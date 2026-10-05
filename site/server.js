import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.SITE_PORT || 3001);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DATA_DIR = new URL("../data/", import.meta.url);

mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(new URL("pitches.db", DATA_DIR).pathname);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS pitches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    company    TEXT,
    link       TEXT,
    stage      TEXT,
    sector     TEXT,
    note       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const insertPitch = db.query(
  `INSERT INTO pitches (name, email, company, link, stage, sector, note)
   VALUES ($name, $email, $company, $link, $stage, $sector, $note)`
);

/* ---------- submission throttle: 3 per IP per hour ---------- */

const recent = new Map(); // ip -> timestamps
function throttled(ip) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 3;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const trim = (v, max) => String(v ?? "").trim().slice(0, max);

async function handlePitch(req, ip) {
  if (throttled(ip)) return json({ error: "Too many submissions from this address. Try again later." }, 429);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }

  const name = trim(body.name, 120);
  const email = trim(body.email, 200);
  const note = trim(body.note, 4000);

  if (!name) return json({ error: "Name is required." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "A valid email is required." }, 400);
  if (note.length < 20) return json({ error: "Tell me a little more — at least a couple of sentences." }, 400);

  insertPitch.run({
    $name: name,
    $email: email,
    $company: trim(body.company, 160) || null,
    $link: trim(body.link, 500) || null,
    $stage: trim(body.stage, 60) || null,
    $sector: trim(body.sector, 60) || null,
    $note: note,
  });

  return json({ ok: true });
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "unknown";

    if (url.pathname === "/api/pitch") {
      if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      return handlePitch(req, ip);
    }

    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (path.includes("..")) return new Response("Not found", { status: 404 });

    const file = Bun.file(new URL(path, PUBLIC_DIR));
    if (await file.exists()) {
      // Assets keep their filenames when they're edited, so a long max-age pins
      // a stale copy in the browser until it expires. Revalidate every time
      // instead: unchanged files cost a 304, and edits show up on reload.
      const lastModified = new Date(file.lastModified).toUTCString();
      const headers = { "cache-control": "no-cache", "last-modified": lastModified };
      if (req.headers.get("if-modified-since") === lastModified) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(file, { headers });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`site → http://localhost:${server.port}`);
