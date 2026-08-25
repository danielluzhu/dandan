#!/usr/bin/env bun
/**
 * Attach a photo from the night to an event that already happened.
 *
 *   bun run recap <event-id|partiful-url> <photo.jpg> ["credit"]
 *
 * The archive is otherwise a list of names and dates. One picture per row is
 * what makes it worth scrolling twice.
 */
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { db, setRecap } from "../lib/db.js";
import { extractEventId } from "../lib/partiful.js";

const [target, photo, credit] = process.argv.slice(2);
if (!target || !photo) {
  console.error('Usage: bun run recap <event-id|partiful-url> <photo.jpg> ["credit"]');
  process.exit(1);
}

const id = extractEventId(target) || target;
const ev = db.query("SELECT id, title FROM events WHERE id = ?").get(id);
if (!ev) {
  console.error(`No event with id ${id}. Run bun run sync, or check /admin for the id.`);
  process.exit(1);
}
if (!existsSync(photo)) {
  console.error(`No such file: ${photo}`);
  process.exit(1);
}

const dir = new URL("../public/img/recaps/", import.meta.url);
mkdirSync(dir, { recursive: true });

const large = `${id}.jpg`;
const thumb = `${id}-thumb.jpg`;

/**
 * Two sizes, the same pair the cover images use: the archive row shows a small
 * square, and nothing there should be pulling a full-size photo off disk.
 */
async function convert(args) {
  const proc = Bun.spawn(["convert", ...args], { stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
}

try {
  await convert([photo, "-resize", "900x600^", "-gravity", "center", "-extent", "900x600",
                 "-strip", "-quality", "82", new URL(large, dir).pathname]);
  await convert([photo, "-resize", "224x224^", "-gravity", "center", "-extent", "224x224",
                 "-strip", "-quality", "80", new URL(thumb, dir).pathname]);
} catch (err) {
  console.error(`Could not resize the photo (is ImageMagick installed?): ${err.message}`);
  process.exit(1);
}

setRecap(id, { image: `/img/recaps/${large}`, thumb: `/img/recaps/${thumb}`, credit: credit || null });
console.log(`Attached ${photo} to "${ev.title}".`);
console.log("Run bun run build:docs to put it on the public page.");
