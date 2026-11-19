"use strict";

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

async function api(method, path, body, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/* Daily (port 3030) and the to-do list (port 1242) are one click apart. The proxy exposes
   each port as <host>-<port>.another.ac; locally it's just the port. */
function siteUrl(port) {
  const { hostname, protocol } = location;
  // <machine>-<port>.another.ac, or a named address like <machine>-daily.another.ac.
  const m = hostname.match(/^(.*)-([^.-]+)\.(.*another\.ac)$/);
  if (m) return `${protocol}//${m[1]}-${port}.${m[3]}`;
  return `${protocol}//${hostname}:${port}`;
}
for (const a of document.querySelectorAll(".js-daily")) a.href = siteUrl(3030);
for (const a of document.querySelectorAll(".js-todo")) a.href = siteUrl(1242);
const TODO_URL = siteUrl(1242);

/* ---------- dates & times ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => iso(new Date());
const parse = (s) => new Date(s + "T12:00:00");
const shift = (s, days) => { const d = parse(s); d.setDate(d.getDate() + days); return iso(d); };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const clock = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
// "3:15 PM" today, "Yesterday, 3:15 PM", else "Nov 12, 3:15 PM".
function when(t) {
  const d = new Date(t);
  const days = Math.round((parse(todayISO()) - parse(iso(d))) / 86400000);
  if (days === 0) return clock(t);
  if (days === 1) return `Yesterday, ${clock(t)}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) + ", " + clock(t);
}
// A version spans its first to last edit: "9:02 – 9:10 AM".
function span(a, b) {
  if (Math.abs(Date.parse(b) - Date.parse(a)) < 60000) return when(b);
  return iso(new Date(a)) === iso(new Date(b)) ? `${when(a)} – ${clock(b)}` : `${when(a)} – ${when(b)}`;
}
const edited = (created, updated) => updated && Date.parse(updated) - Date.parse(created) > 60000;

function dueInfo(due) {
  if (!due) return null;
  const days = Math.round((parse(due) - parse(todayISO())) / 86400000);
  const text = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday"
    : parse(due).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { text, cls: days < 0 ? "overdue" : days === 0 ? "today" : "" };
}

/* ---------- state ---------- */
const JOURNAL_RE = /^#journal(?:-(\d+))?$/;
const state = {
  mode: JOURNAL_RE.test(location.hash) ? "journal" : "day",  // one day, or a journal's running page
  journalId: Number(location.hash.match(JOURNAL_RE)?.[1]) || null,  // the journal open (null = Daily journal)
  journals: [],       // special journals; the Daily journal is every note without one
  date: DATE_RE.test(location.hash.slice(1)) ? location.hash.slice(1) : todayISO(),
  day: null,          // { summary, summary_created_at, summary_updated_at, notes: [...] }
  entries: [],
  projects: [],         // the to-do list's active projects, which notes fall into
  projectFilter: null,  // project id the sidebar's entries are narrowed to
  historyFor: null,   // null = whole day, "summary", or a note id
  historyDate: null,  // the day the history drawer shows (a journal note's day)
  journal: [],        // days loaded into the journal, oldest first
  journalMore: false, // there are earlier days still to load
};

/* ---------- saving ----------
   Every box — the summary and each note — saves on its own while you type. To-dos are
   pulled out once a line is finished (Enter, leaving the box, or leaving the day), so a
   half-typed “need to cl…” never lands on the to-do list.
   A target is { kind: "summary" } or { kind: "note", note }, where note.id is null until
   the note's first save creates it. A journal note also carries its `date`. */
let queue = Promise.resolve();

function saveTarget(t, { extract = false, keepalive = false } = {}) {
  const body = t.el.value;
  if (body === t.saved && (!extract || body === t.extracted)) return queue;
  clearTimeout(t.timer);
  if (t.kind === "note" && t.note.id == null && !body.trim()) return queue;  // an untouched new note
  const date = t.date || state.date;
  setSaved("Saving…");
  queue = queue.then(async () => {
    const payload = { extract, link: `${location.origin}/#${date}` };
    try {
      let res;
      if (t.kind === "summary") res = await api("PUT", `entries/${date}`, { ...payload, summary: body }, { keepalive });
      else if (t.note.id == null) res = await api("POST", `entries/${date}/notes`, { ...payload, body, journal_id: t.note.journal_id ?? null }, { keepalive });
      else res = await api("PUT", `notes/${t.note.id}`, { ...payload, body }, { keepalive });
      t.saved = body;
      if (extract) t.extracted = body;
      if (res.note) { Object.assign(t.note, res.note); t.stamp?.(); }
      if (res.day && state.day?.date === date) { Object.assign(state.day, { summary_created_at: res.day.summary_created_at, summary_updated_at: res.day.summary_updated_at }); stampSummary(); }
      if (state.mode === "day" ? date !== state.date : !t.date) return;
      setSaved("Saved");
      if (res.created.length) {
        const where = res.created.map((c) => c.project || "Inbox");
        toast(`Added ${res.created.length} to-do${res.created.length === 1 ? "" : "s"} → ${[...new Set(where)].join(", ")}`);
      }
      if (res.errors.length) toast(`Couldn't add some to-dos: ${res.errors[0]}`);
      if (extract && state.mode === "day") loadFound();
      loadEntries();
      if (!$("#history").hidden) loadHistory();
    } catch (err) {
      setSaved("Not saved — retrying");
      toast(err.message);
      t.timer = setTimeout(() => saveTarget(t, { extract }), 4000);
    }
  });
  return queue;
}

let targets = [];
const saveAll = (opts) => Promise.all(targets.map((t) => saveTarget(t, opts)));

function setSaved(text) { $("#saved").textContent = text; }

function bind(t) {
  const el = t.el;
  t.saved = t.extracted = el.value;
  el.addEventListener("input", () => {
    grow(el);
    setSaved("Editing…");
    clearTimeout(t.timer);
    t.timer = setTimeout(() => saveTarget(t), 700);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(t.xtimer); t.xtimer = setTimeout(() => saveTarget(t, { extract: true }), 300); }
  });
  el.addEventListener("blur", () => saveTarget(t, { extract: true }));
  targets.push(t);
  return t;
}

