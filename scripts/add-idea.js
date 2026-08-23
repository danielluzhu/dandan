#!/usr/bin/env bun
/**
 * Add an event that has no Partiful page yet — an idea on the list.
 * Usage: bun run idea <category> <id> <title> <description> [location]
 */
import { addManualEvent, CATEGORIES } from "../lib/db.js";

const [category, id, title, description, location] = process.argv.slice(2);
if (!category || !id || !title) {
  console.error("Usage: bun run idea <category> <id> <title> <description> [location]");
  console.error("Categories: " + CATEGORIES.map((c) => c.slug).join(", "));
  process.exit(1);
}
if (!CATEGORIES.some((c) => c.slug === category)) {
  console.error(`Unknown category "${category}". Use one of: ${CATEGORIES.map((c) => c.slug).join(", ")}`);
  process.exit(1);
}

addManualEvent({ id, title, description: description || "", category, location: location || null });
console.log(`✓ ${title} — date TBD [${category}]`);
