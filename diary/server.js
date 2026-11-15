import { Database } from "bun:sqlite";

const PORT = Number(process.env.DIARY_PORT || 3030);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DB_PATH = process.env.DIARY_DB || new URL("../data/diary.db", import.meta.url).pathname;
// The to-do app (todo/server.js). To-dos found in the diary are created there.
const TODO_API = (process.env.TODO_URL || "http://localhost:1242").replace(/\/$/, "") + "/api";

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    date       TEXT PRIMARY KEY,               -- YYYY-MM-DD
    notes      TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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
function syncTodos(date, entry, link) {
  const run = (syncing.get(date) || Promise.resolve()).then(() => syncOnce(date, entry, link));
  syncing.set(date, run.catch(() => {}));
  return run;
}

async function syncOnce(date, entry, link) {
  const found = findTodos(entry.notes + "\n" + entry.summary);
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
          const { items } = await todoApi("POST", "capture", { text: f.text, notes: `From my diary, ${prettyDate(date)}${link ? `\n${link}` : ""}` });
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
async function linkedTodos(date, entry) {
  const keys = new Set(findTodos(entry.notes + "\n" + entry.summary).map((f) => f.key));
  const links = db.query("SELECT * FROM links WHERE date = ? ORDER BY id").all(date).filter((l) => keys.has(l.key));
  if (!links.length) return { todos: [], projects: [] };
  const state = await todoApi("GET", "state");
  const byId = new Map(state.todos.map((t) => [t.id, t]));
  const todos = links.map((l) => byId.get(l.todo_id)).filter(Boolean);
  const pids = new Set(todos.map((t) => t.project_id));
  return { todos, projects: state.projects.filter((p) => pids.has(p.id)) };
}

const getEntry = (date) => db.query("SELECT * FROM entries WHERE date = ?").get(date) || { date, notes: "", summary: "", updated_at: null };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function api(req, url) {
  const [resource, arg, sub] = url.pathname.split("/").filter(Boolean).slice(1);
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : null;

  // Every day with something written, newest first, with a snippet for the sidebar.
  if (resource === "entries" && !arg && req.method === "GET") {
    return json(db.query(`
      SELECT date, substr(CASE WHEN trim(summary) != '' THEN summary ELSE notes END, 1, 140) AS snippet, updated_at
      FROM entries WHERE trim(notes) != '' OR trim(summary) != '' ORDER BY date DESC`).all());
  }

  if (resource === "entries" && arg) {
    if (!DATE_RE.test(arg)) throw new BadRequest("Dates look like 2026-11-15");
    if (req.method === "GET" && !sub) return json(getEntry(arg));
    // POST too, so a save can go out with the page as it closes.
    if ((req.method === "PUT" || req.method === "POST") && !sub) {
      const notes = String(body.notes ?? "").slice(0, 200000);
      const summary = String(body.summary ?? "").slice(0, 20000);
      const entry = db.query(`
        INSERT INTO entries (date, notes, summary, updated_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(date) DO UPDATE SET notes = excluded.notes, summary = excluded.summary, updated_at = excluded.updated_at
        RETURNING *`).get(arg, notes, summary);
      // Saves while typing keep the text; to-dos are made once a line is finished.
      const sync = body.extract ? await syncTodos(arg, entry, typeof body.link === "string" ? body.link.slice(0, 500) : "") : {};
      return json({ entry, errors: sync.errors || [], created: sync.created || [] });
    }
    if (req.method === "GET" && sub === "todos") {
      try { return json(await linkedTodos(arg, getEntry(arg))); }
      catch (err) { return json({ todos: [], projects: [], error: `Couldn't reach the to-do list: ${err.message}` }); }
    }
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

console.log(`diary listening on http://localhost:${server.port}`);
