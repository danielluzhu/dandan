# site — Dan Zhu, personal / investing page

A single-page professional site on **port 3001**: operator→investor positioning, with a
pitch form that captures inbound deal flow to SQLite.

Live via the proxy at **https://dan-3001.another.ac** (the events site stays on 3000).

## Running it

```bash
bun run start      # http://localhost:3001
bun run dev        # same, auto-reload
```

Keep it up across reboots:

```bash
sudo cp ../deploy/dz-site.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dz-site
journalctl -u dz-site -f
```

## Inbound pitches

The form posts JSON to `POST /api/pitch`, which validates and writes to
`/workspace/data/pitches.db` (gitignored — submissions never leave this machine).
Three submissions per IP per hour.

```bash
bun run pitches            # newest 20, formatted
bun run pitches -- --all
bun run pitches -- --csv > pitches.csv
```

## Editing the copy

Everything lives in `public/index.html` — there is no build step and no template layer.
Sections are marked with comments (`HERO`, `TRACK RECORD`, `INVESTING`, `ROOTS`, `CONTACT`).

### Facts that still need your input

The page was written from the publicly visible half of the LinkedIn profile; the
Experience section itself is behind auth, so these are deliberately written vague and
should be tightened with real details:

- **Amazon** — title, team, dates, and one concrete thing you shipped.
- **Reach** — what it actually did. The current copy is generic on purpose.
- **EvoEco** — your title and dates; the product description is from public coverage.
- **Blue Ocean** — your current affiliation per LinkedIn, not yet on the page because
  I don't know what it is.
- **Investing** — check size, number of investments, and any portfolio logos you want
  named. The page currently says "pre-seed and seed" without a dollar figure.
- **University of Washington** — degree and graduation year.
