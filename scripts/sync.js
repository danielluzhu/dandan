#!/usr/bin/env bun
/** Refresh cached Partiful data for every event. Safe to run on a cron. */
import { db, upsertEvent } from "../lib/db.js";
import { fetchPartifulEvent } from "../lib/partiful.js";

const rows = db.query("SELECT id, url, category FROM events").all();
let ok = 0;
for (const row of rows) {
  try {
    const ev = await fetchPartifulEvent(row.url);
    upsertEvent(ev, row.category);
    console.log(`✓ ${ev.title}`);
    ok++;
  } catch (err) {
    console.error(`✗ ${row.url}: ${err.message}`);
  }
}
console.log(`Synced ${ok}/${rows.length} events.`);
