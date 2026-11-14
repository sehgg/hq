# Architecture

HQ is an Electron desktop application and a local CLI built from the same TypeScript project. SQLite is the local source of truth. The desktop app and CLI are separate processes; neither calls the other's interface.

## Code map

| Location | Responsibility |
| --- | --- |
| `ui/index.html`, `ui/styles.css` | Desktop markup, dialogs, layout, and styles. |
| `src/renderer.ts` | Renders workspace state, handles user input, and calls the preload API. |
| `src/preload.ts`, `src/shared.ts` | Exposes the typed `window.hq` bridge through Electron's context bridge; shared types define workspaces and fields. |
| `src/main.ts` | Creates the Electron window, opens the user database, and implements IPC handlers. |
| `src/database.ts` | `PlannerDatabase`: schema migration, SQLite queries, transactions, and shared validation and completion rules. |
| `src/cli.ts` | Parses CLI arguments, selects entries, formats human or JSON output, and calls `PlannerDatabase`. |
| `scripts/` | Packages the desktop application and builds the CLI single executable. |
| `tests/` | Database, CLI, and renderer tests, including concurrent writers. |

TypeScript is compiled into `dist/`. The app loads the compiled renderer from the HTML and runs the compiled main and preload scripts. The CLI packaging script bundles the compiled CLI and database module with a Node runtime.

## Example: saving a task

```mermaid
sequenceDiagram
    actor User
    participant R as Renderer
    participant P as Preload bridge
    participant M as Electron main
    participant D as PlannerDatabase
    participant S as SQLite
    User->>R: Edit task and save
    R->>P: saveTask(id, fields, workspace revision)
    P->>M: IPC task:save
    M->>D: mutate(revision, saveTask)
    D->>S: Begin transaction; compare revision
    D->>S: Validate and update task and relations
    S-->>D: Updated workspace
    D-->>M: Commit and return workspace
    M-->>P: IPC result
    P-->>R: Updated workspace
    R-->>User: Close editor and refresh view
```

The renderer collects the editor fields and the revision from its current workspace. `src/preload.ts` forwards the call using `ipcRenderer.invoke`; `src/main.ts` handles `task:save` and calls `PlannerDatabase.mutate` and `saveTask`. The database layer validates fields and relationships, updates the task, predecessors and acceptance criteria, and returns the updated workspace. Errors propagate to the editor instead of closing it. The window uses context isolation, a sandboxed renderer, and a preload bridge rather than exposing Node directly to the renderer.

The CLI resolves a task and reads the workspace, then uses the same `mutate` and `saveTask` methods. It does not send IPC to the desktop app. Both interfaces therefore use the database rules for project deadlines, dependency cycles, and completion. In particular, a task cannot be completed while it has open subtasks or predecessors, and a release cannot be published while assigned entries are open.

## Concurrent changes

SQLite stores a workspace revision, incremented by triggers on changes to projects, tasks, releases, subtasks, criteria, and dependencies. `mutate` starts an immediate transaction, checks the caller's observed revision, and rejects a stale write before applying it. The caller must reload and retry; a stale full-task edit cannot silently overwrite a newer write. Reads assemble a workspace in a savepoint. SQLite foreign keys and the configured busy timeout also apply. Database initialization performs migrations and checks foreign keys.

During each shared mutation, the database compares the workspace before and after the operation and records field-level history in the same transaction. History captures desktop and CLI changes, persists after entries are deleted, and starts when this version is installed. A newly created task, feature, fix, or release produces a single creation event, including when initial criteria or dependencies are provided; subsequent changes are recorded individually. Manual notes belong only to their selected project, task, or release. History writes also advance the workspace revision.

The desktop renderer polls for a newer workspace every two seconds. It defers refresh while saving, while a dialog is open, or while an input, textarea, or select is focused, so it does not replace a draft. Once interaction permits, external CLI changes can appear without restarting the app.

## Patterns in the code

- **Layered architecture:** presentation and command parsing sit above the shared persistence and business-rule layer.
- **Facade:** `PlannerDatabase` offers task, project, and release operations while hiding SQL and schema details from the two front ends.
- **Adapter / bridge:** preload and IPC translate the renderer's typed API into calls handled by the main process; the CLI adapts command-line arguments to the same database operations.
- **Optimistic concurrency control:** the workspace revision detects stale edits, and SQLite transactions serialize the check and write. This is a concurrency technique, not a claim that the app uses a larger framework or domain architecture.

Legacy task-to-feature and task-to-fix assignments are cleared transactionally when an existing database is opened. Tasks and their dependency links remain intact.
