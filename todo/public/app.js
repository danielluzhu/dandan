"use strict";

const LABELS = [
  { v: null, text: "Unlabeled", icon: "" },
  { v: "urgent", text: "Urgent", icon: "⚡" },
  { v: "north_star", text: "North Star", icon: "★" },
];
const COLORS = ["#6c5ad8", "#3b82f6", "#0ea5a4", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#64748b"];

const state = {
  projects: [],
  sections: [],         // project subsections
  todos: [],
  view: "all",          // all | inbox | urgent | north_star | p<id>
  openId: null,         // todo whose editor is expanded
  showDone: false,
  query: "",
  newLabel: null,
  addingSection: false, // the "+ Add subsection" input is showing
  renamingSection: null,
  confirmSection: null, // subsection whose delete is awaiting confirmation
  quickAdd: null,       // "s<id>" (subsection) or "n<id>" (North Star) with an inline add-task box open
  nsCollapsed: new Set(readCollapsed()),  // North Stars whose tasks are folded away
};

function readCollapsed() {
  try { return JSON.parse(localStorage.getItem("todo.nsCollapsed") || "[]"); } catch { return []; }
}
function saveCollapsed() {
  try { localStorage.setItem("todo.nsCollapsed", JSON.stringify([...state.nsCollapsed])); } catch {}
}

/* ---------- helpers ---------- */
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

async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, action) {
  const t = $("#toast");
  t.replaceChildren(h("span", {}, msg));
  if (action) t.append(h("button", { onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 6000 : 2800);
}

const fail = (err) => toast(err.message || "Something went wrong");

const projectById = (id) => state.projects.find((p) => p.id === id);
const sectionById = (id) => state.sections.find((s) => s.id === id);
const sectionsOf = (projectId) => state.sections.filter((s) => s.project_id === projectId);
const currentProject = () => (state.view.startsWith("p") ? projectById(Number(state.view.slice(1))) : null);
const todoById = (id) => state.todos.find((t) => t.id === id);
const childrenOf = (id) => state.todos.filter((t) => t.parent_id === id);
const isStar = (t) => t && t.label === "north_star" && t.parent_id == null;
// The North Star whose own page is showing (view "n<id>").
const currentStar = () => {
  if (!state.view.startsWith("n") || state.view === "north_star") return null;
  const t = todoById(Number(state.view.slice(1)));
  return isStar(t) ? t : null;
};
const VIEW_RE = /^(all|inbox|urgent|north_star|p\d+|n\d+)$/;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dueInfo(due) {
  if (!due) return null;
  const today = todayISO();
  const days = Math.round((new Date(due + "T00:00") - new Date(today + "T00:00")) / 86400000);
  let text;
  if (days === 0) text = "Today";
  else if (days === 1) text = "Tomorrow";
  else if (days === -1) text = "Yesterday";
  else {
    const d = new Date(due + "T00:00");
    text = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  return { text, cls: days < 0 ? "overdue" : days === 0 ? "today" : "" };
}

function byOpenOrder(a, b) {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1;
  return b.id - a.id;
}

/* ---------- data ---------- */
async function load() {
  const data = await api("GET", "state");
  state.projects = data.projects;
  state.sections = data.sections;
  state.todos = data.todos;
  if (state.view.startsWith("p") && !currentProject()) state.view = "all";
  if (/^n\d/.test(state.view) && !currentStar()) state.view = "all";
  render();
}

function viewTodos() {
  const v = state.view;
  const q = state.query.trim().toLowerCase();
  const star = currentStar();
  let list = state.todos;
  // Tasks inside a North Star render nested under it — except in the flat Urgent view, a
  // North Star's own page, and while filtering.
  if (star) list = list.filter((t) => t.parent_id === star.id);
  else if (v !== "urgent" && !q) list = list.filter((t) => t.parent_id == null);
  if (star) {}
  else if (v === "inbox") list = list.filter((t) => t.project_id == null);
  else if (v === "urgent" || v === "north_star") list = list.filter((t) => t.label === v);
  else if (v.startsWith("p")) list = list.filter((t) => t.project_id === Number(v.slice(1)));
  if (q) list = list.filter((t) => (t.title + " " + t.notes).toLowerCase().includes(q));
  return list;
}

/* ---------- rendering ---------- */
function render() {
  renderSidebar();
  renderHeader();
  renderComposer();
  renderList();
  location.hash = state.view === "all" ? "" : state.view;
}

function navItem(view, icon, name, count) {
  return h("button", {
    class: "nav-item" + (state.view === view ? " active" : ""),
    onclick: () => go(view),
  }, icon, h("span", { class: "name" }, name), h("span", { class: "count" }, count || ""));
}

function starNavs(projectId) {
  return state.todos
    .filter((t) => isStar(t) && !t.done && t.project_id === projectId)
    .sort((a, b) => a.id - b.id)
    .map((t) => {
      const el = navItem("n" + t.id, h("span", { class: "nav-icon", style: "color:var(--star)" }, "★"), t.title,
        childrenOf(t.id).filter((c) => !c.done).length);
      el.classList.add("nav-sub");
      el.dataset.drop = "into";
      el.dataset.parent = t.id;
      return el;
    });
}

function renderSidebar() {
  const open = state.todos.filter((t) => !t.done);
  const starNav = navItem("north_star", h("span", { class: "nav-icon", style: "color:var(--star)" }, "★"), "North Star", open.filter((t) => t.label === "north_star").length);
  const urgentNav = navItem("urgent", h("span", { class: "nav-icon", style: "color:var(--urgent)" }, "⚡"), "Urgent", open.filter((t) => t.label === "urgent").length);
  starNav.dataset.drop = "north_star";
  urgentNav.dataset.drop = "urgent";
  $("#views").replaceChildren(
    navItem("all", h("span", { class: "nav-icon" }, "☰"), "All tasks", open.length),
    navItem("inbox", h("span", { class: "nav-icon" }, "📥"), "Inbox", open.filter((t) => t.project_id == null).length),
    ...starNavs(null),
    starNav,
    urgentNav,
  );
  const projects = state.projects.flatMap((p) => [
    navItem("p" + p.id, h("span", { class: "dot", style: `background:${p.color}` }), p.name, p.open_count),
    ...starNavs(p.id),
  ]);
  $("#projects").replaceChildren(...(projects.length ? projects : [h("div", { class: "side-empty" }, "No projects yet — add one with +")]));
}

function progressEl(kids) {
  const done = kids.filter((k) => k.done).length;
  const pct = kids.length ? Math.round((done / kids.length) * 100) : 0;
  return h("span", { class: "progress", title: `${done} of ${kids.length} done` },
    h("span", { class: "bar" }, h("span", { style: `width:${pct}%` })), `${done}/${kids.length}`);
}

function renderStarHeader(t) {
  const p = t.project_id != null ? projectById(t.project_id) : null;
  const sec = t.section_id != null ? sectionById(t.section_id) : null;
  $("#view-title").replaceChildren(h("span", { class: "star-glyph" }, "★"), t.title);
  const crumb = h("span", { class: "crumb" }, "North Star in ",
    h("a", { href: "#" + (p ? "p" + p.id : "inbox") }, p ? p.name : "Inbox"), sec && ` › ${sec.name}`);
  const kids = childrenOf(t.id);
  $("#view-desc").replaceChildren(crumb, kids.length ? h("span", {}, " · ", progressEl(kids)) : "", t.notes ? h("span", { class: "star-notes" }, t.notes) : "");
  $("#head-actions").replaceChildren(
    h("button", { class: "btn small", onclick: () => { state.openId = t.id; state.focusEditor = true; renderList(); } }, "Edit"),
    h("button", { class: "btn small", onclick: () => toggleDone(t) }, t.done ? "Reopen" : "Complete"));
  document.title = `★ ${t.title} · Todo`;
}

function renderHeader() {
  const star = currentStar();
  if (star) return renderStarHeader(star);
  const p = currentProject();
  const titles = { all: "All tasks", inbox: "Inbox", urgent: "Urgent", north_star: "North Star" };
  const title = $("#view-title");
  if (p) title.replaceChildren(h("span", { class: "dot", style: `background:${p.color}` }), p.name);
  else title.replaceChildren(titles[state.view]);
  const descs = {
    inbox: "Tasks that don't belong to a project yet.",
    urgent: "Everything marked urgent, across every project.",
    north_star: "The tasks that matter most — the ones that move the needle.",
  };
  $("#view-desc").textContent = p ? p.description : descs[state.view] || "";
  $("#head-actions").replaceChildren(
    ...(p ? [
      h("button", { class: "btn small", onclick: startAddSection }, "+ Subsection"),
      h("button", { class: "btn small", onclick: () => openProjectDialog(p) }, "Edit project"),
    ] : []),
  );
  document.title = `${p ? p.name : titles[state.view]} · Todo`;
}

function renderComposer() {
  // Label picker: prefilled from Urgent / North Star views.
  if (state.view === "urgent" || state.view === "north_star") state.newLabel = state.view;
  const star = currentStar();
  // Inside a North Star, tasks can be Urgent or unlabeled but not North Stars themselves.
  if (star && state.newLabel === "north_star") state.newLabel = null;
  $("#new-label").replaceChildren(...LABELS.filter((l) => !star || l.v !== "north_star").map((l) =>
    h("button", {
      type: "button", role: "radio", "data-v": l.v ?? "",
      "aria-checked": String(state.newLabel === l.v),
      onclick: () => { state.newLabel = l.v; renderComposer(); },
    }, l.icon && h("span", {}, l.icon), l.text)));

  const sel = $("#new-project-select");
  const p = currentProject();
  const prev = sel.value;
  sel.replaceChildren(
    h("option", { value: "" }, "No project (Inbox)"),
    ...state.projects.map((pr) => h("option", { value: pr.id }, pr.name)),
  );
  sel.value = p ? String(p.id) : state.view === "inbox" ? "" : prev && projectById(Number(prev)) ? prev : "";
  sel.hidden = !!p || !!star;

  const secSel = $("#new-section-select");
  const secs = p ? sectionsOf(p.id) : [];
  const prevSec = secSel.value;
  secSel.replaceChildren(h("option", { value: "" }, "No subsection"), ...secs.map((s) => h("option", { value: s.id }, s.name)));
  secSel.value = secs.some((s) => String(s.id) === prevSec) ? prevSec : "";
  secSel.hidden = !secs.length;
  $("#new-title").placeholder = star ? `Add a task to ★ ${star.title}…  (press N)` : "Add a task…  (press N)";
}

function section(key, title, todos, opts = {}) {
  const collapsed = opts.collapsible && !state.showDone;
  const head = h("div", { class: `section-head ${key}` + (collapsed ? " collapsed" : "") },
    opts.collapsible
      ? h("button", { onclick: () => { state.showDone = !state.showDone; renderList(); } },
          h("span", { class: "chev" }, "▾"), title, h("span", { class: "n" }, todos.length))
      : [title, h("span", { class: "n" }, todos.length)]);
  const body = collapsed ? [] : todos.length ? todos.map(itemEl) : [h("div", { class: "section-hint" }, opts.hint || "Nothing here.")];
  return h("div", { class: "section", "data-drop": opts.drop }, head, ...body);
}

function renderList() {
  const list = $("#list");
  const todos = viewTodos();
  const open = todos.filter((t) => !t.done).sort(byOpenOrder);
  const done = todos.filter((t) => t.done).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  const star = currentStar();
  if (star) return renderStarList(list, star, open, done);

  if (!todos.length) {
    const p = currentProject();
    list.replaceChildren(h("div", { class: "empty" },
      h("div", { class: "big" }, state.query ? "🔍" : "✨"),
      state.query ? "No tasks match that filter."
        : p ? "This project has no tasks yet. Add the first one above."
        : "Nothing to do. Add a task above, or create a project in the sidebar."));
    if (!state.query && p && !sectionsOf(p.id).length) list.append(addSectionEl());
    if (!state.query && p && sectionsOf(p.id).length) { list.replaceChildren(...sectionsOf(p.id).map((s) => blockEl(s, [])), addSectionEl()); }
    list.querySelector("[data-autofocus]")?.focus();
    return;
  }

  const parts = [];
  const p = currentProject();
  const secs = p ? sectionsOf(p.id) : [];
  if (secs.length) {
    const loose = open.filter((t) => t.section_id == null);
    if (loose.length) parts.push(blockEl(null, loose));
    for (const s of secs) {
      const mine = open.filter((t) => t.section_id === s.id);
      if (!state.query || mine.length) parts.push(blockEl(s, mine));
    }
  } else if (state.view === "urgent" || state.view === "north_star") {
    parts.push(section("", "To do", open, { hint: "All clear." }));
  } else {
    const star = open.filter((t) => t.label === "north_star");
    const urgent = open.filter((t) => t.label === "urgent");
    const rest = open.filter((t) => !t.label);
    parts.push(section("north_star", "★ North Star", star, { drop: "north_star", hint: "No north star yet — drag a task here, or label one above." }));
    parts.push(section("urgent", "⚡ Urgent", urgent, { drop: "urgent", hint: "Nothing urgent. Nice." }));
    parts.push(section("", "Unlabeled", rest, { drop: "none", hint: "Nothing else on the list." }));
  }
  if (p) parts.push(addSectionEl());
  if (done.length) parts.push(section("", "Completed", done, { collapsible: true }));
  list.replaceChildren(...parts);
  list.querySelector("[data-autofocus]")?.focus();

  const focusEl = list.querySelector(".todo.open .e-title");
  if (focusEl && state.focusEditor) { focusEl.focus(); state.focusEditor = false; }
}

/* A North Star's own page: the North Star itself as a card, then its tasks by label. */
function renderStarList(list, star, open, done) {
  const lane = (key, title, items, hint) => {
    const el = section(key, title, items, { drop: key, hint });
    el.dataset.parent = star.id;
    return el;
  };
  const parts = [
    h("div", { class: "star-self" }, todoEl(star, { self: true })),
    lane("urgent", "⚡ Urgent", open.filter((t) => t.label === "urgent"), "Nothing urgent here."),
    lane("none", "Tasks", open.filter((t) => !t.label), open.length ? "Nothing else." : "No tasks yet — add one above, or drag tasks onto this North Star."),
  ];
  if (done.length) parts.push(section("", "Completed", done, { collapsible: true }));
  list.replaceChildren(...parts);
  const focusEl = list.querySelector(".todo.open .e-title");
  if (focusEl && state.focusEditor) { focusEl.focus(); state.focusEditor = false; }
}

/* A North Star in a list: its row, then the tasks inside it, nested. */
function itemEl(t) {
  if (!isStar(t) || state.query) return todoEl(t);
  const kids = childrenOf(t.id);
  const collapsed = state.nsCollapsed.has(t.id);
  const adding = state.quickAdd === "n" + t.id;
  const inner = [];
  if (!collapsed && (kids.length || adding)) {
    const openKids = kids.filter((k) => !k.done).sort(byOpenOrder);
    const doneKids = kids.filter((k) => k.done);
    inner.push(h("div", { class: "ns-children" },
      openKids.map((k) => todoEl(k)), doneKids.map((k) => todoEl(k)),
      quickAddEl("n" + t.id, `★ ${t.title}`, { parent_id: t.id })));
  }
  return h("div", { class: "ns", "data-drop": "into", "data-parent": t.id }, todoEl(t, { kids }), ...inner);
}

function toggleStar(id) {
  if (state.nsCollapsed.has(id)) state.nsCollapsed.delete(id); else state.nsCollapsed.add(id);
  saveCollapsed();
  renderList();
}

/* A project subsection (or the tasks in no subsection, when s is null): a header with
   rename/reorder/delete, then the task's label groups. Every part is a drop target —
   the block itself keeps the label, each label group and header pill sets it. */
const LANES = [
  { key: "north_star", v: "north_star", title: "★ North Star" },
  { key: "urgent", v: "urgent", title: "⚡ Urgent" },
  { key: "none", v: null, title: "Unlabeled" },
];

function blockEl(s, todos) {
  const sid = s ? String(s.id) : "none";
  const collapsed = s && s.collapsed && !state.query;
  const name = s ? s.name : "No subsection";

  let headMain;
  if (s && state.renamingSection === s.id) {
    headMain = h("input", {
      class: "block-rename", value: s.name, maxlength: 200, "aria-label": "Subsection name", "data-autofocus": true,
      onkeydown: (e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") { state.renamingSection = null; renderList(); }
      },
      onblur: (e) => {
        if (state.renamingSection !== s.id) return;
        state.renamingSection = null;
        const v = e.target.value.trim();
        if (v && v !== s.name) patchSection(s.id, { name: v }); else renderList();
      },
    });
  } else {
    headMain = h("button", {
      class: "block-toggle", disabled: !s, title: s ? (collapsed ? "Expand" : "Collapse") : null,
      onclick: () => patchSection(s.id, { collapsed: !s.collapsed }),
    }, s && h("span", { class: "chev" }, "▾"), h("span", { class: "block-name" }, name), h("span", { class: "n" }, todos.length));
  }

  const pills = h("span", { class: "drop-pills" },
    LANES.map((l) => h("span", { class: `drop-pill ${l.key}`, "data-drop": l.key, "data-section": sid }, l.title)));

  const tools = s && h("span", { class: "block-tools" },
    h("button", { class: "icon-btn sm", title: "Rename", "aria-label": "Rename subsection", onclick: () => { state.renamingSection = s.id; renderList(); } }, "✎"),
    h("button", { class: "icon-btn sm", title: "Move up", "aria-label": "Move subsection up", onclick: () => patchSection(s.id, { move: -1 }) }, "↑"),
    h("button", { class: "icon-btn sm", title: "Move down", "aria-label": "Move subsection down", onclick: () => patchSection(s.id, { move: 1 }) }, "↓"),
    h("button", { class: "icon-btn sm", title: "Delete subsection", "aria-label": "Delete subsection", onclick: () => { state.confirmSection = s.id; renderList(); } }, "🗑"));

  const head = h("div", { class: "block-head" + (collapsed ? " collapsed" : "") }, headMain, pills, h("span", { class: "spacer" }), tools);

  const confirm = s && state.confirmSection === s.id && h("div", { class: "block-confirm" },
    h("span", {}, todos.length
      ? `Delete “${s.name}”? Its ${todos.length} open task${todos.length === 1 ? "" : "s"} move to No subsection.`
      : `Delete “${s.name}”?`),
    h("button", { class: "btn danger solid small", onclick: () => deleteSection(s) }, "Delete"),
    h("button", { class: "btn small", onclick: () => { state.confirmSection = null; renderList(); } }, "Cancel"));

  const lanes = [];
  if (!collapsed) {
    for (const l of LANES) {
      const items = todos.filter((t) => (t.label || null) === l.v);
      if (!items.length) continue;
      lanes.push(h("div", { class: "lane", "data-drop": l.key, "data-section": sid },
        h("div", { class: `lane-head ${l.key}` }, l.title), items.map(itemEl)));
    }
    if (!todos.length) lanes.push(h("div", { class: "section-hint" }, "Empty — drag tasks here, or add one."));
    if (s) lanes.push(quickAddEl("s" + s.id, s.name, { project_id: s.project_id, section_id: s.id }));
  }

  return h("div", { class: "block", "data-drop": "keep", "data-section": sid }, head, confirm, ...lanes);
}

function quickAddEl(key, name, fields) {
  if (state.quickAdd !== key) {
    return h("button", { class: "quick-add-btn", onclick: () => { state.quickAdd = key; renderList(); } }, "+ Add task");
  }
  return h("form", {
    class: "quick-add",
    onsubmit: async (e) => {
      e.preventDefault();
      const input = e.target.querySelector("input");
      const title = input.value.trim();
      if (!title) return;
      try {
        state.todos.unshift(await api("POST", "todos", { title, ...fields }));
        await refreshProjects();
        render();
      } catch (err) { fail(err); }
    },
  }, h("input", {
    placeholder: `Add to ${name}…  (Enter to add, Esc to close)`, maxlength: 500, "data-autofocus": true, "aria-label": `Add task to ${name}`,
    onkeydown: (e) => { if (e.key === "Escape") { state.quickAdd = null; renderList(); } },
    onblur: (e) => { if (!e.target.value.trim()) setTimeout(() => { if (state.quickAdd === key) { state.quickAdd = null; renderList(); } }, 150); },
  }));
}

function addSectionEl() {
  if (!state.addingSection) {
    return h("button", { class: "add-section-btn", onclick: startAddSection }, "+ Add subsection");
  }
  const p = currentProject();
  return h("form", {
    class: "add-section",
    onsubmit: async (e) => {
      e.preventDefault();
      const name = e.target.querySelector("input").value.trim();
      if (!name) return;
      try {
        state.sections.push(await api("POST", "sections", { project_id: p.id, name }));
        render();  // stays open so several can be added in a row
      } catch (err) { fail(err); }
    },
  },
    h("input", {
      placeholder: "Subsection name, e.g. Design", maxlength: 200, "data-autofocus": true, "aria-label": "New subsection name",
      onkeydown: (e) => { if (e.key === "Escape") { state.addingSection = false; renderList(); } },
    }),
    h("button", { class: "btn primary small" }, "Add"),
    h("button", { type: "button", class: "btn small", onclick: () => { state.addingSection = false; renderList(); } }, "Done"));
}

const checkSvg = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 12 12");
  s.innerHTML = '<path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

function todoEl(t, opts = {}) {
  const isOpen = state.openId === t.id;
  const parent = t.parent_id != null ? todoById(t.parent_id) : null;
  // Show which North Star a task sits in wherever it isn't already drawn nested under it.
  const showParent = parent && (state.view === "urgent" || state.query) && !currentStar();
  const kids = opts.kids;
  const starMeta = kids && [
    kids.length
      ? h("button", { class: "meta-btn", title: state.nsCollapsed.has(t.id) ? "Show tasks" : "Hide tasks", onclick: () => toggleStar(t.id) },
          h("span", { class: "chev-s" + (state.nsCollapsed.has(t.id) ? " folded" : "") }, "▾"), progressEl(kids))
      : !t.done && h("button", { class: "meta-btn", onclick: () => { state.nsCollapsed.delete(t.id); saveCollapsed(); state.quickAdd = "n" + t.id; renderList(); } }, "+ Add tasks"),
    h("button", { class: "meta-btn open-link", onclick: () => go("n" + t.id) }, "Open ›"),
  ];
  const p = t.project_id != null ? projectById(t.project_id) : null;
  const due = dueInfo(t.due_date);
  const showProject = p && !state.view.startsWith("p") && !currentStar();
  const labelInfo = LABELS.find((l) => l.v === t.label);
  const showLabelPill = t.label && (state.view !== t.label) && (t.done || ["urgent", "north_star"].includes(state.view));

  const meta = h("div", { class: "meta" },
    starMeta,
    showParent && h("span", { class: "chip star-chip" }, "★ ", parent.title),
    showLabelPill && h("span", { class: `pill ${t.label}` }, labelInfo.icon, labelInfo.text),
    showProject && h("span", { class: "chip" }, h("span", { class: "dot", style: `background:${p.color}` }), p.name,
      t.section_id != null && sectionById(t.section_id) && ` › ${sectionById(t.section_id).name}`),
    due && !t.done && h("span", { class: `due ${due.cls}` }, "📅 " + due.text),
    t.notes && !isOpen && h("span", { title: t.notes }, "📝 Notes"),
  );

  const row = h("div", {
    class: "todo-row",
    onclick: (e) => { if (!e.target.closest(".check, .grip, .meta-btn") && !dragJustEnded()) toggleOpen(t.id); },
    onpointerdown: (e) => pressTodo(e, t),
  },
    !isOpen && !opts.self && h("span", { class: "grip", title: "Drag to relabel, or onto a North Star to put it inside", "aria-hidden": "true" }, "⠿"),
    h("button", {
      class: "check", title: t.done ? "Mark as not done" : "Complete",
      "aria-label": t.done ? "Mark as not done" : "Complete",
      onclick: () => toggleDone(t),
    }, checkSvg()),
    h("div", { class: "todo-main" }, h("div", { class: "todo-title" }, t.title), meta),
  );

  return h("div", { class: `todo ${t.label || ""}` + (t.done ? " done" : "") + (isOpen ? " open" : "") + (t.parent_id != null ? " child" : ""), "data-id": t.id },
    row, isOpen && editorEl(t));
}

function editorEl(t) {
  const save = (fields) => patchTodo(t.id, fields);

  const title = h("input", {
    class: "e-title", value: t.title, maxlength: 500, "aria-label": "Title",
    onkeydown: (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.target.blur(); closeEditor(); }
      if (e.key === "Escape") { e.target.value = t.title; closeEditor(); }
    },
    onchange: (e) => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = t.title; return toast("A task needs a title"); }
      if (v !== t.title) save({ title: v });
    },
  });
  const notes = h("textarea", {
    placeholder: "Notes", "aria-label": "Notes",
    onchange: (e) => { if (e.target.value !== t.notes) save({ notes: e.target.value }); },
    onkeydown: (e) => { if (e.key === "Escape") closeEditor(); },
  });
  notes.value = t.notes;

  const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Label" },
    LABELS.filter((l) => t.parent_id == null || l.v !== "north_star").map((l) => h("button", {
      type: "button", role: "radio", "data-v": l.v ?? "", "aria-checked": String((t.label || null) === l.v),
      onclick: () => save({ label: l.v }),
    }, l.icon && h("span", {}, l.icon), l.text)));

  const proj = h("select", { "aria-label": "Project", onchange: (e) => save({ project_id: e.target.value || null }) },
    h("option", { value: "" }, "No project (Inbox)"),
    state.projects.map((p) => h("option", { value: p.id }, p.name)));
  proj.value = t.project_id == null ? "" : String(t.project_id);

  const tSecs = t.project_id != null ? sectionsOf(t.project_id) : [];
  const sec = tSecs.length && h("select", { "aria-label": "Subsection", onchange: (e) => save({ section_id: e.target.value || null }) },
    h("option", { value: "" }, "No subsection"),
    tSecs.map((s) => h("option", { value: s.id }, s.name)));
  if (sec) sec.value = t.section_id == null ? "" : String(t.section_id);

  // Which North Star this task sits inside (North Stars themselves can't be nested).
  const stars = state.todos.filter((x) => isStar(x) && x.id !== t.id && (!x.done || x.id === t.parent_id));
  const inside = !isStar(t) && stars.length && h("select", { "aria-label": "Inside North Star", onchange: (e) => save({ parent_id: e.target.value || null }) },
    h("option", { value: "" }, "Not inside a North Star"),
    stars.map((x) => h("option", { value: x.id }, `★ ${x.title}` + (x.project_id != null ? ` (${projectById(x.project_id)?.name})` : ""))));
  if (inside) inside.value = t.parent_id == null ? "" : String(t.parent_id);

  const due = h("input", { type: "date", "aria-label": "Due date", value: t.due_date || "", onchange: (e) => save({ due_date: e.target.value || null }) });
  const clearDue = t.due_date && h("button", { class: "btn ghost small", type: "button", onclick: () => save({ due_date: null }) }, "Clear date");

  const created = new Date(t.created_at.replace(" ", "T") + "Z");
  const stamp = t.done && t.completed_at
    ? `Completed ${new Date(t.completed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : `Created ${created.toLocaleDateString(undefined, { dateStyle: "medium" })}`;

  return h("div", { class: "editor", onclick: (e) => e.stopPropagation() },
    title, notes,
    h("div", { class: "editor-opts" }, seg, proj, sec, inside, due, clearDue),
    h("div", { class: "editor-actions" },
      h("span", { class: "stamp" }, stamp),
      h("span", { class: "spacer" }),
      h("button", { class: "btn danger ghost small", type: "button", onclick: () => deleteTodo(t) }, "Delete"),
      h("button", { class: "btn small", type: "button", onclick: () => toggleDone(t) }, t.done ? "Mark not done" : "Complete"),
      h("button", { class: "btn primary small", type: "button", onclick: closeEditor }, "Done")));
}

/* ---------- actions ---------- */
function go(view) {
  state.view = view;
  state.openId = null;
  state.addingSection = false;
  state.quickAdd = state.renamingSection = state.confirmSection = null;
  if (view !== "urgent" && view !== "north_star" && ["urgent", "north_star"].includes(state.newLabel)) state.newLabel = null;
  window.scrollTo(0, 0);
  $("#sidebar").classList.remove("show");
  render();
}

function toggleOpen(id) {
  // Commit any pending edit in the editor we're leaving before re-rendering.
  document.activeElement?.blur?.();
  state.openId = state.openId === id ? null : id;
  state.focusEditor = state.openId != null;
  renderList();
}

function closeEditor() {
  document.activeElement?.blur?.();
  state.openId = null;
  renderList();
}

function replaceTodo(updated) {
  state.todos = state.todos.map((t) => (t.id === updated.id ? updated : t));
}

async function refreshProjects() {
  state.projects = await api("GET", "projects");
}

async function patchTodo(id, fields) {
  try {
    replaceTodo(await api("PATCH", `todos/${id}`, fields));
    if ("project_id" in fields || "done" in fields || "parent_id" in fields) {
      // Children may have moved with their North Star; take the server's word for everything.
      const data = await api("GET", "state");
      Object.assign(state, { projects: data.projects, sections: data.sections, todos: data.todos });
    }
    render();
  } catch (err) {
    fail(err);
    load().catch(() => {});  // undo any optimistic change the server refused
  }
}

function startAddSection() {
  state.addingSection = true;
  renderList();
}

async function patchSection(id, fields) {
  try {
    const updated = await api("PATCH", `sections/${id}`, fields);
    // A move renumbers its neighbours too, so refetch rather than patch locally.
    if ("move" in fields) state.sections = await api("GET", "sections");
    else state.sections = state.sections.map((s) => (s.id === id ? updated : s));
    render();
  } catch (err) { fail(err); }
}

async function deleteSection(s) {
  try {
    await api("DELETE", `sections/${s.id}`);
    state.confirmSection = null;
    await load();
    toast(`Deleted subsection “${s.name}”`);
  } catch (err) { fail(err); }
}

async function toggleDone(t) {
  const done = !t.done;
  // Optimistic: flip it locally first so the click feels instant.
  replaceTodo({ ...t, done: done ? 1 : 0, completed_at: done ? new Date().toISOString() : null });
  renderList();
  await patchTodo(t.id, { done });
  if (done) toast("Completed", { label: "Undo", run: () => patchTodo(t.id, { done: false }) });
}

async function deleteTodo(t) {
  const kids = childrenOf(t.id);
  try {
    await api("DELETE", `todos/${t.id}`);
    state.todos = state.todos.filter((x) => x.id !== t.id && x.parent_id !== t.id);
    if (state.view === "n" + t.id) state.view = t.project_id != null && projectById(t.project_id) ? "p" + t.project_id : "all";
    state.openId = null;
    await refreshProjects();
    render();
    const short = t.title.length > 40 ? t.title.slice(0, 40) + "…" : t.title;
    toast(kids.length ? `Deleted “${short}” and ${kids.length} task${kids.length === 1 ? "" : "s"} inside` : `Deleted “${short}”`, {
      label: "Undo",
      run: async () => {
        try {
          const restored = await api("POST", "todos", {
            title: t.title, notes: t.notes, label: t.label, due_date: t.due_date,
            project_id: projectById(t.project_id) ? t.project_id : null,
            section_id: projectById(t.project_id) && sectionById(t.section_id) ? t.section_id : null,
            parent_id: isStar(todoById(t.parent_id)) ? t.parent_id : null,
          });
          if (t.done) await api("PATCH", `todos/${restored.id}`, { done: true });
          for (const k of kids) {
            const kid = await api("POST", "todos", { title: k.title, notes: k.notes, label: k.label, due_date: k.due_date, parent_id: restored.id });
            if (k.done) await api("PATCH", `todos/${kid.id}`, { done: true });
          }
          await load();
        } catch (err) { fail(err); }
      },
    });
  } catch (err) { fail(err); }
}

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#new-title");
  const title = input.value.trim();
  if (!title) return input.focus();
  const p = currentProject();
  const star = currentStar();
  try {
    const todo = await api("POST", "todos", star ? { title, label: state.newLabel, parent_id: star.id, due_date: $("#new-due").value || null } : {
      title,
      label: state.newLabel,
      project_id: p ? p.id : $("#new-project-select").value || null,
      section_id: p ? $("#new-section-select").value || null : null,
      due_date: $("#new-due").value || null,
    });
    state.todos.unshift(todo);
    await refreshProjects();
    input.value = "";
    $("#new-due").value = "";
    // A task added from Inbox into a project would vanish from view; say where it went.
    if (state.view === "inbox" && todo.project_id != null) toast(`Added to ${projectById(todo.project_id)?.name}`);
    render();
    input.focus();
  } catch (err) { fail(err); }
});

$("#search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });
$("#menu").addEventListener("click", () => $("#sidebar").classList.toggle("show"));
$("#new-project").addEventListener("click", () => openProjectDialog(null));

/* ---------- project dialog ---------- */
const dlg = $("#project-dialog");
let editing = null;      // project being edited, or null for new
let pickedColor = COLORS[0];
let deleteArmed = false;

function renderSwatches() {
  $("#pd-colors").replaceChildren(...COLORS.map((c) => h("button", {
    type: "button", class: "swatch", role: "radio", style: `background:${c}`,
    "aria-label": c, "aria-checked": String(c === pickedColor),
    onclick: () => { pickedColor = c; renderSwatches(); },
  })));
}

function openProjectDialog(p) {
  editing = p;
  deleteArmed = false;
  pickedColor = p ? p.color : COLORS[state.projects.length % COLORS.length];
  $("#pd-title").textContent = p ? "Edit project" : "New project";
  $("#pd-name").value = p ? p.name : "";
  $("#pd-desc").value = p ? p.description : "";
  $("#pd-save").textContent = p ? "Save" : "Create project";
  const del = $("#pd-delete");
  del.hidden = !p;
  del.textContent = "Delete project";
  del.classList.remove("solid");
  $("#pd-confirm").hidden = true;
  renderSwatches();
  dlg.showModal();
  $("#pd-name").focus();
}

$("#pd-cancel").addEventListener("click", () => dlg.close());

$("#project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { name: $("#pd-name").value, description: $("#pd-desc").value, color: pickedColor };
  try {
    const saved = editing
      ? await api("PATCH", `projects/${editing.id}`, body)
      : await api("POST", "projects", body);
    dlg.close();
    await refreshProjects();
    if (!editing) state.view = "p" + saved.id;
    render();
    if (!editing) $("#new-title").focus();
  } catch (err) { fail(err); }
});

$("#pd-delete").addEventListener("click", async () => {
  const p = editing;
  const n = state.todos.filter((t) => t.project_id === p.id).length;
  if (!deleteArmed) {
    deleteArmed = true;
    $("#pd-delete").textContent = "Yes, delete it";
    $("#pd-delete").classList.add("solid");
    $("#pd-confirm").textContent = n
      ? `This permanently deletes “${p.name}” and its ${n} task${n === 1 ? "" : "s"}. Click again to confirm.`
      : `This permanently deletes “${p.name}”. Click again to confirm.`;
    $("#pd-confirm").hidden = false;
    return;
  }
  try {
    await api("DELETE", `projects/${p.id}`);
    dlg.close();
    if (state.view === "p" + p.id) state.view = "all";
    await load();
    toast(`Deleted project “${p.name}”`);
  } catch (err) { fail(err); }
});

/* ---------- drag to relabel ----------
   Pointer events rather than native HTML5 drag-and-drop, so it also works on
   touch screens. A mouse drags from anywhere on the row; touch drags from the
   grip, so swiping the list still scrolls it. */
let drag = null;
let dragEndedAt = 0;
const dragJustEnded = () => Date.now() - dragEndedAt < 50;
const DROP_NAMES = { north_star: "North Star", urgent: "Urgent", none: "Unlabeled" };

function pressTodo(e, t) {
  if (e.button !== 0 || state.openId === t.id || e.target.closest(".check")) return;
  const viaGrip = !!e.target.closest(".grip");
  if (e.pointerType !== "mouse" && !viaGrip) return;
  drag = { t, row: e.currentTarget.parentElement, x0: e.clientX, y0: e.clientY, active: false, over: null };
  if (viaGrip) e.preventDefault();
}

function startDrag(e) {
  const rect = drag.row.getBoundingClientRect();
  // A compact ghost held near its left edge, so it doesn't hide the drop targets.
  drag.dx = Math.min(e.clientX - rect.left, 24);
  drag.dy = Math.min(e.clientY - rect.top, 20);
  drag.ghost = drag.row.cloneNode(true);
  drag.ghost.classList.add("drag-ghost");
  drag.ghost.style.width = Math.min(rect.width, 320) + "px";
  document.body.append(drag.ghost);
  drag.row.classList.add("dragging");
  document.body.classList.add("is-dragging");
  drag.active = true;
}

function endDrag() {
  if (!drag) return;
  if (drag.active) {
    drag.ghost.remove();
    drag.row.classList.remove("dragging");
    drag.over?.classList.remove("drop-over");
    document.body.classList.remove("is-dragging");
    dragEndedAt = Date.now();
  }
  drag = null;
}

document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    startDrag(e);
  }
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) rotate(1.5deg)`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]") || null;
  if (over !== drag.over) {
    drag.over?.classList.remove("drop-over");
    over?.classList.add("drop-over");
    drag.over = over;
  }
});