document.addEventListener("visibilitychange", () => { if (document.hidden) saveAll({ extract: true, keepalive: true }); });
window.addEventListener("pagehide", () => saveAll({ extract: true, keepalive: true }));

function grow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}

/* ---------- the day: its summary, with notes inside ---------- */
function stampSummary() {
  const d = state.day;
  $("#summary-stamp").textContent = !d.summary_created_at ? ""
    : edited(d.summary_created_at, d.summary_updated_at) ? `Written ${when(d.summary_created_at)} · edited ${when(d.summary_updated_at)}`
    : `Written ${when(d.summary_created_at)}`;
}

function noteEl(note, date = null) {
  const el = h("textarea", { class: "note-text", spellcheck: "true", "aria-label": "Note",
    placeholder: note.id == null ? "What's on your mind?\n\nTo-dos are picked up as you write: - [ ] call the vet · todo: print the poster · “need to clean the toilet tomorrow”" : "" });
  el.value = note.body;
  const time = h("time", { class: "note-time" });
  const meta = h("span", { class: "note-meta" });
  const pick = h("select", { class: "proj-pick", "aria-label": "Project", title: "Which project this note falls into",
    onchange: (e) => setNoteProject(t, e.target.value) });
  const jpick = h("select", { class: "proj-pick j-pick", "aria-label": "Journal", title: "Which journal this note is in",
    onchange: (e) => setNoteJournal(t, card, e.target.value) });
  const t = bind({ kind: "note", note, el, date });
  t.stamp = () => {
    // Project: worked out from the words and projects' keywords ("Auto") until you pick one.
    const project = projectById(note.project_id);
    pick.replaceChildren(
      h("option", { value: "auto" }, note.project_auto && project ? `✨ ${project.name}` : "✨ Auto"),
      ...projectTree().map(({ p, depth }) => h("option", { value: p.id }, "\u2003".repeat(depth) + p.name)),
      h("option", { value: "none" }, "No project"));
    pick.value = note.project_auto ? "auto" : note.project_id == null ? "none" : String(note.project_id);
    pick.disabled = note.id == null;
    pick.title = note.project_auto ? "Picked from the note's words — choose one to set it yourself" : "Chosen by you — ✨ Auto to let the words decide";
    card.style.setProperty("--proj", project?.color || "var(--faint)");
    card.classList.toggle("has-project", !!project);
    time.textContent = note.created_at ? clock(note.created_at) : "Now";
    time.title = note.created_at ? new Date(note.created_at).toLocaleString() : "Not saved yet";
    meta.textContent = note.created_at && edited(note.created_at, note.updated_at) ? `edited ${when(note.updated_at)}` : "";
    card.classList.toggle("draft", note.id == null);
    // Journal: only worth showing once there are special journals.
    const j = journalById(note.journal_id);
    jpick.hidden = !state.journals.length;
    jpick.replaceChildren(h("option", { value: "" }, "📖 Daily journal"),
      ...state.journals.map((x) => h("option", { value: x.id }, "📓 " + x.name)));
    jpick.value = j ? String(j.id) : "";
    jpick.disabled = note.id == null;
  };
  const card = h("article", { class: "note" },
    h("div", { class: "note-rail" }, time),
    h("div", { class: "note-body" }, el,
      h("div", { class: "note-foot" }, h("span", { class: "proj-wrap" }, h("span", { class: "proj-dot" }), pick), jpick, meta, h("span", { class: "spacer" }),
        h("button", { class: "link-btn", onclick: () => { if (note.id != null) openHistory(note.id, date); } }, "History"),
        h("button", { class: "link-btn danger", onclick: () => deleteNote(t, card) }, "Delete"))));
  t.stamp();
  requestAnimationFrame(() => grow(el));
  return card;
}

