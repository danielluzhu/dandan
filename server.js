import { createHmac, timingSafeEqual } from "node:crypto";
import { db, allSignups, allEvents, upcomingEvents, undatedEvents, pastEvents, addSignup, upsertSignup, updateSignup, deleteSignup, normalizeInstagram, upsertEvent, CATEGORIES } from "./lib/db.js";
import { fetchPartifulEvent } from "./lib/partiful.js";
import { syncEvents, syncStatus, startAutoSync } from "./lib/sync.js";
import { signupsCsv, writeSignupsCsv } from "./lib/csv.js";
import { homePage, passwordPage, adminPage, listPage } from "./lib/render.js";

const PORT = Number(process.env.PORT || 4321);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-secret";
const VALID_SLUGS = new Set(CATEGORIES.map((c) => c.slug));
const PUBLIC_DIR = new URL("./public/", import.meta.url);

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is not set. Copy .env.example to .env and set one.");
  process.exit(1);
}

/* ---------- helpers ---------- */

const sessionToken = () => createHmac("sha256", SESSION_SECRET).update(ADMIN_PASSWORD).digest("hex");

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

function isAdmin(req) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)dandan_admin=([a-f0-9]+)/);
  return !!m && safeEqual(m[1], sessionToken());
}

const html = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

const redirect = (location, headers = {}) => new Response(null, { status: 303, headers: { location, ...headers } });

/* ---------- signup throttle ---------- */

