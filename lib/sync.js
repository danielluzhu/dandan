/**
 * Partiful is the source of truth for every event's date, cover image and RSVP
 * count, and hosts edit those after the fact. The cache in SQLite is only as
 * good as its last refresh, so the server keeps one running in the background
 * instead of waiting for someone to open /admin and press the button.
 */
import { db, upsertEvent } from "./db.js";
import { fetchPartifulEvent } from "./partiful.js";

export const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES ?? 60);

/** Wait this long after boot before the first sync, so the site starts serving first. */
const FIRST_RUN_DELAY_MS = 10_000;
/** Keep refreshing an event for this long after it starts, to catch the final RSVP count. */
const STILL_ACTIVE_HOURS = 48;

/**
 * "active" is every event still ahead of us plus anything that has only just
 * happened — the rows whose numbers can still move. The hourly loop uses it so
 * a growing archive never turns into a growing pile of pointless requests;
 * the button in /admin passes "all" to refresh the archive too.
 */
function rowsToSync(scope) {
  if (scope === "all") return db.query("SELECT id, url, category FROM events WHERE url != ''").all();
  const cutoff = new Date(Date.now() - STILL_ACTIVE_HOURS * 3600 * 1000).toISOString();
  return db
    .query("SELECT id, url, category FROM events WHERE url != '' AND (start_date IS NULL OR start_date > ?)")
    .all(cutoff);
}

let lastRun = null;   // the most recent finished run, for the admin header
let inFlight = null;  // a run in progress: callers join it rather than start a second

/**
 * Refresh cached Partiful data. Concurrent callers — the hourly timer and a
 * click on "Re-sync" landing together — share one run instead of doubling the
 * requests, so the return value may describe a run someone else started.
 */
export function syncEvents({ scope = "all", trigger = "manual" } = {}) {
  if (inFlight) return inFlight;
  inFlight = runSync(scope, trigger).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(scope, trigger) {
  const rows = rowsToSync(scope);
  const errors = [];
  for (const row of rows) {
    try {
      upsertEvent(await fetchPartifulEvent(row.url), row.category);
    } catch (err) {
      errors.push(`${row.url}: ${err.message}`);
    }
  }
  lastRun = { at: new Date().toISOString(), scope, trigger, total: rows.length, count: rows.length - errors.length, errors };
  return lastRun;
}

/**
 * What /admin shows. `at` comes from the events themselves rather than from
 * `lastRun`, so the answer survives a restart — and a run where every fetch
 * failed correctly leaves it reading as old as the last data that landed.
 */
export function syncStatus() {
  const row = db.query("SELECT MAX(synced_at) AS at FROM events WHERE url != ''").get();
  return {
    at: row?.at || null,
    intervalMinutes: SYNC_INTERVAL_MINUTES,
    running: !!inFlight,
    last: lastRun,
  };
}

/** Start the background loop. Set SYNC_INTERVAL_MINUTES=0 to turn it off. */
export function startAutoSync() {
  if (!(SYNC_INTERVAL_MINUTES > 0)) {
    console.log("Auto-sync disabled (SYNC_INTERVAL_MINUTES=0).");
    return null;
  }

  const tick = async () => {
    try {
      const { count, total, errors } = await syncEvents({ scope: "active", trigger: "auto" });
      if (total) console.log(`[sync] ${count}/${total} events refreshed${errors.length ? ` — ${errors.join(" | ")}` : ""}`);
    } catch (err) {
      console.error("[sync] failed:", err.message);
    }
  };

  const first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const every = setInterval(tick, SYNC_INTERVAL_MINUTES * 60 * 1000);
  // The HTTP server keeps the process alive; these timers should not be what does.
  first.unref?.();
  every.unref?.();
  console.log(`Auto-syncing Partiful every ${SYNC_INTERVAL_MINUTES} min.`);
  return every;
}
