#!/usr/bin/env bash
# Publish the M365 add-in static files. The manifest is never touched: users already have it,
# and everything else is fetched fresh each time the task pane opens (Caddy sends no-store).
#
#   VYNOR_M365_DIR=/path/on/vps/extensions/m365 ./deploy/publish-m365.sh
#
# VYNOR_HOST / VYNOR_KEY follow deploy/release-extension.sh. Run it only after approval.
set -euo pipefail

HOST=${VYNOR_HOST:-root@207.58.175.40}
KEY=${VYNOR_KEY:-$HOME/.ssh/vynor_vps}
REMOTE_DIR=${VYNOR_M365_DIR:?set VYNOR_M365_DIR to the VPS extensions/m365 directory}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/extensions/m365"

(cd "$SRC" && npm run build)
[ -f "$SRC/runtime-config.production.js" ] || { echo "runtime-config.production.js missing" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/dist"
cp "$SRC/taskpane.html" "$SRC/auth-dialog.html" "$SRC/auth-callback.html" "$TMP/"
cp "$SRC/dist/taskpane.bundle.js" "$TMP/dist/"
cp "$SRC/runtime-config.production.js" "$TMP/runtime-config.js"
[ -f "$SRC/logo.png" ] && cp "$SRC/logo.png" "$TMP/"

# Upload everything first, then move into place, so a half-copied pane is never served.
STAGE="$REMOTE_DIR/.staging-$$"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "rm -rf '$STAGE' && mkdir -p '$STAGE'"
scp -i "$KEY" -o BatchMode=yes -r "$TMP"/. "$HOST:$STAGE/"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "cd '$STAGE' && mkdir -p '$REMOTE_DIR/dist' && cp -f dist/taskpane.bundle.js '$REMOTE_DIR/dist/' && for f in *.html *.js *.png; do [ -f \"\$f\" ] && cp -f \"\$f\" '$REMOTE_DIR/'; done; rm -rf '$STAGE'"
echo "Published add-in files. The manifest was not changed."
