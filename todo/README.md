# todo

A to-do list app on port **1242** — tasks, projects, and labels.

- **Tasks**: create, edit (title, notes, label, project, due date), complete, delete (with undo).
- **Projects**: create, edit (name, description, color, keywords), delete — deleting a project deletes its tasks.
- **Keywords**: any project can have them (*Edit project*). New tasks from free-form notes and
  Daily land in the project whose keywords they match most. It starts with **Work**, **Health**,
  **Social** and **Domestic** (family and home), each with keywords; they're ordinary projects —
  rename, nest, archive or delete them like any other.
- **Sub-projects**: projects nest, any depth. Drag project A onto project B in the sidebar (or onto
  a sub-project card) and A goes inside B; drop it on the *Projects* heading to bring it back to the
  top level. “+ Sub-project” on a project page, or *Inside* in the project editor, does the same.
  A project's page shows its sub-projects as cards; the sidebar folds them with ▾. Deleting a
  project moves its sub-projects up a level. Tasks can be dragged onto any project to move them there.
- **Subsections**: split a project into named parts (e.g. Design, Build) — rename, reorder, collapse,
  delete (its tasks move to *No subsection*). Each has its own quick “+ Add task”.
- **North Stars are sub-projects**: tasks can live inside a North Star (drag one onto it, use its
  “+ Add task”, or pick it in a task's editor). It shows progress, folds open/closed, appears under
  its project in the sidebar, and has its own page (“Open ›”). Tasks inside can be Urgent or
  unlabeled, and follow the North Star if it moves project or subsection. A North Star with tasks
  inside keeps its label until they're moved out; deleting it deletes them (with undo).
- **Labels**: every task is **North Star**, **Urgent**, or unlabeled. Project pages group tasks by label (inside each subsection, if it has any);
  the sidebar's North Star and Urgent views collect them across every project.
- Drag a task between the North Star, Urgent and Unlabeled sections (or onto North Star / Urgent in
  the sidebar) to relabel it. While dragging, each subsection header shows North Star / Urgent /
  Unlabeled targets, so one drop can move a task to another subsection and relabel it. Mouse drags from anywhere on the row; touch drags from the ⠿ grip.
- **Archive** a project (button on its page) to put it away: it and its sub-projects leave the
  sidebar, the project pickers and every task list and count, but nothing is deleted. Archived
  projects sit under *Archived* at the bottom of the sidebar; open one to see its tasks or
  **Unarchive** it. Free-form notes and Daily never file into an archived project.
- Tasks without a project live in the **Inbox**.
- **Free-form notes**: write anything, one task per line, and each line is sorted for you before
  it's added (the preview shows where each will land). `capture.js` reads the theme from the words
  — “clean toilet” is **Domestic**, “gym tomorrow” Health, “call Jenny” Social, “fix the deploy
  bug” Work — using each project's keywords. `#print` picks a
  project by name; `!`, “urgent” or “asap” marks it Urgent; today / tomorrow / friday / this
  weekend / next week / 11/20 set the due date. Cmd/Ctrl+Enter adds them. A line that matches
  no project's keywords goes to the Inbox.
- **Daily ⇄ To-do**: the switch at the top of the sidebar (or `D`) goes to Daily, the diary on
  port 3030, in the same tab; Daily has the same switch back.
- Keys: `N` new task, `/` filter, `Esc` close the editor, `?` (or ⌨ Shortcuts in the sidebar)
  lists every shortcut.

```bash
bun run start    # http://localhost:1242
```

Data lives in `../data/todo.db` (SQLite, gitignored). `deploy/dz-todo.service` keeps it running:

```bash
sudo cp deploy/dz-todo.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dz-todo
```

## API

| Method | Path | |
|---|---|---|
| GET | `/api/state` | all projects (with open/total counts) and todos |
| GET, POST | `/api/projects` | list / create `{name, description?, color?, parent_id?, keywords?}` |
| GET, PATCH, DELETE | `/api/projects/:id` | PATCH also takes `{archived}`; projects carry `archived` (1 if it or a parent is archived) |
| GET, POST | `/api/todos` | list / create `{title, notes?, label?, project_id?, section_id?, parent_id?, due_date?}` |
| GET, PATCH, DELETE | `/api/todos/:id` | PATCH also takes `{done}` |
| POST | `/api/capture` | free-form `{text, notes?, default_project_id?, dry?}` → `{items}`; one task per line, `dry` only previews |
| POST | `/api/classify` | `{text}` → `{project}`: which project some writing falls into, by keywords |
| GET, POST | `/api/sections` | list / create `{project_id, name}` |
| PATCH, DELETE | `/api/sections/:id` | `{name}`, `{collapsed}`, or `{move: -1 \| 1}` |

`label` is `"urgent"`, `"north_star"`, or `null`.
