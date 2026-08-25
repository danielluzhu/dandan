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

const DOCS = new URL("../docs/", import.meta.url);
const PAGE = new URL("index.html", DOCS);

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
      <article class="ev" style="--c: var(--c-${esc(ev.category)})">
        <figure class="ev__media">${cover(ev, cat, i < 2)}</figure>
        <div class="ev__body">
          <p class="ev__meta">
            <span class="ev__cat">${cat.emoji} ${esc(cat.label)}</span>
            ${soon ? `<span class="ev__soon">${esc(soon)}</span>` : ""}
          </p>
          <h3 class="ev__title">${esc(ev.title)}</h3>
          <p class="ev__when">${esc(fmtLong(ev.start_date, ev.timezone))}</p>
          ${ev.location ? `<p class="ev__where">${esc(ev.location)}</p>` : ""}
          <p class="ev__foot">
            <a class="btn btn--sm" href="${esc(ev.url)}" target="_blank" rel="noopener">RSVP on Partiful</a>
            ${ev.going_count ? `<span class="ev__going">${ev.going_count} going</span>` : ""}
          </p>
        </div>
      </article>`;
}

function ideaCard(ev) {
  const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
  return `
      <article class="ev ev--idea" style="--c: var(--c-${esc(ev.category)})">
        <figure class="ev__media">${cover(ev, cat, false)}</figure>
        <div class="ev__body">
          <p class="ev__meta">
            <span class="ev__cat">${cat.emoji} ${esc(cat.label)}</span>
            <span class="ev__soon">Date TBD</span>
          </p>
          <h3 class="ev__title">${esc(ev.title)}</h3>
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
            const tag = ev.url ? "a" : "div";
            const href = ev.url ? ` href="${esc(ev.url)}" target="_blank" rel="noopener"` : "";
            return `<li><${tag} class="past__row"${href} style="--c: var(--c-${esc(ev.category)})">
            <span class="past__dot"></span>
            <span class="past__title">${esc(ev.title)}</span>
            <span class="past__cat">${cat.emoji} ${esc(cat.label)}</span>
            <time class="past__date">${ev.start_date ? esc(shortDate(ev.start_date, ev.timezone)) : "—"}</time>
          </${tag}></li>`;
          }).join("\n          ")}
        </ul>
      </div>`).join("\n");
}

function render() {
  const upcoming = upcomingEvents();
  const ideas = undatedEvents();
  const past = pastEvents();

  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric",
  }).format(new Date());

  return `
<section id="up-next">
  <div class="wrap">
    <h2>Up next</h2>
    <p>${upcoming.length
      ? "Everything on the calendar, soonest first. RSVPs happen on Partiful."
      : "Nothing on the calendar right now — the next one goes up here when it does."}</p>
    ${upcoming.length ? `<div class="evs">${upcoming.map(eventCard).join("\n")}\n    </div>` : ""}
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

<p class="stamp">Snapshot of ${upcoming.length + ideas.length + past.length} events, published ${esc(stamp)}.</p>
`;
}

/* ---------- write ---------- */

const START = "<!-- events:start -->";
const END = "<!-- events:end -->";

const page = readFileSync(PAGE, "utf8");
const a = page.indexOf(START);
const b = page.indexOf(END);
if (a === -1 || b === -1) {
  console.error(`docs/index.html is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

writeFileSync(PAGE, page.slice(0, a + START.length) + render() + page.slice(b));

// Ideas use cover images kept in the repo; the remote ones load from Partiful's CDN.
mkdirSync(new URL("img/", DOCS), { recursive: true });
cpSync(new URL("../public/img/", import.meta.url), new URL("img/", DOCS), { recursive: true });

const total = upcomingEvents().length + undatedEvents().length + pastEvents().length;
console.log(`Wrote docs/index.html with ${total} events. Commit docs/ and push to publish.`);
