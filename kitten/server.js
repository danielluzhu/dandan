// Kitten sitting sign-up: the page, its photos, and a shared reservation list anyone can edit.
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";

const PORT = Number(process.env.KITTEN_PORT || 3333);
const PAGE = new URL("./index.html", import.meta.url).pathname;
const PHOTO_DIR = new URL("./photos/", import.meta.url).pathname;
const DB_PATH = new URL("../data/kitten.db", import.meta.url).pathname;

const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS claims (
  slot TEXT PRIMARY KEY,          -- 'YYYY-MM-DD|<visit index>'
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const SLOT_RE = /^\d{4}-\d{2}-\d{2}\|[01]$/;
const PHOTO_RE = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;

const json = (body, status = 200) => Response.json(body, { status });

function state() {
  const claims = {};
  for (const r of db.query("SELECT slot, name FROM claims").all()) claims[r.slot] = { name: r.name };
  let photos = [];
  try { photos = readdirSync(PHOTO_DIR).filter((f) => PHOTO_RE.test(f)); } catch {}
  return { claims, photos };
}

async function readName(req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  return name || null;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/" || pathname === "/index.html")
      return new Response(Bun.file(PAGE), { headers: { "Content-Type": "text/html; charset=utf-8" } });

    if (pathname.startsWith("/photos/")) {
      const f = decodeURIComponent(pathname.slice(8));
      if (!PHOTO_RE.test(f)) return new Response("Not found", { status: 404 });
      const file = Bun.file(PHOTO_DIR + f);
      return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
    }

    if (pathname === "/api/state" && req.method === "GET") return json(state());

    if (pathname.startsWith("/api/claims/")) {
      const slot = decodeURIComponent(pathname.slice(12));
      if (!SLOT_RE.test(slot)) return json({ error: "bad_slot" }, 400);

      if (req.method === "DELETE") {
        db.query("DELETE FROM claims WHERE slot = ?").run(slot);
        return json(state());
      }
      if (req.method === "POST" || req.method === "PUT") {
        const name = await readName(req);
        if (!name) return json({ error: "name_required" }, 400);
        // POST reserves an open visit only, so two people can't grab the same one;
        // PUT changes whoever is on it.
        if (req.method === "POST") {
          const r = db.query("INSERT OR IGNORE INTO claims (slot, name) VALUES (?, ?)").run(slot, name);
          if (!r.changes) return json({ error: "taken", ...state() }, 409);
        } else {
          db.query(`INSERT INTO claims (slot, name) VALUES (?, ?)
            ON CONFLICT(slot) DO UPDATE SET name = excluded.name, updated_at = datetime('now')`).run(slot, name);
        }
        return json(state());
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`kitten sign-up on http://localhost:${PORT}`);
