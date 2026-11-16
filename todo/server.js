import { Database } from "bun:sqlite";
import { STARTER_PROJECTS, parseText, projectFor } from "./capture.js";

const PORT = Number(process.env.TODO_PORT || 1242);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DB_PATH = process.env.TODO_DB || new URL("../data/todo.db", import.meta.url).pathname;

const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT '#6c5ad8',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS todos (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    label        TEXT CHECK (label IN ('urgent', 'north_star')),
    due_date     TEXT,
    done         INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS todos_project ON todos(project_id);
  CREATE TABLE IF NOT EXISTS sections (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    collapsed   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// Subsections arrived after todos; deleting one drops its tasks back to "no subsection".
if (!db.query("SELECT 1 FROM pragma_table_info('todos') WHERE name = 'section_id'").get())
  db.exec("ALTER TABLE todos ADD COLUMN section_id INTEGER REFERENCES sections(id) ON DELETE SET NULL");
// Each North Star is also a sub-project: other tasks can live inside it (one level deep).
if (!db.query("SELECT 1 FROM pragma_table_info('todos') WHERE name = 'parent_id'").get())
  db.exec("ALTER TABLE todos ADD COLUMN parent_id INTEGER REFERENCES todos(id) ON DELETE CASCADE");
// Projects nest: a project can live inside another, any depth deep.
if (!db.query("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'parent_id'").get())
  db.exec("ALTER TABLE projects ADD COLUMN parent_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
// Archived projects (and everything inside them) drop out of the lists but keep their tasks.
if (!db.query("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'archived_at'").get())
  db.exec("ALTER TABLE projects ADD COLUMN archived_at TEXT");
// Any project can have keywords: tasks and Daily notes fall into the one they match most.
if (!db.query("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'keywords'").get())
  db.exec("ALTER TABLE projects ADD COLUMN keywords TEXT NOT NULL DEFAULT ''");
// Projects and "themes" were briefly separate lists; they're all just projects now.
if (db.query("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'is_theme'").get())
  db.exec("ALTER TABLE projects DROP COLUMN is_theme");
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");

/* Start with Work, Health, Social and Domestic, each with keywords. A top-level project
   already called one of those (or e.g. "home" for Domestic) takes them on instead, keeping
   everything inside it. Runs once, so deleted or renamed ones stay that way. */
if (!db.query("SELECT 1 FROM settings WHERE key = 'themes_seeded'").get()) {
  db.transaction(() => {
    for (const t of STARTER_PROJECTS) {
      const existing = db.query("SELECT * FROM projects WHERE parent_id IS NULL AND keywords = ''").all()
        .find((p) => t.aliases.includes(p.name.trim().toLowerCase()));
      if (existing)
        db.query("UPDATE projects SET name = ?, keywords = ?, description = CASE WHEN description = '' THEN ? ELSE description END WHERE id = ?")
          .run(t.name, t.keywords.join(", "), t.description, existing.id);
      else
        db.query("INSERT INTO projects (name, description, color, keywords) VALUES (?, ?, ?, ?)")
          .run(t.name, t.description, t.color, t.keywords.join(", "));
    }
    db.query("INSERT INTO settings (key, value) VALUES ('themes_seeded', ?)").run(new Date().toISOString());
  })();
}

const LABELS = new Set(["urgent", "north_star", null]);

class BadRequest extends Error {}

/* Validate a todo/project payload; `partial` allows omitting fields on PATCH. */
function cleanTodo(body, partial) {
  const out = {};
  if (!partial || "title" in body) {
    const title = String(body.title ?? "").trim();
    if (!title) throw new BadRequest("Title is required");
    out.title = title.slice(0, 500);
  }
  if ("notes" in body) out.notes = String(body.notes ?? "").slice(0, 10000);
  if ("label" in body) {
    const label = body.label || null;
    if (!LABELS.has(label)) throw new BadRequest("Label must be urgent, north_star or empty");
    out.label = label;
  }
  if ("due_date" in body) {
    const d = body.due_date || null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequest("Due date must be YYYY-MM-DD");
    out.due_date = d;
  }
  if ("project_id" in body) {
    const pid = body.project_id == null || body.project_id === "" ? null : Number(body.project_id);
    if (pid !== null && !db.query("SELECT 1 FROM projects WHERE id = ?").get(pid))
      throw new BadRequest("No such project");
    out.project_id = pid;
  }
  if ("parent_id" in body)
    out.parent_id = body.parent_id == null || body.parent_id === "" ? null : Number(body.parent_id);
  if ("section_id" in body)
    out.section_id = body.section_id == null || body.section_id === "" ? null : Number(body.section_id);
  if ("done" in body) {
    out.done = body.done ? 1 : 0;
    out.completed_at = body.done ? new Date().toISOString() : null;
  }
  return out;
}

/* A project's ancestors, nearest first. */
function ancestorsOf(id) {
  const out = [];
  for (let cur = db.query("SELECT parent_id FROM projects WHERE id = ?").get(id)?.parent_id; cur != null && !out.includes(cur);
       cur = db.query("SELECT parent_id FROM projects WHERE id = ?").get(cur)?.parent_id) out.push(cur);
  return out;
}

function cleanProject(body, partial, id = null) {
  const out = {};
  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequest("Name is required");
    out.name = name.slice(0, 200);
  }
  if ("description" in body) out.description = String(body.description ?? "").slice(0, 5000);
  if ("color" in body) {
    if (!/^#[0-9a-f]{6}$/i.test(body.color || "")) throw new BadRequest("Color must be #rrggbb");
    out.color = body.color;
  }
  if ("parent_id" in body) {
    const pid = body.parent_id == null || body.parent_id === "" ? null : Number(body.parent_id);
    if (pid !== null) {
      if (!db.query("SELECT 1 FROM projects WHERE id = ?").get(pid)) throw new BadRequest("No such project");
      if (id != null && (pid === id || ancestorsOf(pid).includes(id)))
        throw new BadRequest("A project can't go inside itself or one of its own sub-projects");
    }
    out.parent_id = pid;
  }
  if ("archived" in body) out.archived_at = body.archived ? new Date().toISOString() : null;
  if ("keywords" in body) out.keywords = String(body.keywords ?? "").slice(0, 10000);
  return out;
}

/* Rules for tasks inside a North Star: the parent must be a top-level North Star, a
   child can't itself be a North Star, and a child always shares its parent's project
   and subsection. Moving a child elsewhere by project/subsection takes it out. */
function fitParent(fields, existing) {
  const label = "label" in fields ? fields.label : existing?.label ?? null;
  if (existing?.parent_id != null && !("parent_id" in fields) &&
      (("project_id" in fields && fields.project_id !== existing.project_id) ||
       ("section_id" in fields && fields.section_id !== existing.section_id))) fields.parent_id = null;
  const parentId = "parent_id" in fields ? fields.parent_id : existing?.parent_id ?? null;
  if (parentId != null) {
    const parent = db.query("SELECT * FROM todos WHERE id = ?").get(parentId);
    if (!parent || parent.label !== "north_star" || parent.parent_id != null || parent.id === existing?.id)
      throw new BadRequest("Tasks can only go inside a North Star");
    if (label === "north_star") throw new BadRequest("A North Star can't go inside another North Star");
    if ("parent_id" in fields) { fields.project_id = parent.project_id; fields.section_id = parent.section_id; }
  }
  if (existing?.label === "north_star" && "label" in fields && label !== "north_star") {
    const n = db.query("SELECT COUNT(*) n FROM todos WHERE parent_id = ?").get(existing.id).n;
    if (n) throw new BadRequest(`This North Star has ${n} task${n === 1 ? "" : "s"} inside — move them out first`);
  }
  return fields;
}

/* A task's subsection must belong to its project; moving projects clears it. */
function fitSection(fields, existing) {
  const projectId = "project_id" in fields ? fields.project_id : existing?.project_id ?? null;
  if ("project_id" in fields && !("section_id" in fields) && existing?.section_id != null &&
      fields.project_id !== existing.project_id) fields.section_id = null;
  if (fields.section_id != null) {
    const sec = db.query("SELECT project_id FROM sections WHERE id = ?").get(fields.section_id);
    if (!sec || sec.project_id !== projectId) throw new BadRequest("That subsection isn't in this task's project");
  }
  return fields;
}

function cleanSection(body, partial) {
  const out = {};
  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new BadRequest("Name is required");
    out.name = name.slice(0, 200);
  }
  if (!partial) {
    const pid = Number(body.project_id);
    if (!db.query("SELECT 1 FROM projects WHERE id = ?").get(pid)) throw new BadRequest("No such project");
    out.project_id = pid;
    out.position = db.query("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM sections WHERE project_id = ?").get(pid).n;
  }
  if ("collapsed" in body) out.collapsed = body.collapsed ? 1 : 0;
  return out;
}

/* Swap a subsection with its neighbour; positions are renumbered so gaps never matter. */
function moveSection(id, dir) {
  const sec = db.query("SELECT * FROM sections WHERE id = ?").get(id);
  if (!sec) return null;
  const ids = db.query("SELECT id FROM sections WHERE project_id = ? ORDER BY position, id").all(sec.project_id).map((r) => r.id);
  const i = ids.indexOf(id), j = i + dir;
  if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
  const set = db.query("UPDATE sections SET position = ? WHERE id = ?");
  db.transaction(() => ids.forEach((sid, n) => set.run(n, sid)))();
  return db.query("SELECT * FROM sections WHERE id = ?").get(id);
}

function insert(table, fields) {
  const keys = Object.keys(fields);
  const sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")}) RETURNING *`;
  return db.query(sql).get(...keys.map((k) => fields[k]));
}

function update(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return db.query(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(",")} WHERE id = ? RETURNING *`;
  return db.query(sql).get(...keys.map((k) => fields[k]), id);
}

// `archived` is 1 when the project or any project it sits inside is archived.
const listProjects = () =>
  db.query(`
    WITH RECURSIVE arch(id) AS (
      SELECT id FROM projects WHERE archived_at IS NOT NULL
      UNION SELECT p.id FROM projects p JOIN arch a ON p.parent_id = a.id
    )
    SELECT p.*, p.id IN (SELECT id FROM arch) AS archived,
      (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.done = 0) AS open_count,
      (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id) AS total_count
    FROM projects p ORDER BY p.created_at, p.id`).all();

const listSections = () => db.query("SELECT * FROM sections ORDER BY project_id, position, id").all();

const listTodos = () => db.query("SELECT * FROM todos ORDER BY done, created_at DESC, id DESC").all();

// The projects writing can be sorted into: active ones with keywords.
const listKeyworded = () => listProjects().filter((p) => !p.archived && p.keywords.trim());

/* Free-form capture: each line of `text` becomes a task, filed into the project its
   #tag names (created if missing), else the project its words match the keywords of, else
   `default_project_id` (Daily passes a note's project), else the Inbox. On a project page
   the page passes `project_id`, and lines without a #tag go there instead. `choices`, lined
   up with the parsed lines, overrides that per line: `{project_id}` (null = Inbox) and/or
   `{section_id}`. With `dry`, nothing is written — the parse comes back so the page can
   preview it. */
function capture(body) {
  const items = parseText(body.text);
  if (items.length > 100) throw new BadRequest("That's more than 100 lines — split it up");
  const notes = String(body.notes ?? "").slice(0, 10000);
  // Never file into an archived project; an active one of the same name (or a new one) instead.
  const projects = listProjects().filter((p) => !p.archived).map(({ id, name }) => ({ id, name }));
  const find = (names) => {
    for (const n of names) {
      const p = projects.find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
      if (p) return p;
    }
    return null;
  };
  const keyworded = listKeyworded();
  const fallback = body.default_project_id != null ? projects.find((p) => p.id === Number(body.default_project_id)) ?? null : null;
  // `project_id` (the project page you're on) takes every line without a #tag, ahead of keywords.
  const here = body.project_id != null ? projects.find((p) => p.id === Number(body.project_id)) ?? null : null;
  const resolve = (it) => {
    if (it.project) return find([it.project]) || { id: null, name: it.project };
    return here || projectFor(it.title, keyworded) || fallback;
  };
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const sectionIn = (sid, pid) => {
    if (sid == null || sid === "" || pid == null) return null;
    const sec = db.query("SELECT id, project_id FROM sections WHERE id = ?").get(Number(sid));
    if (!sec || sec.project_id !== pid) throw new BadRequest("That subsection isn't in the chosen project");
    return sec.id;
  };
  return db.transaction(() => items.map((it, i) => {
    const choice = choices[i] && typeof choices[i] === "object" ? choices[i] : {};
    let p;
    if ("project_id" in choice) {
      p = choice.project_id == null || choice.project_id === "" ? null : projects.find((x) => x.id === Number(choice.project_id));
      if (p === undefined) throw new BadRequest("That project doesn't exist or is archived");
    } else p = resolve(it);
    const section_id = sectionIn(choice.section_id, p?.id ?? null);
    const out = { ...it, project_id: p?.id ?? null, project_name: p?.name ?? null, new_project: !!p && p.id == null, section_id };
    if (body.dry) return out;
    if (p && p.id == null) {
      p = insert("projects", { name: p.name });
      projects.push(p);
    }
    out.todo = insert("todos", { title: it.title, label: it.label, due_date: it.due_date, project_id: p?.id ?? null, section_id, notes });
    out.project_id = p?.id ?? null;
    return out;
  }))();
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const notFound = () => json({ error: "Not found" }, 404);

async function api(req, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
  const [resource, rawId] = parts;
  const id = rawId === undefined ? null : Number(rawId);
  const body = ["POST", "PATCH"].includes(req.method) ? await req.json().catch(() => ({})) : null;

  if (resource === "state" && req.method === "GET") return json({ projects: listProjects(), sections: listSections(), todos: listTodos() });

  // Which project a piece of writing falls into, by keywords (Daily asks this for each note).
  if (resource === "classify" && req.method === "POST") {
    const p = projectFor(String(body.text ?? "").slice(0, 200000), listKeyworded());
    return json({ project: p ? { id: p.id, name: p.name, color: p.color } : null });
  }
  if (resource === "capture" && req.method === "POST") return json({ items: capture(body) }, body.dry ? 200 : 201);

  if (resource === "projects") {
    if (id === null) {
      if (req.method === "GET") return json(listProjects());
      if (req.method === "POST") return json(insert("projects", cleanProject(body, false)), 201);
    } else {
      if (req.method === "GET") return json(db.query("SELECT * FROM projects WHERE id = ?").get(id) ?? null) ;
      if (req.method === "PATCH") return json(update("projects", id, cleanProject(body, true, id)) ?? null);
      if (req.method === "DELETE") {
        // Sub-projects survive their parent: they move up a level.
        const r = db.transaction(() => {
          db.query("UPDATE projects SET parent_id = (SELECT parent_id FROM projects WHERE id = ?) WHERE parent_id = ?").run(id, id);
          return db.query("DELETE FROM projects WHERE id = ?").run(id);
        })();
        return r.changes ? json({ ok: true }) : notFound();
      }
    }
  }

  if (resource === "sections") {
    if (id === null) {
      if (req.method === "GET") return json(listSections());
      if (req.method === "POST") return json(insert("sections", cleanSection(body, false)), 201);
    } else {
      if (req.method === "PATCH") {
        if (body.move === -1 || body.move === 1) return json(moveSection(id, body.move));
        return json(update("sections", id, cleanSection(body, true)) ?? null);
      }
      if (req.method === "DELETE") {
        const r = db.query("DELETE FROM sections WHERE id = ?").run(id);
        return r.changes ? json({ ok: true }) : notFound();
      }
    }
  }

  if (resource === "todos") {
    if (id === null) {
      if (req.method === "GET") return json(listTodos());
      if (req.method === "POST") return json(insert("todos", fitSection(fitParent(cleanTodo(body, false), null), null)), 201);
    } else {
      if (req.method === "GET") return json(db.query("SELECT * FROM todos WHERE id = ?").get(id) ?? null);
      if (req.method === "PATCH") {
        const existing = db.query("SELECT * FROM todos WHERE id = ?").get(id);
        if (!existing) return notFound();
        const fields = fitSection(fitParent(cleanTodo(body, true), existing), existing);
        const updated = db.transaction(() => {
          const row = update("todos", id, fields);
          // Children travel with their North Star.
          if (row.project_id !== existing.project_id || row.section_id !== existing.section_id)
            db.query("UPDATE todos SET project_id = ?, section_id = ? WHERE parent_id = ?").run(row.project_id, row.section_id, id);
          return row;
        })();
        return json(updated);
      }
      if (req.method === "DELETE") {
        const r = db.query("DELETE FROM todos WHERE id = ?").run(id);
        return r.changes ? json({ ok: true }) : notFound();
      }
    }
  }
  return notFound();
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        const res = await api(req, url);
        // A GET/PATCH on a missing row returns null from the helpers above.
        if (res.status === 200 && (await res.clone().text()) === "null") return notFound();
        return res;
      } catch (err) {
        if (err instanceof BadRequest) return json({ error: err.message }, 400);
        console.error(err);
        return json({ error: "Server error" }, 500);
      }
    }

    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(new URL(path, PUBLIC_DIR));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "cache-control": "no-cache" } });
  },
});

console.log(`todo listening on http://localhost:${server.port}`);
