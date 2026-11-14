# HQ

HQ is a local desktop planner for projects, priorities, and tasks. It keeps projects, tasks, features, fixes, releases, and their relationships in a SQLite database on your computer. The desktop interface is in German; the local CLI offers a scriptable interface for people and agents.

## Get started

Install Node.js 24 or later and the repository dependencies, subject to the project rule on approval for external dependencies. From the repository root:

```sh
npm ci
npm start
```

`npm start` compiles TypeScript and launches Electron. To build a standalone desktop app for the current platform and architecture, run:

```sh
npm run package
```

On Apple Silicon the app is `out/HQ-darwin-arm64/HQ.app`; on Intel macOS it is `out/HQ-darwin-x64/HQ.app`. A Windows build contains `HQ.exe` in the corresponding `out/HQ-win32-<arch>` directory. Data is stored separately from the application: `~/Library/Application Support/HQ/hq.sqlite` on macOS and `%APPDATA%\HQ\hq.sqlite` on Windows.

## A typical desktop workflow

1. Select **Projekte** and use **[ + ]** to create a project. Choose a normal or software project, and optionally add a description and deadline.
2. Open the project and use **[ + ]** in **Aufgaben** to create a task. Add its description, status, due date, and predecessors in the editor. Tasks can also be created in **Posteingang** before assigning them to a project.
3. Select the task to open its details on the right. Use **[ B ]** to edit it and add or check subtasks in the details. A task cannot be completed while a subtask or predecessor remains open.
4. In a software project, use the **Features**, **Fixes**, and **Releases** tabs to plan work. Assign an entry to a release in its editor. A release can be published once all its assigned tasks, features, and fixes are done.

Task, feature, and fix lists and the inbox show title, status, priority, and due date in columns. Each list contains entries from its own project or inbox. **Ideen** and **Recherche** are placeholders. Drag either sidebar divider to change its width; the focused divider also accepts the arrow keys.

## A typical CLI workflow

After building the CLI as described below, put the resulting `hq` executable (`hq.exe` on Windows) on your `PATH`, or invoke it by its output path. The following example reads a project, creates a task, updates it, and marks it done. Use a project that exists in your own database and substitute the ID returned by `create`:

```sh
hq projects --json
hq tasks --project "My project" --json
hq create --project "My project" --title "Review export" --json
hq edit --id 12 --status in_progress
hq done --id 12
hq show --id 12 --json
```

The task must have no open predecessors or subtasks before `done` succeeds. For a separate test database, pass `--db PATH` to each command; the file must already exist. See [Local CLI for agents](#local-cli-for-agents) for installation, search, status values, and errors.

For implementation details, see [Architecture](docs/ARCHITECTURE.md); for development and checks, see [Contributing](CONTRIBUTING.md). HQ is available under the [MIT license](LICENSE).

## Deleting entries

Open the editor for an existing task, feature, fix, or release and choose **Löschen**. Confirming permanently deletes a task, feature, or fix along with its subtasks, acceptance criteria, and dependency links. Deleting a release removes its assignments. Linked entries remain in place.

## Planning releases

Software projects have a **Releases** tab. Use **[ + ]** to create a version and **[ B ]** to edit an existing version, its optional due date, and its status. Releases can be planned, in progress, paused, or published. Tasks, features, and fixes can target an unpublished release in the same project. The release overview and details show their current statuses. A release can be published only after all assigned entries are done; HQ lists the open entries that block publication. Changing a release back to an unpublished status makes it selectable again. Publishing removes that version from new selections while retaining existing assignments and the release contents. Existing free-text target versions are migrated to planned releases when the database is upgraded. Select a release to open its details and edit or delete it in the editor. Deleting a release removes its assignments but keeps the entries.

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
hq tasks --all --open --kind task
hq releases --project "My project"
hq release-create --project "My project" --version "v1.0"
hq create --inbox --title "Review inbox"
hq show --project "My project" --title "Export"
hq create --project "My project" --title "Test export" --release 2 --due 2026-11-30
hq edit --id 12 --status in_progress --predecessors 8,9
hq subtask-add --id 12 --text "Check the CSV"
hq subtask-done --subtask 3
hq done --id 12
```

`projects` and `project` read project details; `releases` lists a project's releases and their IDs. `tasks` with only a project lists open entries whose predecessors and subtasks are complete; it never changes an entry. `tasks --all --open` lists all open entries across projects and the inbox, including blocked entries; `--kind` narrows the result to tasks, features, or fixes. A title filter searches case-insensitively. Use an entry `--id`, or `--project-id` for duplicate project names, to select an unambiguous match before changing anything. `create` and `edit` support descriptions, priority, status, dates, predecessor IDs, release IDs, and `--criteria` as a JSON array containing `id`, `text`, and `completed`. A new criterion has `id: null`; existing IDs must belong to the entry. `criterion-done` toggles a criterion, and `--undo` reopens a criterion or subtask. `--move-to` changes the project by ID; the same project and release consistency rules apply. Deletion remains in the desktop app.

`--json` returns `{ "ok": true, "data": ... }` on standard output. Projects and search results are ordered by numeric ID; task details include their sorted predecessor and successor IDs and subtasks. Status values are `planned`, `in_progress`, `paused`, and `done`; entry kinds are `task`, `feature`, and `fix`. Failures are written to standard error as `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Exit codes are 0 for success, 2 for invalid arguments or validation errors, 3 for ambiguity, 4 for missing entries or database, and 5 for a concurrent change or busy database. Error codes include `INVALID_ARGUMENT`, `VALIDATION_ERROR`, `AMBIGUOUS`, `NOT_FOUND`, `DATABASE_NOT_FOUND`, `CONFLICT`, and `DATABASE_BUSY`.

The desktop app checks for external changes periodically without replacing an open editor or focused input. Writes include the observed database revision and run in a transaction; a stale writer receives a conflict and must reload before retrying.
