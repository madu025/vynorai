#!/usr/bin/env bash
set -euo pipefail

# Stage only the VSIX whose version exactly matches package.json. Selecting by
# modification time previously allowed a stale Continue/VynorAI artifact to be
# tested while the source tree contained a newer fix.
node ./scripts/sync-vsix.js --stage
