import { Database } from "bun:sqlite";

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
`);

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
  if ("done" in body) {
    out.done = body.done ? 1 : 0;
    out.completed_at = body.done ? new Date().toISOString() : null;
  }
  return out;
}

function cleanProject(body, partial) {
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
  return out;
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

const listProjects = () =>
  db.query(`
    SELECT p.*,
      (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id AND t.done = 0) AS open_count,
      (SELECT COUNT(*) FROM todos t WHERE t.project_id = p.id) AS total_count
    FROM projects p ORDER BY p.created_at, p.id`).all();

const listTodos = () => db.query("SELECT * FROM todos ORDER BY done, created_at DESC, id DESC").all();

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

  if (resource === "state" && req.method === "GET") return json({ projects: listProjects(), todos: listTodos() });

  if (resource === "projects") {
    if (id === null) {
      if (req.method === "GET") return json(listProjects());
      if (req.method === "POST") return json(insert("projects", cleanProject(body, false)), 201);
    } else {
      if (req.method === "GET") return json(db.query("SELECT * FROM projects WHERE id = ?").get(id) ?? null) ;
      if (req.method === "PATCH") return json(update("projects", id, cleanProject(body, true)) ?? null);
      if (req.method === "DELETE") {
        const r = db.query("DELETE FROM projects WHERE id = ?").run(id);
        return r.changes ? json({ ok: true }) : notFound();
      }
    }
  }

  if (resource === "todos") {
    if (id === null) {
      if (req.method === "GET") return json(listTodos());
      if (req.method === "POST") return json(insert("todos", cleanTodo(body, false)), 201);
    } else {
      if (req.method === "GET") return json(db.query("SELECT * FROM todos WHERE id = ?").get(id) ?? null);
      if (req.method === "PATCH") return json(update("todos", id, cleanTodo(body, true)) ?? null);
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
