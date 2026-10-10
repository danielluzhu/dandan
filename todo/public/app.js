"use strict";

const LABELS = [
  { v: null, text: "Unlabeled", icon: "" },
  { v: "urgent", text: "Urgent", icon: "⚡" },
  { v: "north_star", text: "North Star", icon: "★" },
];
const COLORS = ["#6c5ad8", "#3b82f6", "#0ea5a4", "#16a34a", "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#64748b"];

const state = {
  projects: [],
  todos: [],
  view: "all",          // all | inbox | urgent | north_star | p<id>
  openId: null,         // todo whose editor is expanded
  showDone: false,
  query: "",
  newLabel: null,
};

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
const currentProject = () => (state.view.startsWith("p") ? projectById(Number(state.view.slice(1))) : null);

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
  state.todos = data.todos;
  if (state.view.startsWith("p") && !currentProject()) state.view = "all";
  render();
}

function viewTodos() {
  const v = state.view;
  let list = state.todos;
  if (v === "inbox") list = list.filter((t) => t.project_id == null);
  else if (v === "urgent" || v === "north_star") list = list.filter((t) => t.label === v);
  else if (v.startsWith("p")) list = list.filter((t) => t.project_id === Number(v.slice(1)));
  const q = state.query.trim().toLowerCase();
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

function renderSidebar() {
  const open = state.todos.filter((t) => !t.done);
  const starNav = navItem("north_star", h("span", { class: "nav-icon", style: "color:var(--star)" }, "★"), "North Star", open.filter((t) => t.label === "north_star").length);
  const urgentNav = navItem("urgent", h("span", { class: "nav-icon", style: "color:var(--urgent)" }, "⚡"), "Urgent", open.filter((t) => t.label === "urgent").length);
  starNav.dataset.drop = "north_star";
  urgentNav.dataset.drop = "urgent";
  $("#views").replaceChildren(
    navItem("all", h("span", { class: "nav-icon" }, "☰"), "All tasks", open.length),
    navItem("inbox", h("span", { class: "nav-icon" }, "📥"), "Inbox", open.filter((t) => t.project_id == null).length),
    starNav,
    urgentNav,
  );
  const projects = state.projects.map((p) =>
    navItem("p" + p.id, h("span", { class: "dot", style: `background:${p.color}` }), p.name, p.open_count));
  $("#projects").replaceChildren(...(projects.length ? projects : [h("div", { class: "side-empty" }, "No projects yet — add one with +")]));
}

function renderHeader() {
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
    ...(p ? [h("button", { class: "btn small", onclick: () => openProjectDialog(p) }, "Edit project")] : []),
  );
  document.title = `${p ? p.name : titles[state.view]} · Todo`;
}

