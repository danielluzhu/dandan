import { writeFileSync } from "node:fs";
import { allSignups, categoryBySlug } from "./db.js";

const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const HEADERS = ["ID", "Date added", "Name", "Instagram", "Phone", "Interested in", "Note"];

export function signupsCsv() {
  const rows = allSignups().map((s) => [
    s.id,
    s.created_at,
    s.name,
    s.instagram,
    s.phone,
    s.categories.split(",").filter(Boolean).map((c) => categoryBySlug[c]?.label || c).join("; "),
    s.note,
  ]);
  // BOM so Excel / Numbers open the UTF-8 file with the right encoding.
  return "﻿" + [HEADERS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Keep data/signups.csv in sync so there is always a plain spreadsheet on disk. */
export function writeSignupsCsv() {
  const path = new URL("../data/signups.csv", import.meta.url).pathname;
  writeFileSync(path, signupsCsv());
  return path;
}
