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

/**
 * Partiful serves cover images from four different hosts depending on where the
 * host got the picture, and only one of them takes our resize params as-is:
 *
 *   upload            user upload on Firebase -> partiful.imgix.net/<path>
 *   partiful_posters  stock poster on Cloudinary, which 401s for us
 *                     -> partiful-posters.imgix.net/<name>, extension stripped
 *   unsplash          images.unsplash.com, resized with its own query params
 *   giphy             raw .gif, often 15MB+; use Giphy's smaller renditions
 *
 * Each event gets two sizes: `large` for the Up next cards, `thumb` for the
 * archive rows, so a 56px thumbnail never pulls a full-size image.
 */
const LARGE = { w: 900, h: 600 };
const THUMB = { w: 112, h: 112 };

const imgixParams = ({ w, h }) => `w=${w}&h=${h}&fit=crop&auto=format,compress`;

function imageVariants(image) {
  if (!image) return { large: null, thumb: null };
  const raw = image.url || null;

  const path = image.upload?.path;
  if (path) {
    const base = `https://partiful.imgix.net/${path}`;
    return { large: `${base}?${imgixParams(LARGE)}`, thumb: `${base}?${imgixParams(THUMB)}` };
  }

  if (image.source === "partiful_posters" && raw) {
    // .../image/upload/posters/Birthday%20Bash.jpg -> partiful-posters.imgix.net/Birthday%20Bash
    const name = raw.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "");
    if (name) {
      const base = `https://partiful-posters.imgix.net/${name}`;
      return { large: `${base}?${imgixParams(LARGE)}`, thumb: `${base}?${imgixParams(THUMB)}` };
    }
  }

  if (image.source === "unsplash" && raw) {
    const base = raw.split("?")[0];
    const p = ({ w, h }) => `w=${w}&h=${h}&fit=crop&auto=format&q=75`;
    return { large: `${base}?${p(LARGE)}`, thumb: `${base}?${p(THUMB)}` };
  }

  if (image.source === "giphy" && raw) {
    // giphy.gif is the full-size original — routinely 15MB+ and unusable as a thumbnail.
    const base = raw.split("?")[0].replace(/\/[^/]+\.gif$/, "");
    return { large: `${base}/giphy-downsized.gif`, thumb: `${base}/200w_s.gif` };
  }

  return { large: raw, thumb: raw };
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
    ...(({ large, thumb }) => ({ imageUrl: large, imageThumb: thumb, imageCredit: null }))(imageVariants(ev.image)),
    location: locationText(ev.locationInfo),
    goingCount: ev.goingGuestCount ?? 0,
    calendarFile: ev.calendarFile || null,
  };
}
