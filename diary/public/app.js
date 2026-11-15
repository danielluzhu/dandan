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

/* The to-do list runs on port 1242, which the proxy exposes as <host>-1242.another.ac. */
function siteUrl(port) {
  const { hostname, protocol } = location;
  const m = hostname.match(/^(.*)-(\d+)\.(.+)$/);
  if (m) return `${protocol}//${m[1]}-${port}.${m[3]}`;
  return `${protocol}//${hostname}:${port}`;
}
const TODO_URL = siteUrl(1242);
for (const a of document.querySelectorAll(".js-todo")) a.href = TODO_URL;

/* ---------- dates ---------- */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => iso(new Date());
const parse = (s) => new Date(s + "T12:00:00");
const shift = (s, days) => { const d = parse(s); d.setDate(d.getDate() + days); return iso(d); };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  saved: { notes: "", summary: "" },     // what the server has
  extracted: { notes: "", summary: "" }, // what to-dos were last pulled from
  entries: [],
};
let saveTimer, extractTimer, saving = Promise.resolve();

const current = () => ({ notes: $("#notes").value, summary: $("#summary").value });
const same = (a, b) => a.notes === b.notes && a.summary === b.summary;

/* ---------- saving ----------
   Text saves quietly while you type. To-dos are pulled out once a line is finished —
   on Enter, when you leave the box, or when you leave the day — so a half-typed
   “need to cl…” never lands on the to-do list. */
function save({ extract = false, keepalive = false } = {}) {
  const date = state.date;
  const body = current();
  if (same(body, state.saved) && (!extract || same(body, state.extracted))) return saving;
  clearTimeout(saveTimer);
  if (extract) clearTimeout(extractTimer);
  setSaved("Saving…");
  saving = saving.then(async () => {
    try {
      const res = await api("PUT", `entries/${date}`, { ...body, extract, link: `${location.origin}/#${date}` }, { keepalive });
      if (date !== state.date) return;
      state.saved = body;
      if (extract) state.extracted = body;
      setSaved("Saved");
      if (res.created.length) {
        const where = res.created.map((c) => c.project || "Inbox");
        toast(`Added ${res.created.length} to-do${res.created.length === 1 ? "" : "s"} → ${[...new Set(where)].join(", ")}`);
      }
      if (res.errors.length) toast(`Couldn't add some to-dos: ${res.errors[0]}`);
      if (extract) loadFound();
      loadEntries();
    } catch (err) {
      setSaved("Not saved — retrying");
      toast(err.message);
      saveTimer = setTimeout(() => save({ extract }), 4000);
    }
  });
  return saving;
}

function setSaved(text) { $("#saved").textContent = text; }

for (const id of ["#notes", "#summary"]) {
  const el = $(id);
  el.addEventListener("input", () => {
    grow(el);
    setSaved("Editing…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 700);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(extractTimer); extractTimer = setTimeout(() => save({ extract: true }), 300); }
  });
  el.addEventListener("blur", () => save({ extract: true }));
}
document.addEventListener("visibilitychange", () => { if (document.hidden) save({ extract: true, keepalive: true }); });

function grow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
}

/* ---------- loading a day ---------- */
async function openDay(date) {
  if (state.date && state.date !== date) await save({ extract: true });
  state.date = date;
  history.replaceState(null, "", date === todayISO() ? location.pathname : "#" + date);
  const d = parse(date);
  $("#day-name").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const days = Math.round((parse(todayISO()) - d) / 86400000);
  $("#day-sub").textContent = (days === 0 ? "Today" : days === 1 ? "Yesterday" : days === -1 ? "Tomorrow"
    : days > 0 ? `${days} days ago` : `In ${-days} days`) + " · " + d.getFullYear();
  $("#pick").value = date;
  document.title = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · Diary`;
  $("#sidebar").classList.remove("show");
  setSaved("");
  try {
    const entry = await api("GET", `entries/${date}`);
    if (state.date !== date) return;
    $("#notes").value = entry.notes;
    $("#summary").value = entry.summary;
    state.saved = state.extracted = { notes: entry.notes, summary: entry.summary };
    if (entry.updated_at) setSaved("Saved " + new Date(entry.updated_at.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  } catch (err) { toast(err.message); }
  grow($("#notes")); grow($("#summary"));
  renderEntries();
  loadFound();
  loadDue();
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
    }, h("span", { class: "d" }, d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })),
      h("span", { class: "s" }, e.snippet.replace(/\s+/g, " "))));
  }
  $("#entries").replaceChildren(...(nodes.length ? nodes : [h("div", { class: "side-empty" }, "Nothing written yet.")]));
  $("#go-today").classList.toggle("active", state.date === todayISO());
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
          " or “need to …” and it's added to your to-do list, sorted into the right project. Tick ",
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
document.addEventListener("keydown", (e) => {
  if (!e.altKey) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); openDay(shift(state.date, -1)); }
  if (e.key === "ArrowRight") { e.preventDefault(); openDay(shift(state.date, 1)); }
});
window.addEventListener("hashchange", () => {
  const d = location.hash.slice(1) || todayISO();
  if (DATE_RE.test(d) && d !== state.date) openDay(d);
});
window.addEventListener("resize", () => { grow($("#notes")); grow($("#summary")); });

const start = state.date;
state.date = null;
openDay(start).then(() => { if (start === todayISO()) $("#notes").focus(); });
loadEntries();
