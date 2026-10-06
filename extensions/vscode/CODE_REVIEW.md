# VynorAI VS Code Extension: code-review map

Use this document as the entry point for every extension review. It maps the
runtime boundaries, the files that own them, and the checks needed before a
release.

## Runtime map

```text
VS Code activation
  src/extension.ts
    -> extension/VsCodeExtension.ts
      -> ContinueGUIWebviewViewProvider.ts
           -> gui/assets/index.js (React GUI bundle)
      -> extension/VsCodeMessenger.ts
           <-> webviewProtocol.ts
           <-> core (agent, chat, workspace, tools)
      -> commands.ts / apply/ / diff/ / autocomplete/ / browser/

React GUI (gui/src)
  -> IdeMessenger
  -> typed protocol messages
  -> VsCodeWebviewProtocol
  -> VsCodeMessenger
  -> VS Code APIs, Core, and Vynor backend API
```

The webview is untrusted UI input. It must reach VS Code APIs only through the
typed protocol and extension-host validation. The extension host is the trust
boundary for filesystem access, terminal commands, diffs, authentication, and
update installation.

## Ownership map

| Concern                       | Primary files                                                                             | Review focus                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Activation and lifecycle      | `src/extension.ts`, `src/extension/VsCodeExtension.ts`                                    | disposables, sleep/resume, workspace changes, startup failure recovery                 |
| Chat-panel webview            | `src/ContinueGUIWebviewViewProvider.ts`, `src/webviewProtocol.ts`, `gui/src`              | CSP, local resource roots, reload/startup queue, undefined state guards                |
| Message bridge                | `src/extension/VsCodeMessenger.ts`, `core/protocol/*`, `gui/src/context/IdeMessenger.tsx` | typed request/response pairs, input validation, errors returned to GUI                 |
| Workspace identity            | `core/workspace/WorkspaceSessionService.ts`, `VsCodeExtension.ts`                         | multi-root, trust, no-folder windows, sleep/resume transient empty state               |
| File edits and diffs          | `src/apply/*`, `src/diff/*`, `VsCodeMessenger.ts`                                         | explicit approval, path containment, stale-document handling, undo/restore             |
| Tools and terminal            | `VsCodeMessenger.ts`, `src/ide/*`, `core/tools/*`                                         | workspace trust, command allow-listing, timeouts, output truncation, no secret logging |
| Authentication and account UI | `src/util/vynorAuth.ts`, `src/commands.ts`, GUI auth components                           | token storage, logout cleanup, quota/upgrade errors, no token in diagnostics           |
| Diagnostics and logs          | `src/diagnostics/runtimeDiagnostics.ts`, `src/commands.ts`                                | redact secrets and code content; copy only safe, actionable evidence                   |
| Auto-update                   | `src/util/selfUpdate.ts`, `package.json`                                                  | HTTPS-only source, SHA-256 verification, version comparison, user consent              |
| Background agents             | `VsCodeMessenger.ts`, backend client/core protocol                                        | disabled-state clarity, cancellation, no unsafe local execution                        |
| Native/runtime packaging      | `scripts/prepackage.js`, `scripts/download-copy-sqlite.js`, `scripts/package.js`          | target binary integrity, download retries, no stale GUI assets                         |
| E2E tests                     | `e2e/*`, `package.json` scripts                                                           | deterministic setup, ChromeDriver/VS Code lifecycle, isolated storage                  |

## Required review path for a feature change

1. Start at the visible GUI component and identify its message name.
2. Trace the message through `webviewProtocol.ts` and `VsCodeMessenger.ts`.
3. Trace the handler into VS Code APIs or `core`; identify file, network,
   terminal, and authentication effects.
4. Confirm both success and failure responses are represented in the GUI.
5. Add a focused unit test at the owner layer. Add/adjust E2E only for actual
   VS Code/webview behaviour.
6. Test lifecycle transitions: no workspace, trust denied, reload, sleep/resume,
   extension-host restart, cancellation, timeout, and offline/network failure.

## Security review checklist

- [ ] Webview messages never bypass `VsCodeMessenger` or the typed protocol.
- [ ] Workspace trust is required before reading, indexing, editing, or running
      project commands.
- [ ] User-controlled paths are checked before filesystem writes or commands.
- [ ] Terminal/tool execution has clear consent and bounded output.
- [ ] Auth tokens, prompts, source files, and environment values do not enter
      diagnostics, telemetry, logs, or error dialogs.
- [ ] Update download is HTTPS, checksum-verified, and never silently installs.
- [ ] The GUI handles missing/reloading state without calling methods on
      `undefined`.

## Reliability checklist

- [ ] Every VS Code listener is registered in `context.subscriptions`.
- [ ] Timers are debounced and cannot leave stale state after reload.
- [ ] Workspace refresh does not permanently cache a transient empty result.
- [ ] Message handlers return useful errors; failures do not leave a chat turn
      stuck in progress.
- [ ] Native binary downloads retry transient network failures and fail with
      actionable logs.
- [ ] Build copies the current GUI bundle before packaging the VSIX.

## Test matrix

| Level           | Command                                                                       | Purpose                                                                  |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Core unit       | `npm --prefix core run vitest -- workspace/WorkspaceSessionService.vitest.ts` | workspace lifecycle regression                                           |
| Core types      | `npm --prefix core run tsc:check`                                             | core protocol/type safety                                                |
| Extension types | `npm --prefix extensions/vscode run tsc:check`                                | VS Code host/type safety                                                 |
| Extension unit  | `npm --prefix extensions/vscode run vitest`                                   | protocol and updater coverage                                            |
| GUI focused     | `cd gui; npx vitest run <affected-tests> --maxWorkers=1 --minWorkers=1`       | reliable UI regression check                                             |
| GUI full        | `cd gui; npx vitest run`                                                      | broad regression gate; rerun isolated failures before classifying flakes |
| VS Code E2E     | `npm --prefix extensions/vscode run e2e:quick`                                | real VS Code + ChromeDriver validation                                   |
| Release build   | `./deploy/build-extension.sh <version>`                                       | GUI, host, VSIX, packaged-asset gate                                     |

## Current review priorities

1. Remove or rename remaining `continue.*` user-facing identifiers inherited
   from the fork, without breaking compatibility commands deliberately retained.
2. Add focused lifecycle E2E coverage for laptop sleep/resume and workspace
   reconnect.
3. Make GUI full-suite execution resource-stable; the chat tests pass serially
   but can time out under high parallel load.
4. Keep build downloads resilient and verify native artifact provenance.

## Findings format

Record each finding using this structure:

```text
Severity: critical | high | medium | low
Boundary: GUI | protocol | extension host | core | build/release
Evidence: file + line, reproduction, or test output
Impact: user-visible and security/reliability consequence
Fix: smallest safe change
Verification: exact automated/manual test
```
