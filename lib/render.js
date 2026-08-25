import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { CATEGORIES, categoryBySlug } from "./db.js";

/**
 * Static assets are served with a long max-age, so their URLs carry a hash of the
 * file contents. Editing styles.css or app.js changes the URL and browsers fetch
 * the new copy immediately instead of sitting on a stale cached one.
 */
const assetVersions = new Map();
export function asset(path) {
  if (!assetVersions.has(path)) {
    try {
      const bytes = readFileSync(new URL(`../public${path}`, import.meta.url));
      assetVersions.set(path, createHash("sha256").update(bytes).digest("hex").slice(0, 8));
    } catch {
      assetVersions.set(path, "0");
    }
  }
  return `${path}?v=${assetVersions.get(path)}`;
}

export const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const SITE = {
  title: process.env.SITE_TITLE || "dandan",
  tagline: process.env.SITE_TAGLINE || "Mahjong, dinners, tastings, hikes, film nights, cabin trips, Homeless weekends and parties — hosted in San Francisco.",
};

function parts(iso, tz) {
  const d = new Date(iso);
  const f = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: tz || "America/Los_Angeles", ...opts }).format(d);
  return {
    weekday: f({ weekday: "short" }),
    month: f({ month: "short" }),
    day: f({ day: "numeric" }),
    year: f({ year: "numeric" }),
    time: f({ hour: "numeric", minute: "2-digit" }),
  };
}

export function fmtLong(iso, tz) {
  if (!iso) return "Date TBD";
  const p = parts(iso, tz);
  return `${p.weekday}, ${p.month} ${p.day} · ${p.time}`;
}

export function countdown(iso) {
  if (!iso) return null;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  return `In ${Math.round(days / 7)} weeks`;
}

