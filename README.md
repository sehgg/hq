# HQ

Ein lokaler Projektplaner für Projekte, Prioritäten und lose Aufgaben.

## Start im Entwicklungsmodus

```sh
npm ci
npm start
```

## Eigenständige Mac-App bauen

```sh
npm run package
```

Auf einem Apple-Silicon-Mac entsteht `out/HQ-darwin-arm64/HQ.app`. Die App lässt sich per Doppelklick öffnen oder nach **Programme** ziehen. Auf einem Intel-Mac heißt der Ausgabeordner `HQ-darwin-x64`. Auf einem Windows-Rechner erzeugt derselbe Befehl einen Windows-Build mit `HQ.exe`.

Die Daten liegen getrennt von der App im Benutzerprofil. Auf macOS ist die Datenbank `~/Library/Application Support/HQ/hq.sqlite`.

## Deleting entries

Open a task, feature, or fix and choose **Löschen** in the details panel. Confirming permanently deletes the entry, its subtasks and acceptance criteria, and its dependency links. Linked entries remain in place.

## Linking tasks to features and fixes

In a software project's feature or fix details, use **Zugehörige Aufgaben** to create or assign tasks from the same project. Task details let you open, change, or clear the associated feature or fix. Assignments do not change either entry's status or create a predecessor relationship.

## Upcoming sections

The **Ideen** and **Recherche** navigation entries are placeholders for sections still in development.

## Sidebar width

Drag the dividers at the edges of the navigation and details sidebars to adjust their widths. Each sidebar's original width at the current window size is its minimum. The focused dividers also support the left and right arrow keys.

## Planning releases

Software projects have a **Releases** tab. Use **[ + ]** to create a version and **[ B ]** to edit an existing version, its optional due date, and its status. Releases can be planned, in progress, paused, or published. Tasks, features, and fixes can target an unpublished release in the same project. The release overview and details show their current statuses. A release can be published only after all assigned entries are done; HQ lists the open entries that block publication. Changing a release back to an unpublished status makes it selectable again. Publishing removes that version from new selections while retaining existing assignments and the release contents. Existing free-text target versions are migrated to planned releases when the database is upgraded. Select a release to open its details, edit it or delete it. Deleting a release removes its assignments but keeps the entries.

## Project deadlines

A project can have an optional due date. Tasks, features, and fixes assigned to that project may be undated or due on or before the project deadline. When a new project deadline conflicts with existing entries, the editor lists the affected entries so their dates can be adjusted before saving.

## Local CLI for agents

The CLI uses the same SQLite database and validation rules as the desktop app. On macOS its default database is `~/Library/Application Support/HQ/hq.sqlite`; on Windows it is `%APPDATA%\HQ\hq.sqlite`. The database must already exist. Use `--db PATH` for an isolated test database or another installation.

Build on each target operating system using Node.js 24 or later with single-executable application (SEA) support and the existing project dependencies:

```sh
npm ci
npm run package:cli
```

The resulting self-contained program is `out/cli-darwin-<arch>/hq` on macOS or `out/cli-win32-<arch>/hq.exe` on Windows. The build uses the existing `postject` package and does not require Node.js on the target machine. Some Node distributions disable SEA; set `HQ_NODE` to the path of a Node executable with SEA support before building. Run `hq --help` for all commands. To run the CLI test suite against a packaged executable, set `HQ_CLI_EXEC` to its absolute path and run `node --test tests/cli.cjs` on the target system.

Examples:

```sh
hq projects --json
hq tasks --project "My project"
hq releases --project "My project"
hq show --project "My project" --title "Export"
hq create --project "My project" --title "Test export" --feature 7 --release 2 --due 2026-11-30
hq edit --id 12 --status in_progress --predecessors 8,9
hq subtask-add --id 12 --text "Check the CSV"
hq subtask-done --subtask 3
hq done --id 12
```

`projects` and `project` read project details; `releases` lists a project's releases and their IDs. `tasks` with only a project lists open entries whose predecessors and subtasks are complete; it never changes an entry. A title filter searches case-insensitively. Use an entry `--id`, or `--project-id` for duplicate project names, to select an unambiguous match before changing anything. `create` and `edit` support descriptions, priority, status, dates, predecessor IDs, feature and release IDs, and `--criteria` as a JSON array containing `id`, `text`, and `completed`. A new criterion has `id: null`; existing IDs must belong to the entry. `criterion-done` toggles a criterion, and `--undo` reopens a criterion or subtask. `--move-to` changes the project by ID; the same project and release consistency rules apply. Deletion remains in the desktop app.

`--json` returns `{ "ok": true, "data": ... }` on standard output. Projects and search results are ordered by numeric ID; task details include their sorted predecessor and successor IDs and subtasks. Status values are `planned`, `in_progress`, `paused`, and `done`; entry kinds are `task`, `feature`, and `fix`. Failures are written to standard error as `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Exit codes are 0 for success, 2 for invalid arguments or validation errors, 3 for ambiguity, 4 for missing entries or database, and 5 for a concurrent change or busy database. Error codes include `INVALID_ARGUMENT`, `VALIDATION_ERROR`, `AMBIGUOUS`, `NOT_FOUND`, `DATABASE_NOT_FOUND`, `CONFLICT`, and `DATABASE_BUSY`.

The desktop app checks for external changes periodically without replacing an open editor or focused input. Writes include the observed database revision and run in a transaction; a stale writer receives a conflict and must reload before retrying.
