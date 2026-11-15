import { Database } from "bun:sqlite";

const PORT = Number(process.env.DIARY_PORT || 3030);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DB_PATH = process.env.DIARY_DB || new URL("../data/diary.db", import.meta.url).pathname;
// The to-do app (todo/server.js). To-dos found in the diary are created there.
const TODO_API = (process.env.TODO_URL || "http://localhost:1242").replace(/\/$/, "") + "/api";

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  -- A day: its summary, with the day's notes inside it. (\`notes\` is from before notes were
  -- their own rows; it's moved into the notes table on start and left empty.)
  CREATE TABLE IF NOT EXISTS entries (
    date       TEXT PRIMARY KEY,               -- YYYY-MM-DD
    notes      TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Separate notes within a day, each stamped with when it was written. Deleting one only
  -- marks it, so its history can bring it back.
  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY,
    date       TEXT NOT NULL REFERENCES entries(date) ON DELETE CASCADE,
    body       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,                  -- ISO 8601, UTC
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS notes_date ON notes(date);
  -- Version history, like a doc's: a snapshot of a note (or, with note_id NULL, the day's
  -- summary) after each stretch of editing. \`event\` marks created / deleted / restored.
  CREATE TABLE IF NOT EXISTS revisions (
    id         INTEGER PRIMARY KEY,
    date       TEXT NOT NULL REFERENCES entries(date) ON DELETE CASCADE,
    note_id    INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    event      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS revisions_date ON revisions(date);
  -- Which to-do each diary line created, so saving again never duplicates it.
  -- \`key\` is the line's task text, normalised.
  CREATE TABLE IF NOT EXISTS links (
    id         INTEGER PRIMARY KEY,
    date       TEXT NOT NULL REFERENCES entries(date) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    todo_id    INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (date, key)
  );
`);

class BadRequest extends Error {}

const now = () => new Date().toISOString();
const sqlToIso = (s) => (s && !s.includes("T") ? s.replace(" ", "T") + ".000Z" : s);
// Edits closer together than this are one version, the way a doc's history groups them.
const VERSION_GAP_MS = 10 * 60 * 1000;

/* Add to a note's (or the summary's) history. Plain edits fold into the latest version while
   it's recent; created / deleted / restored always start a new one. */
