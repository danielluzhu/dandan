# personal — Dan Zhu's personal site

A warm, single-page personal site on **port 3002** — the "me outside work" page, and the
one meant for the Instagram bio link (replacing `alcove.place/dandan`).

Three sites now run side by side:

| Port | What | Service |
|------|------|---------|
| 3000 | Events site (invites + archive) | `dandan` |
| 3001 | Professional / investing | `dz-site` |
| 3002 | Personal | `dz-personal` |

## Running it

```bash
bun run start      # http://localhost:3002
bun run dev        # same, auto-reload
```

Keep it up across reboots:

```bash
sudo cp ../deploy/dz-personal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dz-personal
journalctl -u dz-personal -f
```

## Where the content comes from

**Photos** (`public/img/feed/`) were pulled from the public Instagram profile and saved
locally on purpose: Instagram's CDN URLs are signed and expire in about four days, so
hot-linking them would have broken the page within a week. To swap or add photos, drop
JPEGs in that folder and update the `<figure>` list in `public/index.html`. The gallery
is a 4×2 grid — one tall image spanning two rows plus six singles tiles exactly, so keep
that ratio when changing things.

**Hosting numbers and recent events** are read live from the events site's database
(`../data/events.db`, opened read-only) and served from `GET /api/hosting`. Host a new
event on the 3000 site and it shows up here on the next load. If that database is
missing or busy, the whole hosting section hides itself rather than showing empty state.

**Cross-site links** are placeholders in the HTML (`localhost:3000`, `localhost:3001`)
and get rewritten at load by `public/app.js` so they also work through the
`*-PORT.another.ac` proxy.

## Note on visibility

Ports are private by default — the proxy redirects to auth. Open 3002 publicly in the
another dashboard before putting the link in an Instagram bio.
