---
name: vynor-release
description: Release VynorAI safely: gates, commit, push, backend deploy, extension publish and post-publish checks. Use when asked to push, deploy, build for users or publish an extension version.
---

# VynorAI release

Releasing is outward-facing. The updater installs new versions on users' machines automatically
(15-minute checks, no prompt), so a bad VSIX reaches everyone. Never publish a build that was not verified live.

## Gates (all must pass; report any that were not run)

1. `npx tsc --noEmit` in `backend`, `core`, `gui`, `extensions/vscode`: 0 errors.
2. Unit tests for what changed: `backend` (`npm test`), `core` and `gui` (`npx vitest run <paths>`).
   Known, not caused by your change: backend "Negative Margin Prevention" fails during DeepSeek peak hours (01-04 UTC) because the pricing math depends on the clock; `LocalPlatformClient` "Hook timed out" is flaky; Windows file:// URI tests in core `tools` fail on Windows.
3. Live verification of the built VSIX (see the `vynor-live-verify` skill): `VynorOnlyUI`, `VSIXLifecycle`, `SlashCommands` pass and the host log has no new errors.

## Steps

1. Commit only source, tests and docs. Keep local files out (`.claude/settings.local.json`, `reports/`, `research_notes/`, `e2e/storage`). Commit message ends with the attribution line from the session.
2. `git push origin main` (ask first if the user did not say to push).
3. Backend deploy only if `backend/` changed: `ssh -i ~/.ssh/vynor_vps root@207.58.175.40 "cd /opt/vynor && ./deploy/rolling-deploy.sh"`.
   Then `curl https://vynor.lk/ready` and `/health` must return 200 and both workers `healthy`.
4. Build: `./deploy/build-extension.sh X.Y.Z` (bumps `extensions/vscode/package.json`; commit that bump).
5. Publish: `./deploy/release-extension.sh extensions/vscode/build/vynorai-X.Y.Z.vsix "<notes>"`.
6. Verify: `curl https://vynor.lk/api/extension/latest` shows the new version and sha256; `curl -o /dev/null -w "%{size_download}" https://vynor.lk/download/vynorai-X.Y.Z.vsix` equals the local file size.

## Rules

- Do not bypass a denied permission. If the build script is denied, say so and let the user add a rule or run it.
- Never print or commit API keys, `.env`, or the VPS key. Tell the user to rotate a key that appeared in chat.
- Tell the user what to do on their machines: IDEs on 1.2.39 need one manual "Update"; newer ones update themselves.