const recent = new Map(); // ip -> timestamps
function throttled(ip) {
  const now = Date.now();
  const hits = (recent.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 5;
}

/* ---------- routes ---------- */

async function handleSignup(req, ip) {
  const form = await req.formData();
  // Honeypot: real people never fill a field they cannot see.
  if (String(form.get("website") || "").trim()) return redirect("/?thanks=1#keep-in-touch");
  if (throttled(ip)) return redirect("/?error=slow#keep-in-touch");

  const name = String(form.get("name") || "").trim().slice(0, 80);
  const instagram = normalizeInstagram(form.get("instagram"));
  const phone = String(form.get("phone") || "").trim().slice(0, 40);
  const note = String(form.get("note") || "").trim().slice(0, 600);
  const categories = form.getAll("categories").map(String).filter((c) => VALID_SLUGS.has(c));

  if (!name || !phone || categories.length === 0) return redirect("/?error=missing#keep-in-touch");
  // A handle that survives normalising is the only proof the field held something usable.
  if (!instagram) return redirect("/?error=instagram#keep-in-touch");

  // Someone filling the form a second time is the same person, not a second contact.
  upsertSignup({ name, instagram, phone, categories, note });
  writeSignupsCsv();
  return redirect("/?thanks=1#keep-in-touch");
}

function contactFields(form) {
  return {
    name: String(form.get("name") || "").trim().slice(0, 80),
    instagram: normalizeInstagram(form.get("instagram")),
    phone: String(form.get("phone") || "").trim().slice(0, 40),
    note: String(form.get("note") || "").trim().slice(0, 600),
    categories: form.getAll("categories").map(String).filter((c) => VALID_SLUGS.has(c)),
  };
}

const SAFE_NEXT = /^\/(list|admin)$/;

async function handleLogin(req) {
  const form = await req.formData();
  const next = SAFE_NEXT.test(String(form.get("next") || "")) ? String(form.get("next")) : "/list";
  if (!safeEqual(String(form.get("password") || ""), ADMIN_PASSWORD)) {
    return html(passwordPage({ next, error: "That password is not right." }), 401);
  }
  return redirect(next, {
    "set-cookie": `dandan_admin=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
  });
}

async function handleList(req, url) {
  const { pathname } = url;
  if (!isAdmin(req)) return html(passwordPage({ next: "/list" }), pathname === "/list" ? 200 : 401);

  if (pathname === "/list/contacts.csv") {
    return new Response(signupsCsv(), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dandan-list-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  if (req.method === "POST") {
    if (pathname === "/list/contacts") {
      const fields = contactFields(await req.formData());
      if (!fields.name) return redirect("/list?error=A+contact+needs+a+name.&add=1#contacts");
      addSignup(fields);
      writeSignupsCsv();
      return redirect(`/list?flash=${encodeURIComponent(`Added ${fields.name}.`)}#contacts`);
    }

    let m;
    if ((m = pathname.match(/^\/list\/contacts\/(\d+)$/))) {
      const id = Number(m[1]);
      const fields = contactFields(await req.formData());
      if (!fields.name) return redirect(`/list?error=A+contact+needs+a+name.&edit=${id}#contacts`);
      updateSignup(id, fields);
      writeSignupsCsv();
      return redirect(`/list?flash=${encodeURIComponent(`Updated ${fields.name}.`)}#contacts`);
    }

    if ((m = pathname.match(/^\/list\/contacts\/(\d+)\/delete$/))) {
      deleteSignup(Number(m[1]));
      writeSignupsCsv();
      return redirect("/list?flash=Contact+deleted.#contacts");
    }
  }

  if (pathname === "/list") {
    return html(listPage({
      signups: allSignups(),
      flash: url.searchParams.get("flash"),
      error: url.searchParams.get("error"),
    }));
  }

  return new Response("Not found", { status: 404 });
}

async function handleAdmin(req, url) {
  const { pathname } = url;
  const method = req.method;

  if (!isAdmin(req)) return html(passwordPage({ next: "/admin" }), pathname === "/admin" ? 200 : 401);

  if (method === "POST") {
    if (pathname === "/admin/events") {
      const form = await req.formData();
      const category = String(form.get("category") || "") || null;
      try {
        const ev = await fetchPartifulEvent(String(form.get("url") || ""));
        const used = upsertEvent(ev, category && VALID_SLUGS.has(category) ? category : null);
        return redirect(`/admin?flash=${encodeURIComponent(`Added "${ev.title}" under ${used}.`)}`);
      } catch (err) {
        return redirect(`/admin?error=${encodeURIComponent(err.message)}`);
      }
    }

    if (pathname === "/admin/sync") {
      const { count, errors } = await syncEvents({ scope: "all", trigger: "manual" });
      const q = errors.length
        ? `error=${encodeURIComponent(`Synced ${count}; failed: ${errors.join(" | ")}`)}`
        : `flash=${encodeURIComponent(`Synced ${count} event${count === 1 ? "" : "s"} from Partiful.`)}`;
      return redirect(`/admin?${q}`);
    }

    let m;
    if ((m = pathname.match(/^\/admin\/events\/([A-Za-z0-9_-]+)\/(category|toggle|delete)$/))) {
      const [, id, action] = m;
      if (action === "category") {
        const cat = String((await req.formData()).get("category") || "");
        if (VALID_SLUGS.has(cat)) db.query("UPDATE events SET category = ? WHERE id = ?").run(cat, id);
      } else if (action === "toggle") {
        db.query("UPDATE events SET hidden = 1 - hidden WHERE id = ?").run(id);
      } else {
        db.query("DELETE FROM events WHERE id = ?").run(id);
      }
      return redirect("/admin");
    }

  }

  if (pathname === "/admin") {
    return html(adminPage({
      events: db.query("SELECT * FROM events ORDER BY start_date DESC").all(),
      sync: syncStatus(),
      flash: url.searchParams.get("flash"),
      error: url.searchParams.get("error"),
    }));
  }

  return new Response("Not found", { status: 404 });
}

/* ---------- server ---------- */

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req, srv) {
    const url = new URL(req.url);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || srv.requestIP(req)?.address || "unknown";

    try {
      if (url.pathname === "/login" && req.method === "POST") return await handleLogin(req);
      if (url.pathname === "/logout" && req.method === "POST") {
        return redirect("/", { "set-cookie": "dandan_admin=; Path=/; HttpOnly; Max-Age=0" });
      }
      if (url.pathname === "/list" || url.pathname.startsWith("/list/")) return await handleList(req, url);
      if (url.pathname.startsWith("/admin")) return await handleAdmin(req, url);

      if (url.pathname === "/signup" && req.method === "POST") return await handleSignup(req, ip);

      if (url.pathname === "/") {
        return html(homePage({
          upcoming: upcomingEvents(),
          ideas: undatedEvents(),
          past: pastEvents(),
          thanks: url.searchParams.get("thanks") === "1",
        }), 200, { "cache-control": "no-store" });
      }

      if (url.pathname === "/health") {
        return Response.json({ ok: true, events: allEvents().length, lastSync: syncStatus().at });
      }

      // Static assets
      if (/^\/(img\/)?[a-z0-9._-]+\.(css|js|png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname)) {
        const file = Bun.file(new URL("." + url.pathname, PUBLIC_DIR));
        if (await file.exists()) {
          // Hashed ?v= URLs can be cached hard; anything requested without one must not be,
          // or an edit to styles.css sits behind a stale copy until the cache expires.
          const versioned = url.searchParams.has("v");
          return new Response(file, {
            headers: { "cache-control": versioned ? "public, max-age=31536000, immutable" : "no-cache" },
          });
        }
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err);
      return new Response("Something went wrong", { status: 500 });
    }
  },
});

console.log(`dandan running on http://localhost:${server.port}  (admin at /admin)`);
startAutoSync();
