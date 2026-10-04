#!/usr/bin/env bash
# Publish an extension build on vynor.lk (no marketplace needed).
#
#   ./deploy/release-extension.sh extensions/vscode/build/vynorai-1.2.15.vsix "Short release notes"
#
# Uploads the .vsix to /opt/vynor/releases on the VPS and rewrites
# latest.json, which /api/extension/latest serves to the in-extension
# updater and the /download page. Keeps the 5 newest builds.
set -euo pipefail

VSIX=${1:?usage: release-extension.sh path/to/vynorai-x.y.z.vsix "notes"}
NOTES=${2:-}
HOST=${VYNOR_HOST:-root@207.58.175.40}
KEY=${VYNOR_KEY:-$HOME/.ssh/vynor_vps}

FILE=$(basename "$VSIX")
[[ "$FILE" =~ ^vynorai-([0-9]+\.[0-9]+\.[0-9]+)\.vsix$ ]] || { echo "File must be named vynorai-x.y.z.vsix" >&2; exit 1; }
VERSION=${BASH_REMATCH[1]}
SHA=$(sha256sum "$VSIX" | cut -d' ' -f1)
SIZE=$(wc -c < "$VSIX" | tr -d ' ')
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LATEST=$(python -c 'import json,sys; print(json.dumps({"version":sys.argv[1],"file":sys.argv[2],"sha256":sys.argv[3],"size":int(sys.argv[4]),"notes":sys.argv[5],"publishedAt":sys.argv[6]}))' \
  "$VERSION" "$FILE" "$SHA" "$SIZE" "$NOTES" "$NOW")

ssh -i "$KEY" -o BatchMode=yes "$HOST" "mkdir -p /opt/vynor/releases"
scp -q -i "$KEY" -o BatchMode=yes "$VSIX" "$HOST:/opt/vynor/releases/$FILE.part"
ssh -i "$KEY" -o BatchMode=yes "$HOST" bash -s <<REMOTE
set -e
cd /opt/vynor/releases
echo "$SHA  $FILE.part" | sha256sum -c --quiet
mv "$FILE.part" "$FILE"
cat > latest.json.tmp <<'JSON'
$LATEST
JSON
mv latest.json.tmp latest.json
ls -1t vynorai-*.vsix | tail -n +6 | xargs -r rm -f
REMOTE
echo "Published VynorAI $VERSION ($SIZE bytes, sha256 $SHA)"
