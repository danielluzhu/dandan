/**
 * The calendar feed.
 *
 * A subscribable .ics is the one way to reach someone's calendar that keeps
 * working when this machine is off and nobody remembers the site exists: they
 * subscribe once, and every event added later turns up on its own.
 */
import { categoryBySlug } from "./db.js";

const PRODID = "-//dandan//events//EN";
/** How long a subscribed calendar should wait before asking for the file again. */
const REFRESH = "PT12H";
/** Partiful events often have no end time; assume an evening. */
const DEFAULT_HOURS = 3;

/** RFC 5545 §3.3.5: UTC timestamps, no punctuation. */
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 §3.3.11: these four characters carry meaning inside a value. */
const escape = (s) =>
  String(s ?? "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/**
 * RFC 5545 §3.1: no line may exceed 75 octets. Continuation lines start with a
 * space. Counting octets rather than characters matters — event titles have
 * emoji in them, and splitting one down the middle corrupts the file.
 */
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back up off any continuation byte.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return out.join("\r\n ");
}

/**
 * DTSTAMP must not move unless the event does. Using the clock would rewrite
 * every file on every build, and a cron that publishes "what changed" would
 * then commit a fresh copy of an unchanged calendar forever. `added_at` is
 * stable — upsertEvent leaves it alone once the row exists.
 */
function vevent(ev, now) {
  const cat = categoryBySlug[ev.category];
  const start = new Date(ev.start_date);
  const end = ev.end_date ? new Date(ev.end_date) : new Date(start.getTime() + DEFAULT_HOURS * 3600 * 1000);
  const summary = cat ? `${cat.emoji} ${ev.title}` : ev.title;
  const body = [ev.description, ev.url].filter(Boolean).join("\n\n");

  return [
    "BEGIN:VEVENT",
    `UID:${ev.id}@dandan`,
    `DTSTAMP:${stamp(ev.added_at || now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(summary)}`,
    body ? `DESCRIPTION:${escape(body)}` : null,
    ev.location ? `LOCATION:${escape(ev.location)}` : null,
    ev.url ? `URL:${escape(ev.url)}` : null,
    cat ? `CATEGORIES:${escape(cat.label)}` : null,
    "END:VEVENT",
  ].filter(Boolean);
}

/**
 * @param events  scheduled events only — an event with no date has nothing to put in DTSTART
 * @param name    what the calendar calls itself once subscribed
 */
export function buildIcs(events, { name = "dandan", description = "", now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(name)}`,
    description ? `X-WR-CALDESC:${escape(description)}` : null,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    ...events.filter((e) => e.start_date).flatMap((e) => vevent(e, now)),
    "END:VCALENDAR",
  ].filter(Boolean);

  // RFC 5545 §3.1: CRLF line endings, and the file ends with one.
  return lines.map(fold).join("\r\n") + "\r\n";
}