const projectById = (id) => state.projects.find((t) => t.id === id) || null;
// Every project in the to-do list's order — each followed by its sub-projects — with its depth.
function projectTree() {
  const out = [];
  const walk = (p, depth) => { out.push({ p, depth }); state.projects.filter((c) => c.parent_id === p.id).forEach((c) => walk(c, depth + 1)); };
  state.projects.filter((p) => p.parent_id == null || !projectById(p.parent_id)).forEach((p) => walk(p, 0));
  return out;
}

async function setNoteProject(t, value) {
  try {
    const { note } = await api("PATCH", `notes/${t.note.id}`, value === "auto" ? { auto: true } : { project_id: value === "none" ? null : Number(value) });
    Object.assign(t.note, note);
    t.stamp();
    loadEntries();
  } catch (err) { toast(err.message); }
}

const journalById = (id) => (id == null ? null : state.journals.find((j) => j.id === id) || null);

async function setNoteJournal(t, card, value) {
  try {
    const { note } = await api("PATCH", `notes/${t.note.id}`, { journal_id: value ? Number(value) : null });
    Object.assign(t.note, note);
    const j = journalById(note.journal_id);
    // On a journal's page, a note moved to another journal leaves it.
    if (state.mode === "journal" && (note.journal_id ?? null) !== state.journalId) {
      targets = targets.filter((x) => x !== t);
      card.remove();
      for (const d of state.journal) d.notes = d.notes.filter((n) => n.id !== note.id);
    } else t.stamp();
    toast(`Moved to ${j ? j.name : "the Daily journal"}`);
    loadJournals();
  } catch (err) { toast(err.message); }
}

async function loadJournals() {
  try { state.journals = await api("GET", "journals"); } catch { state.journals = []; }
  renderJournalsNav();
  for (const t of targets) t.stamp?.();  // notes' journal pickers
}

function renderJournalsNav() {
  const on = (id) => state.mode === "journal" && state.journalId === id;
  $("#journals-nav").replaceChildren(
    h("button", { class: "nav-item" + (on(null) ? " active" : ""), onclick: () => openJournal(null) },
      "📖 Daily journal", h("span", { class: "ext" }, "Alt J")),
    ...state.journals.map((j) => h("button", { class: "nav-item" + (on(j.id) ? " active" : ""), onclick: () => openJournal(j.id) },
      h("span", { class: "dot", style: `background:${j.color}` }), h("span", { class: "j-nav-name" }, j.name),
      h("span", { class: "ext" }, j.note_count || ""))));
}

/* New / rename a special journal. */
const JOURNAL_COLORS = ["#b4572e", "#c2410c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#6b7280"];
let editingJournal = null, journalColor = JOURNAL_COLORS[0];
function journalDialog(j = null) {
  editingJournal = j;
  journalColor = j?.color || JOURNAL_COLORS[(state.journals.length + 3) % JOURNAL_COLORS.length];
  $("#jd-title").textContent = j ? "Rename journal" : "New journal";
  $("#jd-save").textContent = j ? "Save" : "Create";
  $("#jd-name").value = j?.name || "";
  const paint = () => $("#jd-colors").replaceChildren(...JOURNAL_COLORS.map((c) => h("button", {
    type: "button", class: "swatch" + (c === journalColor ? " on" : ""), style: `background:${c}`, "aria-label": c,
    onclick: () => { journalColor = c; paint(); } })));
  paint();
  $("#journal-dialog").showModal();
  $("#jd-name").focus();
}
$("#journal-dialog").addEventListener("close", async () => {
  if ($("#journal-dialog").returnValue !== "ok") return;
  const name = $("#jd-name").value.trim();
  if (!name) return;
  try {
    const j = editingJournal
      ? await api("PATCH", `journals/${editingJournal.id}`, { name, color: journalColor })
      : await api("POST", "journals", { name, color: journalColor });
    await loadJournals();
    openJournal(j.id);
  } catch (err) { toast(err.message); }
});

