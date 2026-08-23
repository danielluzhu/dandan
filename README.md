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
  "Lands End Lookout · San Francisco"
```

Refresh cached data for every event (safe to put on a cron):

```bash
bun run sync
```

"Up next" lists every scheduled event, soonest first; undated ones sit below it
under "On the list". An event moves to the archive automatically, 6 hours after
its start time.

## Signups

The form on the home page writes to the `signups` table and mirrors every submission to
`data/signups.csv`, which opens directly in Excel, Numbers or Google Sheets. The dashboard also has
a **Download spreadsheet (CSV)** button, and `bun run export` rewrites the file on demand.

Signups are only visible behind the `/admin` password — nothing about them is public.
The form has a hidden honeypot field and a per-IP rate limit to keep bots out.

## Layout

```
server.js           routes, admin auth, static files
lib/db.js           SQLite schema, categories, queries
lib/partiful.js     fetch + parse a Partiful event
lib/render.js       HTML for the public site and the dashboard
lib/csv.js          spreadsheet export
public/             styles.css, app.js
scripts/            add-event.js, add-idea.js, sync.js, export-csv.js
data/               events.db + signups.csv (gitignored — never committed)
```

`data/` and `.env` stay out of git, so no contact info or passwords leave this machine.
