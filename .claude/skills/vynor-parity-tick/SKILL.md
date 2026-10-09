---
name: vynor-parity-tick
description: Make VynorAI match the Claude Code extension one verified gap at a time, without downgrading anything. Use for the parity loop or any "improve VynorAI like Claude Code" task.
---

# Parity tick

Source of truth: `docs/CLAUDE_CODE_PARITY.md` (matrix of Claude Code behaviour vs VynorAI, gap size, priority, status).
Research notes: `research_notes/Claude Code parity/` (local, not committed).

## One tick = one gap

1. Pick the highest-priority open gap. Re-read the VynorAI code before editing; the matrix line numbers are survey-reported.
2. Record a baseline: tsc error counts (`backend`, `core`, `gui`, `extensions/vscode`), backend tests pass count, vitest counts for the files you will touch.
3. Smallest complete change, with tests for the new behaviour and a regression test. Match surrounding style.
4. Re-run the same checks. Never below baseline.
5. Update the gap row with evidence (files, tests, commands).

## Never downgrade

No removal, disabling, narrowing or simplifying of features, commands, settings, UI or protocol messages. Do not delete, skip
or loosen tests; do not lower limits, context sizes, model quality, thinking level, retrieval depth or safety checks. Do not
move to a cheaper model. If a change would reduce a capability, stop and report. Do not edit a test's mocks or assertions
to make a failure disappear: fix the code (for example, put new exports where the existing mocks do not hide them).

## Evidence, not claims

Unit tests do not show that a feature works in an IDE. End every tick with the steps the user can follow in their own IDE
(for example `/status`, `/memory`, the Approve button in Plan mode) and say what was NOT verified live. Use the
`vynor-live-verify` skill when a feature should be seen in a real VS Code.

## Limits

Local working tree only unless the user said otherwise: no push, deploy, publish, ssh; no `.env`, API keys or `~/.vynorai` edits.
Answer the user in Sinhala; code, commands and paths stay in English.