function record(date, noteId, body, event = null, at = now()) {
  const last = db.query("SELECT * FROM revisions WHERE date = ? AND note_id IS ? ORDER BY id DESC LIMIT 1").get(date, noteId);
  if (!event && last && last.body === body) return;
  if (!event && last && last.event !== "deleted" && Date.parse(at) - Date.parse(last.updated_at) < VERSION_GAP_MS) {
    db.query("UPDATE revisions SET body = ?, updated_at = ? WHERE id = ?").run(body, at, last.id);
    return;
  }
  db.query("INSERT INTO revisions (date, note_id, body, event, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(date, noteId, body, event, at, at);
}

const ensureDay = (date) => db.query("INSERT OR IGNORE INTO entries (date) VALUES (?)").run(date);

// One-time move of each day's single block of notes into a first note, timed at its last save.
db.transaction(() => {
  for (const e of db.query("SELECT * FROM entries WHERE notes != ''").all()) {
    const at = sqlToIso(e.updated_at);
    if (e.notes.trim()) {
      const n = db.query("INSERT INTO notes (date, body, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id").get(e.date, e.notes, at, at);
      record(e.date, n.id, e.notes, "created", at);
    }
    if (e.summary.trim() && !db.query("SELECT 1 FROM revisions WHERE date = ? AND note_id IS NULL").get(e.date))
      record(e.date, null, e.summary, "created", at);
    db.query("UPDATE entries SET notes = '' WHERE date = ?").run(e.date);
  }
})();

// Each note falls into one of the to-do list's projects. It's worked out from the note's words
// and the projects' keywords (project_auto) until you pick one yourself. (These columns were
// briefly theme_id / theme_auto.)
if (db.query("SELECT 1 FROM pragma_table_info('notes') WHERE name = 'theme_id'").get())
  db.exec("ALTER TABLE notes RENAME COLUMN theme_id TO project_id; ALTER TABLE notes RENAME COLUMN theme_auto TO project_auto");
if (!db.query("SELECT 1 FROM pragma_table_info('notes') WHERE name = 'project_id'").get())
  db.exec("ALTER TABLE notes ADD COLUMN project_id INTEGER; ALTER TABLE notes ADD COLUMN project_auto INTEGER NOT NULL DEFAULT 1");

const liveNotes = (date) => db.query("SELECT * FROM notes WHERE date = ? AND deleted_at IS NULL ORDER BY created_at, id").all(date);
// Everything written on a day, for finding to-dos.
const dayText = (date) => [...liveNotes(date).map((n) => n.body), getDay(date).summary].join("\n");
// The day's to-do lines, each with the project of the note it's in: a to-do whose own words
// don't place it lands in its note's project.
function dayTodos(date) {
  const seen = new Set();
  const notes = [...liveNotes(date), { body: db.query("SELECT summary FROM entries WHERE date = ?").get(date)?.summary ?? "", project_id: null }];
  return notes.flatMap((n) => findTodos(n.body).map((f) => ({ ...f, project_id: n.project_id })))
    .filter((f) => !seen.has(f.key) && seen.add(f.key));
}

/* Work out an automatically-placed note's project from its words. Leaves it be if the to-do
   list can't be reached. */
async function autoProject(note) {
  if (!note?.project_auto) return note;
  try {
    const { project } = note.body.trim() ? await todoApi("POST", "classify", { text: note.body }) : { project: null };
    return db.query("UPDATE notes SET project_id = ? WHERE id = ? RETURNING *").get(project?.id ?? null, note.id);
  } catch { return note; }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- finding to-dos in diary text ----------
   A line is a to-do when it's written as one:
     - [ ] call the vet          [ ] call the vet          todo: call the vet
   or when a sentence says so:
     "…long day. Need to clean the toilet tomorrow."  → clean the toilet tomorrow
   Ticked boxes (- [x] …) are to-dos already done. Free prose is left alone. */
const SENTENCE_RE = /\b(?:i\s+)?(?:really\s+)?(?:need to|have to|gotta|got to|remember to|don'?t forget to|should really|todo:?|to-do:?)\s+([^.;\n]+)/gi;

export function findTodos(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const box = line.match(/^(?:[-*•+]\s*)?\[( |x|X)?\]\s*(.+)$/);
    if (box) { out.push({ text: box[2].trim(), done: !!box[1]?.trim() }); continue; }
    const tagged = line.match(/^(?:[-*•+]\s*)?(?:todo|to-do|to do)\s*[:\-]\s*(.+)$/i);
    if (tagged) { out.push({ text: tagged[1].trim(), done: false }); continue; }
    for (const m of line.matchAll(SENTENCE_RE)) {
      // Cut at a change of thought, and drop end punctuation — an exclamation in a sentence
      // isn't the "!" that marks a to-do urgent.
      const t = m[1].replace(/[,\s]+(?:but|because|since|though|so)\b.*$/i, "").replace(/[\s,!?:]+$/, "").trim();
      if (/^(?:say|admit|agree|wonder|laugh|wait and see)\b/i.test(t)) continue;  // "I have to say…"
      if (t && t.split(/\s+/).length <= 14) out.push({ text: t, done: false });
    }
  }
  const seen = new Set();
  return out
    .map((t) => ({ ...t, key: keyOf(t.text) }))
    .filter((t) => t.key && !seen.has(t.key) && seen.add(t.key));
}

const keyOf = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

async function todoApi(method, path, body) {
  const res = await fetch(`${TODO_API}/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `To-do list said ${res.status}`), { status: res.status });
  return data;
}

const prettyDate = (d) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/* Create to-dos for any new to-do lines in an entry, tick off the ones written as done, and
   when a line was edited rather than added (its old text is gone and one contains the other),
   rename its to-do instead of making a second one. Never deletes a to-do. */
const syncing = new Map();  // date → the sync in flight, so two saves can't both create a to-do
function syncTodos(date, link) {
  const run = (syncing.get(date) || Promise.resolve()).then(() => syncOnce(date, link));
  syncing.set(date, run.catch(() => {}));
  return run;
}

async function syncOnce(date, link) {
  const found = dayTodos(date);
  const links = db.query("SELECT * FROM links WHERE date = ?").all(date);
  const byKey = new Map(links.map((l) => [l.key, l]));
  const orphans = links.filter((l) => !found.some((f) => f.key === l.key));
  const errors = [], created = [];
  for (const f of found) {
    try {
      let l = byKey.get(f.key);
      if (!l) {
        const was = orphans.find((o) => f.key.startsWith(o.key) || o.key.startsWith(f.key));
        if (was) {
          orphans.splice(orphans.indexOf(was), 1);
          const [parsed] = (await todoApi("POST", "capture", { text: f.text, dry: true })).items;
          await todoApi("PATCH", `todos/${was.todo_id}`, { title: parsed?.title || f.text });
          db.query("UPDATE links SET key = ? WHERE id = ?").run(f.key, was.id);
          l = { ...was, key: f.key };
        } else {
          const { items } = await todoApi("POST", "capture", { text: f.text, default_project_id: f.project_id, notes: `From Daily, ${prettyDate(date)}${link ? `\n${link}` : ""}` });
          if (!items[0]?.todo) continue;
          created.push({ title: items[0].todo.title, project: items[0].project_name });
          l = db.query("INSERT INTO links (date, key, todo_id) VALUES (?, ?, ?) RETURNING *").get(date, f.key, items[0].todo.id);
        }
      }
      if (f.done) await todoApi("PATCH", `todos/${l.todo_id}`, { done: true }).catch((e) => { if (e.status !== 404) throw e; });
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { errors, created };
}

/* The to-dos an entry links to, as the to-do list has them now. Lines since removed from the
   entry drop out of view, but their link is kept so retyping them doesn't make a duplicate. */
async function linkedTodos(date) {
  const keys = new Set(findTodos(dayText(date)).map((f) => f.key));
  const links = db.query("SELECT * FROM links WHERE date = ? ORDER BY id").all(date).filter((l) => keys.has(l.key));
  if (!links.length) return { todos: [], projects: [] };
  const state = await todoApi("GET", "state");
  const byId = new Map(state.todos.map((t) => [t.id, t]));
  const todos = links.map((l) => byId.get(l.todo_id)).filter(Boolean);
  const pids = new Set(todos.map((t) => t.project_id));
  return { todos, projects: state.projects.filter((p) => pids.has(p.id)) };
}

function getDay(date) {
  const e = db.query("SELECT date, summary, updated_at FROM entries WHERE date = ?").get(date);
  const summarized = db.query("SELECT created_at, updated_at FROM revisions WHERE date = ? AND note_id IS NULL ORDER BY id").all(date);
  return {
    date,
    summary: e?.summary ?? "",
    summary_created_at: summarized[0]?.created_at ?? null,
    summary_updated_at: summarized.at(-1)?.updated_at ?? null,
    notes: e ? liveNotes(date) : [],
  };
}

// Saves while typing keep the text; to-dos are made once a line is finished (`extract`).
const linkOf = (body) => (typeof body.link === "string" ? body.link.slice(0, 500) : "");
async function afterSave(date, body, payload) {
  const sync = body.extract ? await syncTodos(date, linkOf(body)) : {};
  return json({ ...payload, errors: sync.errors || [], created: sync.created || [] });
}

/* A day's history, newest first. Each version carries the one before it (of the same note
   or summary) so the page can show what changed. */
function history(date) {
  const revs = db.query("SELECT * FROM revisions WHERE date = ? ORDER BY id").all(date);
  const prev = new Map();
  const out = revs.map((r) => {
    const key = r.note_id ?? "summary";
    const before = prev.get(key);
    prev.set(key, r.body);
    return { ...r, before: before ?? "" };
  });
  const notes = db.query("SELECT id, created_at, deleted_at, body FROM notes WHERE date = ?").all(date);
  return { revisions: out.reverse(), notes };
}

/* Put a note (or the summary) back the way a version had it. A deleted note comes back too. */
function restore(revId) {
  const r = db.query("SELECT * FROM revisions WHERE id = ?").get(revId);
  if (!r) throw new BadRequest("No such version");
  const at = now();
  db.transaction(() => {
    if (r.note_id == null) db.query("UPDATE entries SET summary = ?, updated_at = datetime('now') WHERE date = ?").run(r.body, r.date);
    else db.query("UPDATE notes SET body = ?, updated_at = ?, deleted_at = NULL WHERE id = ?").run(r.body, at, r.note_id);
    record(r.date, r.note_id, r.body, "restored", at);
  })();
  return r.date;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function api(req, url) {
  const [resource, arg, sub] = url.pathname.split("/").filter(Boolean).slice(1);
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : null;

  // Every day with something written, newest first, with a snippet for the sidebar.
  if (resource === "entries" && !arg && req.method === "GET") {
    return json(db.query(`
      SELECT e.date, substr(CASE WHEN trim(e.summary) != '' THEN e.summary
          ELSE (SELECT n.body FROM notes n WHERE n.date = e.date AND n.deleted_at IS NULL AND trim(n.body) != '' ORDER BY n.created_at LIMIT 1) END, 1, 140) AS snippet,
        (SELECT COUNT(*) FROM notes n WHERE n.date = e.date AND n.deleted_at IS NULL AND trim(n.body) != '') AS note_count,
        (SELECT group_concat(DISTINCT n.project_id) FROM notes n WHERE n.date = e.date AND n.deleted_at IS NULL AND n.project_id IS NOT NULL) AS projects
      FROM entries e
      WHERE trim(e.summary) != '' OR EXISTS (SELECT 1 FROM notes n WHERE n.date = e.date AND n.deleted_at IS NULL AND trim(n.body) != '')
      ORDER BY e.date DESC`).all());
  }

  if (resource === "entries" && arg) {
    if (!DATE_RE.test(arg)) throw new BadRequest("Dates look like 2026-11-15");
    if (req.method === "GET" && !sub) {
      // Notes not yet placed in a project get one on view.
      for (const n of liveNotes(arg)) if (n.project_auto && n.project_id == null && n.body.trim()) await autoProject(n);
      return json(getDay(arg));
    }
    // The day's summary. POST too, so a save can go out with the page as it closes.
    if ((req.method === "PUT" || req.method === "POST") && !sub) {
      const summary = String(body.summary ?? "").slice(0, 20000);
      db.transaction(() => {
        ensureDay(arg);
        db.query("UPDATE entries SET summary = ?, updated_at = datetime('now') WHERE date = ?").run(summary, arg);
        const first = !db.query("SELECT 1 FROM revisions WHERE date = ? AND note_id IS NULL").get(arg);
        if (!first || summary.trim()) record(arg, null, summary, first ? "created" : null);
        // A page loaded before notes were separate still sends the day's notes as one block:
        // keep it in the day's first note rather than lose it.
        if (typeof body.notes === "string") {
          const at = now(), first = liveNotes(arg)[0];
          if (first) { db.query("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?").run(body.notes, at, first.id); record(arg, first.id, body.notes, null, at); }
          else if (body.notes.trim()) {
            const n = db.query("INSERT INTO notes (date, body, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING id").get(arg, body.notes, at, at);
            record(arg, n.id, body.notes, "created", at);
          }
        }
      })();
      return afterSave(arg, body, { day: getDay(arg) });
    }
    // A new note, stamped now.
    if (req.method === "POST" && sub === "notes") {
      const at = now();
      const text = String(body.body ?? "").slice(0, 200000);
      const note = db.transaction(() => {
        ensureDay(arg);
        const n = db.query("INSERT INTO notes (date, body, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *").get(arg, text, at, at);
        record(arg, n.id, text, "created", at);
        return n;
      })();
      return afterSave(arg, body, { note: await autoProject(note) });
    }
    if (req.method === "GET" && sub === "todos") {
      try { return json(await linkedTodos(arg)); }
      catch (err) { return json({ todos: [], projects: [], error: `Couldn't reach the to-do list: ${err.message}` }); }
    }
    if (req.method === "GET" && sub === "history") return json(history(arg));
  }

  if (resource === "notes" && arg) {
    const note = db.query("SELECT * FROM notes WHERE id = ?").get(Number(arg));
    if (!note) return json({ error: "Not found" }, 404);
    if (req.method === "PUT" || req.method === "POST") {
      const text = String(body.body ?? "").slice(0, 200000);
      const at = now();
      const saved = db.transaction(() => {
        const n = db.query("UPDATE notes SET body = ?, updated_at = ?, deleted_at = NULL WHERE id = ? RETURNING *").get(text, at, note.id);
        record(note.date, note.id, text, null, at);
        return n;
      })();
      // The project follows the words once a line is finished, like to-dos do.
      return afterSave(note.date, body, { note: body.extract ? await autoProject(saved) : saved });
    }
    // Pick the note's project yourself ({project_id}, null for none), or hand it back to {auto: true}.
    if (req.method === "PATCH") {
      if (body.auto) return json({ note: await autoProject(db.query("UPDATE notes SET project_auto = 1 WHERE id = ? RETURNING *").get(note.id)) });
      const pid = body.project_id == null || body.project_id === "" ? null : Number(body.project_id);
      return json({ note: db.query("UPDATE notes SET project_id = ?, project_auto = 0 WHERE id = ? RETURNING *").get(pid, note.id) });
    }
    if (req.method === "DELETE") {
      db.transaction(() => {
        db.query("UPDATE notes SET deleted_at = ? WHERE id = ?").run(now(), note.id);
        // An empty note leaves no trace; one with writing can be restored from history.
        if (note.body.trim()) record(note.date, note.id, note.body, "deleted");
        else db.query("DELETE FROM notes WHERE id = ?").run(note.id);
      })();
      return json({ ok: true });
    }
  }

  if (resource === "revisions" && arg && sub === "restore" && req.method === "POST") {
    const date = restore(Number(arg));
    return json({ day: getDay(date) });
  }

  // The projects notes can fall into: the to-do list's, minus archived ones.
  if (resource === "projects" && req.method === "GET") {
    try {
      const projects = await todoApi("GET", "projects");
      return json(projects.filter((p) => !p.archived).map(({ id, name, color, parent_id }) => ({ id, name, color, parent_id })));
    } catch { return json([]); }
  }

  // Tick a linked to-do from the diary.
  if (resource === "todos" && arg && req.method === "PATCH") {
    return json(await todoApi("PATCH", `todos/${Number(arg)}`, { done: !!body.done }));
  }

  // What's due today or overdue on the to-do list, for the side panel.
  if (resource === "due" && req.method === "GET") {
    const today = url.searchParams.get("today");
    if (!DATE_RE.test(today || "")) throw new BadRequest("Pass ?today=YYYY-MM-DD");
    try {
      const state = await todoApi("GET", "state");
      const archived = new Set(state.projects.filter((p) => p.archived).map((p) => p.id));
      const todos = state.todos.filter((t) => !t.done && t.due_date && t.due_date <= today && !archived.has(t.project_id)).sort((a, b) => a.due_date.localeCompare(b.due_date));
      return json({ todos, projects: state.projects });
    } catch (err) { return json({ todos: [], projects: [], error: `Couldn't reach the to-do list: ${err.message}` }); }
  }

  return json({ error: "Not found" }, 404);
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(req, url);
      } catch (err) {
        if (err instanceof BadRequest) return json({ error: err.message }, 400);
        console.error(err);
        return json({ error: err.message || "Server error" }, err.status || 500);
      }
    }
    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(new URL(path, PUBLIC_DIR));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "cache-control": "no-cache" } });
  },
});

console.log(`daily listening on http://localhost:${server.port}`);
