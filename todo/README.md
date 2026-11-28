# todo

A to-do list app on port **1242** — tasks, projects, and labels.

- **Tasks**: create, edit (title, notes, label, project, due date), complete, delete (with undo).
- **Due today by default**: every new task — typed, free-form, or from Day Log — is due today unless
  you give it a date (or clear the composer's date). Each open task has **+1d / +3d / +7d** buttons
  (on hover; always on touch screens) that push its due date back — from its due date, or from
  today if it's overdue or has none. Each task also shows when it was made (“Made Nov 12”).
- **Plan today** (sidebar): overdue tasks one at a time, oldest first, each with **Today**,
  **+1d / +3d / +7d**, a date picker, **Done**, **No date**, **Skip** and **Delete** — keys `T`,
  `1` `3` `7`, `X`, `0`, `S`/→, Delete — with Undo on each. *+ No date* (top right) adds the
  tasks without a due date to the run. Below the card is what's on today's list.
- **Pending** (waiting on a delivery, a reply): click **⏳ Pending** on any task (every open task has it), or pick it in
  the editor. It leaves your lists until its check-in day (1 day, 3 days, 1 week or 2 weeks —
  the default is set on the *⏳ Pending* page — or any date in the editor), then comes back,
  marked “Pending since Nov 20 — still waiting?”, with **✓ Arrived**, **Wait +3d / +7d** and
  **Not pending**. Check-ins also come first in Plan today, show in Day Log's due panel, and
  the sidebar's *Pending* says how many are back to check. Project pages list their pending
  tasks at the bottom.
- **Repeating tasks**: pick *🔁 Repeat* in the composer or a task's editor (daily, weekly,
  every 2 weeks, monthly, every 3 or 6 months, yearly, or *Custom…* like “10 days”), or write it in
  free-form notes and Day Log: “pay rent every month on 12/1”, “water plants every other day”,
  “gym every monday”, “dentist yearly”. Completing one makes the next copy, due one step on from
  its due date (and never already overdue); Jan 31 monthly goes to Feb 28. Undo takes it back.
- **Images**: open a task and *📎 Attach image*, paste one (⌘V / Ctrl+V) into the editor, or drop
  image files onto it. Tasks show small thumbnails; click one to see it big (← / → to step
  through, *Open full size* for the original). Hover a thumbnail in the editor for × to remove it
  (with undo). Photos over 2400px are scaled down before upload; JPEG, PNG, GIF, WebP, AVIF and
  BMP up to 15 MB. They're stored in `todo.db` with everything else; deleting a task keeps its
  images for a day so Undo brings them back.
- **Projects**: create, edit (name, description, color, keywords), delete — deleting a project deletes its tasks.
- **Keywords**: any project can have them (*Edit project*). New tasks from free-form notes and
  Day Log land in the project whose keywords they match most. It starts with **Work**, **Health**,
  **Social** and **Domestic** (family and home), each with keywords; they're ordinary projects —
  rename, nest, archive or delete them like any other.
- **Sub-projects**: projects nest, any depth. Drag project A onto project B in the sidebar (or onto
  a sub-project card) and A goes inside B; drop it on the *Projects* heading to bring it back to the
  top level. “+ Sub-project” on a project page, or *Inside* in the project editor, does the same.
  A project's page shows its sub-projects as cards, and below its own tasks, the open tasks of
  every sub-project (grouped, deepest ones too); the sidebar folds them with ▾. Deleting a
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
  **Unarchive** it. Free-form notes and Day Log never file into an archived project.
- Tasks without a project live in the **Inbox**. Its *Unsorted | All tasks* switch (top right, remembered) shows every task there instead, each with its project.
- **Free-form notes**: write anything, one task per line, and each line is sorted for you before
  it's added (the preview shows where each will land). `capture.js` reads the project from the words
  — “clean toilet” is **Domestic**, “gym tomorrow” Health, “call Jenny” Social, “fix the deploy
  bug” Work — using each project's keywords. `#print` picks a
  project by name; `!`, “urgent” or “asap” marks it Urgent; today / tomorrow / friday / this
  weekend / next week / 11/20 set the due date. Cmd/Ctrl+Enter adds them. A line that matches
  no project's keywords goes to the Inbox. On a project page, every line without a `#tag` goes to
  that project instead. Before adding, each previewed line has a project
  picker (✨ is the automatic pick), an urgency picker (Not urgent / ⚡ Urgent / ★ North Star —
  it starts from the words) and, when that project has subsections, a subsection picker.
- **Day Log ⇄ To-do**: the switch at the top of the sidebar (or `D`) goes to Day Log, the diary on
  port 3030, in the same tab; Day Log has the same switch back.
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
| GET, PATCH, DELETE | `/api/todos/:id` | PATCH also takes `{done, today?}`, `{waiting_since, remind_on}` (pending; null both to stop) (completing a task with `repeat` like `"1 month"` makes its next copy, dated from `today`); todos carry `images: [{id, name, type, size}]`, POST takes `image_ids` (Undo) |
| POST | `/api/todos/:id/images` | the image's bytes as the body, its type as `content-type`, `x-name` its file name |
| GET, PATCH, DELETE | `/api/images/:id` | GET the bytes; DELETE removes it (kept a day); PATCH `{todo_id}` puts a removed one back |
| POST | `/api/capture` | free-form `{text, notes?, project_id?, default_project_id?, default_due?, choices?, dry?}` → `{items}`; one task per line, `project_id` takes untagged lines, `choices[i]` (`{project_id?, section_id?, label?}`) overrides line i, `dry` only previews |
| POST | `/api/classify` | `{text}` → `{project}`: which project some writing falls into, by keywords |
| GET, POST | `/api/sections` | list / create `{project_id, name}` |
| PATCH, DELETE | `/api/sections/:id` | `{name}`, `{collapsed}`, or `{move: -1 \| 1}` |

`label` is `"urgent"`, `"north_star"`, or `null`.
