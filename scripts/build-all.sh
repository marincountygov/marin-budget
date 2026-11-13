#!/usr/bin/env bash
# Rebuilds every page from the data in marin-data/output (or the folder given as the first argument).
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SRC=${1:-"$ROOT/../marin-data/output"}
[[ -d "$SRC" ]] || { printf 'ERROR: %s not found. Clone marin-data next to this repo or pass the folder.\n' "$SRC" >&2; exit 1; }
mkdir -p "$ROOT/data"
cp "$SRC/organizations.jsonld" "$SRC/programs.jsonld" "$ROOT/data/"
cd "$ROOT"
node scripts/build-budget.js "$SRC"
node scripts/build-budget-2025.js "$SRC"
node scripts/build-capital.js "$SRC/cip"
node scripts/build-dashboard.js
# The shell reads marin.yml next to the page for the app's status and audience, so every folder of pages has a copy.
for dir in budget budget/fy2025-26 budget/funds capital capital/projects; do cp marin.yml "$dir/marin.yml"; done
