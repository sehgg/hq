# Contributing

## Environment

Use Node.js 24 or later, npm, and a supported macOS or Windows development environment. Electron, TypeScript, the packager, and `postject` are supplied by the repository's dependency tree. Follow [AGENTS.md](AGENTS.md): obtain the user's approval before installing external dependencies. After approval, install the lockfile dependencies from the repository root:

```sh
npm ci
```

The application stores its real database in the user profile. CLI commands default to that same database; use `--db PATH` with an existing separate database when experimenting. The automated tests create isolated temporary databases.

## Develop and verify

```sh
npm run build
npm start
npm test
npm run package
npm run package:cli
```

`npm run build` compiles TypeScript; `npm start` builds and starts Electron. `npm test` builds and runs the Node test suite. `npm run package` builds the desktop app for the current platform, and `npm run package:cli` builds a self-contained CLI for the current platform. CLI packaging requires a Node executable with SEA support; if the active Node distribution disables it, point `HQ_NODE` at a suitable Node executable. See the [CLI section of the README](README.md#local-cli-for-agents) for paths, examples, and the packaged-CLI test command.

Choose checks appropriate to the change and report any that could not be run. Do not use Computer Use for testing: the user runs tests that require it. Keep goals and completion criteria achievable without Computer Use.

## Documentation and commits

Write documentation, agent instructions, and similar project material in English. Review relevant documentation with every code change and update it when behavior or commands change. Keep examples accurate and avoid using the user's real workspace for destructive demonstrations. Follow the HQ CLI workflow in [AGENTS.md](AGENTS.md) when working on planner entries for this repository.

Every change must be committed. Review the diff and commit the intended changes with a descriptive message after the relevant checks pass.
