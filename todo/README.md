# todo

A to-do list app on port **1242** — tasks, projects, and labels.

- **Tasks**: create, edit (title, notes, label, project, due date), complete, delete (with undo).
- **Projects**: create, edit (name, description, color), delete — deleting a project deletes its tasks.
- **Labels**: every task is **North Star**, **Urgent**, or unlabeled. Project pages group tasks by label;
  the sidebar's North Star and Urgent views collect them across every project.
- Tasks without a project live in the **Inbox**.
- Keys: `N` new task, `/` filter, `Esc` close the editor.

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
| GET, POST | `/api/projects` | list / create `{name, description?, color?}` |
| GET, PATCH, DELETE | `/api/projects/:id` | |
| GET, POST | `/api/todos` | list / create `{title, notes?, label?, project_id?, due_date?}` |
| GET, PATCH, DELETE | `/api/todos/:id` | PATCH also takes `{done}` |

`label` is `"urgent"`, `"north_star"`, or `null`.
