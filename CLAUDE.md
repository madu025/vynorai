# CLAUDE.md

Rules for Claude working in this repository.

## Language

- Answer the user in Sinhala (සිංහල අක්ෂර), in simple and clear language.
- Keep code, commands, file paths, identifiers, error messages, commit messages and PR text in English.
- If the user writes Singlish (Sinhala in English letters), still reply in Sinhala script.

## Working style

- Own engineering end to end. When the user gives a goal or says to follow the recommendation, choose the best option, do the work, and report. Avoid repeated questions and option menus.
- Ask before `git push`, extension publish, backend deploy, or any production change that was not explicitly requested.
- Never bypass a denied permission or a safety check. Never print or commit secrets (`.env`, API keys).
- Report results honestly: say what was verified (with evidence) and what was not. Do not claim something works without running it.

## Token and context discipline

- Search before reading: Grep/Glob first, then Read with `offset`/`limit`. Do not read whole large files, lockfiles, build output or logs; filter long command output (`| tail`, `| grep`) or redirect it to a file.
- Run long jobs (build, E2E, full suites) in the background with output in a file; read only the failing part.
- Delegate wide searches to a subagent so the file dumps stay out of the main context; keep only its conclusion.
- Do not re-read a file just edited, and do not re-derive facts already established in the session.
- Anything that goes into a model prompt must keep the prompt prefix stable: see the `vynor-prompt-cache` skill.

## Project skills

- `vynor-live-verify`: real-IDE E2E and live-audit evidence. `vynor-postgres-check`: backend SQL on real PostgreSQL. `vynor-prompt-cache`: prompt prefix stability. `vynor-windows-shell`: shell and quoting pitfalls. `vynor-release`, `vynor-review-fix`, `vynor-parity-tick`, `docs-style`: see each skill.

## Verification

- Before saying something is fixed, run the relevant check: `npx tsc --noEmit` in `backend`, `core`, `gui`, `extensions/vscode`; `npx tsx --test test/*.test.ts` in `backend`; `npx vitest run <path>` in `core` and `gui`.
- Release build: `./deploy/build-extension.sh x.y.z`, then `./deploy/release-extension.sh <vsix> "<notes>"`. Backend deploy: push, then `./deploy/rolling-deploy.sh` on the VPS.
