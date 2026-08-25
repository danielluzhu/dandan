#!/usr/bin/env bun
/**
 * Publish the events onto the project page.
 *
 * GitHub Pages serves static files and cannot reach the SQLite file on this
 * machine, so the event list has to be baked in here and committed. Run this
 * after a sync — `bun run build:docs` — then commit docs/ and push; the Pages
 * workflow does the rest.
 *
 * Only what is already public on Partiful goes in: title, date, location, cover
 * image and RSVP count. Nothing from the contact list is read at all.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { upcomingEvents, undatedEvents, pastEvents, categoryBySlug } from "../lib/db.js";
import { esc, fmtLong, countdown } from "../lib/render.js";
import { buildIcs } from "../lib/ics.js";

const DOCS = new URL("../docs/", import.meta.url);
const PAGE = new URL("index.html", DOCS);
/** Pages serves this repo from a subpath, and og:image only accepts absolute URLs. */
const BASE = "https://danielluzhu.github.io/dandan/";

/**
 * Whoever lands on this page has no way to reach me otherwise — the signup form
 * lives on the machine at home, which is not always up. Set HOST_INSTAGRAM in
 * .env to switch the invitation on; left unset, the page says nothing rather
 * than shipping a link to a stranger's profile.
 */
const HANDLE = (process.env.HOST_INSTAGRAM || "").trim().replace(/^@+/, "");

const year = (iso, tz) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", year: "numeric" }).format(new Date(iso));
const shortDate = (iso, tz) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(iso));

/**
 * Ideas carry local cover images under public/img. The site serves those from
 * the root, but Pages serves this page from /dandan/, so absolute paths would
 * 404 — they get copied into docs/img and rewritten relative.
 */
const src = (url) => (url?.startsWith("/img/") ? url.slice(1) : url);

function cover(ev, cat, eager) {
  if (!ev.image_url) return `<span class="ev__fallback">${cat.emoji}</span>`;
  const loading = eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"';
  const img = `<img src="${esc(src(ev.image_url))}" alt="" width="900" height="600" ${loading}>`;
  // Creative Commons photos may only be used with their attribution attached.
  return ev.image_credit ? `${img}<figcaption>${esc(ev.image_credit)}</figcaption>` : img;
}

function eventCard(ev, i) {
  const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
  const soon = countdown(ev.start_date);
  return `
      <article class="ev" data-category="${esc(ev.category)}" style="--c: var(--c-${esc(ev.category)})">
        <figure class="ev__media">${cover(ev, cat, i < 2)}</figure>
        <div class="ev__body">
          <p class="ev__meta">
            <span class="ev__cat">${cat.emoji} ${esc(cat.label)}</span>
            ${soon ? `<span class="ev__soon">${esc(soon)}</span>` : ""}
          </p>
          <h3 class="ev__title"><a href="e/${esc(ev.id)}.html">${esc(ev.title)}</a></h3>
          <p class="ev__when">${esc(fmtLong(ev.start_date, ev.timezone))}</p>
          ${ev.location ? `<p class="ev__where">${esc(ev.location)}</p>` : ""}
          <p class="ev__foot">
            <a class="btn btn--sm" href="${esc(ev.url)}" target="_blank" rel="noopener">RSVP on Partiful</a>
            <a class="ev__cal" href="e/${esc(ev.id)}.ics" download>Add to calendar</a>
            ${ev.going_count ? `<span class="ev__going">${ev.going_count} going</span>` : ""}
          </p>
        </div>
      </article>`;
}

