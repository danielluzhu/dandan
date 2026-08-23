#!/usr/bin/env bun
/**
 * Add an event that has no Partiful page yet — an idea on the list.
 * Usage: bun run idea <category> <id> <title> <description> [location]
 */
import { addManualEvent, CATEGORIES } from "../lib/db.js";

const [category, id, title, description, location, imageUrl, imageCredit] = process.argv.slice(2);
if (!category || !id || !title) {
  console.error("Usage: bun run idea <category> <id> <title> <description> [location] [image] [credit]");
  console.error('  image: a path under /img, e.g. "/img/lands-end.jpg" (a -thumb.jpg beside it is used for the archive)');
  console.error("Categories: " + CATEGORIES.map((c) => c.slug).join(", "));
  process.exit(1);
}
if (!CATEGORIES.some((c) => c.slug === category)) {
  console.error(`Unknown category "${category}". Use one of: ${CATEGORIES.map((c) => c.slug).join(", ")}`);
  process.exit(1);
}

addManualEvent({
  id, title, description: description || "", category, location: location || null,
  imageUrl: imageUrl || null,
  imageThumb: imageUrl ? imageUrl.replace(/\.(jpe?g|png|webp)$/i, "-thumb.$1") : null,
  imageCredit: imageCredit || null,
});
console.log(`✓ ${title} — date TBD [${category}]`);
