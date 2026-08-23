#!/usr/bin/env bun
/**
 * Import contacts from a CSV of Name,Event rows — the shape a Google Sheet
 * exports when you keep one row per person per event.
 *
 * Usage: bun run import <file.csv | google-sheet-url> [--dry-run]
 *
 * People are merged by name, so someone listed under three events becomes one
 * contact interested in three categories. Re-running is safe: an existing
 * contact keeps its details and gains any new categories.
 */
import { readFileSync } from "node:fs";
import { allSignups, addSignup, updateSignup, normalizeInstagram, CATEGORIES, categoryBySlug } from "../lib/db.js";
import { writeSignupsCsv } from "../lib/csv.js";

const [source, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!source) {
  console.error("Usage: bun run import <file.csv | google-sheet-url> [--dry-run]");
  process.exit(1);
}

/** Column values seen in the wild -> our category slugs. */
const EVENT_TO_CATEGORY = {
  films: "film", film: "film", movie: "film", "film night": "film",
  hike: "hikes", hikes: "hikes", hiking: "hikes",
  mahjong: "mahjong",
  cabin: "cabin", "cabin trip": "cabin", "cabin trips": "cabin",
  party: "parties", parties: "parties",
  homeless: "homeless",
  dinner: "dining", dining: "dining",
  tasting: "tasting", "drink tasting": "tasting",
};

/** Minimal RFC-4180 parser: handles quoted fields, embedded commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

async function load(src) {
  const sheet = src.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (sheet) {
    // A sheet shared as "anyone with the link" exports without authenticating.
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv`, { redirect: "follow" });
    if (!res.ok) throw new Error(`Could not read that sheet (${res.status}). Is it shared with anyone who has the link?`);
    const body = await res.text();
    if (body.trimStart().startsWith("<")) throw new Error("That sheet is not public — Google returned a sign-in page instead of CSV.");
    return body;
  }
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { redirect: "follow" });
    if (!res.ok) throw new Error(`Could not fetch ${src} (${res.status})`);
    return await res.text();
  }
  return readFileSync(src, "utf8");
}

const rows = parseCsv(await load(source));
const header = rows.shift().map((h) => h.trim().toLowerCase());
const col = (...names) => header.findIndex((h) => names.includes(h));
const iName = col("name", "who", "person");
const iEvent = col("event", "category", "interested in");
const iInsta = col("instagram", "insta", "ig", "handle");
const iPhone = col("phone", "number", "mobile");
const iNote = col("note", "notes", "comment");

if (iName < 0) throw new Error(`No "Name" column found. Columns seen: ${header.join(", ")}`);

/** Merge rows into one entry per person. */
const people = new Map();
const unmapped = new Set();
for (const r of rows) {
  const name = (r[iName] || "").trim().replace(/\s+/g, " ");
  if (!name) continue;
  const key = name.toLowerCase();
  const p = people.get(key) || { name, categories: new Set(), instagram: "", phone: "", notes: new Set() };
  p.name = name;

  if (iEvent >= 0) {
    const raw = (r[iEvent] || "").trim();
    if (raw) {
      const slug = EVENT_TO_CATEGORY[raw.toLowerCase()];
      if (slug) p.categories.add(slug);
      else unmapped.add(raw);
    }
  }
  if (iInsta >= 0 && (r[iInsta] || "").trim()) p.instagram ||= normalizeInstagram(r[iInsta]);
  if (iPhone >= 0 && (r[iPhone] || "").trim()) p.phone ||= r[iPhone].trim();
  if (iNote >= 0 && (r[iNote] || "").trim()) p.notes.add(r[iNote].trim());
  people.set(key, p);
}

if (unmapped.size) {
  console.error(`\n! Unrecognised event names, skipped: ${[...unmapped].join(", ")}`);
  console.error(`  Known categories: ${CATEGORIES.map((c) => c.slug).join(", ")}\n`);
}

const existing = new Map(allSignups().map((s) => [s.name.trim().toLowerCase(), s]));
let added = 0, updated = 0, unchanged = 0;

for (const p of people.values()) {
  const cats = [...p.categories];
  const prior = existing.get(p.name.toLowerCase());
  const label = cats.map((c) => categoryBySlug[c]?.label || c).join(", ") || "no categories";

  if (!prior) {
    if (!dryRun) addSignup({ name: p.name, instagram: p.instagram, phone: p.phone, categories: cats, note: [...p.notes].join("; ") });
    console.log(`+ ${p.name} — ${label}`);
    added++;
    continue;
  }

  const merged = [...new Set([...prior.categories.split(",").filter(Boolean), ...cats])];
  const changed =
    merged.length !== prior.categories.split(",").filter(Boolean).length ||
    (p.instagram && !prior.instagram) || (p.phone && !prior.phone);
  if (!changed) { unchanged++; continue; }

  if (!dryRun) {
    updateSignup(prior.id, {
      name: prior.name,
      instagram: prior.instagram || p.instagram,
      phone: prior.phone || p.phone,
      categories: merged,
      note: prior.note,
    });
  }
  console.log(`~ ${p.name} — now ${merged.map((c) => categoryBySlug[c]?.label || c).join(", ")}`);
  updated++;
}

if (!dryRun && (added || updated)) writeSignupsCsv();
console.log(`\n${dryRun ? "[dry run] " : ""}${added} added, ${updated} updated, ${unchanged} already current — ${people.size} people in the file.`);
