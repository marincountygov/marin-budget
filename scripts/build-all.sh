#!/usr/bin/env bash
# Rebuilds every page from the data in marin-data/output (or the folder given as the first argument).
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SRC=${1:-"$ROOT/../marin-data/output"}
[[ -d "$SRC" ]] || { printf 'ERROR: %s not found. Clone marin-data next to this repo or pass the folder.\n' "$SRC" >&2; exit 1; }
mkdir -p "$ROOT/data"
cp "$SRC/organizations.jsonld" "$SRC/programs.jsonld" "$ROOT/data/"
cd "$ROOT"
# The accounting data is local until it is decided it can be public: its rollups and its page are built where the data is.
if [[ -f data/accounting/meta.json && -f coa-schemagov-json/marin-accounting-dimensions.json ]]; then
  node scripts/build-accounting.js > /dev/null
  node scripts/build-label-review.js > /dev/null
  node scripts/build-spending.js
fi
node scripts/build-budget.js "$SRC"
node scripts/build-budget-2025.js "$SRC"
node scripts/build-capital.js "$SRC/cip"
python3 scripts/build_contracts_view.py
node scripts/build-contracts.js
node scripts/build-reports.js
node scripts/build-data.js
node scripts/build-search.js > /dev/null
node scripts/build-dashboard.js
# The shell reads marin.yml next to the page for the app's status and audience, so every folder of pages has a copy.
for dir in budget budget/fy2025-26 budget/accounting budget/accounting/departments budget/funds capital capital/projects contracts contracts/vendors contracts/c reports data; do [[ -d "$dir" ]] && cp marin.yml "$dir/marin.yml"; done
# The imports of every stylesheet carry the stamp, so a changed style is read at once.
node scripts/stamp-css.js