document.addEventListener("pointerup", () => {
  if (!drag) return;
  const { t, over, active } = drag;
  endDrag();
  if (!active || !over) return;
  // data-drop is a label, "keep" to leave the label, or "into" a North Star (data-parent).
  // data-section, when present, is a subsection.
  const fields = {};
  const where = [];
  const before = { label: t.label, section_id: t.section_id, parent_id: t.parent_id, done: !!t.done };
  if (over.dataset.drop === "into") {
    const pid = Number(over.dataset.parent);
    if (pid === t.id) return;
    if (isStar(t)) return toast("A North Star can't go inside another North Star");
    if (t.parent_id !== pid) fields.parent_id = pid;
    if (t.label === "north_star") fields.label = null;
    if (t.done) fields.done = false;
    if (!Object.keys(fields).length) return;
    replaceTodo({ ...t, ...fields, done: 0, completed_at: null });
    render();
    patchTodo(t.id, fields);
    return toast(`Moved into ★ ${todoById(pid)?.title}`, { label: "Undo", run: () => patchTodo(t.id, before) });
  }
  // Dropping a task from inside a North Star anywhere else takes it out, unless the target
  // is a lane on that North Star's own page.
  if ("parent" in over.dataset) {
    if (Number(over.dataset.parent) !== t.parent_id) fields.parent_id = Number(over.dataset.parent);
  } else if (t.parent_id != null) {
    fields.parent_id = null;
    where.push("out of ★ " + (todoById(t.parent_id)?.title || "North Star"));
  }
  if (over.dataset.drop !== "keep") {
    const label = over.dataset.drop === "none" ? null : over.dataset.drop;
    if (label !== (t.label || null)) fields.label = label;
    if (!("parent" in over.dataset) || fields.label !== undefined) where.push(DROP_NAMES[over.dataset.drop]);
  }
  if ("section" in over.dataset) {
    const sid = over.dataset.section === "none" ? null : Number(over.dataset.section);
    if (sid !== t.section_id) fields.section_id = sid;
    where.unshift(sid == null ? "No subsection" : sectionById(sid)?.name);
  }
  // Dropping a finished task into an active section brings it back.
  if (t.done) fields.done = false;
  if (!Object.keys(fields).length) return;
  replaceTodo({ ...t, ...fields, done: 0, completed_at: null });
  render();
  patchTodo(t.id, fields);
  toast(`Moved to ${where.join(" · ")}`, { label: "Undo", run: () => patchTodo(t.id, before) });
});

document.addEventListener("pointercancel", endDrag);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag) endDrag(); });

/* ---------- keyboard ---------- */
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest("input, textarea, select, dialog");
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n") { e.preventDefault(); $("#new-title").focus(); }
  else if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
  else if (e.key === "Escape" && state.openId != null) closeEditor();
});

/* ---------- boot ---------- */
const initial = location.hash.slice(1);
if (VIEW_RE.test(initial)) state.view = initial;
load().catch(fail);

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1) || "all";
  if (v !== state.view && VIEW_RE.test(v)) go(v);
});
