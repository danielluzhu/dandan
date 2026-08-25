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
    image_thumb  TEXT,
    image_credit TEXT,
    location     TEXT,
    going_count  INTEGER DEFAULT 0,
    hidden       INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT NOT NULL,
    synced_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS signups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    instagram   TEXT,
    phone       TEXT,
    categories  TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL
  );
`);

// Older databases predate the two-size image columns.
const cols = db.query("PRAGMA table_info(events)").all().map((c) => c.name);
if (!cols.includes("image_thumb")) db.exec("ALTER TABLE events ADD COLUMN image_thumb TEXT");
// Creative Commons photos need their credit stored alongside them.
if (!cols.includes("image_credit")) db.exec("ALTER TABLE events ADD COLUMN image_credit TEXT");

// A past event can carry one photo from the night itself, kept in the repo.
if (!cols.includes("recap_image")) db.exec("ALTER TABLE events ADD COLUMN recap_image TEXT");
if (!cols.includes("recap_thumb")) db.exec("ALTER TABLE events ADD COLUMN recap_thumb TEXT");
if (!cols.includes("recap_credit")) db.exec("ALTER TABLE events ADD COLUMN recap_credit TEXT");

// Contacts used to carry an email; the form now asks for an Instagram handle instead.
const sCols = db.query("PRAGMA table_info(signups)").all().map((c) => c.name);
if (!sCols.includes("instagram")) {
  db.exec("ALTER TABLE signups ADD COLUMN instagram TEXT");
  if (sCols.includes("email")) db.exec("UPDATE signups SET instagram = email WHERE instagram IS NULL AND email IS NOT NULL");
}

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

/** An idea with no Partiful link yet: still an event, just nothing to RSVP to. */
export function addManualEvent({
  id, title, description, category, location, startDate = null,
  imageUrl = null, imageThumb = null, imageCredit = null,
}) {
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO events (id, url, category, title, description, start_date, timezone,
                        image_url, image_thumb, image_credit, location, hidden, added_at, synced_at)
    VALUES ($id, '', $category, $title, $description, $start_date, 'America/Los_Angeles',
            $image_url, $image_thumb, $image_credit, $location, 0, $now, $now)
    ON CONFLICT(id) DO UPDATE SET
      category = $category, title = $title, description = $description,
      start_date = $start_date, location = $location, synced_at = $now,
      image_url = $image_url, image_thumb = $image_thumb, image_credit = $image_credit
  `).run({
    $id: id, $category: category, $title: title, $description: description,
    $start_date: startDate, $location: location ?? null, $now: now,
    $image_url: imageUrl, $image_thumb: imageThumb ?? imageUrl, $image_credit: imageCredit,
  });
  return id;
}

export function upsertEvent(ev, category) {
  const now = new Date().toISOString();
  const existing = db.query("SELECT category, hidden FROM events WHERE id = ?").get(ev.id);
  const cat = category || existing?.category || guessCategory(ev);
  db.query(`
    INSERT INTO events (id, url, category, title, description, start_date, end_date,
                        timezone, image_url, image_thumb, image_credit, location, going_count, hidden, added_at, synced_at)
    VALUES ($id, $url, $category, $title, $description, $start_date, $end_date,
            $timezone, $image_url, $image_thumb, $image_credit, $location, $going_count, $hidden, $added_at, $synced_at)
    ON CONFLICT(id) DO UPDATE SET
      url = $url, category = $category, title = $title, description = $description,
      start_date = $start_date, end_date = $end_date, timezone = $timezone,
      image_url = $image_url, image_thumb = $image_thumb, image_credit = $image_credit, location = $location, going_count = $going_count,
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
    $image_thumb: ev.imageThumb ?? ev.imageUrl,
    $image_credit: ev.imageCredit ?? null,
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
/**
 * Events with no date yet. These get their own section rather than competing for
 * a category's single card, so adding a second undated hike does not hide the first.
 */
export function undatedEvents() {
  return db.query("SELECT * FROM events WHERE hidden = 0 AND start_date IS NULL ORDER BY added_at ASC").all();
}

export function pastEvents() {
  return allEvents().filter(isPast);
}

/** Every scheduled event still to come, soonest first. */
export function upcomingEvents() {
  return db
    .query("SELECT * FROM events WHERE hidden = 0 AND start_date IS NOT NULL ORDER BY start_date ASC")
    .all()
    .filter((r) => !isPast(r));
}

/** Accepts "@name", "name", or an instagram.com/name URL and returns "@name". */
export function normalizeInstagram(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (fromUrl ? fromUrl[1] : raw).replace(/^@+/, "").replace(/\/+$/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : "";
}

/**
 * The public form, where the same person may well fill it in twice — months
 * apart, or because they forgot. A second row would split their categories
 * across two contacts and quietly under-count who wants what, which is exactly
 * the mess `bun run import` goes to the trouble of merging.
 *
 * The handle is the identity: it is normalised, required by the form, and
 * unlike a name it is actually unique. Matching by name would merge two
 * different people who share one.
 *
 * @returns {{ id: number, merged: boolean }}
 */
export function upsertSignup({ name, instagram, phone, categories, note }) {
  const existing = instagram
    ? db.query("SELECT * FROM signups WHERE instagram = ? COLLATE NOCASE").get(instagram)
    : null;

  if (!existing) return { id: addSignup({ name, instagram, phone, categories, note }), merged: false };

  // Union the categories: saying "hikes" today does not retract "mahjong" from before.
  const merged = [...new Set([
    ...String(existing.categories || "").split(",").filter(Boolean),
    ...categories,
  ])];

  // Anything they typed this time wins; anything they left blank keeps what we had.
  const notes = [existing.note, note].filter(Boolean);
  db.query(`
    UPDATE signups SET name = ?, phone = ?, categories = ?, note = ?
    WHERE id = ?
  `).run(
    name || existing.name,
    phone || existing.phone,
    merged.join(","),
    notes.length ? [...new Set(notes)].join(" · ") : null,
    existing.id,
  );
  return { id: existing.id, merged: true };
}

export function addSignup({ name, instagram, phone, categories, note }) {
  const info = db.query(`
    INSERT INTO signups (name, instagram, phone, categories, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, instagram || null, phone || null, categories.join(","), note || null, new Date().toISOString());
  return info.lastInsertRowid;
}

export function allSignups() {
  return db.query("SELECT * FROM signups ORDER BY created_at DESC").all();
}

export function getSignup(id) {
  return db.query("SELECT * FROM signups WHERE id = ?").get(Number(id));
}

export function updateSignup(id, { name, instagram, phone, categories, note }) {
  db.query(`
    UPDATE signups SET name = ?, instagram = ?, phone = ?, categories = ?, note = ?
    WHERE id = ?
  `).run(name, instagram || null, phone || null, categories.join(","), note || null, Number(id));
}

/** Attach (or replace) the photo shown against a past event. */
export function setRecap(id, { image, thumb, credit }) {
  const info = db.query("UPDATE events SET recap_image = ?, recap_thumb = ?, recap_credit = ? WHERE id = ?")
    .run(image, thumb ?? image, credit ?? null, id);
  return info.changes > 0;
}

export function deleteSignup(id) {
  db.query("DELETE FROM signups WHERE id = ?").run(Number(id));
}
