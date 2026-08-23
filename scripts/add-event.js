#!/usr/bin/env bun
/** Usage: bun run add <partiful-url> [category] */
import { fetchPartifulEvent } from "../lib/partiful.js";
import { upsertEvent, CATEGORIES } from "../lib/db.js";

const [url, category] = process.argv.slice(2);
if (!url) {
  console.error("Usage: bun run add <partiful-url> [category]");
  console.error("Categories: " + CATEGORIES.map((c) => c.slug).join(", "));
  process.exit(1);
}
if (category && !CATEGORIES.some((c) => c.slug === category)) {
  console.error(`Unknown category "${category}". Use one of: ${CATEGORIES.map((c) => c.slug).join(", ")}`);
  process.exit(1);
}

const ev = await fetchPartifulEvent(url);
const used = upsertEvent(ev, category || null);
console.log(`✓ ${ev.title} — ${ev.startDate || "date TBD"} [${used}]`);
