import { createHmac, timingSafeEqual } from "node:crypto";
import { db, allSignups, allEvents, upcomingEvents, undatedEvents, pastEvents, addSignup, updateSignup, deleteSignup, upsertEvent, CATEGORIES } from "./lib/db.js";
import { fetchPartifulEvent } from "./lib/partiful.js";
import { signupsCsv, writeSignupsCsv } from "./lib/csv.js";
import { homePage, adminLoginPage, adminPage } from "./lib/render.js";

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
  const email = String(form.get("email") || "").trim().slice(0, 120);
  const phone = String(form.get("phone") || "").trim().slice(0, 40);
  const note = String(form.get("note") || "").trim().slice(0, 600);
  const categories = form.getAll("categories").map(String).filter((c) => VALID_SLUGS.has(c));

  if (!name || (!email && !phone) || categories.length === 0) return redirect("/?error=missing#keep-in-touch");

  addSignup({ name, email, phone, categories, note });
  writeSignupsCsv();
  return redirect("/?thanks=1#keep-in-touch");
}

function contactFields(form) {
  return {
    name: String(form.get("name") || "").trim().slice(0, 80),
    email: String(form.get("email") || "").trim().slice(0, 120),
    phone: String(form.get("phone") || "").trim().slice(0, 40),
    note: String(form.get("note") || "").trim().slice(0, 600),
    categories: form.getAll("categories").map(String).filter((c) => VALID_SLUGS.has(c)),
  };
}

async function syncAll() {
  const rows = db.query("SELECT id, url, category FROM events WHERE url != ''").all();
  const errors = [];
  for (const row of rows) {
    try {
      upsertEvent(await fetchPartifulEvent(row.url), row.category);
    } catch (err) {
      errors.push(`${row.url}: ${err.message}`);
    }
  }
  return { count: rows.length - errors.length, errors };
}

async function handleAdmin(req, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === "/admin/login" && method === "POST") {
    const form = await req.formData();
    if (!safeEqual(String(form.get("password") || ""), ADMIN_PASSWORD)) {
      return html(adminLoginPage("Wrong password."), 401);
    }
    return redirect("/admin", {
      "set-cookie": `dandan_admin=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    });
  }

  if (!isAdmin(req)) return html(adminLoginPage(), pathname === "/admin" ? 200 : 401);

  if (pathname === "/admin/logout" && method === "POST") {
    return redirect("/admin", { "set-cookie": "dandan_admin=; Path=/; HttpOnly; Max-Age=0" });
  }

  if (pathname === "/admin/signups.csv") {
    return new Response(signupsCsv(), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="dandan-signups-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

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
      const { count, errors } = await syncAll();
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

    if (pathname === "/admin/signups") {
      const fields = contactFields(await req.formData());
      if (!fields.name) return redirect("/admin?error=A+contact+needs+a+name.&add=1#contacts");
      addSignup(fields);
      writeSignupsCsv();
      return redirect(`/admin?flash=${encodeURIComponent(`Added ${fields.name}.`)}#contacts`);
    }

    if ((m = pathname.match(/^\/admin\/signups\/(\d+)$/))) {
      const id = Number(m[1]);
      const fields = contactFields(await req.formData());
      if (!fields.name) return redirect(`/admin?error=A+contact+needs+a+name.&edit=${id}#contacts`);
      updateSignup(id, fields);
      writeSignupsCsv();
      return redirect(`/admin?flash=${encodeURIComponent(`Updated ${fields.name}.`)}#contacts`);
    }

    if ((m = pathname.match(/^\/admin\/signups\/(\d+)\/delete$/))) {
      deleteSignup(Number(m[1]));
      writeSignupsCsv();
      return redirect("/admin?flash=Contact+deleted.#contacts");
    }
  }

  if (pathname === "/admin") {
    return html(adminPage({
      events: db.query("SELECT * FROM events ORDER BY start_date DESC").all(),
      signups: allSignups(),
      flash: url.searchParams.get("flash"),
      error: url.searchParams.get("error"),
      editing: url.searchParams.get("edit"),
      addOpen: url.searchParams.get("add") === "1",
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

      if (url.pathname === "/health") return Response.json({ ok: true, events: allEvents().length });

      // Static assets
      if (/^\/(img\/)?[a-z0-9._-]+\.(css|js|png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname)) {
        const file = Bun.file(new URL("." + url.pathname, PUBLIC_DIR));
        if (await file.exists()) return new Response(file, { headers: { "cache-control": "public, max-age=3600" } });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err);
      return new Response("Something went wrong", { status: 500 });
    }
  },
});

console.log(`dandan running on http://localhost:${server.port}  (admin at /admin)`);
