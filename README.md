# dandan

**[danielluzhu.github.io/dandan](https://danielluzhu.github.io/dandan)** — what this is, at a glance.

A small site for the events I host — mahjong, hikes, film nights, cabin trips and parties.
Events live on Partiful; this site pulls them in, shows the next one in each category, keeps an
archive of everything that already happened, and collects contact info from people who want in.

## How it works

Partiful sends `x-frame-options: SAMEORIGIN`, so its pages **cannot** be put in an iframe.
Instead, `lib/partiful.js` reads the `__NEXT_DATA__` JSON that every Partiful event page ships and
caches the title, date, timezone, cover image, location and RSVP count in SQLite. The site renders
its own cards from that data and links out to the real RSVP page. Re-syncing refreshes the cache,
so edits made on Partiful show up here.

The server re-syncs on its own: ten seconds after it starts, and every hour after that. Each pass
refreshes only the events that can still change — everything upcoming, everything undated, and
anything that started in the last 48 hours, so the final RSVP count lands — and leaves the rest of
the archive alone. `/admin` shows when data last arrived and whatever failed on the way. Set
`SYNC_INTERVAL_MINUTES` in `.env` to change the hour, or `0` to turn the loop off and sync by hand.
**Re-sync from Partiful** in the dashboard refreshes *every* event, archive included; the timer and
the button share one run, so pressing it mid-sync joins the run in progress rather than doubling
the requests.

## Running it

```bash
cp .env.example .env      # then set ADMIN_PASSWORD and SESSION_SECRET
bun run start             # http://localhost:3000
bun run dev               # same, with auto-reload
```

### Keeping it up

`deploy/dandan.service` runs the site under systemd, so it starts on boot and comes back on its
own if it dies:

```bash
sudo cp deploy/dandan.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dandan

systemctl status dandan
sudo journalctl -u dandan -f     # logs
sudo systemctl restart dandan    # after changing .env or the code
```

The unit deliberately has no `EnvironmentFile`: Bun reads `/workspace/.env` itself, and a real
environment variable beats the file, so pointing systemd at it too would put two parsers on one
file with systemd's reading of an unquoted `SITE_TAGLINE` quietly winning.

The machine proxies the port at `https://<hostname>-3000.another.ac`, behind an
[another](https://access.anothercomputer.co/) sign-in unless the port is opened publicly in the
dashboard. The public page on GitHub Pages needs none of that.

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
bun run sync            # every event
bun run sync --active   # just the ones still ahead
```

### Photos from the night

The archive is otherwise a list of names and dates. Attach one picture per event and it becomes
worth scrolling:

```bash
bun run recap <event-id|partiful-url> photo.jpg "Photographer · CC BY 4.0"
```

It writes the same two sizes the covers use into `public/img/recaps/`. Wherever an event has one,
the archive shows it instead of the invite's cover art — the night itself rather than how it was
advertised — on the live site and the public page both.

"Up next" lists every scheduled event, soonest first; undated ones sit below it
under "On the list". An event moves to the archive automatically, 6 hours after
its start time.

## The List

`/list` is the private view of everyone who has asked to hear about an event: who they are, how to
reach them, and which categories they said they would come to. The toolbar filters and sorts it:
click a category in the tally to narrow to those people, search across name, handle, phone and
note, pick out anyone with a contact detail missing, and sort by name, when they were added, or how
many things they are up for. The filters combine, and the count on the right says how many of the
list you are looking at. The form on the home page writes here, and contacts can also be added and edited by hand —
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

Someone who fills the public form twice is the same person, not a second contact: a repeat
submission is matched on the Instagram handle, unions the categories onto the existing row, keeps
whatever the new one left blank, and joins the notes. Adding a contact by hand in `/list` is a
deliberate act, so that one is left alone.

### Inviting people

`/list/invite` is the join between the list and the calendar — pick an event and get exactly the
people who ticked that series, with the message already written: title, date, place, RSVP link.

- **Copy handles** — comma-separated, ready to paste into a new Instagram group DM
- **Copy message**, or **copy both** at once
- **Text everyone** — opens Messages with the numbers of everyone still checked
- Everyone else is listed below, unchecked, for anyone you want to add anyway

It says how many of the selected people you can actually reach. A list imported from a spreadsheet
is mostly names, and a "copy handles" button that copies an empty string is worse than one that
says so.

`/list` and `/admin` are both behind one password, `ADMIN_PASSWORD` in `.env`. Visiting either
unlocked shows a password prompt; unlocking one unlocks both, and **Lock** in the header clears it.
Nothing about contacts is public — every `/list/*` and `/admin/*` route returns 401 without the
session cookie. The public form has a hidden honeypot field and a per-IP rate limit to keep bots out.

## Layout

```
server.js           routes, password gate, static files
lib/db.js           SQLite schema, categories, queries
lib/partiful.js     fetch + parse a Partiful event
lib/sync.js         the hourly refresh loop and its status
lib/ics.js          the calendar feed
lib/render.js       HTML for the public site, /list and /admin
lib/csv.js          spreadsheet export
public/             styles.css, app.js
scripts/            add-event.js, add-idea.js, add-recap.js, import-contacts.js,
                    sync.js, export-csv.js, build-docs.js, publish.js
docs/               the static copy published to GitHub Pages
deploy/             the systemd unit
data/               events.db + signups.csv (gitignored — never committed)
```

## The public page

The site itself only runs on this machine. [danielluzhu.github.io/dandan](https://danielluzhu.github.io/dandan)
is a static copy of the events that anyone can open whether or not the machine is up. It carries:

- **Up next, on the list and the whole archive**, filterable by series — the chips filter every
  section at once, and the choice goes in the URL so a filtered view can be sent to someone
- **A calendar to subscribe to** at `dandan.ics` — one subscription, and every event added later
  turns up on its own — plus a single `.ics` per upcoming event
- **A page per event** at `e/<id>.html`, each with its own preview tags, so sharing one night
  previews that night instead of the whole site
- **A link preview** built from the next event's cover and details
- **A way to reach you**, if `HOST_INSTAGRAM` is set in `.env`. Left blank the section does not
  render — better than a link pointing at whoever owns the handle you guessed

Pages serves files and cannot reach the database here, so the events are baked in and committed:

```bash
bun run publish            # sync, rebuild, commit and push if anything changed
bun run publish --dry-run  # everything except the commit
bun run build:docs         # rebuild only
```

`publish` is safe on a cron, and one is installed — daily at 07:15, logging to `data/publish.log`:

```
15 7 * * * bun run publish >> /workspace/data/publish.log 2>&1
```

Run `crontab -e` to change or remove it. It only ever commits `docs/`: `data/` and `.env` are
gitignored, and a dirty tree elsewhere is someone mid-edit rather than something to sweep into an
automated commit. The build is deterministic — no clocks in the calendar files, no build date on
the page — so an unchanged calendar never produces a commit that says nothing.

`build:docs` rewrites `docs/index.html` between marker comments, so the hand-written parts of that
page stay editable and re-running is safe. `.github/workflows/pages.yml` deploys on every push to
`main` that touches `docs/`. Pages needs one setting, once: **Settings → Pages → Source: GitHub Actions**.

Only what Partiful already shows publicly goes on it — title, date, location, cover image and RSVP
count — and photo credits travel with the pictures that need them. **The contact list is never read
by the build**: nothing about who signed up leaves this machine.
