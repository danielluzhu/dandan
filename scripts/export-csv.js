#!/usr/bin/env bun
import { writeSignupsCsv } from "../lib/csv.js";
import { allSignups } from "../lib/db.js";
console.log(`Wrote ${allSignups().length} signups to ${writeSignupsCsv()}`);
