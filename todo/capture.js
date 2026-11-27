/* Free-form capture: turn loosely written lines ("clean toilet", "pay rent by friday!")
   into tasks — which project each falls into, whether it's urgent, and when it's due.
   Pure functions; the server decides what to do with the result. */

// Any project can have keywords; a task or Daily note falls into the project whose keywords
// it matches most. These four start with some; all are editable in the app.
// Keywords match whole words, so "bin" doesn't fire on "cabinet"; a trailing * matches any
// ending ("clean*" → cleaning, cleaned); a phrase matches as written ("pick up").
export const STARTER_PROJECTS = [
  {
    name: "Work", color: "#3b82f6", description: "",
    aliases: ["work"],
    keywords: ["work", "job", "office", "meeting*", "deck", "slides", "report", "deploy", "review", "pr", "bug*",
      "standup", "1:1", "email*", "draft", "proposal", "deadline", "client*", "spec", "ticket", "interview*",
      "pitch", "launch", "ship", "investor*", "startup", "project plan", "hire", "hiring", "manager", "boss", "coworker*"],
  },
  {
    name: "Health", color: "#16a34a", description: "",
    aliases: ["health", "fitness"],
    keywords: ["doctor", "dentist", "gym", "workout", "work out", "run", "running", "yoga", "meds", "medicine",
      "prescription", "appointment", "therapy", "therapist", "vitamins", "checkup", "physio", "stretch*",
      "sleep*", "slept", "walk", "hike", "jetlag", "jet lag", "sick", "tired", "dizz*", "headache", "meditat*",
      "diet", "protein", "water intake", "steps", "weight"],
  },
  {
    name: "Social", color: "#ca8a04", description: "",
    aliases: ["social", "friends", "people"],
    keywords: ["friend*", "party", "parties", "call", "text", "birthday", "gift", "invite", "rsvp", "dinner with",
      "lunch with", "coffee with", "drinks", "hangout", "hang out", "catch up", "thank", "card for", "visit",
      "mahjong", "game night", "date", "wedding", "event", "highballs", "book", "flight*", "hotel*", "airbnb",
      "pack", "packing", "trip", "travel*", "passport", "visa", "itinerary", "check in"],
  },
  {
    name: "Domestic", color: "#ea580c", description: "Family and home",
    aliases: ["domestic", "home", "household", "chores", "family"],
    keywords: ["clean*", "toilet*", "bathroom*", "kitchen", "laundry", "wash*", "dish*", "dishwasher", "vacuum*",
      "mop*", "sweep*", "dust*", "tidy", "tidying", "declutter*", "trash", "garbage", "recycling", "compost",
      "bin", "bins", "litter", "sheets", "bedding", "bed", "towels", "fold*", "iron*", "fridge", "freezer",
      "oven", "stove", "sink", "shower", "tub", "floor*", "window*", "plants", "water the plants", "cook*",
      "meal prep", "closet", "lightbulb*", "light bulb*", "filter", "chore*", "scrub*", "wipe*", "laundromat",
      "feeder", "fountain", "cat food", "cat", "cats", "kitty", "kitten*", "couch", "sofa", "rug", "carpet", "mattress",
      "lawn", "yard", "garden*", "weed*", "repair*", "fix the", "leak*", "plumber", "handyman",
      "family", "mom", "dad", "parents", "grandma", "grandpa", "sister", "brother", "kids",
      "errand*", "buy", "pick up", "drop off", "groceries", "grocery", "pharmacy", "post office", "mail",
      "return", "costco", "target", "trader joe*", "safeway", "store", "order", "amazon", "dry clean*",
      "car wash", "oil change", "dmv", "refill", "renew", "pay", "bill*", "rent", "tax*", "bank", "budget",
      "insurance", "reimburse*", "refund", "subscription*", "credit card", "lamp", "furniture", "print"],
  },
];

