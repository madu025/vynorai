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

## Verification

- Before saying something is fixed, run the relevant check: `npx tsc --noEmit` in `backend`, `core`, `gui`, `extensions/vscode`; `npx tsx --test test/*.test.ts` in `backend`; `npx vitest run <path>` in `core` and `gui`.
- Release build: `./deploy/build-extension.sh x.y.z`, then `./deploy/release-extension.sh <vsix> "<notes>"`. Backend deploy: push, then `./deploy/rolling-deploy.sh` on the VPS.
