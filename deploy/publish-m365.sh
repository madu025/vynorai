#!/usr/bin/env bash
# Publish the M365 add-in. The installed Office manifest stays stable while this script publishes
# a fresh build, so reopening a task pane cannot reuse an old bundle.
#
# The pane's build id is written in taskpane.html (loader, <link> hints and the "Build" line in the
# menu) and travels with the git checkout on the VPS; pane.css, the bundle and its chunks are cached
# for a year under ?v=<that id>. Caddy sends no-cache for everything else.
#
#   VYNOR_M365_DIR=/opt/vynor/extensions/m365 ./deploy/publish-m365.sh
#
# VYNOR_HOST / VYNOR_KEY follow deploy/release-extension.sh. Run it only after approval.
# Keep this script LF-terminated: it is commonly invoked from Git Bash on Windows as well as Linux.
# VYNOR_M365_URL (default https://vynor.lk/m365) is used for the cache warm-up after publishing.
set -euo pipefail

HOST=${VYNOR_HOST:-root@207.58.175.40}
KEY=${VYNOR_KEY:-$HOME/.ssh/vynor_vps}
REMOTE_DIR=${VYNOR_M365_DIR:?set VYNOR_M365_DIR to the VPS extensions/m365 directory}
PUBLIC_URL=${VYNOR_M365_URL:-https://vynor.lk/m365}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/extensions/m365"
BUILD_ID=${VYNOR_M365_BUILD_ID:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}

[[ "$BUILD_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "VYNOR_M365_BUILD_ID has unsafe characters" >&2; exit 1; }

# The bundle URL carries the build id and is cached for a year: a build from uncommitted changes
# would keep the same URL with different bytes. Publish only what is committed.
if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no -- extensions/m365 ':!extensions/m365/dist')" ]; then
  echo "extensions/m365 has uncommitted changes; commit them first (the build id is the commit)" >&2
  exit 1
fi

# The pane build id: one value in the loader, the head links and the menu line (a unit test keeps
# them equal). It must change whenever the bundle or pane.css changes.
PANE_ID=$(grep -o 'var BUILD = "[^"]*"' "$SRC/taskpane.html" | head -1 | sed 's/.*"\(.*\)"/\1/')
[[ "$PANE_ID" =~ ^[0-9]{8}\.[0-9]+$ ]] || { echo "could not read the pane build id from taskpane.html" >&2; exit 1; }

if [ "${VYNOR_M365_SKIP_BUILD:-0}" = "1" ]; then
  echo "Skipping M365 build; using the already-built dist artifacts"
else
  (cd "$SRC" && npm run build)
fi
for file in dist/taskpane.bundle.js dist/text.bundle.js pane.css runtime-config.production.js; do
  [ -f "$SRC/$file" ] || { echo "$file missing" >&2; exit 1; }
done
[ -d "$SRC/dist/chunks" ] || { echo "dist/chunks missing" >&2; exit 1; }

# Fingerprint of everything cached under the pane build id (runtime-config.js is served immutable
# under ?v= too). If the id was published before with different bytes, stop: browsers and Cloudflare
# would keep serving the old copy.
PANE_HASH=$(cd "$SRC" && { cat dist/taskpane.bundle.js pane.css runtime-config.production.js; find dist/chunks -type f | LC_ALL=C sort | xargs cat; } | sha256sum | cut -d' ' -f1)

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
printf 'window.__VYNOR_M365_BUILD_ID__ = "%s";\n' "$BUILD_ID" > "$STAGE/build-id.js"
printf '%s %s\n' "$PANE_ID" "$PANE_HASH" > "$STAGE/pane-build.txt"

SSH=(ssh -i "$KEY" -o BatchMode=yes "$HOST")
SCP=(scp -i "$KEY" -o BatchMode=yes)

PRIOR=$("${SSH[@]}" "cat '$REMOTE_DIR/pane-build.txt' 2>/dev/null || true")
if [ -n "$PRIOR" ] && [ "${PRIOR%% *}" = "$PANE_ID" ] && [ "${PRIOR##* }" != "$PANE_HASH" ]; then
  echo "pane build $PANE_ID was already published with different files; bump the Build id in taskpane.html (loader, head links, menu line) and commit" >&2
  exit 1
fi

# Upload next to the target first, then rename. Asset bytes go live before the HTML that names
# their build ID, so a task pane cannot receive a page that refers to a missing bundle.
# Chunk names carry a content hash, so they are added beside the old ones (panes still open on the
# previous build keep working); chunks older than 30 days are removed.
"${SSH[@]}" "mkdir -p '$REMOTE_DIR/dist/chunks'"
"${SCP[@]}" "$SRC"/dist/chunks/*.js "$HOST:$REMOTE_DIR/dist/chunks/"
for bundle in taskpane text; do
  "${SCP[@]}" "$SRC/dist/$bundle.bundle.js" "$HOST:$REMOTE_DIR/dist/$bundle.bundle.js.new"
done
"${SCP[@]}" "$SRC/runtime-config.production.js" "$HOST:$REMOTE_DIR/runtime-config.js.new"
"${SCP[@]}" "$STAGE/build-id.js" "$HOST:$REMOTE_DIR/build-id.js.new"
"${SCP[@]}" "$STAGE/pane-build.txt" "$HOST:$REMOTE_DIR/pane-build.txt.new"

# Fetch (do not change the checkout yet) and check the server would end up on this commit.
SOURCE_COMMIT=$(git -C "$ROOT" rev-parse HEAD)
REMOTE_COMMIT=$("${SSH[@]}" "git -C '$REMOTE_DIR' fetch -q >/dev/null && git -C '$REMOTE_DIR' rev-parse '@{u}'")
[ "$REMOTE_COMMIT" = "$SOURCE_COMMIT" ] || { echo "remote revision $REMOTE_COMMIT does not match local $SOURCE_COMMIT" >&2; exit 1; }
# One remote step, assets BEFORE pages: the bundle, chunks and runtime-config are renamed into place
# first and taskpane.html + pane.css (git) change last. A pane that still holds the old page and asks
# for the old id in that instant can only get new bytes cached under the OLD id, which nothing asks
# for afterwards; the other order could cache OLD bytes under the NEW id for a year.
"${SSH[@]}" "cd '$REMOTE_DIR' && mv -f dist/taskpane.bundle.js.new dist/taskpane.bundle.js && mv -f dist/text.bundle.js.new dist/text.bundle.js && mv -f runtime-config.js.new runtime-config.js && mv -f build-id.js.new build-id.js && git merge -q --ff-only '@{u}' && mv -f pane-build.txt.new pane-build.txt && find dist/chunks -type f -mtime +30 -delete"
[ "$("${SSH[@]}" "git -C '$REMOTE_DIR' rev-parse HEAD")" = "$SOURCE_COMMIT" ] || { echo "server checkout is not at $SOURCE_COMMIT after the update" >&2; exit 1; }
echo "Published M365 build $BUILD_ID (pane $PANE_ID). The manifest was not changed."

# Warm the edge: the first open of a build otherwise pays for the origin round trip. Failures are
# reported but never fail the publish.
warm() {
  if curl -fsS -o /dev/null --max-time 30 "$1"; then echo "warmed $1"; else echo "warning: could not warm $1" >&2; fi
}
warm "$PUBLIC_URL/taskpane.html"
warm "$PUBLIC_URL/pane.css?v=$PANE_ID"
warm "$PUBLIC_URL/runtime-config.js?v=$PANE_ID"
warm "$PUBLIC_URL/dist/taskpane.bundle.js?v=$PANE_ID"
for chunk in "$SRC"/dist/chunks/*.js; do
  warm "$PUBLIC_URL/dist/chunks/$(basename "$chunk")"
done