async function deleteJournal(j) {
  if (!confirm(`Delete the journal “${j.name}”? Its ${j.note_count || 0} note${j.note_count === 1 ? "" : "s"} move to the Daily journal — nothing is lost.`)) return;
  await saveAll({ extract: true });
  try {
    await api("DELETE", `journals/${j.id}`);
    await loadJournals();
    toast(`Deleted “${j.name}” — its notes are in the Daily journal`);
    openJournal(null);
  } catch (err) { toast(err.message); }
}

async function loadProjects() {
  try { state.projects = await api("GET", "projects"); } catch { state.projects = []; }
}

function renderDay() {
  targets = [];
  const d = state.day;
  const summary = $("#summary");
  summary.replaceWith(summary.cloneNode());  // drop the last day's listeners
  $("#summary").value = d.summary;
  bind({ kind: "summary", el: $("#summary") });
  stampSummary();
  const notes = d.notes.length ? d.notes : [{ id: null, body: "", created_at: null, updated_at: null }];
  $("#notes").replaceChildren(...notes.map(noteEl));
  requestAnimationFrame(() => grow($("#summary")));
}

function addNote() {
  if (state.mode === "journal") return journalWrite();
  // Reuse an empty note at the end rather than stacking blanks.
  const last = targets.filter((t) => t.kind === "note").at(-1);
  if (last && !last.el.value.trim()) return last.el.focus();
  const card = noteEl({ id: null, body: "", created_at: null, updated_at: null });
  $("#notes").append(card);
  card.querySelector("textarea").focus();
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function deleteNote(t, card) {
  clearTimeout(t.timer);
  targets = targets.filter((x) => x !== t);
  const box = card.parentElement;
  card.remove();
  if (!box.children.length) box.append(noteEl({ id: null, body: "", created_at: null, updated_at: null }, t.date));
  if (t.note.id == null) return;
  await queue;
  try {
    await api("DELETE", `notes/${t.note.id}`);
    if (state.day) state.day.notes = state.day.notes.filter((n) => n.id !== t.note.id);
    if (t.el.value.trim()) toast("Note deleted — bring it back from History");
    loadEntries();
    if (state.mode === "day") loadFound();
    if (!$("#history").hidden) loadHistory();
  } catch (err) { toast(err.message); }
}

async function openDay(date) {
  if (state.mode === "journal") { await saveAll({ extract: true }); setMode("day"); }
  else if (state.date && state.day && state.date !== date) await saveAll({ extract: true });
  state.date = date;
  history.replaceState(null, "", date === todayISO() ? location.pathname : "#" + date);
  const d = parse(date);
  $("#day-name").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const days = Math.round((parse(todayISO()) - d) / 86400000);
  $("#day-sub").textContent = (days === 0 ? "Today" : days === 1 ? "Yesterday" : days === -1 ? "Tomorrow"
    : days > 0 ? `${days} days ago` : `In ${-days} days`) + " · " + d.getFullYear();
  $("#pick").value = date;
  document.title = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Daily`;
  $("#sidebar").classList.remove("show");
  setSaved("");
  try {
    const day = await api("GET", `entries/${date}`);
    if (state.date !== date) return;
    state.day = day;
    renderDay();
  } catch (err) { toast(err.message); }
  renderEntries();
  loadFound();
  loadDue();
  if (!$("#history").hidden) { state.historyFor = null; state.historyDate = null; loadHistory(); }
}

/* ---------- the journal ----------
   Every day on one running page, oldest at the top and today at the bottom, like one long
   file. Notes are edited right there (same autosave, to-dos, projects and history as the
   day view); each day's heading opens that day. Earlier days load as you ask for them. */
const JOURNAL_DAYS = 30;
const blankNote = (journal_id = null) => ({ id: null, body: "", created_at: null, updated_at: null, journal_id });

function setMode(mode) {
  state.mode = mode;
  document.body.classList.toggle("journal-mode", mode === "journal");
  $("#journal").hidden = mode !== "journal";
  $(".page").hidden = mode === "journal";
  $("#go-today").classList.toggle("active", mode === "day" && state.date === todayISO());
  renderJournalsNav();
}

async function openJournal(jid = null) {
  await saveAll({ extract: true });
  const j = journalById(jid);
  jid = j ? j.id : null;
  state.journalId = jid;
  state.journal = [];
  setMode("journal");
  history.replaceState(null, "", jid ? `#journal-${jid}` : "#journal");
  $("#day-name").textContent = j ? j.name : "Daily journal";
  $("#day-sub").replaceChildren(...(j
    ? ["A journal of its own · ",
       h("button", { class: "link-btn", onclick: () => journalDialog(j) }, "Rename"), " · ",
       h("button", { class: "link-btn danger", onclick: () => deleteJournal(j) }, "Delete")]
    : ["Every day, one running page"]));
  document.title = `${j ? j.name : "Daily journal"} · Daily`;
  $("#sidebar").classList.remove("show");
  closeHistory();
  setSaved("");
  state.day = null;
  try {
    const { days, more } = await api("GET", `journal?days=${JOURNAL_DAYS}` + (jid ? `&journal=${jid}` : ""));
    if (state.mode !== "journal" || state.journalId !== jid) return;
    state.journal = days;
    state.journalMore = more;
    renderJournal();
    window.scrollTo(0, document.body.scrollHeight);
  } catch (err) { toast(err.message); }
  renderEntries();
}

async function loadEarlier() {
  const first = state.journal[0]?.date;
  try {
    const { days, more } = await api("GET", `journal?days=${JOURNAL_DAYS}&before=${first}` + (state.journalId ? `&journal=${state.journalId}` : ""));
    const h0 = document.body.scrollHeight;
    state.journal = [...days, ...state.journal];
    state.journalMore = more;
    renderJournal();
    window.scrollBy(0, document.body.scrollHeight - h0);  // stay where you were reading
  } catch (err) { toast(err.message); }
}

function journalDayEl(day) {
  const d = parse(day.date);
  const today = day.date === todayISO();
  const filter = state.projectFilter;
  const notes = day.notes.filter((n) => n.body.trim() || today).filter((n) => filter == null || n.project_id === filter);
  if (filter != null && !notes.length && !today) return null;
  const list = h("div", { class: "notes" }, notes.map((n) => noteEl(n, day.date)));
  if (today && filter == null) list.append(noteEl(blankNote(state.journalId), day.date));
  return h("section", { class: "j-day" + (today ? " today" : ""), id: "j-" + day.date },
    h("header", { class: "j-head" },
      h("a", { class: "j-date", href: "#" + day.date, title: "Open this day",
          onclick: (e) => { e.preventDefault(); openDay(day.date); } },
        today ? "Today" : d.toLocaleDateString(undefined, { weekday: "long" }),
        h("span", { class: "j-full" }, d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }))),
      h("span", { class: "j-open" }, "Open day ›")),
    day.summary.trim() && filter == null && h("p", { class: "j-summary" }, h("span", { class: "field-label" }, "The day"), day.summary),
    list,
    today && filter == null && h("button", { class: "add-note", title: "New note (Alt+N)", onclick: journalWrite }, "+ New note"));
}

