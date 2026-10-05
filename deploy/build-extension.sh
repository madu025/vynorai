#!/usr/bin/env bash
# Full extension build: GUI (chat panel) + extension host + .vsix.
# Building only the extension host ships a stale chat panel, so always use
# this script.   ./deploy/build-extension.sh 1.2.17
set -euo pipefail
VERSION=${1:?usage: build-extension.sh x.y.z}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Release gate: the chat panel and agent runtime tests must pass before a
# build ships (SKIP_TESTS=1 to bypass in an emergency).
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  (cd "$ROOT/gui" && npx vitest run >/tmp/vynor-gui-tests.log 2>&1) \
    || { grep -E "FAIL|Tests " /tmp/vynor-gui-tests.log | head -20; echo "GUI tests failed; not building." >&2; exit 1; }
  (cd "$ROOT/core" && npx vitest run agent tools/browser >/tmp/vynor-core-tests.log 2>&1) \
    || { grep -E "FAIL|Tests " /tmp/vynor-core-tests.log | head -20; echo "Core agent tests failed; not building." >&2; exit 1; }
fi

(cd "$ROOT/gui" && npm run build >/tmp/vynor-gui-build.log 2>&1) || { tail -20 /tmp/vynor-gui-build.log; exit 1; }
rm -rf "$ROOT/extensions/vscode/gui/assets"
mkdir -p "$ROOT/extensions/vscode/gui"
cp -r "$ROOT/gui/dist/." "$ROOT/extensions/vscode/gui/"

cd "$ROOT/extensions/vscode"
sed -i -E "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$VERSION\"/" package.json
npm run esbuild >/tmp/vynor-esbuild.log 2>&1 || { tail -20 /tmp/vynor-esbuild.log; exit 1; }
npm run package >/tmp/vynor-package.log 2>&1 || { tail -20 /tmp/vynor-package.log; exit 1; }

VSIX="build/vynorai-$VERSION.vsix"
# Guard: the packaged chat panel must be this build's GUI.
hits=$(unzip -p "$VSIX" extension/gui/assets/index.js | grep -c "Agent Permissions" || true)
[ "${hits:-0}" -gt 0 ] ||{ echo "Packaged GUI is stale (no 'Agent Permissions' in index.js)" >&2; exit 1; }
echo "Built $ROOT/extensions/vscode/$VSIX"