/** "12 minutes ago" — how fresh the cached Partiful data is. */
export function timeAgo(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "a minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs === 1) return "an hour ago";
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/* ---------- components ---------- */

function pendingCard(cat) {
  return `
    <a class="pending" data-category="${cat.slug}" href="#keep-in-touch">
      <span class="pending__emoji">${cat.emoji}</span>
      <span class="pending__text">
        <span class="pending__label">${esc(cat.label)}</span>
        <span class="pending__blurb">${esc(cat.blurb)}</span>
      </span>
      <span class="pending__cta">Get notified &rarr;</span>
    </a>`;
}

function nextCard(cat, ev, eager) {
  const soon = countdown(ev.start_date);
  const p = ev.start_date ? parts(ev.start_date, ev.timezone) : null;
  return `
    <article class="card" data-category="${cat.slug}">
      <${ev.url ? "a" : "div"} class="card__media"${ev.url ? ` href="${esc(ev.url)}" target="_blank" rel="noopener"` : ""}>
        ${ev.image_url ? `<img src="${esc(ev.image_url)}" alt="" width="900" height="600" ${eager ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'}>` : `<span class="card__fallback">${cat.emoji}</span>`}
        <span class="card__badge">${cat.emoji} ${esc(cat.label)}</span>
        ${soon ? `<span class="card__soon">${esc(soon)}</span>` : ""}
        ${p ? "" : `<span class="card__soon card__soon--tbd">Date TBD</span>`}
      </${ev.url ? "a" : "div"}>
      <div class="card__body">
        <div class="card__when">
          ${p
            ? `<span class="card__date">${esc(p.weekday)} ${esc(p.month)} ${esc(p.day)}</span>
          <span class="card__time">${esc(p.time)}</span>`
            : `<span class="card__date">Date to be picked</span>`}
        </div>
        <h3 class="card__title">${esc(ev.title)}</h3>
        ${ev.description ? `<p class="card__desc">${esc(ev.description)}</p>` : ""}
        <dl class="card__meta">
          ${ev.location ? `<div><dt>Where</dt><dd>${esc(ev.location)}</dd></div>` : ""}
          ${ev.going_count ? `<div><dt>Going</dt><dd>${ev.going_count} ${ev.going_count === 1 ? "person" : "people"}</dd></div>` : ""}
        </dl>
        ${ev.url
          ? `<a class="btn" href="${esc(ev.url)}" target="_blank" rel="noopener">RSVP on Partiful &rarr;</a>`
          : `<a class="btn btn--ghost" href="#keep-in-touch">I'd come to this &rarr;</a>`}
      </div>
    </article>`;
}

function ideaCard(ev, eager) {
  const cat = categoryBySlug[ev.category] || { emoji: "\u2022", label: ev.category };
  return `
    <article class="idea" data-category="${esc(ev.category)}">
      ${ev.image_url ? `
      <figure class="idea__media">
        <img src="${esc(ev.image_url)}" alt="" width="900" height="600" ${eager ? "" : 'loading="lazy" decoding="async"'}>
        ${ev.image_credit ? `<figcaption>${esc(ev.image_credit)}</figcaption>` : ""}
      </figure>` : ""}
      <div class="idea__head">
        <span class="idea__cat">${cat.emoji} ${esc(cat.label)}</span>
        <span class="idea__tbd">Date TBD</span>
      </div>
      <h3 class="idea__title">${esc(ev.title)}</h3>
      ${ev.description ? `<p class="idea__desc">${esc(ev.description)}</p>` : ""}
      ${ev.location ? `<p class="idea__where">${esc(ev.location)}</p>` : ""}
      ${ev.url
        ? `<a class="idea__link" href="${esc(ev.url)}" target="_blank" rel="noopener">See it on Partiful &rarr;</a>`
        : `<a class="idea__link" href="#keep-in-touch">I'd come to this &rarr;</a>`}
    </article>`;
}

function archiveRow(ev) {
  const cat = categoryBySlug[ev.category] || { emoji: "•", label: ev.category };
  const p = ev.start_date ? parts(ev.start_date, ev.timezone) : null;
  return `
    <${ev.url ? "a" : "div"} class="past"${ev.url ? ` href="${esc(ev.url)}" target="_blank" rel="noopener"` : ""} data-category="${esc(ev.category)}">
      <div class="past__thumb">
        ${ev.image_thumb || ev.image_url ? `<img src="${esc(ev.image_thumb || ev.image_url)}" alt="" width="112" height="112" loading="lazy" decoding="async">` : `<span>${cat.emoji}</span>`}
      </div>
      <div class="past__text">
        <span class="past__cat">${cat.emoji} ${esc(cat.label)}</span>
        <span class="past__title">${esc(ev.title)}</span>
        ${ev.location ? `<span class="past__loc">${esc(ev.location)}</span>` : ""}
      </div>
      <time class="past__date">${p ? `${esc(p.month)} ${esc(p.day)}, ${esc(p.year)}` : "—"}</time>
    </${ev.url ? "a" : "div"}>`;
}

/* ---------- pages ---------- */

export function layout({ title, body, bodyClass = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(SITE.tagline)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%8E%89</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${asset("/styles.css")}">
</head>
<body class="${bodyClass}">
${body}
<script src="${asset("/app.js")}" defer></script>
</body>
</html>`;
}

export function homePage({ upcoming, ideas, past, thanks }) {
  const upcomingCount = upcoming.length;
  const busy = new Set([...upcoming, ...ideas].map((e) => e.category));
  const pending = CATEGORIES.filter((c) => !busy.has(c.slug));
  const years = [...new Set(past.filter((e) => e.start_date).map((e) => parts(e.start_date, e.timezone).year))];

  const body = `
<header class="hero">
  <div class="hero__inner">
    <p class="hero__eyebrow">You're invited</p>
    <h1 class="hero__title">${esc(SITE.title)}</h1>
    <p class="hero__tagline">${esc(SITE.tagline)}</p>
    <nav class="hero__nav">
      <a href="#up-next">Up next</a>
      <a href="#archive">Past events</a>
      <a href="#keep-in-touch">Keep in touch</a>
    </nav>
  </div>
</header>

<main>
  <section id="up-next" class="section">
    <div class="section__head">
      <h2>Up next</h2>
      <p>${upcomingCount ? `Everything on the calendar, soonest first. RSVPs happen on Partiful.` : "Nothing on the calendar right now — leave your info below and you'll hear about the next one."}</p>
    </div>
    ${upcoming.length ? `<div class="grid${upcoming.length === 1 ? " grid--solo" : ""}">${upcoming.map((ev, i) => nextCard(categoryBySlug[ev.category] || { slug: ev.category, emoji: "\u2022", label: ev.category }, ev, i < 3)).join("\n")}</div>` : ""}
    ${ideas.length ? `
    <div class="ideawrap">
      <p class="ideawrap__head">On the list — date still to be picked</p>
      <div class="idealist">${ideas.map((e, i) => ideaCard(e, i < 3)).join("\n")}</div>
    </div>` : ""}
    ${pending.length ? `
    <div class="pendingwrap">
      <p class="pendingwrap__head">${upcoming.length || ideas.length ? "Not on the list yet" : "Nothing on the list yet"} — say the word and I'll plan one</p>
      <div class="pendinglist">${pending.map(pendingCard).join("\n")}</div>
    </div>` : ""}
  </section>

  <section id="archive" class="section section--alt">
    <div class="section__head">
      <h2>The archive</h2>
      <p>${past.length ? `${past.length} ${past.length === 1 ? "night" : "nights"} so far${years.length ? `, ${years[0] === years[years.length - 1] ? years[0] : `${years[years.length - 1]}\u2013${years[0]}`}` : ""}.` : "Past events will collect here once they've happened."}</p>
    </div>
    ${past.length ? `
    <div class="filters" role="group" aria-label="Filter past events">
      <button class="chip is-active" data-filter="all">All</button>
      ${CATEGORIES.filter((c) => past.some((e) => e.category === c.slug))
        .map((c) => `<button class="chip" data-filter="${c.slug}">${c.emoji} ${esc(c.label)}</button>`).join("")}
    </div>
    <div class="pastlist">${past.map(archiveRow).join("\n")}</div>
    <p class="pastlist__empty" hidden>No past events in that category yet.</p>` : ""}
  </section>

  <section id="keep-in-touch" class="section">
    <div class="section__head">
      <h2>Keep in touch</h2>
      <p>Tell me what you're into and I'll make sure you get the invite. This goes to me only — nothing is public, nothing is shared.</p>
    </div>
    ${thanks ? `<p class="flash">Got it — you're on the list. See you at the next one.</p>` : ""}
    <form class="form" method="post" action="/signup">
      <div class="form__row">
        <label><span class="lbl">Name<span class="req">*</span></span>
          <input name="name" required maxlength="80" autocomplete="name" placeholder="Your name">
        </label>
      </div>
      <div class="form__row form__row--split">
        <label><span class="lbl">Instagram<span class="req">*</span></span>
          <input name="instagram" required maxlength="120" autocapitalize="none" spellcheck="false" placeholder="@yourhandle">
        </label>
        <label><span class="lbl">Phone<span class="req">*</span></span>
          <input type="tel" name="phone" required maxlength="40" autocomplete="tel" placeholder="(555) 123-4567">
        </label>
      </div>
      <fieldset class="form__cats">
        <legend>I'd come to<span class="req">*</span></legend>
        ${CATEGORIES.map((c) => `
          <label class="checkcard">
            <input type="checkbox" name="categories" value="${c.slug}">
            <span class="checkcard__emoji">${c.emoji}</span>
            <span class="checkcard__label">${esc(c.label)}</span>
          </label>`).join("")}
      </fieldset>
      <div class="form__row">
        <label><span class="lbl">Anything else?</span>
          <textarea name="note" rows="3" maxlength="600" placeholder="Dietary stuff, who you know, a mahjong skill level confession…"></textarea>
        </label>
      </div>
      <label class="hp" aria-hidden="true">Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
      <p class="form__error" hidden></p>
      <button class="btn btn--big" type="submit">Add me to the list</button>
      <p class="form__fine">Instagram and phone are both needed so I can actually reach you. Pick at least one category.</p>
    </form>
  </section>
</main>

<footer class="foot">
  <p>${esc(SITE.title)} · hosted by a human, not an algorithm</p>
</footer>`;

  return layout({ title: `${SITE.title} — events`, body });
}

/** One password gate, shared by /list and /admin. */
export function passwordPage({ next = "/list", error = null } = {}) {
  return layout({
    bodyClass: "admin-login",
    title: "Sign in · " + SITE.title,
    body: `
<form class="login" method="post" action="/login">
  <h1>${esc(SITE.title)}</h1>
  <p class="login__blurb">${next === "/admin" ? "Managing events" : "The contact list"} is private. Enter the password to continue.</p>
  ${error ? `<p class="flash flash--bad">${esc(error)}</p>` : ""}
  <input type="hidden" name="next" value="${esc(next)}">
  <label><span class="lbl">Password</span>
    <input type="password" name="password" autocomplete="current-password" autofocus required>
  </label>
  <button class="btn" type="submit">Unlock</button>
</form>`,
  });
}

function contactForm({ action, submit, value = {}, picked = [], id = null }) {
  return `
    <form class="cform" method="post" action="${action}">
      <div class="cform__row">
        <label><span class="lbl">Name<span class="req">*</span></span>
          <input name="name" required maxlength="80" value="${esc(value.name || "")}" placeholder="Their name">
        </label>
        <label><span class="lbl">Instagram</span>
          <input name="instagram" maxlength="120" autocapitalize="none" spellcheck="false" value="${esc(value.instagram || "")}" placeholder="@handle">
        </label>
        <label><span class="lbl">Phone</span>
          <input type="tel" name="phone" maxlength="40" value="${esc(value.phone || "")}" placeholder="(555) 123-4567">
        </label>
      </div>
      <fieldset class="cform__cats">
        <legend>Interested in</legend>
        ${CATEGORIES.map((c) => `
          <label class="checkcard">
            <input type="checkbox" name="categories" value="${c.slug}"${picked.includes(c.slug) ? " checked" : ""}>
            <span class="checkcard__emoji">${c.emoji}</span>
            <span class="checkcard__label">${esc(c.label)}</span>
          </label>`).join("")}
      </fieldset>
      <label><span class="lbl">Note</span>
        <textarea name="note" rows="2" maxlength="600" placeholder="Anything worth remembering">${esc(value.note || "")}</textarea>
      </label>
      <div class="cform__actions">
        <button class="btn btn--sm" type="submit">${esc(submit)}</button>
        ${id ? `<button class="linkbtn linkbtn--bad" type="submit" formaction="/list/contacts/${id}/delete"
                  onclick="return confirm('Delete this contact?')">Delete</button>` : ""}
      </div>
    </form>`;
}

export function listPage({ signups, flash, error, editing = null, addOpen = false }) {
  const counts = CATEGORIES.map((c) => ({
    ...c,
    n: signups.filter((s) => s.categories.split(",").includes(c.slug)).length,
  })).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);

  const body = `
<div class="admin">
  <header class="admin__head">
    <h1>The List</h1>
    <div class="admin__actions">
      <a class="btn btn--ghost" href="/admin">Events</a>
      <a class="btn btn--ghost btn--sm" href="/list/contacts.csv">Download spreadsheet (CSV)</a>
      <form method="post" action="/logout"><button class="btn btn--ghost">Lock</button></form>
    </div>
  </header>

  <p class="admin__lede">Everyone who has asked to hear about an event, and what they said they would come to.</p>

  ${flash ? `<p class="flash">${esc(flash)}</p>` : ""}
  ${error ? `<p class="flash flash--bad">${esc(error)}</p>` : ""}

  ${signups.length ? `
  <div class="toolbar">
    <div class="tally" role="group" aria-label="Filter by interest">
      <button class="tag tag--all is-active" data-filter="all" aria-pressed="true">Everyone <b>${signups.length}</b></button>
      ${counts.map((c) => `<button class="tag" data-category="${c.slug}" data-filter="${c.slug}" aria-pressed="false">${c.emoji} ${esc(c.label)} <b>${c.n}</b></button>`).join("")}
    </div>
    <div class="toolbar__row">
      <label class="field field--search">
        <span class="lbl">Search</span>
        <input type="search" id="q" placeholder="Name, handle or phone" autocomplete="off" spellcheck="false">
      </label>
      <label class="field">
        <span class="lbl">Missing</span>
        <select id="missing">
          <option value="">Anyone</option>
          <option value="instagram">No Instagram</option>
          <option value="phone">No phone</option>
          <option value="any">No contact details</option>
        </select>
      </label>
      <label class="field">
        <span class="lbl">Sort by</span>
        <select id="sort">
          <option value="name">Name (A–Z)</option>
          <option value="-name">Name (Z–A)</option>
          <option value="-added">Newest first</option>
          <option value="added">Oldest first</option>
          <option value="-interests">Most interests</option>
          <option value="interests">Fewest interests</option>
        </select>
      </label>
      <p class="toolbar__count" aria-live="polite"></p>
    </div>
  </div>` : ""}

  <section class="admin__panel" id="contacts">

    <details class="adder"${addOpen ? " open" : ""}>
      <summary>Add a contact by hand</summary>
      ${contactForm({ action: "/list/contacts", submit: "Add contact" })}
    </details>

    ${signups.length ? `
    <ul class="contacts">
      ${signups.map((c) => {
        const picked = c.categories.split(",").filter(Boolean);
        return `
      <li class="contact"
          data-categories="${esc(picked.join(","))}"
          data-name="${esc(c.name.toLowerCase())}"
          data-search="${esc([c.name, c.instagram, c.phone, c.note].filter(Boolean).join(" ").toLowerCase())}"
          data-added="${esc(c.created_at)}"
          data-interests="${picked.length}"
          data-has-instagram="${c.instagram ? "1" : "0"}"
          data-has-phone="${c.phone ? "1" : "0"}">
        <details${String(editing) === String(c.id) ? " open" : ""}>
          <summary>
            <span class="contact__name">${esc(c.name)}</span>
            <span class="contact__contact">${
              [c.instagram ? `<a href="https://instagram.com/${esc(String(c.instagram).replace(/^@/, ""))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : "",
               c.phone ? esc(c.phone) : ""].filter(Boolean).join(" · ") || "<em>no contact details</em>"}</span>
            <span class="contact__tags">${picked.map((k) => `<span class="tag" data-category="${esc(k)}">${categoryBySlug[k]?.emoji || ""} ${esc(categoryBySlug[k]?.label || k)}</span>`).join("") || `<span class="tag tag--none">nothing picked</span>`}</span>
            <span class="contact__when">${esc(new Date(c.created_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" }))}</span>
            <span class="contact__edit">Edit</span>
          </summary>
          ${c.note ? `<p class="contact__note">${esc(c.note)}</p>` : ""}
          ${contactForm({ action: `/list/contacts/${c.id}`, submit: "Save changes", value: c, picked, id: c.id })}
        </details>
      </li>`;
      }).join("")}
    </ul>
    <p class="contacts__empty" hidden>Nobody matches that.</p>` : `<p class="empty">No contacts yet. People who fill in the form on the site land here, or add one by hand above.</p>`}
    <p class="hint">Private to this page. Every change also rewrites <code>data/signups.csv</code> on this machine.</p>
  </section>
</div>`;

  return layout({ title: "The List · " + SITE.title, body, bodyClass: "admin-body" });
}

/**
 * The sync state under the admin header: when Partiful data last landed, how
 * often it refreshes itself, and whatever failed last time. Anything older than
 * two intervals means the background loop is not running — worth seeing at a glance.
 */
function syncLine(sync) {
  if (!sync) return "";
  const auto = sync.intervalMinutes > 0
    ? `Auto-syncs every ${sync.intervalMinutes} min`
    : "Auto-sync off";
  const stale = sync.at && sync.intervalMinutes > 0 &&
    Date.now() - new Date(sync.at).getTime() > sync.intervalMinutes * 2 * 60000;
  const failures = sync.last?.errors?.length
    ? `<br><span class="syncbar__bad">Last run: ${esc(sync.last.errors.join(" | "))}</span>`
    : "";
  return `<p class="syncbar${stale || failures ? " syncbar--bad" : ""}">
    ${auto} · last synced ${esc(timeAgo(sync.at))}${sync.running ? " · syncing now" : ""}${failures}
  </p>`;
}

export function adminPage({ events, sync = null, flash, error }) {
  const catOptions = (sel) =>
    CATEGORIES.map((c) => `<option value="${c.slug}"${c.slug === sel ? " selected" : ""}>${c.emoji} ${esc(c.label)}</option>`).join("");

  const body = `
<div class="admin">
  <header class="admin__head">
    <h1>Events</h1>
    <div class="admin__actions">
      <a class="btn btn--ghost" href="/list">The List</a>
      <form method="post" action="/admin/sync"><button class="btn btn--ghost">Re-sync from Partiful</button></form>
      <a class="btn btn--ghost" href="/" target="_blank">View site</a>
      <form method="post" action="/logout"><button class="btn btn--ghost">Lock</button></form>
    </div>
  </header>

  ${syncLine(sync)}
  ${flash ? `<p class="flash">${esc(flash)}</p>` : ""}
  ${error ? `<p class="flash flash--bad">${esc(error)}</p>` : ""}

  <section class="admin__panel">
    <h2>Add an event</h2>
    <form class="admin__add" method="post" action="/admin/events">
      <input name="url" placeholder="https://partiful.com/e/…" required>
      <select name="category"><option value="">Auto-detect category</option>${catOptions()}</select>
      <button class="btn">Add</button>
    </form>
    <p class="hint">Paste any Partiful link (long or go.partiful.com short link). Title, date, cover image, location and RSVP count are pulled in automatically and refreshed on every sync.</p>
  </section>

  <section class="admin__panel">
    <h2>All events <span class="count">${events.length}</span></h2>
    <div class="tblwrap"><table class="tbl">
      <thead><tr><th>When</th><th>Event</th><th>Category</th><th>Going</th><th>Shown</th><th></th></tr></thead>
      <tbody>
        ${events.length ? events.map((e) => `
        <tr>
          <td class="nowrap">${e.start_date ? esc(fmtLong(e.start_date, e.timezone)) : "—"}<br><small>${e.start_date ? esc(parts(e.start_date, e.timezone).year) : ""}</small></td>
          <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : `${esc(e.title)} <small>(no link)</small>`}<br><small>${esc(e.location || "")}</small></td>
          <td>
            <form method="post" action="/admin/events/${esc(e.id)}/category" class="inline">
              <select name="category" onchange="this.form.submit()">${catOptions(e.category)}</select>
            </form>
          </td>
          <td>${e.going_count ?? 0}</td>
          <td>
            <form method="post" action="/admin/events/${esc(e.id)}/toggle" class="inline">
              <button class="linkbtn">${e.hidden ? "Hidden" : "Visible"}</button>
            </form>
          </td>
          <td>
            <form method="post" action="/admin/events/${esc(e.id)}/delete" class="inline" onsubmit="return confirm('Remove this event from the site? The Partiful event itself is untouched.')">
              <button class="linkbtn linkbtn--bad">Remove</button>
            </form>
          </td>
        </tr>`).join("") : `<tr><td colspan="6" class="empty">No events yet — paste a Partiful link above.</td></tr>`}
      </tbody>
    </table></div>
  </section>

</div>`;

  return layout({ title: "Admin · " + SITE.title, body, bodyClass: "admin-body" });
}