function renderJournal() {
  targets = [];
  const days = [...state.journal];
  if (days.at(-1)?.date !== todayISO()) days.push({ date: todayISO(), summary: "", notes: [] });
  let month = null;
  const parts = [];
  if (state.journalMore) parts.push(h("button", { class: "btn j-more", onclick: loadEarlier }, "Load earlier days"));
  else if (state.journal.length) parts.push(h("p", { class: "j-start" }, "The beginning"));
  else if (state.journalId) parts.push(h("p", { class: "j-start" }, "Nothing here yet — write today's first note below. Notes elsewhere can be moved in with their journal picker."));
  for (const day of days) {
    const el = journalDayEl(day);
    if (!el) continue;
    const m = parse(day.date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (m !== month) { parts.push(h("div", { class: "j-month" }, m)); month = m; }
    parts.push(el);
  }
  $("#journal").replaceChildren(...parts);
}

// Alt+N in the journal: write in today's empty note at the bottom.
function journalWrite() {
  const today = $("#j-" + todayISO());
  const blank = [...(today?.querySelectorAll("textarea") || [])].find((x) => !x.value.trim());
  if (blank) { blank.focus(); blank.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  if (!today) return;
  const card = noteEl(blankNote(state.journalId), todayISO());
  today.querySelector(".notes").append(card);
  card.querySelector("textarea").focus();
  card.scrollIntoView({ block: "center", behavior: "smooth" });
}

/* ---------- sidebar ---------- */
async function loadEntries() {
  try { state.entries = await api("GET", "entries"); renderEntries(); } catch {}
}

function renderEntries() {
  const nodes = [];
  let month = null;
  // Narrow the list to one project's days.
  const used = new Set(state.entries.flatMap((e) => (e.projects || "").split(",").filter(Boolean).map(Number)));
  const chips = state.projects.filter((t) => used.has(t.id));
  if (chips.length) nodes.push(h("div", { class: "proj-filter" },
    h("button", { class: "chip-btn" + (state.projectFilter == null ? " on" : ""), onclick: () => { state.projectFilter = null; renderEntries(); if (state.mode === "journal") renderJournal(); } }, "All"),
    chips.map((t) => h("button", { class: "chip-btn" + (state.projectFilter === t.id ? " on" : ""), onclick: () => { state.projectFilter = state.projectFilter === t.id ? null : t.id; renderEntries(); if (state.mode === "journal") renderJournal(); } },
      h("span", { class: "dot", style: `background:${t.color}` }), t.name))));
  for (const e of state.entries) {
    const inDay = (e.projects || "").split(",").filter(Boolean).map(Number);
    if (state.projectFilter != null && !inDay.includes(state.projectFilter)) continue;
    const d = parse(e.date);
    const m = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (m !== month) { nodes.push(h("div", { class: "month" }, m)); month = m; }
    nodes.push(h("a", {
      class: "entry-link" + (state.mode === "day" && e.date === state.date ? " active" : ""), href: "#" + e.date,
      onclick: (ev) => {
        ev.preventDefault();
        const inJournal = state.mode === "journal" && $("#j-" + e.date);
        if (inJournal) { inJournal.scrollIntoView({ block: "start", behavior: "smooth" }); $("#sidebar").classList.remove("show"); }
        else openDay(e.date);
      },
    }, h("span", { class: "d" }, d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
        e.note_count > 1 && h("span", { class: "n" }, `${e.note_count} notes`),
        h("span", { class: "dots" }, inDay.map((id) => projectById(id)).filter(Boolean).map((t) => h("span", { class: "dot", title: t.name, style: `background:${t.color}` })))),
      h("span", { class: "s" }, (e.snippet || "").replace(/\s+/g, " "))));
  }
  $("#entries").replaceChildren(...(nodes.length ? nodes : [h("div", { class: "side-empty" }, "Nothing written yet.")]));
  $("#go-today").classList.toggle("active", state.mode === "day" && state.date === todayISO());
}

/* ---------- version history ----------
   Like a doc's: each version is a stretch of editing on one note or the summary, shown as
   what changed since the version before it. Any version can be restored — a deleted note
   comes back with it. */
function diffWords(a, b) {
  const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean);
  if (A.length * B.length > 600000) return [{ t: "del", s: a }, { t: "ins", s: b }];
  // Trim the shared start and end, then LCS on what's left.
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const n = a2.length, m = b2.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  const push = (t, str) => { if (out.length && out.at(-1).t === t) out.at(-1).s += str; else out.push({ t, s: str }); };
  if (s) push("same", A.slice(0, s).join(""));
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a2[i] === b2[j]) { push("same", a2[i]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) push("ins", b2[j++]);
    else push("del", a2[i++]);
  }
  if (e) push("same", A.slice(A.length - e).join(""));
  return out;
}

