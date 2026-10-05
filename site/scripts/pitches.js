/* Read inbound pitches from the contact form.
 *
 *   bun run site/scripts/pitches.js            # newest 20
 *   bun run site/scripts/pitches.js --all
 *   bun run site/scripts/pitches.js --csv > pitches.csv
 */
import { Database } from "bun:sqlite";

const DB = new URL("../../data/pitches.db", import.meta.url).pathname;
const args = new Set(process.argv.slice(2));
const db = new Database(DB, { readonly: true });

const rows = db
  .query(`SELECT * FROM pitches ORDER BY id DESC ${args.has("--all") ? "" : "LIMIT 20"}`)
  .all();

if (!rows.length) {
  console.log("No pitches yet.");
  process.exit(0);
}

if (args.has("--csv")) {
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  console.log(cols.join(","));
  for (const r of rows) console.log(cols.map((c) => esc(r[c])).join(","));
  process.exit(0);
}

for (const r of rows) {
  const meta = [r.company, r.sector, r.stage].filter(Boolean).join(" · ");
  console.log(`\n\x1b[1m#${r.id}  ${r.name}\x1b[0m  <${r.email}>   \x1b[2m${r.created_at}\x1b[0m`);
  if (meta) console.log(`  ${meta}`);
  if (r.link) console.log(`  ${r.link}`);
  console.log(`  ${r.note.replaceAll("\n", "\n  ")}`);
}
console.log(`\n${rows.length} shown.`);
