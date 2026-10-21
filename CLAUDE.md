# CLAUDE.md

Rules for Claude working in this repository.

## Language

- Answer the user in Sinhala (සිංහල අක්ෂර), in simple and clear language.
- Keep code, commands, file paths, identifiers, error messages, commit messages and PR text in English.
- If the user writes Singlish (Sinhala in English letters), still reply in Sinhala script.

## Working style

- Own engineering end to end. When the user gives a goal or says to follow the recommendation, choose the best option, do the work, and report. Avoid repeated questions and option menus.
- `git push` to the session's working branch is automatic, but only when the work is fixed and verified: every relevant check in "Verification" below (and `node scripts/check-doc-links.mjs`) passed after the last change, and the working tree holds nothing unfinished. If any check fails or was not run, do not push; say what is missing. Never force-push, and never push to `main` or another branch without asking.
- Ask before extension publish, backend deploy, or any production change that was not explicitly requested.
- Never bypass a denied permission or a safety check. Never print or commit secrets (`.env`, API keys).
- Exception, the testing-account key: the owner allows the key of the VynorAI testing account to be used for any test (E2E, benchmark, live audit), including when it was given in chat. It is kept in the git-ignored file `.env.e2e` at the root as `VYNORAI_E2E_API_KEY`; the test command loads it from there (for example `node --env-file=.env.e2e ...`) without the file being opened or echoed. It is still never committed and never written into a tracked file, a log or a report. This exception covers no other key.
- Report results honestly: say what was verified (with evidence) and what was not. Do not claim something works without running it.

## Existing product, and its index

- VynorAI is built and released. Extend what exists: search and read `CODEMAP.md` before writing a new module, and never rebuild a subsystem without asking. `AGENTS.md` has the same rules for other AI agents and a table of what already exists.
- When you add, move, rename or remove a module, update `CODEMAP.md` (and the table in `AGENTS.md` if a capability moved) in the same commit. Run `node scripts/check-doc-links.mjs` from the root before committing.

## Fixed decisions

- Before answering or changing anything about the database, caches, context limits or plans, read `docs/ARCHITECTURE_DECISIONS.md`. Do not re-derive these from memory; they are the same in every session.
- If you change one of those decisions, update that file in the same commit. If code and the file disagree, say so and fix the file.

## Token and context discipline

- Search before reading: Grep/Glob first, then Read with `offset`/`limit`. Do not read whole large files, lockfiles, build output or logs; filter long command output (`| tail`, `| grep`) or redirect it to a file.
- Run long jobs (build, E2E, full suites) in the background with output in a file; read only the failing part.
- Delegate wide searches to a subagent so the file dumps stay out of the main context; keep only its conclusion.
- Do not re-read a file just edited, and do not re-derive facts already established in the session.
- Anything that goes into a model prompt must keep the prompt prefix stable: see the `vynor-prompt-cache` skill.

## Project skills

- `vynor-live-verify`: real-IDE E2E and live-audit evidence. `vynor-postgres-check`: backend SQL on real PostgreSQL. `vynor-prompt-cache`: prompt prefix stability. `vynor-windows-shell`: shell and quoting pitfalls. `vynor-excel-agent`: M365 Excel add-in and agent changes, gates and past bugs. `vynor-release`, `vynor-review-fix`, `vynor-parity-tick`, `docs-style`: see each skill.

## Verification

- Before saying something is fixed, run the relevant check: `npx tsc --noEmit` in `backend`, `core`, `gui`, `extensions/vscode`; `npx tsx --test test/*.test.ts` in `backend`; `npx vitest run <path>` in `core` and `gui`.
- Release build: `./deploy/build-extension.sh x.y.z`, then `./deploy/release-extension.sh <vsix> "<notes>"`. Backend deploy: push, then `./deploy/rolling-deploy.sh` on the VPS.
