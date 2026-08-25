#!/usr/bin/env bun
/**
 * Sync from Partiful, rebuild the public page, and push it if anything changed.
 *
 * The page is a static copy, so without this it is only ever as current as the
 * last time someone remembered to run the build. On a cron it becomes a mirror
 * of the live site instead of a snapshot that quietly goes stale.
 *
 *   bun run publish            # sync, rebuild, commit and push if changed
 *   bun run publish --dry-run  # do everything except commit and push
 */
import { syncEvents } from "../lib/sync.js";

const ROOT = new URL("..", import.meta.url).pathname;
const dryRun = process.argv.includes("--dry-run");
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...a);

async function run(cmd, { quiet = false } = {}) {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 && !quiet) throw new Error(`${cmd.join(" ")} failed: ${err.trim() || out.trim()}`);
  return { code, out: out.trim(), err: err.trim() };
}

/**
 * Two of these must never overlap: a second run mid-push would commit a
 * half-written page. The lock is the repo's own index, checked cheaply.
 */
const { out: busy } = await run(["git", "rev-parse", "--git-dir"], { quiet: true });
if (!busy) {
  console.error("Not a git repository — nothing to publish to.");
  process.exit(1);
}

const { count, total, errors } = await syncEvents({ scope: "all", trigger: "publish" });
log(`synced ${count}/${total} events${errors.length ? ` (${errors.length} failed)` : ""}`);
for (const e of errors) log("  ✗", e);

await run(["bun", "run", "scripts/build-docs.js"]);

// Only docs/ is ever committed here. data/ and .env are gitignored and stay put.
const { out: changed } = await run(["git", "status", "--porcelain", "--", "docs"]);
if (!changed) {
  log("page already current — nothing to publish");
  process.exit(0);
}
log(`changes in docs/:\n${changed}`);

if (dryRun) {
  log("dry run — not committing");
  process.exit(0);
}

// A dirty tree elsewhere is someone mid-edit; committing it from a cron would
// sweep their work into an automated commit.
const { out: dirty } = await run(["git", "status", "--porcelain", "--", ":!docs"]);
if (dirty) {
  log("other files are modified — publishing docs/ only, leaving the rest alone");
}

await run(["git", "add", "--", "docs"]);
const stamp = new Date().toISOString().slice(0, 10);
await run(["git", "commit", "-m", `Republish events (${stamp})`, "--only", "--", "docs"]);

const { code, err } = await run(["git", "push", "origin", "HEAD"], { quiet: true });
if (code !== 0) {
  log("push failed — the commit is here and will go up next time:", err.split("\n")[0]);
  process.exit(1);
}
log("published");
