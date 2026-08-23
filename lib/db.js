import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });

export const db = new Database(new URL("../data/events.db", import.meta.url).pathname);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    category     TEXT NOT NULL,
    title        TEXT,
    description  TEXT,
    start_date   TEXT,
    end_date     TEXT,
    timezone     TEXT,
    image_url    TEXT,
    location     TEXT,
    going_count  INTEGER DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT NOT NULL,
    synced_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS signups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    categories  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL
  );
`);

export const CATEGORIES = [
  { slug: "mahjong", label: "Mahjong",     emoji: "\u{1F004}", blurb: "Tiles, snacks, mild trash talk." },
  { slug: "hikes",   label: "Hikes",       emoji: "\u{1F97E}", blurb: "Trails, early starts, good views." },
  { slug: "film",    label: "Film Night",  emoji: "\u{1F3AC}", blurb: "Projector on, phones away." },
  { slug: "cabin",   label: "Cabin Trips", emoji: "\u{1F6D6}", blurb: "Weekends out of town." },
  { slug: "parties", label: "Parties",     emoji: "\u{1F389}", blurb: "The big ones." },
  { slug: "homeless", label: "Homeless",  emoji: "\u{1F9F3}", blurb: "Whole weekends, no fixed address." },
  { slug: "dining",  label: "Dining",    emoji: "\u{1F35C}", blurb: "Long tables, many dishes." },
  { slug: "tasting", label: "Drink Tasting", emoji: "\u{1F377}", blurb: "Bottles lined up, notes taken." },
];

export const categoryBySlug = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

export function upsertEvent(ev, category) {
  const now = new Date().toISOString();
  const existing = db.query("SELECT category, hidden FROM events WHERE id = ?").get(ev.id);
  const cat = category || existing?.category || guessCategory(ev);
  db.query(`
    INSERT INTO events (id, url, category, title, description, start_date, end_date,
                        timezone, image_url, location, going_count, hidden, added_at, synced_at)
    VALUES ($id, $url, $category, $title, $description, $start_date, $end_date,
            $timezone, $image_url, $location, $going_count, $hidden, $added_at, $synced_at)
    ON CONFLICT(id) DO UPDATE SET
      url = $url, category = $category, title = $title, description = $description,
      start_date = $start_date, end_date = $end_date, timezone = $timezone,
      image_url = $image_url, location = $location, going_count = $going_count,
      synced_at = $synced_at
  `).run({
    $id: ev.id,
    $url: ev.url,
    $category: cat,
    $title: ev.title,
    $description: ev.description,
    $start_date: ev.startDate,
    $end_date: ev.endDate,
    $timezone: ev.timezone,
    $image_url: ev.imageUrl,
    $location: ev.location,
    $going_count: ev.goingCount ?? 0,
    $hidden: existing?.hidden ?? 0,
    $added_at: now,
    $synced_at: now,
  });
  return cat;
}

const KEYWORDS = [
  ["mahjong", /mahjong|mah jong|\u{1F004}|tiles?\b|riichi|orphans/iu],
  ["hikes",   /hike|hiking|trail|summit|peak|ridge|\u{1F97E}|walk\b|backpack/iu],
  ["film",    /film|movie|cinema|screening|watch night|\u{1F3AC}|projector|double feature/iu],
  ["cabin",   /cabin|tahoe|yosemite|lodge|retreat|getaway|weekend away|\u{1F6D6}/iu],
  ["homeless",/homeless|\u{1F9F3}/iu],
  ["tasting", /tasting|wine|whisk|sake|soju|cocktail|mezcal|tequila|beer|natty|somm|\u{1F377}|\u{1F943}/iu],
  ["dining",  /dinner|dining|noodle|brunch|lunch|feast|supper|hot ?pot|omakase|tasting menu|\u{1F35C}|\u{1F37D}/iu],
  ["parties", /party|birthday|housewarming|potluck|dinner|nye|new year|\u{1F389}|bash|rager/iu],
];

export function guessCategory(ev) {
  const hay = `${ev.title || ""} ${ev.description || ""}`;
  for (const [slug, re] of KEYWORDS) if (re.test(hay)) return slug;
  return "parties";
}

const isPast = (row) => {
  if (!row.start_date) return false;
  // Treat an event as "past" 6h after it starts, so same-night visitors still see it as current.
  return new Date(row.start_date).getTime() + 6 * 3600 * 1000 < Date.now();
};

export function allEvents() {
  return db.query("SELECT * FROM events WHERE hidden = 0 ORDER BY start_date DESC").all();
}

/** Soonest upcoming event per category, keyed by category slug. */
export function nextByCategory() {
  const out = {};
  // NULLs last, so a scheduled event always outranks one that is still "date TBD".
  const rows = db.query("SELECT * FROM events WHERE hidden = 0 ORDER BY start_date IS NULL, start_date ASC").all();
  for (const row of rows) {
    if (isPast(row)) continue;
    if (!out[row.category]) out[row.category] = row;
  }
  return out;
}

export function pastEvents() {
  return allEvents().filter(isPast);
}

export function upcomingEvents() {
  return allEvents()
    .filter((r) => !isPast(r))
    .sort((a, b) => (a.start_date || "\uffff").localeCompare(b.start_date || "\uffff"));
}

export function addSignup({ name, email, phone, categories, note }) {
  const info = db.query(`
    INSERT INTO signups (name, email, phone, categories, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, email || null, phone || null, categories.join(","), note || null, new Date().toISOString());
  return info.lastInsertRowid;
}

export function allSignups() {
  return db.query("SELECT * FROM signups ORDER BY created_at DESC").all();
}
