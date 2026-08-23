/**
 * Partiful sets `x-frame-options: SAMEORIGIN`, so its pages cannot be iframed.
 * Instead we scrape the `__NEXT_DATA__` blob the page ships, which carries the
 * full event record, and render our own card that links out to the real RSVP page.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export function extractEventId(url) {
  const m = String(url).match(/partiful\.com\/e\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Resolve go.partiful.com short links to a canonical /e/<id> URL. */
async function canonicalUrl(input) {
  const raw = String(input).trim();
  if (extractEventId(raw)) return `https://partiful.com/e/${extractEventId(raw)}`;
  const res = await fetch(raw, { redirect: "follow", headers: { "user-agent": UA } });
  const id = extractEventId(res.url);
  if (!id) throw new Error(`Not a Partiful event URL: ${raw}`);
  return `https://partiful.com/e/${id}`;
}

function imageUrl(image) {
  const path = image?.upload?.path;
  // imgix transcodes Partiful's HEIC uploads; `auto=format` gives the browser webp/jpeg.
  if (path) return `https://partiful.imgix.net/${path}?w=1200&h=800&fit=crop&auto=format,compress`;
  return image?.url || null;
}

function locationText(info) {
  if (!info) return null;
  const parts = [
    info.neighborhood,
    info.mapsInfo?.name,
    info.mapsInfo?.approximateLocation,
    Array.isArray(info.mapsInfo?.addressLines) ? info.mapsInfo.addressLines.join(", ") : null,
    info.address,
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ") || null;
}

export async function fetchPartifulEvent(input) {
  const url = await canonicalUrl(input);
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Partiful returned ${res.status} for ${url}`);
  const html = await res.text();

  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error(`Could not read event data from ${url} (page layout changed?)`);
  const ev = JSON.parse(m[1])?.props?.pageProps?.event;
  if (!ev?.id) throw new Error(`No event found at ${url} (private or deleted?)`);

  return {
    id: ev.id,
    url,
    shortUrl: ev.publicShortUrl || url,
    title: ev.title || "Untitled event",
    description: ev.description || "",
    // Partiful sends the literal string "TBD" when the host has not picked a date yet.
    startDate: /^\d{4}-\d{2}-\d{2}/.test(ev.startDate || "") ? ev.startDate : null,
    endDate: ev.endDate || null,
    timezone: ev.timezone || "America/Los_Angeles",
    imageUrl: imageUrl(ev.image),
    location: locationText(ev.locationInfo),
    goingCount: ev.goingGuestCount ?? 0,
    calendarFile: ev.calendarFile || null,
  };
}
