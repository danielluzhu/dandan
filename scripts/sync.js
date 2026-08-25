#!/usr/bin/env bun
/**
 * Refresh cached Partiful data for every event, once, from the terminal.
 * The server does this on its own every SYNC_INTERVAL_MINUTES; this is for
 * cron on another machine, or for when you want the archive refreshed now.
 */
import { syncEvents } from "../lib/sync.js";

const scope = process.argv.includes("--active") ? "active" : "all";
const { count, total, errors } = await syncEvents({ scope, trigger: "cli" });

for (const err of errors) console.error(`✗ ${err}`);
console.log(`Synced ${count}/${total} events.`);
process.exit(errors.length && !count ? 1 : 0);
