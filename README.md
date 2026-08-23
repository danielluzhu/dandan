# dandan

A small site for the events I host — mahjong, hikes, film nights, cabin trips and parties.
Events live on Partiful; this site pulls them in, shows the next one in each category, keeps an
archive of everything that already happened, and collects contact info from people who want in.

## How it works

Partiful sends `x-frame-options: SAMEORIGIN`, so its pages **cannot** be put in an iframe.
Instead, `lib/partiful.js` reads the `__NEXT_DATA__` JSON that every Partiful event page ships and
caches the title, date, timezone, cover image, location and RSVP count in SQLite. The site renders
its own cards from that data and links out to the real RSVP page. Re-syncing refreshes the cache,
so edits made on Partiful show up here.

## Running it

```bash
cp .env.example .env      # then set ADMIN_PASSWORD and SESSION_SECRET
bun run start             # http://localhost:4321
bun run dev               # same, with auto-reload
```

## Adding events

Either paste the Partiful link into the admin dashboard at `/admin`, or from the terminal:

```bash
bun run add https://partiful.com/e/xxxxxxxx            # category auto-detected
bun run add https://partiful.com/e/xxxxxxxx mahjong    # or set it explicitly
```

Categories: `mahjong`, `hikes`, `film`, `cabin`, `parties`, `homeless`, `dining`, `tasting`.
Both long links and `go.partiful.com` short links work.

For something with no Partiful page yet — a hike on the list, a film picked but
unscheduled — add it as an idea. It shows under "On the list" with no RSVP link
until a real event exists:

```bash
bun run idea hikes lands-end-coastal-trail "Lands End Coastal Trail" \
  "3.4 miles · 350 ft gain · out-and-back from the Lands End Lookout." \
  "Lands End Lookout · San Francisco" \
  "/img/lands-end.jpg" "Niranjan Arminius · CC BY-SA 4.0"
```

The last two arguments are optional. The image is a path under `public/img/`;
a `-thumb.jpg` beside it is used for archive rows. To prepare a pair:

```bash
convert source.jpg -resize 900x600^  -gravity center -extent 900x600 -strip -quality 80 public/img/name.jpg
convert source.jpg -resize 224x224^  -gravity center -extent 224x224 -strip -quality 78 public/img/name-thumb.jpg
```

The credit shows in the corner of the image. The hike photos currently on the
site come from Wikimedia Commons under CC BY / CC BY-SA, which require it —
keep the credit accurate if you swap them out.

Refresh cached data for every event (safe to put on a cron):

```bash
bun run sync
```

"Up next" lists every scheduled event, soonest first; undated ones sit below it
under "On the list". An event moves to the archive automatically, 6 hours after
its start time.

## The List

`/list` is the private view of everyone who has asked to hear about an event: who they are, how to
reach them, and which categories they said they would come to, with a tally per category at the
top. The form on the home page writes here, and contacts can also be added and edited by hand —
click a row to open its form, change anything including the category tags, then save. Deleting is
on the same form.

Contact details are an Instagram handle and a phone number; the public form requires both. Handles
are normalised, so `@name`, `name` and `instagram.com/name` all store as `@name` and link through
to the profile from the list.

To bring in a list you already keep elsewhere:

```bash
bun run import <file.csv | google-sheet-url> [--dry-run]
```

It reads a `Name` column and an `Event` column (plus optional `Instagram`, `Phone`, `Note`) and
merges rows by name, so someone listed under three events becomes one contact with three
categories. Event names map onto categories case-insensitively — `Films` to Film Night, `Hike` to
Hikes, and so on; anything unrecognised is reported rather than guessed. Re-running is safe: an
existing contact keeps its details and only gains new categories. A Google Sheet must be shared as
"anyone with the link" for the export to work.

Every change mirrors to `data/signups.csv`, which opens directly in Excel, Numbers or Google
Sheets. The dashboard has a **Download spreadsheet (CSV)** button, and `bun run export` rewrites
the file on demand.

`/list` and `/admin` are both behind one password, `ADMIN_PASSWORD` in `.env`. Visiting either
unlocked shows a password prompt; unlocking one unlocks both, and **Lock** in the header clears it.
Nothing about contacts is public — every `/list/*` and `/admin/*` route returns 401 without the
session cookie. The public form has a hidden honeypot field and a per-IP rate limit to keep bots out.

## Layout

```
server.js           routes, password gate, static files
lib/db.js           SQLite schema, categories, queries
lib/partiful.js     fetch + parse a Partiful event
lib/render.js       HTML for the public site, /list and /admin
lib/csv.js          spreadsheet export
public/             styles.css, app.js
scripts/            add-event.js, add-idea.js, import-contacts.js, sync.js, export-csv.js
data/               events.db + signups.csv (gitignored — never committed)
```

`data/` and `.env` stay out of git, so no contact info or passwords leave this machine.