function ideaCard(ev) {
  const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
  return `
      <article class="ev ev--idea" data-category="${esc(ev.category)}" style="--c: var(--c-${esc(ev.category)})">
        <figure class="ev__media">${cover(ev, cat, false)}</figure>
        <div class="ev__body">
          <p class="ev__meta">
            <span class="ev__cat">${cat.emoji} ${esc(cat.label)}</span>
            <span class="ev__soon">Date TBD</span>
          </p>
          <h3 class="ev__title"><a href="e/${esc(ev.id)}.html">${esc(ev.title)}</a></h3>
          ${ev.description ? `<p class="ev__desc">${esc(ev.description)}</p>` : ""}
          ${ev.location ? `<p class="ev__where">${esc(ev.location)}</p>` : ""}
          ${ev.url ? `<p class="ev__foot">
            <a class="btn btn--sm" href="${esc(ev.url)}" target="_blank" rel="noopener">See it on Partiful</a>
          </p>` : ""}
        </div>
      </article>`;
}

function archiveSection(past) {
  const byYear = new Map();
  for (const ev of past) {
    const y = ev.start_date ? year(ev.start_date, ev.timezone) : "Undated";
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(ev);
  }
  const years = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return years.map(([y, evs]) => `
      <div class="yr">
        <h3 class="yr__label">${esc(y)}</h3>
        <ul class="past">
          ${evs.map((ev) => {
            const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
            const tag = "a";
            const href = ` href="e/${esc(ev.id)}.html"`;
            return `<li data-category="${esc(ev.category)}"><${tag} class="past__row"${href} style="--c: var(--c-${esc(ev.category)})">
            ${ev.recap_thumb
              ? `<img class="past__pic" src="${esc(src(ev.recap_thumb))}" alt="" width="56" height="56" loading="lazy" decoding="async"${ev.recap_credit ? ` title="${esc(ev.recap_credit)}"` : ""}>`
              : `<span class="past__dot"></span>`}
            <span class="past__title">${esc(ev.title)}</span>
            <span class="past__cat">${cat.emoji} ${esc(cat.label)}</span>
            <time class="past__date">${ev.start_date ? esc(shortDate(ev.start_date, ev.timezone)) : "—"}</time>
          </${tag}></li>`;
          }).join("\n          ")}
        </ul>
      </div>`).join("\n");
}

/**
 * What a link to this page looks like when it is pasted somewhere. Without an
 * og:image, a site whose whole appeal is the cover art previews as grey text —
 * so the next event's cover becomes the preview, and the description says what
 * is actually coming up rather than describing the software.
 */
function renderOg(next) {
  const image = next?.image_url
    ? (next.image_url.startsWith("/") ? BASE + next.image_url.slice(1) : next.image_url)
    : null;
  const description = next
    ? `Next up: ${next.title}${next.start_date ? ` · ${fmtLong(next.start_date, next.timezone)}` : ""}${next.location ? ` · ${next.location}` : ""}`
    : "Mahjong, dinners, tastings, hikes, film nights, cabin trips and parties — hosted in San Francisco.";

  return `
<meta property="og:site_name" content="dandan">
<meta property="og:title" content="dandan">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(BASE)}">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="900">
<meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="dandan">
<meta name="twitter:description" content="${esc(description)}">
${image ? `<meta name="twitter:image" content="${esc(image)}">` : ""}`;
}

/**
 * One page per event, so that sharing a single night previews that night rather
 * than the whole site. These are generated from the page shell, so they inherit
 * its styles and theme without a second stylesheet to keep in step.
 */
function eventPage(ev, shell, hasIcs) {
  const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
  const image = ev.image_url
    ? (ev.image_url.startsWith("/") ? BASE + ev.image_url.slice(1) : ev.image_url)
    : null;
  const when = ev.start_date ? fmtLong(ev.start_date, ev.timezone) : "Date to be decided";
  const description = [when, ev.location, ev.description].filter(Boolean).join(" · ").slice(0, 300);

  const head = `
<meta property="og:site_name" content="dandan">
<meta property="og:title" content="${esc(ev.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(BASE)}e/${esc(ev.id)}.html">
${image ? `<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="900">
<meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image)}">` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${esc(ev.title)}">
<meta name="twitter:description" content="${esc(description)}">`;

  const body = `