/* A project's keywords as stored: one per line or comma-separated. */
export const parseKeywords = (s) => String(s ?? "").split(/[,\n]/).map((w) => w.trim().toLowerCase()).filter(Boolean);

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${esc(w.replace(/\*$/, "")).replace(/ /g, "\\s+")}${w.endsWith("*") ? "[a-z]*" : ""}(?=$|[^a-z0-9])`, "i");
const reCache = new Map();
const reFor = (w) => reCache.get(w) || (reCache.set(w, wordRe(w)), reCache.get(w));

/* Which of `projects` ({ id, keywords }) a piece of writing falls into, or null. The project
   with the most matching keywords wins; ties go to the earlier one. */
export function projectFor(text, projects) {
  let best = null, bestScore = 0;
  for (const t of projects) {
    const score = parseKeywords(t.keywords).filter((w) => reFor(w).test(text)).length;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Due date phrases, removed from the title once read. Order matters: longer phrases first. */
function takeDue(text, today) {
  const at = (days) => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d); };
  const rules = [
    [/\b(?:by |on |due )?(?:today|tonight)\b/i, () => at(0)],
    [/\b(?:by |on |due )?tomorrow\b/i, () => at(1)],
    [/\b(?:by |on |due )?(?:this |the )?weekend\b/i, () => at((6 - today.getDay() + 7) % 7 || 7)],
    [/\b(?:by |due )?next week\b/i, () => at(7)],
    [new RegExp(`\\b(?:by |on |due |this |next )?(${WEEKDAYS.join("|")}|mon|tues?|wed|thur?s?|fri|sat|sun)\\b`, "i"), (m) => {
      const name = m[1].toLowerCase();
      const n = WEEKDAYS.findIndex((w) => w.startsWith(name.slice(0, 3)));
      return at((n - today.getDay() + 7) % 7 || 7);
    }],
    [/\b(?:by |on |due )?(\d{4}-\d{2}-\d{2})\b/, (m) => m[1]],
    [/\b(?:by |on |due )?(\d{1,2})\/(\d{1,2})\b/, (m) => {
      const d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]));
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
      return iso(d);
    }],
  ];
  for (const [re, fn] of rules) {
    const m = text.match(re);
    if (m) return { due: fn(m), text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)) };
  }
  return { due: null, text };
}

/* Repeating tasks: a rule is "<n> <unit>" — "1 week", "3 month". When one is completed
   the next copy is made, due one step later. */
export const REPEAT_RE = /^([1-9]\d{0,2}) (day|week|month|year)$/;
const UNIT = { day: "day", days: "day", week: "week", weeks: "week", month: "month", months: "month", year: "year", years: "year" };

// The repeat phrase in a line ("every month", "weekly", "every 2 weeks", "every friday"),
// taken out of it. "every friday" leaves "friday" behind so the due date lands on one.
function takeRepeat(text) {
  const rules = [
    [/\bevery other (day|week|month|year)\b/i, (m) => `2 ${UNIT[m[1].toLowerCase()]}`],
    [/\bevery ([1-9]\d{0,2}) (days?|weeks?|months?|years?)\b/i, (m) => `${m[1]} ${UNIT[m[2].toLowerCase()]}`],
    [/\bevery (day|week|month|year)\b/i, (m) => `1 ${UNIT[m[1].toLowerCase()]}`],
    [new RegExp(`\\bevery (${WEEKDAYS.join("|")})\\b`, "i"), (m) => "1 week", (m) => m[1]],
    [/\b(daily|weekly|biweekly|monthly|quarterly|yearly|annually)\b/i, (m) =>
      ({ daily: "1 day", weekly: "1 week", biweekly: "2 week", monthly: "1 month", quarterly: "3 month", yearly: "1 year", annually: "1 year" })[m[1].toLowerCase()]],
  ];
  for (const [re, rule, keep] of rules) {
    const m = text.match(re);
    if (m) return { repeat: rule(m), text: text.slice(0, m.index) + (keep ? keep(m) : "") + text.slice(m.index + m[0].length) };
  }
  return { repeat: null, text };
}

const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
// One step of a rule on from a YYYY-MM-DD date. Months and years keep the day of the month,
// or the month's last day when it's shorter (Jan 31 → Feb 28).
function step(date, rule) {
  const [, n0, unit] = rule.match(REPEAT_RE);
  const n = Number(n0);
  const d = parseISO(date);
  if (unit === "day" || unit === "week") { d.setDate(d.getDate() + n * (unit === "week" ? 7 : 1)); return iso(d); }
  const months = unit === "year" ? 12 * n : n;
  const day = d.getDate();
  const out = new Date(d.getFullYear(), d.getMonth() + months, 1);
  out.setDate(Math.min(day, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return iso(out);
}
// When the next copy is due: a step on from this one's due date, and after today — a task
// done late doesn't come back already overdue.
export function nextDue(due, rule, today = iso(new Date())) {
  let next = step(due || today, rule);
  for (let i = 0; next <= today && i < 5000; i++) next = step(next, rule);
  return next;
}

/* One free-form line → { title, label, due_date, repeat, project } where `project` is a
   project name the line asked for with #tag, if any. Returns null for a blank line. */
export function parseLine(raw, today = new Date()) {
  let text = String(raw)
    .replace(/^\s*(?:[-*•+]|\d+[.)])\s+/, "")        // list bullets
    .replace(/^\s*\[[ xX]?\]\s*/, "")              // checkboxes
    .replace(/^\s*(?:todo|to-do|to do)\s*[:\-]?\s*/i, "")
    .trim();
  if (!text) return null;

  let label = null;
  if (/(^|\s)(?:urgent|asap)\b[:!]?|!{1,}\s*$/i.test(text)) {
    label = "urgent";
    text = text.replace(/(^|\s)(?:urgent|asap)\b[:!]?/gi, " ").replace(/!+\s*$/, "");
  }

  let project = null;
  const tag = text.match(/(^|\s)#([\w-]+)/);
  if (tag) { project = tag[2].replace(/[-_]/g, " "); text = text.replace(tag[0], " "); }

  const rep = takeRepeat(text);
  text = rep.text;
  const due = takeDue(text, today);
  const title = due.text.replace(/\s{2,}/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  if (!title) return null;
  return { title, label, due_date: due.due, repeat: rep.repeat, project };
}

export const parseText = (text, today) => String(text ?? "").split(/\r?\n/).map((l) => parseLine(l, today)).filter(Boolean);
