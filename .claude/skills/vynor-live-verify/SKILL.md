---
name: vynor-live-verify
description: Verify a VynorAI extension change in a real VS Code (build the VSIX, install it into the isolated E2E profile, run the E2E tests, read the extension-host logs, optionally run the real-DeepSeek audit). Use before any release and whenever "it works" needs live evidence instead of unit tests.
---

# Live verification of the VynorAI extension

Unit tests and `tsc` are not proof that the extension works in an IDE. Use this
procedure and report what was seen in the real VS Code, and what was NOT verified.

## 1. Build the VSIX

`./deploy/build-extension.sh X.Y.Z` (runs GUI/core tests, builds the GUI, packages, hash-checks the GUI).
Check the package really contains new code: `unzip -p extensions/vscode/build/vynorai-X.Y.Z.vsix extension/out/extension.js | grep -c "<a string from the change>"`.
A VSIX built before a change does not contain it. If a command is "No results" in E2E, suspect a stale build first.

## 2. Install into the isolated E2E profile (never into the user's own IDEs)

Use PowerShell (bash quoting breaks on backticks and paths with spaces):

```
$env:ELECTRON_RUN_AS_NODE=$null
& ".\e2e\storage\VSCode-win32-x64-archive\bin\code.cmd" --install-extension ".\build\vynorai-X.Y.Z.vsix" --force --extensions-dir ".\e2e\.test-extensions" --user-data-dir ".\e2e\storage\settings-cli"
```

Then remove the previous version folder and write the canonical marker with Node (no BOM, so not PowerShell `Set-Content`):
`fs.rmSync("e2e/.test-extensions/vynorai.vynorai-<old>",{recursive:true,force:true})`, and write
`e2e/.test-extensions/.vynor-canonical-vsix.json` = `{extension:"VynorAI.vynorai",version,file,sha256}`.
(`run-e2e.js` refuses to run if the marker, version or sha256 do not match the VSIX.)

## 3. Run the E2E tests: one test file per VS Code session

Set `ELECTRON_RUN_AS_NODE=$null` (if it is set, Code.exe starts as plain Node and exits), `NODE_ENV=e2e`,
`CONTINUE_GLOBAL_DIR=e2e/test-continue` (the script makes it absolute; a relative path breaks activation),
`TEST_FILE=./e2e/_output/tests/<Name>.test.js`, then `node scripts/run-e2e.js`.
Run `npm run e2e:compile` first when e2e `.ts` changed. Kill stale `Code.exe`/`chromedriver.exe` between runs.
Run long jobs in the background, write output to a file in the scratchpad, read it when the task completes.
Tests that share one VS Code session interfere with each other (workspace reload): run `VynorOnlyUI`, `VSIXLifecycle`, `SlashCommands` separately.

## 4. Read the extension-host logs

`extensions/vscode/e2e/storage/settings/logs/<latest>/window1/exthost/exthost.log` and neighbours.

- Look for `Error retrieving embeddings`, `[error]` lines from the Extension Host, `Activating extension ... failed`.
- `[UtilityProcessWorker] terminated unexpectedly` right after `Extension host ... exited with code: 0` is harness shutdown noise, not a crash.
- msecnd.net network errors and "YAML extension is not installed" are harness noise.
- Trace logging: launch `Code.exe` directly with `--log trace` and QUOTED path arguments (an unquoted `--user-data-dir` with a space is cut at "D:\My").

## 5. Real-model checks (need a key; never write it to a file or print it)

The key comes only from the environment: `VYNORAI_E2E_API_KEY`. Rotate any key that was pasted into a chat.

- `node backend/scripts/live-audit.mjs 3` in `backend`: production proxy + real DeepSeek + read-only tools over a docs/core fixture; scores false "file is missing" claims, invented paths, and a final answer within 14 turns (~350K tokens per run).
- UI route (`Smart.audit.test.ts`) still stalls in the harness: the status bar shows the account (signed in) but the chat panel stays on "Loading". Do not claim it passes.

## Report

Per test: PASS/FAIL with the evidence (output text or log line), the version tested, and what was not verified.
