// Kitten sitting sign-up: the page, its photos, and a shared reservation list anyone can edit.
import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";

const PORT = Number(process.env.KITTEN_PORT || 3333);
const PAGE = new URL("./index.html", import.meta.url).pathname;
const PHOTO_DIR = new URL("./photos/", import.meta.url).pathname;
const DB_PATH = new URL("../data/kitten.db", import.meta.url).pathname;

// Rough time of day a sitter plans to come; the page shows these in this order.
const TIMES = ["Morning", "Midday", "Afternoon", "Evening", "Flexible"];

const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
// Any number of sitters per day, each with a rough time of day.
db.run(`CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  name TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT 'Flexible',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// The first version allowed one sitter per day in `claims`; carry those over once.
if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'claims'").get()) {
  db.transaction(() => {
    db.run(`INSERT INTO reservations (date, name, time, created_at, updated_at)
      SELECT substr(slot, 1, 10), name, 'Flexible', updated_at, updated_at FROM claims`);
    db.run("DROP TABLE claims");
  })();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHOTO_RE = /^[a-z0-9_-]+\.(jpe?g|png|webp)$/i;
const ICONS = {
  "/favicon.svg": "image/svg+xml",
  "/favicon.ico": "image/x-icon",
  "/apple-touch-icon.png": "image/png",
};

const json = (body, status = 200) => Response.json(body, { status });

function state() {
  const reservations = db.query("SELECT id, date, name, time FROM reservations ORDER BY date, id").all();
  let photos = [];
  try { photos = readdirSync(PHOTO_DIR).filter((f) => PHOTO_RE.test(f)); } catch {}
  return { reservations, times: TIMES, photos };
}

// Validates a reservation body; returns { name, time } or an error code.
async function readReservation(req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  const time = TIMES.includes(body.time) ? body.time : "Flexible";
  if (!name) return { error: "name_required" };
  return { name, time, dates: body.dates };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/" || pathname === "/index.html")
      return new Response(Bun.file(PAGE), { headers: { "Content-Type": "text/html; charset=utf-8" } });

    if (ICONS[pathname])
      return new Response(Bun.file(new URL("." + pathname, import.meta.url).pathname), {
        headers: { "Content-Type": ICONS[pathname], "Cache-Control": "public, max-age=86400" },
      });

    if (pathname.startsWith("/photos/")) {
      const f = decodeURIComponent(pathname.slice(8));
      if (!PHOTO_RE.test(f)) return new Response("Not found", { status: 404 });
      const file = Bun.file(PHOTO_DIR + f);
      return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
    }

    if (pathname === "/api/state" && req.method === "GET") return json(state());

    // Reserve one or more days under one name and time of day.
    if (pathname === "/api/reservations" && req.method === "POST") {
      const r = await readReservation(req);
      if (r.error) return json({ error: r.error }, 400);
      const dates = Array.isArray(r.dates) ? [...new Set(r.dates)] : [];
      if (!dates.length || dates.length > 60 || !dates.every((d) => DATE_RE.test(d))) return json({ error: "bad_dates" }, 400);
      const insert = db.query("INSERT INTO reservations (date, name, time) VALUES (?, ?, ?)");
      db.transaction(() => { for (const d of dates) insert.run(d, r.name, r.time); })();
      return json(state());
    }

    const m = /^\/api\/reservations\/(\d+)$/.exec(pathname);
    if (m) {
      const id = Number(m[1]);
      if (req.method === "DELETE") {
        db.query("DELETE FROM reservations WHERE id = ?").run(id);
        return json(state());
      }
      if (req.method === "PUT") {
        const r = await readReservation(req);
        if (r.error) return json({ error: r.error }, 400);
        const res = db.query("UPDATE reservations SET name = ?, time = ?, updated_at = datetime('now') WHERE id = ?").run(r.name, r.time, id);
        if (!res.changes) return json({ error: "gone", ...state() }, 404);
        return json(state());
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`kitten sign-up on http://localhost:${PORT}`);
