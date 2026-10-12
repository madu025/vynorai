# VynorAI

VynorAI is an AI coding agent for VS Code with its own hosted model proxy. The extension reads, edits and runs
code in the user's project; the proxy routes each request to a DeepSeek model (OpenRouter is supported as a
fallback provider), meters it in credits priced in LKR, and takes payment through PayHere.

The product is built, released and in use. This repository holds all of it: the extension, the engine, the chat
interface and the back end. If you are an AI agent, read `AGENTS.md` before changing anything.

## Repository layout

| Folder              | What it is                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `extensions/vscode` | The VS Code extension (`VynorAI.vynorai`): activation, commands, sign-in, checkpoints, packaging  |
| `gui`               | The chat panel, a React and Redux app shown in the extension's webview. The agent loop lives here |
| `core`              | The engine: tools, model drivers, configuration, indexing, the agent task runtime                 |
| `backend`           | The hosted service: proxy, routing, quota and billing, accounts, admin. Express and PostgreSQL    |
| `extensions/cli`    | A headless command-line runner                                                                    |
| `packages`          | Shared libraries used by `core` and the extensions                                                |
| `deploy`            | Build, release and deployment scripts, and the server configuration                               |
| `docs`              | Engineering decisions and plans (the `.md` files), next to the public documentation site          |
| `.claude/skills`    | Written procedures: release, live verification, PostgreSQL check, prompt cache rules              |

`CODEMAP.md` indexes every subsystem and the files that implement it.

## Documents

| File                                | What it answers                                             |
| ----------------------------------- | ----------------------------------------------------------- |
| `AGENTS.md`                         | Rules for AI agents and a table of what already exists      |
| `CODEMAP.md`                        | Where each feature is implemented                           |
| `docs/ARCHITECTURE_DECISIONS.md`    | Fixed decisions: database, caches, context limits, plans    |
| `docs/AGENTIC_BUILD_PLAN.md`        | Current work: the agent finishing a whole job, with results |
| `docs/LARGE_TASK_BENCHMARK_PLAN.md` | How multi-file tasks are measured                           |
| `docs/NEXT_LEVEL_PLAN.md`           | Planned upgrades                                            |
| `docs/CLAUDE_CODE_PARITY.md`        | Feature gaps against Claude Code                            |
| `docs/HOOKS.md`                     | The hook events and how to configure them                   |

## Build and test

Node.js 20.20.1 or newer. Install dependencies in each folder you work in (`npm install`).

```bash
# Type check: run in backend, core, gui and extensions/vscode
npx tsc --noEmit

# Tests
cd backend && npx tsx --test test/*.test.ts
cd core && npx vitest run <path>
cd gui && npx vitest run <path>

# Back end, local development (SQLite unless DATABASE_URL is set)
cd backend && npm run dev

# Extension package
./deploy/build-extension.sh x.y.z        # writes extensions/vscode/build/vynorai-x.y.z.vsix
```

The extension version is the `version` field of `extensions/vscode/package.json`.

End-to-end tests drive a real VS Code with the packaged extension in an isolated profile; they are in
`extensions/vscode/e2e/tests`. The benchmarks that measure the agent on real tasks are in
`backend/scripts/bench`.

## Release and deploy

Extension builds are published on vynor.lk, not on a marketplace; the extension's updater reads the latest
build from there.

```bash
./deploy/release-extension.sh extensions/vscode/build/vynorai-x.y.z.vsix "Release notes"
./deploy/rolling-deploy.sh               # on the server, after pushing the back end
```

A build is published only after it has been verified in a real VS Code. The steps are in
`.claude/skills/vynor-release/SKILL.md` and `.claude/skills/vynor-live-verify/SKILL.md`.

## Origin and license

`core`, `gui` and the extension shell started from the open-source [Continue](https://github.com/continuedev/continue)
project, which is why some file, command and setting names still say `continue`. VynorAI is developed
independently of it; `CODEMAP.md` section 9 describes the boundary.

Licensed under Apache 2.0; see `LICENSE`. Continue is © 2023-2026 Continue Dev, Inc.
