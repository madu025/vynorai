#!/usr/bin/env bash
# Publish the M365 add-in. The installed Office manifest stays stable while this script publishes
# a fresh build ID in the HTML asset URLs, so reopening a task pane cannot reuse an old bundle.
# Caddy sends no-cache (revalidate), but the versioned URLs protect Excel WebView caches that do not
# immediately honour a changed response at the same URL.
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
BUILD_ID=${VYNOR_M365_BUILD_ID:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}

[[ "$BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "VYNOR_M365_BUILD_ID has unsafe characters" >&2; exit 1; }

(cd "$SRC" && npm run build)
for bundle in taskpane text; do
  [ -f "$SRC/dist/$bundle.bundle.js" ] || { echo "dist/$bundle.bundle.js missing" >&2; exit 1; }
done
[ -f "$SRC/runtime-config.production.js" ] || { echo "runtime-config.production.js missing" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
printf 'window.__VYNOR_M365_BUILD_ID__ = "%s";\n' "$BUILD_ID" > "$STAGE/build-id.js"

SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")
SCP=(scp -i "$KEY" -o BatchMode=yes)

# Upload next to the target first, then rename. Asset bytes go live before the HTML that names
# their build ID, so a task pane cannot receive a page that refers to a missing bundle.
REMOTE_COMMIT=$("${SSH[@]}" "git -C '$REMOTE_DIR' pull -q >/dev/null && git -C '$REMOTE_DIR' rev-parse HEAD && mkdir -p '$REMOTE_DIR/dist'")
SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
[ "$REMOTE_COMMIT" = "$SOURCE_COMMIT" ] || { echo "remote revision $REMOTE_COMMIT does not match local $SOURCE_COMMIT" >&2; exit 1; }
for bundle in taskpane text; do
  "${SCP[@]}" "$SRC/dist/$bundle.bundle.js" "$HOST:$REMOTE_DIR/dist/$bundle.bundle.js.new"
done
"${SCP[@]}" "$SRC/runtime-config.production.js" "$HOST:$REMOTE_DIR/runtime-config.js.new"
"${SCP[@]}" "$STAGE/build-id.js" "$HOST:$REMOTE_DIR/build-id.js.new"
"${SSH[@]}" "cd '$REMOTE_DIR' && mv -f dist/taskpane.bundle.js.new dist/taskpane.bundle.js && mv -f dist/text.bundle.js.new dist/text.bundle.js && mv -f runtime-config.js.new runtime-config.js && mv -f build-id.js.new build-id.js"
echo "Published M365 build $BUILD_ID. The manifest was not changed."