<header class="hero hero--one">
  <div class="wrap">
    <p class="hero__eyebrow"><a href="../">dandan</a> · ${cat.emoji} ${esc(cat.label)}</p>
    <h1>${esc(ev.title)}</h1>
    <p class="hero__tagline">${esc(when)}${ev.location ? ` · ${esc(ev.location)}` : ""}</p>
    <div class="hero__cta">
      ${ev.url ? `<a class="btn" href="${esc(ev.url)}" target="_blank" rel="noopener">RSVP on Partiful</a>` : ""}
      ${/* Only events still ahead of us get a calendar file; offering one for a
             night that already happened would link to nothing. */""}
      ${hasIcs ? `<a class="btn btn--ghost" href="${esc(ev.id)}.ics" download>Add to calendar</a>` : ""}
      <a class="btn btn--ghost" href="../">Everything else</a>
    </div>
  </div>
</header>

<section>
  <div class="wrap one">
    ${ev.image_url ? `<figure class="one__media">
      <img src="${esc(ev.image_url.startsWith("/") ? ".." + ev.image_url : ev.image_url)}" alt="" width="900" height="600">
      ${ev.image_credit ? `<figcaption>${esc(ev.image_credit)}</figcaption>` : ""}
    </figure>` : ""}
    ${ev.description ? `<p class="one__desc">${esc(ev.description)}</p>` : ""}
    ${ev.going_count ? `<p class="one__going">${ev.going_count} going.</p>` : ""}
  </div>
</section>

<footer class="foot">
  <div class="wrap">
    <p><a href="../">All the events</a> · <a href="https://github.com/danielluzhu/dandan">source</a></p>
  </div>
</footer>`;

  // Same <head> and <style> as the index; only the meta block and body differ.
  const styles = shell.slice(shell.indexOf("<style>"), shell.indexOf("</style>") + 8);
  const fonts = shell.slice(shell.indexOf('<link rel="preconnect"'), shell.indexOf("<style>"));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ev.title)} · dandan</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(BASE)}e/${esc(ev.id)}.html">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%8E%89</text></svg>">
${fonts}${styles}
${head}
</head>
<body>
${body}
</body>
</html>
`;
}

function renderContact() {
  if (!HANDLE) return "";
  return `
<section id="keep-in-touch" class="ask">
  <div class="wrap">
    <h2>Want in on the next one?</h2>
    <p>Most of these are small, and word of mouth is how they fill. Say hello and say which of
       the eight you'd come to — mahjong, a hike, a film, dinner, a tasting, a cabin, a Homeless
       weekend, a party — and you'll hear about the next one.</p>
    <p class="ask__cta">
      ${/* ig.me/m/<handle> is the "message me" deep link, but it only resolves on mobile —
             a desktop browser gets a Facebook error page. The profile works everywhere, and
             has the Message button on it. */""}
      <a class="btn" href="https://instagram.com/${esc(HANDLE)}" target="_blank" rel="noopener">Message me on Instagram</a>
      <span class="ask__hint">@${esc(HANDLE)}</span>
    </p>
  </div>
</section>`;
}

/**
 * Chips for filtering, built from the events that are actually here — a series
 * with nothing in it would otherwise get a chip that filters to an empty page.
 * The counts come from the same pass, so they cannot drift from the lists below.
 */
function renderFilters(events) {
  const counts = new Map();
  for (const ev of events) counts.set(ev.category, (counts.get(ev.category) || 0) + 1);
  if (counts.size < 2) return "";

  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([slug, n]) => {
      const cat = categoryBySlug[slug] || { emoji: "\u2022", label: slug };
      return `<button class="chip" type="button" data-filter="${esc(slug)}" aria-pressed="false"
        style="--c: var(--c-${esc(slug)})">${cat.emoji} ${esc(cat.label)} <span class="chip__n">${n}</span></button>`;
    }).join("\n      ");

  return `
  <div class="filters" hidden>
    <div class="wrap">
      <button class="chip chip--all is-on" type="button" data-filter="" aria-pressed="true">Everything <span class="chip__n">${events.length}</span></button>
      ${chips}
    </div>
  </div>`;
}

