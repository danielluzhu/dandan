// Kitten sitting sign-up: the page, its photos, and a shared reservation list anyone can edit.
import { Database } from "bun:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";

const PORT = Number(process.env.KITTEN_PORT || 3333);
const PAGE = new URL("./index.html", import.meta.url).pathname;
const PHOTO_DIR = new URL("./photos/", import.meta.url).pathname;
const DB_PATH = new URL("../data/kitten.db", import.meta.url).pathname;
// Photos visitors upload; kept out of git with the rest of data/.
const UPLOAD_DIR = new URL("../data/kitten-photos/", import.meta.url).pathname;
mkdirSync(UPLOAD_DIR, { recursive: true });

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
db.run(`CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',  -- who uploaded it, if they said
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// Sign-offs for recurring chores (replace the water, empty the bin...): who did it, and on which day.
db.run(`CREATE TABLE IF NOT EXISTS chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,             -- task id from the page's care config
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
const TASK_RE = /^[a-z0-9-]{1,40}$/;
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
  const uploads = db.query("SELECT id, file, name FROM photos ORDER BY id").all();
  const chores = db.query("SELECT id, task, date, name FROM chores ORDER BY date DESC, id DESC").all();
  return { reservations, times: TIMES, photos, uploads, chores };
}

// Validates a reservation body; returns { name, time } or an error code.
async function readReservation(req) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 60);
  const time = TIMES.includes(body.time) ? body.time : "Flexible";
  if (!name) return { error: "name_required" };
  return { name, time, dates: body.dates };
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const UPLOAD_RE = /^up-[a-z0-9-]+\.jpg$/;

// Name the decoder from the file's first bytes, so ImageMagick never guesses
// a format (SVG, MVG, ...) from untrusted input.
function sniff(b) {
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8, 4))) return "heic";
  return null;
}

// Re-encode as a resized JPEG: fixes rotation and strips metadata such as GPS location.
async function savePhoto(file) {
  if (file.size > MAX_PHOTO_BYTES) return { error: "too_big" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fmt = sniff(bytes);
  if (!fmt) return { error: "not_an_image" };
  const name = `up-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.jpg`;
  const proc = Bun.spawn(["convert", `${fmt}:-[0]`, "-auto-orient", "-resize", "1600x1600>", "-strip", "-quality", "85", `jpeg:${UPLOAD_DIR}${name}`],
    { stdin: bytes, stdout: "ignore", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 30000);
  const code = await proc.exited;
  clearTimeout(timer);
  if (code !== 0) { rmSync(UPLOAD_DIR + name, { force: true }); return { error: "unreadable" }; }
  return { file: name };
}

Bun.serve({
  port: PORT,
  maxRequestBodySize: 10 * MAX_PHOTO_BYTES,
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

    if (pathname.startsWith("/uploads/")) {
      const f = decodeURIComponent(pathname.slice(9));
      if (!UPLOAD_RE.test(f)) return new Response("Not found", { status: 404 });
      const file = Bun.file(UPLOAD_DIR + f);
      return (await file.exists()) ? new Response(file, { headers: { "Content-Type": "image/jpeg" } }) : new Response("Not found", { status: 404 });
    }

    if (pathname === "/api/state" && req.method === "GET") return json(state());

    // Anyone can add photos of the kittens (up to 10 at a time) and remove uploaded ones.
    if (pathname === "/api/photos" && req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const files = form ? form.getAll("photos").filter((f) => f instanceof Blob).slice(0, 10) : [];
      if (!files.length) return json({ error: "no_files" }, 400);
      const name = String(form.get("name") ?? "").trim().slice(0, 60);
      const insert = db.query("INSERT INTO photos (file, name) VALUES (?, ?)");
      let failed = 0;
      for (const f of files) {
        const r = await savePhoto(f);
        if (r.error) failed++; else insert.run(r.file, name);
      }
      return json({ ...state(), failed }, failed === files.length ? 400 : 200);
    }
    const ph = /^\/api\/photos\/(\d+)$/.exec(pathname);
    if (ph && req.method === "DELETE") {
      const row = db.query("SELECT file FROM photos WHERE id = ?").get(Number(ph[1]));
      if (row) { db.query("DELETE FROM photos WHERE id = ?").run(Number(ph[1])); rmSync(UPLOAD_DIR + row.file, { force: true }); }
      return json(state());
    }

    // Sign off a chore as done on a given day; anyone can remove a sign-off made by mistake.
    if (pathname === "/api/chores" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const task = String(body.task ?? ""), date = String(body.date ?? "");
      const name = String(body.name ?? "").trim().slice(0, 60);
      if (!name) return json({ error: "name_required" }, 400);
      if (!TASK_RE.test(task) || !DATE_RE.test(date)) return json({ error: "bad_request" }, 400);
      db.query("INSERT INTO chores (task, date, name) VALUES (?, ?, ?)").run(task, date, name);
      return json(state());
    }
    const ch = /^\/api\/chores\/(\d+)$/.exec(pathname);
    if (ch && req.method === "DELETE") {
      db.query("DELETE FROM chores WHERE id = ?").run(Number(ch[1]));
      return json(state());
    }

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