// Long unchanged stretches fold down to their ends, so the change is what you see.
function diffEl(before, after) {
  const parts = diffWords(before, after);
  return h("div", { class: "diff" }, parts.map((p, i) => {
    if (p.t === "ins") return h("ins", {}, p.s);
    if (p.t === "del") return h("del", {}, p.s);
    if (parts.length === 1 || p.s.length < 240) return p.s;
    const head = i === 0 ? "" : p.s.slice(0, 100), tail = i === parts.length - 1 ? "" : p.s.slice(-100);
    return [head, h("span", { class: "fold" }, " … "), tail];
  }));
}

async function openHistory(target = null, date = null) {
  state.historyFor = target;
  state.historyDate = date;
  $("#history").hidden = false;
  document.body.classList.add("history-open");
  await saveAll();
  loadHistory();
}

function closeHistory() {
  $("#history").hidden = true;
  document.body.classList.remove("history-open");
}

async function loadHistory() {
  const date = state.historyDate || state.date;
  let data;
  try { data = await api("GET", `entries/${date}/history`); } catch (err) { return toast(err.message); }
  if (date !== (state.historyDate || state.date)) return;
  const notes = new Map(data.notes.map((n) => [n.id, n]));
  const label = (r) => r.note_id == null ? "The day's summary" : `Note from ${notes.get(r.note_id) ? clock(notes.get(r.note_id).created_at) : "earlier"}`;
  // The newest version of something still there is what's on the page: nothing to restore.
  const latest = new Set();
  const seen = new Set();
  for (const r of data.revisions) {
    const key = r.note_id ?? "summary";
    if (!seen.has(key)) { seen.add(key); if (r.event !== "deleted") latest.add(r.id); }
  }

  const keyOf = (r) => r.note_id ?? "summary";
  const targetsHere = [...new Set(data.revisions.map(keyOf))];
  $("#history-sub").textContent = parse(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    + ` · ${data.revisions.length} version${data.revisions.length === 1 ? "" : "s"}`;
  const chip = (key, text) => h("button", {
    class: "chip-btn" + (state.historyFor === key ? " on" : ""), onclick: () => { state.historyFor = key; loadHistory(); },
  }, text);
  $("#history-filter").replaceChildren(...[
    chip(null, "Everything"),
    targetsHere.includes("summary") && chip("summary", "Summary"),
    ...targetsHere.filter((k) => k !== "summary").reverse().map((id) => {
      const n = notes.get(id);
      return chip(id, (n?.deleted_at ? "🗑 " : "") + (n ? `Note ${clock(n.created_at)}` : "Note"));
    }),
  ].filter(Boolean));

  const list = data.revisions.filter((r) => state.historyFor == null || keyOf(r) === state.historyFor);
  $("#history-list").replaceChildren(...(list.length ? list.map((r) => {
    const badge = r.event === "created" ? "Created" : r.event === "deleted" ? "Deleted" : r.event === "restored" ? "Restored" : "Edited";
    const isLatest = latest.has(r.id);
    return h("div", { class: "version" + (isLatest ? " current" : "") },
      h("div", { class: "version-head" },
        h("span", { class: "version-time" }, span(r.created_at, r.updated_at)),
        h("span", { class: `badge ${r.event || "edited"}` }, badge)),
      h("div", { class: "version-what" }, label(r), isLatest && h("span", { class: "current-tag" }, " · current")),
      r.event === "deleted" ? h("div", { class: "diff gone" }, r.body.length > 300 ? r.body.slice(0, 300) + " …" : r.body)
        : diffEl(r.event === "created" ? "" : r.before, r.body),
      !isLatest && h("button", { class: "btn small", onclick: () => restoreVersion(r) },
        r.event === "deleted" ? "Restore this note" : "Restore this version"));
  }) : [h("div", { class: "hint" }, "No versions yet — they're saved as you write.")]));
}

async function restoreVersion(r) {
  await saveAll();
  try {
    const { day } = await api("POST", `revisions/${r.id}/restore`);
    if (state.mode === "journal") {
      const i = state.journal.findIndex((x) => x.date === day.date);
      if (i >= 0) state.journal[i] = day; else state.journal = [...state.journal, day].sort((a, b) => a.date.localeCompare(b.date));
      renderJournal();
    } else {
      if (day.date !== state.date) return;
      state.day = day;
      renderDay();
    }
    toast("Restored");
    loadHistory();
    loadEntries();
    if (state.mode === "day") loadFound();
  } catch (err) { toast(err.message); }
}

/* ---------- to-do panels ---------- */
const checkSvg = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 12 12");
  s.innerHTML = '<path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

function todoEl(t, projects, refresh) {
  const p = projects.find((x) => x.id === t.project_id);
  const due = !t.done && dueInfo(t.due_date);
  return h("div", { class: `todo ${t.label || ""}` + (t.done ? " done" : "") },
    h("button", {
      class: "check", title: t.done ? "Mark as not done" : "Complete", "aria-label": t.done ? "Mark as not done" : "Complete",
      onclick: async () => {
        try { await api("PATCH", `todos/${t.id}`, { done: !t.done }); refresh(); } catch (err) { toast(err.message); }
      },
    }, checkSvg()),
    h("div", { class: "todo-main" },
      h("div", { class: "todo-title" }, t.title),
      h("div", { class: "meta" },
        h("a", { href: `${TODO_URL}/#${p ? "p" + p.id : "inbox"}`, target: "_blank", rel: "noopener" },
          p ? [h("span", { class: "dot", style: `background:${p.color}` }), p.name] : "📥 Inbox"),
        t.label === "urgent" && h("span", { class: "due overdue" }, "⚡ Urgent"),
        due && h("span", { class: `due ${due.cls}` }, "📅 " + due.text))));
}

async function loadFound() {
  const date = state.date;
  const box = $("#found");
  try {
    const { todos, projects, error } = await api("GET", `entries/${date}/todos`);
    if (date !== state.date) return;
    if (error) return box.replaceChildren(h("div", { class: "warn" }, error));
    box.replaceChildren(...(todos.length ? todos.map((t) => todoEl(t, projects, () => { loadFound(); loadDue(); }))
      : [h("div", { class: "hint" }, "None yet. Write ", h("code", {}, "- [ ] call mom"), ", ", h("code", {}, "todo: …"),
          " or “need to …” in any note and it's added to your to-do list, sorted into the right project. Tick ",
          h("code", {}, "- [x]"), " to mark it done.")]));
  } catch (err) { box.replaceChildren(h("div", { class: "warn" }, err.message)); }
}

async function loadDue() {
  const box = $("#due");
  try {
    const { todos, projects, error } = await api("GET", `due?today=${todayISO()}`);
    if (error) return box.replaceChildren(h("div", { class: "warn" }, error));
    box.replaceChildren(...(todos.length ? todos.map((t) => todoEl(t, projects, () => { loadDue(); loadFound(); }))
      : [h("div", { class: "hint" }, "Nothing due today or overdue.")]));
  } catch (err) { box.replaceChildren(h("div", { class: "warn" }, err.message)); }
}

/* ---------- navigation ---------- */
$("#new-journal").addEventListener("click", () => journalDialog());
$("#prev").addEventListener("click", () => openDay(shift(state.date, -1)));
$("#next").addEventListener("click", () => openDay(shift(state.date, 1)));
$("#go-today").addEventListener("click", () => openDay(todayISO()));
$("#pick").addEventListener("change", (e) => { if (DATE_RE.test(e.target.value)) openDay(e.target.value); });
$("#menu").addEventListener("click", () => $("#sidebar").classList.toggle("show"));
$("#add-note").addEventListener("click", addNote);
$("#show-keys").addEventListener("click", () => $("#keys-dialog").showModal());
$("#open-history").addEventListener("click", () => ($("#history").hidden ? openHistory() : closeHistory()));
$("#close-history").addEventListener("click", closeHistory);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#history").hidden) return closeHistory();
  // "?" only when not writing, so it can still be typed into a note.
  if (e.key === "?" && !e.target.closest("textarea, input")) { e.preventDefault(); return $("#keys-dialog").showModal(); }
  if (!e.altKey) return;
  const k = e.code;
  if (e.key === "ArrowLeft" && state.mode === "day") { e.preventDefault(); openDay(shift(state.date, -1)); }
  else if (e.key === "ArrowRight" && state.mode === "day") { e.preventDefault(); openDay(shift(state.date, 1)); }
  else if (k === "KeyJ") { e.preventDefault(); state.mode === "journal" && state.journalId == null ? openDay(state.date) : openJournal(null); }
  else if (k === "KeyN") { e.preventDefault(); addNote(); }
  else if (k === "KeyH") { e.preventDefault(); $("#history").hidden ? openHistory() : closeHistory(); }
  else if (k === "KeyD") { e.preventDefault(); location.href = TODO_URL; }
  else if (k === "KeyT") { e.preventDefault(); openDay(todayISO()); }
  else if (k === "Slash") { e.preventDefault(); $("#keys-dialog").showModal(); }
});
window.addEventListener("hashchange", () => {
  const jm = location.hash.match(JOURNAL_RE);
  if (jm) { const jid = Number(jm[1]) || null; if (state.mode !== "journal" || state.journalId !== jid) openJournal(jid); return; }
  const d = location.hash.slice(1) || todayISO();
  if (DATE_RE.test(d) && (d !== state.date || state.mode === "journal")) openDay(d);
});
window.addEventListener("resize", () => document.querySelectorAll("textarea").forEach(grow));

const start = state.date;
state.date = null;
if (state.mode === "journal") { state.date = start; Promise.all([loadProjects(), loadJournals()]).then(() => openJournal(state.journalId)); }
else {
  loadJournals();
  loadProjects().then(() => openDay(start)).then(() => { if (start === todayISO()) [...document.querySelectorAll("#notes textarea")].at(-1)?.focus(); });
}
loadEntries();
