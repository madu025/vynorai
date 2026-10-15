#!/usr/bin/env bash
# Publish the M365 add-in. The VPS already has the tracked files (taskpane.html, manifest, ...)
# through `git pull`; this uploads only the build output that git ignores. The manifest is never
# touched: users already have it, and everything else is fetched fresh each time the task pane
# opens (Caddy sends no-store).
#
#   VYNOR_M365_DIR=/opt/vynor/extensions/m365 ./deploy/publish-m365.sh
#
# VYNOR_HOST / VYNOR_KEY follow deploy/release-extension.sh. Run it only after approval.
set -euo pipefail

HOST=${VYNOR_HOST:-root@207.58.175.40}
KEY=${VYNOR_KEY:-$HOME/.ssh/vynor_vps}
REMOTE_DIR=${VYNOR_M365_DIR:?set VYNOR_M365_DIR to the VPS extensions/m365 directory}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/extensions/m365"

(cd "$SRC" && npm run build)
for bundle in taskpane text; do
  [ -f "$SRC/dist/$bundle.bundle.js" ] || { echo "dist/$bundle.bundle.js missing" >&2; exit 1; }
done
[ -f "$SRC/runtime-config.production.js" ] || { echo "runtime-config.production.js missing" >&2; exit 1; }

SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")
SCP=(scp -i "$KEY" -o BatchMode=yes)

# Upload next to the target first, then rename, so a half-copied bundle is never served.
"${SSH[@]}" "git -C '$REMOTE_DIR' pull -q && mkdir -p '$REMOTE_DIR/dist'"
for bundle in taskpane text; do
  "${SCP[@]}" "$SRC/dist/$bundle.bundle.js" "$HOST:$REMOTE_DIR/dist/$bundle.bundle.js.new"
done
"${SCP[@]}" "$SRC/runtime-config.production.js" "$HOST:$REMOTE_DIR/runtime-config.js.new"
"${SSH[@]}" "cd '$REMOTE_DIR' && mv -f dist/taskpane.bundle.js.new dist/taskpane.bundle.js && mv -f dist/text.bundle.js.new dist/text.bundle.js && mv -f runtime-config.js.new runtime-config.js"
echo "Published add-in build output. The manifest was not changed."
