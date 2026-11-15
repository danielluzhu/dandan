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
  const m = hostname.match(/^(.*)-(\d+)\.(.+)$/);
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
const state = {
  date: DATE_RE.test(location.hash.slice(1)) ? location.hash.slice(1) : todayISO(),
  day: null,          // { summary, summary_created_at, summary_updated_at, notes: [...] }
  entries: [],
  historyFor: null,   // null = whole day, "summary", or a note id
};

/* ---------- saving ----------
   Every box — the summary and each note — saves on its own while you type. To-dos are
   pulled out once a line is finished (Enter, leaving the box, or leaving the day), so a
   half-typed “need to cl…” never lands on the to-do list.
   A target is { kind: "summary" } or { kind: "note", note }, where note.id is null until
   the note's first save creates it. */
let queue = Promise.resolve();

function saveTarget(t, { extract = false, keepalive = false } = {}) {
  const body = t.el.value;
  if (body === t.saved && (!extract || body === t.extracted)) return queue;
  clearTimeout(t.timer);
  if (t.kind === "note" && t.note.id == null && !body.trim()) return queue;  // an untouched new note
  const date = state.date;
  setSaved("Saving…");
  queue = queue.then(async () => {
    const payload = { extract, link: `${location.origin}/#${date}` };
    try {
      let res;
      if (t.kind === "summary") res = await api("PUT", `entries/${date}`, { ...payload, summary: body }, { keepalive });
      else if (t.note.id == null) res = await api("POST", `entries/${date}/notes`, { ...payload, body }, { keepalive });
      else res = await api("PUT", `notes/${t.note.id}`, { ...payload, body }, { keepalive });
      t.saved = body;
      if (extract) t.extracted = body;
      if (res.note) { Object.assign(t.note, res.note); t.stamp?.(); }
      if (res.day) { Object.assign(state.day, { summary_created_at: res.day.summary_created_at, summary_updated_at: res.day.summary_updated_at }); stampSummary(); }
      if (date !== state.date) return;
      setSaved("Saved");
      if (res.created.length) {
        const where = res.created.map((c) => c.project || "Inbox");
        toast(`Added ${res.created.length} to-do${res.created.length === 1 ? "" : "s"} → ${[...new Set(where)].join(", ")}`);
      }
      if (res.errors.length) toast(`Couldn't add some to-dos: ${res.errors[0]}`);
      if (extract) loadFound();
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

function noteEl(note) {
  const el = h("textarea", { class: "note-text", spellcheck: "true", "aria-label": "Note",
    placeholder: note.id == null ? "What's on your mind?\n\nTo-dos are picked up as you write: - [ ] call the vet · todo: print the poster · “need to clean the toilet tomorrow”" : "" });
  el.value = note.body;
  const time = h("time", { class: "note-time" });
  const meta = h("span", { class: "note-meta" });
  const t = bind({ kind: "note", note, el });
  t.stamp = () => {
    time.textContent = note.created_at ? clock(note.created_at) : "Now";
    time.title = note.created_at ? new Date(note.created_at).toLocaleString() : "Not saved yet";
    meta.textContent = note.created_at && edited(note.created_at, note.updated_at) ? `edited ${when(note.updated_at)}` : "";
    card.classList.toggle("draft", note.id == null);
  };
  const card = h("article", { class: "note" },
    h("div", { class: "note-rail" }, time),
    h("div", { class: "note-body" }, el,
      h("div", { class: "note-foot" }, meta, h("span", { class: "spacer" }),
        h("button", { class: "link-btn", onclick: () => { if (note.id != null) openHistory(note.id); } }, "History"),
        h("button", { class: "link-btn danger", onclick: () => deleteNote(t, card) }, "Delete"))));
  t.stamp();
  requestAnimationFrame(() => grow(el));
  return card;
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
  card.remove();
  if (!$("#notes").children.length) $("#notes").append(noteEl({ id: null, body: "", created_at: null, updated_at: null }));
  if (t.note.id == null) return;
  await queue;
  try {
    await api("DELETE", `notes/${t.note.id}`);
    state.day.notes = state.day.notes.filter((n) => n.id !== t.note.id);
    if (t.el.value.trim()) toast("Note deleted — bring it back from History");
    loadEntries();
    loadFound();
    if (!$("#history").hidden) loadHistory();
  } catch (err) { toast(err.message); }
}

async function openDay(date) {
  if (state.date && state.day && state.date !== date) await saveAll({ extract: true });
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
  if (!$("#history").hidden) { state.historyFor = null; loadHistory(); }
}

/* ---------- sidebar ---------- */
async function loadEntries() {
  try { state.entries = await api("GET", "entries"); renderEntries(); } catch {}
}

function renderEntries() {
  const nodes = [];
  let month = null;
  for (const e of state.entries) {
    const d = parse(e.date);
    const m = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (m !== month) { nodes.push(h("div", { class: "month" }, m)); month = m; }
    nodes.push(h("a", {
      class: "entry-link" + (e.date === state.date ? " active" : ""), href: "#" + e.date,
      onclick: (ev) => { ev.preventDefault(); openDay(e.date); },
    }, h("span", { class: "d" }, d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
        e.note_count > 1 && h("span", { class: "n" }, `${e.note_count} notes`)),
      h("span", { class: "s" }, (e.snippet || "").replace(/\s+/g, " "))));
  }
  $("#entries").replaceChildren(...(nodes.length ? nodes : [h("div", { class: "side-empty" }, "Nothing written yet.")]));
  $("#go-today").classList.toggle("active", state.date === todayISO());
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

async function openHistory(target = null) {
  state.historyFor = target;
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
  const date = state.date;
  let data;
  try { data = await api("GET", `entries/${date}/history`); } catch (err) { return toast(err.message); }
  if (date !== state.date) return;
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
    if (day.date !== state.date) return;
    state.day = day;
    renderDay();
    toast("Restored");
    loadHistory();
    loadEntries();
    loadFound();
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
  if (e.key === "ArrowLeft") { e.preventDefault(); openDay(shift(state.date, -1)); }
  else if (e.key === "ArrowRight") { e.preventDefault(); openDay(shift(state.date, 1)); }
  else if (k === "KeyN") { e.preventDefault(); addNote(); }
  else if (k === "KeyH") { e.preventDefault(); $("#history").hidden ? openHistory() : closeHistory(); }
  else if (k === "KeyD") { e.preventDefault(); location.href = TODO_URL; }
  else if (k === "KeyT") { e.preventDefault(); openDay(todayISO()); }
  else if (k === "Slash") { e.preventDefault(); $("#keys-dialog").showModal(); }
});
window.addEventListener("hashchange", () => {
  const d = location.hash.slice(1) || todayISO();
  if (DATE_RE.test(d) && d !== state.date) openDay(d);
});
window.addEventListener("resize", () => document.querySelectorAll("textarea").forEach(grow));

const start = state.date;
state.date = null;
openDay(start).then(() => { if (start === todayISO()) [...document.querySelectorAll("#notes textarea")].at(-1)?.focus(); });
loadEntries();
