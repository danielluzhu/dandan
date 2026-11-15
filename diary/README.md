# diary

A daily diary on port **3030** — one page per day, with **Notes** and a short **Summary**.
It saves as you type, and anything written as a to-do lands on the to-do list (`../todo`,
port 1242), sorted into the right project the same way the to-do list's free-form notes are.

These lines become to-dos:

```
- [ ] call mom            [ ] call mom            todo: print poster #print
Need to clean the toilet tomorrow, but not tonight.   → “clean the toilet”, due tomorrow, domestic
Remember to / have to / gotta / don't forget to …
```

- A to-do is made once its line is finished (Enter, leaving the box, or leaving the day), so a
  half-typed line never reaches the list.
- Each day remembers which to-do each line made: saving again never duplicates, editing the
  line renames its to-do, and ticking it (`- [x]`) completes it. Deleting the line leaves the
  to-do alone.
- The side panel shows the day's to-dos (tick them off there too) and everything due today or
  overdue on the to-do list. ☑ *To-do list* in the sidebar opens it.
- Alt+← / Alt+→ move between days.

```bash
bun run start    # http://localhost:3030
```

Entries live in `../data/diary.db` (SQLite, gitignored). `TODO_URL` points at the to-do app
(default `http://localhost:1242`). `deploy/dz-diary.service` keeps it running:

```bash
sudo cp deploy/dz-diary.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dz-diary
```

## API

| Method | Path | |
|---|---|---|
| GET | `/api/entries` | days with writing, newest first, with a snippet |
| GET, PUT | `/api/entries/:date` | PUT `{notes, summary, extract?, link?}`; `extract` turns finished to-do lines into to-dos |
| GET | `/api/entries/:date/todos` | the day's to-dos, live from the to-do list |
| PATCH | `/api/todos/:id` | `{done}` — passed through to the to-do list |
| GET | `/api/due?today=YYYY-MM-DD` | open to-dos due today or earlier |
