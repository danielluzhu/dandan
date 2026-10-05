/* Sibling sites live on neighbouring ports, which the proxy exposes as
   <host>-<port>.another.ac. Rewrite the placeholder localhost links so they
   work whether you're on the VM or coming in through the proxy. */
function siteUrl(port) {
  const { hostname, protocol } = location;
  const m = hostname.match(/^(.*)-(\d+)\.(.+)$/);
  if (m) return `${protocol}//${m[1]}-${port}.${m[3]}`;
  return `${protocol}//${hostname}:${port}`;
}

for (const a of document.querySelectorAll('a[href^="http://localhost:3000"], .js-events')) {
  a.href = siteUrl(3000);
}
for (const a of document.querySelectorAll('a[href^="http://localhost:3001"], .js-invest')) {
  a.href = siteUrl(3001);
}

/* Hosting numbers and recent events, read live from the events database. */
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } catch {
    return "";
  }
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function loadHosting() {
  const tally = document.getElementById("tally");
  const kinds = document.getElementById("kinds");
  const events = document.getElementById("events");

  let data;
  try {
    const res = await fetch("/api/hosting");
    data = await res.json();
  } catch {
    data = null;
  }

  if (!data?.stats) {
    document.getElementById("hosting")?.setAttribute("hidden", "");
    return;
  }

  const { events: n, rsvps, byCat, since } = data.stats;
  const cells = [
    [n, "gatherings"],
    [rsvps, "people through the door"],
    [byCat.length, "kinds of trouble"],
    [since || "—", "since"],
  ];
  tally.innerHTML = cells.map(([v, l]) => `<li><b>${esc(v)}</b><span>${esc(l)}</span></li>`).join("");

  kinds.innerHTML = byCat
    .map((c) => `<span class="kind"><b>${esc(c.n)}</b> ${esc(c.label)}</span>`)
    .join("");

  if (!data.recent.length) {
    events.innerHTML = "";
    return;
  }

  events.innerHTML = data.recent
    .map((e) => {
      const img = e.image_thumb || e.image_url;
      const when = fmtDate(e.start_date);
      const who = e.going_count ? `${e.going_count} went` : "";
      const meta = [when, who].filter(Boolean).join(" · ");
      return `<article class="ev">
        <img src="${esc(img)}" alt="" loading="lazy" decoding="async">
        <div class="ev-body">
          <p class="ev-cat">${esc(e.label)}</p>
          <h4 class="ev-title">${esc(e.title || "Untitled")}</h4>
          <p class="ev-meta">${esc(meta)}</p>
        </div>
      </article>`;
    })
    .join("");
}

loadHosting();