function render() {
  const upcoming = upcomingEvents();
  const ideas = undatedEvents();
  const past = pastEvents();


  return `
${renderFilters([...upcoming, ...ideas, ...past])}
<section id="up-next">
  <div class="wrap">
    <h2>Up next</h2>
    <p>${upcoming.length
      ? "Everything on the calendar, soonest first. RSVPs happen on Partiful."
      : "Nothing on the calendar right now — the next one goes up here when it does."}</p>
    ${upcoming.length ? `<p class="sub">
      <a class="btn btn--ghost btn--sm" href="webcal://danielluzhu.github.io/dandan/dandan.ics">Subscribe in your calendar</a>
      <span class="sub__hint">One subscription — every event after this one turns up on its own. <a href="dandan.ics" download>Download the file</a> if webcal does not open.</span>
    </p>
    <div class="evs">${upcoming.map(eventCard).join("\n")}\n    </div>` : ""}
  </div>
</section>
${ideas.length ? `
<section id="on-the-list">
  <div class="wrap">
    <h2>On the list</h2>
    <p>Picked, but not yet on the calendar. Some already have an invite up; the rest are waiting for a date.</p>
    <div class="evs">${ideas.map(ideaCard).join("\n")}
    </div>
  </div>
</section>` : ""}
${past.length ? `
<section id="archive">
  <div class="wrap">
    <h2>Already happened <span class="count">${past.length}</span></h2>
    <p>Every night that has been. Links still open the original invite.</p>
    ${archiveSection(past)}
  </div>
</section>` : ""}

${/* No build date here on purpose: it would rewrite the page every day and the
      cron would commit a "change" that is nothing but a new timestamp. */""}
<p class="stamp">${upcoming.length + ideas.length + past.length} events, republished from the live site whenever they change.</p>
`;
}

/* ---------- write ---------- */

/** Replace everything between a pair of markers, leaving the hand-written page alone. */
function inject(page, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = page.indexOf(start);
  const b = page.indexOf(end);
  if (a === -1 || b === -1) {
    console.error(`docs/index.html is missing the ${start} / ${end} markers.`);
    process.exit(1);
  }
  return page.slice(0, a + start.length) + content + page.slice(b);
}

let page = readFileSync(PAGE, "utf8");
page = inject(page, "events", render());
page = inject(page, "og", renderOg(upcomingEvents()[0]));
page = inject(page, "contact", renderContact());
writeFileSync(PAGE, page);

/**
 * One feed for everything upcoming, plus a single-event file per card. The
 * subscription is the point; the per-event files are for people who want just
 * the one night and not a standing subscription.
 */
const scheduled = upcomingEvents();
mkdirSync(new URL("e/", DOCS), { recursive: true });
writeFileSync(new URL("dandan.ics", DOCS), buildIcs(scheduled, {
  name: "dandan",
  description: "Mahjong, dinners, tastings, hikes, film nights, cabin trips and parties.",
}));
for (const ev of scheduled) {
  writeFileSync(new URL(`e/${ev.id}.ics`, DOCS), buildIcs([ev], { name: ev.title }));
}

const withIcs = new Set(scheduled.map((e) => e.id));
const everyEvent = [...upcomingEvents(), ...undatedEvents(), ...pastEvents()];
for (const ev of everyEvent) {
  writeFileSync(new URL(`e/${ev.id}.html`, DOCS), eventPage(ev, page, withIcs.has(ev.id)));
}

// Ideas use cover images kept in the repo; the remote ones load from Partiful's CDN.
mkdirSync(new URL("img/", DOCS), { recursive: true });
cpSync(new URL("../public/img/", import.meta.url), new URL("img/", DOCS), { recursive: true });

const total = upcomingEvents().length + undatedEvents().length + pastEvents().length;
if (!HANDLE) console.log("HOST_INSTAGRAM is not set — the page has no way for anyone to reach you.");
console.log(`Wrote docs/index.html with ${total} events and ${scheduled.length} calendar file${scheduled.length === 1 ? "" : "s"}. Commit docs/ and push to publish.`);
