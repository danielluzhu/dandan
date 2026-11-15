/* Free-form capture: turn loosely written lines ("clean toilet", "pay rent by friday!")
   into tasks — which project each belongs in, whether it's urgent, and when it's due.
   Pure functions; the server decides what to do with the result. */

// Each category is filed into a project: the first existing project whose name is one of
// `projects`, or a new one named after the first entry. Words match whole words, so "bin"
// doesn't fire on "cabinet"; a trailing * matches any ending ("clean*" → cleaning, cleaned).
export const CATEGORIES = [
  {
    key: "domestic", projects: ["domestic", "home", "household", "chores"],
    words: ["clean*", "toilet*", "bathroom*", "kitchen", "laundry", "wash*", "dish*", "dishwasher", "vacuum*",
      "mop*", "sweep*", "dust*", "tidy", "tidying", "declutter*", "trash", "garbage", "recycling", "compost",
      "bin", "bins", "litter", "sheets", "bedding", "bed", "towels", "fold*", "iron*", "fridge", "freezer",
      "oven", "stove", "sink", "shower", "tub", "floor*", "window*", "plants", "water the plants", "cook*",
      "meal prep", "closet", "lightbulb*", "light bulb*", "filter", "chore*", "scrub*", "wipe*", "laundromat",
      "feeder", "fountain", "cat food", "kitty", "kittens", "couch", "sofa", "rug", "carpet", "mattress",
      "hang", "lawn", "yard", "garden*", "weed*", "repair*", "fix the", "leak*", "plumber", "handyman"],
  },
  {
    key: "errands", projects: ["errands", "shopping"],
    words: ["errand*", "buy", "pick up", "pickup", "drop off", "groceries", "grocery", "pharmacy", "post office",
      "mail", "ship", "return", "costco", "target", "trader joe*", "safeway", "store", "shop", "order",
      "amazon", "dry clean*", "car wash", "oil change", "dmv", "refill", "renew"],
  },
  {
    key: "health", projects: ["health", "fitness"],
    words: ["doctor", "dentist", "gym", "workout", "work out", "run", "running", "yoga", "meds", "medicine",
      "prescription", "appointment", "therapy", "therapist", "vitamins", "checkup", "physio", "stretch*",
      "sleep", "walk", "hike"],
  },
  {
    key: "finance", projects: ["finance", "money", "admin"],
    words: ["pay", "bill*", "rent", "tax*", "invoice*", "bank", "budget", "venmo", "zelle", "insurance",
      "reimburse*", "refund", "subscription*", "cancel", "401k", "ira", "credit card", "expense*"],
  },
  {
    key: "social", projects: ["social", "friends", "people"],
    words: ["call", "text", "birthday", "gift", "invite", "rsvp", "dinner with", "lunch with", "coffee with",
      "catch up", "mom", "dad", "grandma", "grandpa", "thank", "card for", "visit"],
  },
  {
    key: "travel", projects: ["travel", "trips"],
    words: ["book", "flight*", "hotel*", "airbnb", "pack", "packing", "trip", "passport", "visa", "itinerary", "check in"],
  },
  {
    key: "work", projects: ["work"],
    words: ["meeting", "deck", "slides", "report", "deploy", "review", "pr", "bug", "standup", "1:1",
      "email", "draft", "proposal", "deadline", "client", "spec", "ticket", "interview", "pitch"],
  },
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${esc(w.replace(/\*$/, "")).replace(/ /g, "\\s+")}${w.endsWith("*") ? "[a-z]*" : ""}(?=$|[^a-z0-9])`, "i");
const CATEGORY_RES = CATEGORIES.map((c) => ({ ...c, res: c.words.map(wordRe) }));

/* Which category a line falls into, or null. Most matching words wins; ties go to the
   earlier category. */
export function categorize(text) {
  let best = null, bestScore = 0;
  for (const c of CATEGORY_RES) {
    const score = c.res.filter((re) => re.test(text)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best ? best.key : null;
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

/* One free-form line → { title, label, due_date, category, project } where `project` is a
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

  const due = takeDue(text, today);
  const title = due.text.replace(/\s{2,}/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  if (!title) return null;
  return { title, label, due_date: due.due, category: categorize(title), project };
}

export const parseText = (text, today) => String(text ?? "").split(/\r?\n/).map((l) => parseLine(l, today)).filter(Boolean);