function renderComposer() {
  // Label picker: prefilled from Urgent / North Star views.
  if (state.view === "urgent" || state.view === "north_star") state.newLabel = state.view;
  $("#new-label").replaceChildren(...LABELS.map((l) =>
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
  sel.hidden = !!p;
}

function section(key, title, todos, opts = {}) {
  const collapsed = opts.collapsible && !state.showDone;
  const head = h("div", { class: `section-head ${key}` + (collapsed ? " collapsed" : "") },
    opts.collapsible
      ? h("button", { onclick: () => { state.showDone = !state.showDone; renderList(); } },
          h("span", { class: "chev" }, "▾"), title, h("span", { class: "n" }, todos.length))
      : [title, h("span", { class: "n" }, todos.length)]);
  const body = collapsed ? [] : todos.length ? todos.map(todoEl) : [h("div", { class: "section-hint" }, opts.hint || "Nothing here.")];
  return h("div", { class: "section", "data-drop": opts.drop }, head, ...body);
}

function renderList() {
  const list = $("#list");
  const todos = viewTodos();
  const open = todos.filter((t) => !t.done).sort(byOpenOrder);
  const done = todos.filter((t) => t.done).sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  if (!todos.length) {
    const p = currentProject();
    list.replaceChildren(h("div", { class: "empty" },
      h("div", { class: "big" }, state.query ? "🔍" : "✨"),
      state.query ? "No tasks match that filter."
        : p ? "This project has no tasks yet. Add the first one above."
        : "Nothing to do. Add a task above, or create a project in the sidebar."));
    return;
  }

  const parts = [];
  if (state.view === "urgent" || state.view === "north_star") {
    parts.push(section("", "To do", open, { hint: "All clear." }));
  } else {
    const star = open.filter((t) => t.label === "north_star");
    const urgent = open.filter((t) => t.label === "urgent");
    const rest = open.filter((t) => !t.label);
    parts.push(section("north_star", "★ North Star", star, { drop: "north_star", hint: "No north star yet — drag a task here, or label one above." }));
    parts.push(section("urgent", "⚡ Urgent", urgent, { drop: "urgent", hint: "Nothing urgent. Nice." }));
    parts.push(section("", "Unlabeled", rest, { drop: "none", hint: "Nothing else on the list." }));
  }
  if (done.length) parts.push(section("", "Completed", done, { collapsible: true }));
  list.replaceChildren(...parts);

  const focusEl = list.querySelector(".todo.open .e-title");
  if (focusEl && state.focusEditor) { focusEl.focus(); state.focusEditor = false; }
}

const checkSvg = () => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 12 12");
  s.innerHTML = '<path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

function todoEl(t) {
  const isOpen = state.openId === t.id;
  const p = t.project_id != null ? projectById(t.project_id) : null;
  const due = dueInfo(t.due_date);
  const showProject = p && !state.view.startsWith("p");
  const labelInfo = LABELS.find((l) => l.v === t.label);
  const showLabelPill = t.label && (state.view !== t.label) && (t.done || ["urgent", "north_star"].includes(state.view));

  const meta = h("div", { class: "meta" },
    showLabelPill && h("span", { class: `pill ${t.label}` }, labelInfo.icon, labelInfo.text),
    showProject && h("span", { class: "chip" }, h("span", { class: "dot", style: `background:${p.color}` }), p.name),
    due && !t.done && h("span", { class: `due ${due.cls}` }, "📅 " + due.text),
    t.notes && !isOpen && h("span", { title: t.notes }, "📝 Notes"),
  );

  const row = h("div", {
    class: "todo-row",
    onclick: (e) => { if (!e.target.closest(".check, .grip") && !dragJustEnded()) toggleOpen(t.id); },
    onpointerdown: (e) => pressTodo(e, t),
  },
    !isOpen && h("span", { class: "grip", title: "Drag to North Star, Urgent or Unlabeled", "aria-hidden": "true" }, "⠿"),
    h("button", {
      class: "check", title: t.done ? "Mark as not done" : "Complete",
      "aria-label": t.done ? "Mark as not done" : "Complete",
      onclick: () => toggleDone(t),
    }, checkSvg()),
    h("div", { class: "todo-main" }, h("div", { class: "todo-title" }, t.title), meta),
  );

  return h("div", { class: `todo ${t.label || ""}` + (t.done ? " done" : "") + (isOpen ? " open" : ""), "data-id": t.id },
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
    LABELS.map((l) => h("button", {
      type: "button", role: "radio", "data-v": l.v ?? "", "aria-checked": String((t.label || null) === l.v),
      onclick: () => save({ label: l.v }),
    }, l.icon && h("span", {}, l.icon), l.text)));

  const proj = h("select", { "aria-label": "Project", onchange: (e) => save({ project_id: e.target.value || null }) },
    h("option", { value: "" }, "No project (Inbox)"),
    state.projects.map((p) => h("option", { value: p.id }, p.name)));
  proj.value = t.project_id == null ? "" : String(t.project_id);

  const due = h("input", { type: "date", "aria-label": "Due date", value: t.due_date || "", onchange: (e) => save({ due_date: e.target.value || null }) });
  const clearDue = t.due_date && h("button", { class: "btn ghost small", type: "button", onclick: () => save({ due_date: null }) }, "Clear date");

  const created = new Date(t.created_at.replace(" ", "T") + "Z");
  const stamp = t.done && t.completed_at
    ? `Completed ${new Date(t.completed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
    : `Created ${created.toLocaleDateString(undefined, { dateStyle: "medium" })}`;

  return h("div", { class: "editor", onclick: (e) => e.stopPropagation() },
    title, notes,
    h("div", { class: "editor-opts" }, seg, proj, due, clearDue),
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
  if (view !== "urgent" && view !== "north_star" && ["urgent", "north_star"].includes(state.newLabel)) state.newLabel = null;
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
    if ("project_id" in fields || "done" in fields) await refreshProjects();
    render();
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
  try {
    await api("DELETE", `todos/${t.id}`);
    state.todos = state.todos.filter((x) => x.id !== t.id);
    state.openId = null;
    await refreshProjects();
    render();
    toast(`Deleted “${t.title.length > 40 ? t.title.slice(0, 40) + "…" : t.title}”`, {
      label: "Undo",
      run: async () => {
        try {
          const restored = await api("POST", "todos", {
            title: t.title, notes: t.notes, label: t.label, due_date: t.due_date,
            project_id: projectById(t.project_id) ? t.project_id : null,
          });
          if (t.done) await api("PATCH", `todos/${restored.id}`, { done: true });
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
  try {
    const todo = await api("POST", "todos", {
      title,
      label: state.newLabel,
      project_id: p ? p.id : $("#new-project-select").value || null,
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
  drag.dx = e.clientX - rect.left;
  drag.dy = e.clientY - rect.top;
  drag.ghost = drag.row.cloneNode(true);
  drag.ghost.classList.add("drag-ghost");
  drag.ghost.style.width = rect.width + "px";
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
  const label = over.dataset.drop === "none" ? null : over.dataset.drop;
  if (label === t.label && !t.done) return;
  // Dropping a finished task into an active section brings it back.
  const fields = t.done ? { label, done: false } : { label };
  const before = { label: t.label, done: !!t.done };
  replaceTodo({ ...t, label, done: 0, completed_at: null });
  render();
  patchTodo(t.id, fields);
  toast(`Moved to ${DROP_NAMES[over.dataset.drop]}`, { label: "Undo", run: () => patchTodo(t.id, before) });
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
if (/^(inbox|urgent|north_star|p\d+)$/.test(initial)) state.view = initial;
load().catch(fail);
