# HQ

HQ is a local desktop planner for personal projects, priorities, and standalone tasks. It uses Electron and TypeScript and stores data in SQLite.

## Project rules

- Obtain the user's approval before installing any external dependencies.
- Write documentation, agent instructions, and similar project materials in English, even when the user's instructions are in German.
- Review the relevant documentation with every code change and update it as needed.
- Do not make assumptions about unclear requirements. Stop and ask the user for clarification before proceeding.
- Do not use Computer Use for testing. The user runs any tests that require it. Continue working toward the goal while those tests are pending.
- Define goals and their completion criteria so they can be completed without Computer Use.
- Every change has to be comitted

## HQ CLI workflow

Use the local `hq` CLI with the `HQ` project when working on planner entries for this repository.

- If the user names the project without specifying an entry, run `hq tasks --project "HQ" --json`, suggest open entries, and wait for the user to choose.
- If the user names an entry, read it with `hq show --project "HQ" --title "<title>" --json`. Review its description and any predecessors, subtasks, or acceptance criteria before starting.
- Resolve ambiguous matches before making changes. Look up the entry ID yourself and ask the user to choose if the matching entries cannot be distinguished from the request.
- When starting the selected entry, run `hq edit --id <id> --status in_progress`. After implementing and verifying the work, run `hq done --id <id>`.
- Use `hq --help` and the [CLI documentation](README.md#local-cli-for-agents) for other commands.
