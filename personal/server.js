import { Database } from "bun:sqlite";

const PORT = Number(process.env.PERSONAL_PORT || 3002);
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const EVENTS_DB = new URL("../data/events.db", import.meta.url).pathname;

/* The events site owns this database; we only ever read from it. */
const db = new Database(EVENTS_DB, { readonly: true });

const CATEGORY_LABEL = {
  mahjong: "Mahjong", hikes: "Hikes", film: "Film Night", cabin: "Cabin Trips",
  parties: "Parties", homeless: "Road Trips", dining: "Dining", tasting: "Drink Tasting",
};

function hostingStats() {
  const totals = db
    .query("SELECT COUNT(*) events, COALESCE(SUM(going_count),0) rsvps FROM events WHERE hidden = 0")
    .get();
  const byCat = db
    .query(`SELECT category, COUNT(*) n FROM events WHERE hidden = 0 GROUP BY category ORDER BY n DESC`)
    .all()
    .map((r) => ({ ...r, label: CATEGORY_LABEL[r.category] || r.category }));
  return { ...totals, byCat };
}

function recentEvents(limit = 8) {
  return db
    .query(
      `SELECT title, category, start_date, image_url, image_thumb, going_count, location
       FROM events
       WHERE hidden = 0 AND image_url IS NOT NULL AND start_date IS NOT NULL
       ORDER BY start_date DESC LIMIT ?`
    )
    .all(limit)
    .map((e) => ({ ...e, label: CATEGORY_LABEL[e.category] || e.category }));
}

const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/hosting") {
      try {
        return json({ stats: hostingStats(), recent: recentEvents() });
      } catch {
        // The events DB may be mid-write or absent; the page degrades without it.
        return json({ stats: null, recent: [] });
      }
    }

    const path = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (path.includes("..")) return new Response("Not found", { status: 404 });

    const file = Bun.file(new URL(path, PUBLIC_DIR));
    if (await file.exists()) {
      // Photos get replaced under the same filenames, so revalidate rather than
      // pinning a stale copy in the browser for a day.
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

console.log(`personal → http://localhost:${server.port}`);
