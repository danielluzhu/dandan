# Daily

**Daily** is the diary, on port **3030** (it lives in `diary/`) — one page per day: a **summary** of the day with any number
of **notes** inside it, each stamped with the time it was written (“+ New note”, or Alt+N).
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
- **Version history** (🕘 History, Alt+H, or *History* on a note), like a Google Doc's: every
  stretch of editing on a note or the summary is a version — edits within 10 minutes of each
  other fold into one — shown as what changed (added words green, removed red). Filter to one
  note, and restore any version. Deleting a note keeps it in history, so it can be restored.
- Notes show when they were written and when they were last edited.
- Each note falls into one of the to-do list's **projects**. It's worked out from the note's
  words and the projects' keywords (✨) until you pick one under the note. To-dos in a note whose
  own words don't place them land in the note's project. The sidebar can narrow entries to one
  project; keywords are edited on the to-do list (*Edit project*).
- The Daily ⇄ To-do switch at the top of the sidebar (or Alt+D) goes to the to-do list in the
  same tab.
- Alt+← / Alt+→ move between days, Alt+T goes to today. ⌨ Shortcuts in the sidebar (or
  Alt+/, or `?` outside a note) lists every shortcut.

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
| GET, PUT | `/api/entries/:date` | the day: `{summary, notes: [...]}`; PUT `{summary, extract?, link?}` saves the summary; `extract` turns finished to-do lines into to-dos |
| POST | `/api/entries/:date/notes` | new note `{body, extract?, link?}`, stamped now |
| PUT, DELETE | `/api/notes/:id` | save `{body, extract?, link?}`; DELETE keeps it in history |
| GET | `/api/entries/:date/history` | versions, newest first, each with the text `before` it |
| POST | `/api/revisions/:id/restore` | put a note or the summary back as that version had it |
| GET | `/api/entries/:date/todos` | the day's to-dos, live from the to-do list |
| PATCH | `/api/todos/:id` | `{done}` — passed through to the to-do list |
| GET | `/api/due?today=YYYY-MM-DD` | open to-dos due today or earlier |
