#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR="$ROOT_DIR/../marin-app-shell"
RUN_BROWSER=0
case "${1:-}" in
  '') ;;
  --browser) RUN_BROWSER=1 ;;
  -h|--help)
    printf 'Usage: bash scripts/check.sh [--browser]\n'
    exit 0
    ;;
  *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
command -v python3 >/dev/null 2>&1 || { printf 'ERROR: Python 3 is required.\n' >&2; exit 1; }

bash -n "$ROOT_DIR/scripts/check.sh"
if [[ -f "$SHELL_DIR/scripts/install.py" ]]; then
  python3 "$SHELL_DIR/scripts/install.py" --check "$ROOT_DIR"
else
  printf 'SKIP: marin-app-shell is not next to this repo; shell integrity was not checked.\n' >&2
fi
# The audit ships with the shell release; use the installed copy so it matches the installed shell.
if [[ -f "$ROOT_DIR/vendor/marinos/audit-buttons.py" ]]; then
  python3 "$ROOT_DIR/vendor/marinos/audit-buttons.py" "$ROOT_DIR" --fail
else
  printf 'SKIP: vendor/marinos/audit-buttons.py is missing (shell older than 1.18.0); the button audit was not run.\n' >&2
fi
# An h1 has one of two sizes (Marin UI 1.41.0); this lists app CSS that sets its own size and must list nothing.
python3 "$ROOT_DIR/vendor/marinos/audit-h1.py" "$ROOT_DIR" --fail
# Card styles come from Marin UI (1.42.0); this lists copies and redrawn card surfaces and must list nothing.
python3 "$ROOT_DIR/vendor/marinos/audit-cards.py" "$ROOT_DIR" --fail
# Every filter column is drawn by the shell from a filters.json that follows the schema; no hand-written filter column.
if [[ -f "$ROOT_DIR/vendor/marinos/audit-filter-column.py" ]]; then
  python3 "$ROOT_DIR/vendor/marinos/audit-filter-column.py" "$ROOT_DIR" --fail
else
  printf 'SKIP: vendor/marinos/audit-filter-column.py is missing (shell older than 2.1.0); the filter column audit was not run.\n' >&2
fi
# Lists copy, download, file reading and upload code the app does itself; it must list nothing.
if [[ -f "$ROOT_DIR/vendor/marinos/audit-shared-helpers.py" ]]; then
  python3 "$ROOT_DIR/vendor/marinos/audit-shared-helpers.py" "$ROOT_DIR" --fail
fi

# The data files copied from marin-data must match it (see marin-data/consumers.json). Skipped when marin-data is not next to this repo.
if [[ -f "$ROOT_DIR/../marin-data/check_copies.py" ]]; then
  python3 "$ROOT_DIR/../marin-data/check_copies.py" "$ROOT_DIR"
else
  printf 'SKIP: marin-data is not next to this repo; its data copies were not compared.\n' >&2
fi
if command -v node >/dev/null 2>&1; then
  node --check "$ROOT_DIR/scripts/build-budget.js"
  node --check "$ROOT_DIR/scripts/build-search.js"
  node --check "$ROOT_DIR/scripts/stamp-css.js"
  node --check "$ROOT_DIR/shared/home-search.js"
  node --check "$ROOT_DIR/shared/chart-links.js"
  node --check "$ROOT_DIR/scripts/budget-shell.js"
  node --check "$ROOT_DIR/scripts/build-budget-2025.js"
  node --check "$ROOT_DIR/scripts/budget-tool.js"
  node --check "$ROOT_DIR/scripts/filter-column.js"
  node --check "$ROOT_DIR/scripts/build-accounting.js"
  node --check "$ROOT_DIR/scripts/build-spending.js"
  node --check "$ROOT_DIR/budget/accounting.js"
  node --check "$ROOT_DIR/shared/display-name.js"
  node --check "$ROOT_DIR/scripts/map-accounting-organizations.js"
  node --check "$ROOT_DIR/scripts/labels.js"
  node --check "$ROOT_DIR/scripts/build-label-review.js"
  node --check "$ROOT_DIR/scripts/budget-2025-org.js"
  node --check "$ROOT_DIR/budget/tool.js"
  node --check "$ROOT_DIR/shared/reports.js"
  node --check "$ROOT_DIR/scripts/build-capital.js"
  node --check "$ROOT_DIR/scripts/build-dashboard.js"
  node --check "$ROOT_DIR/shared/page-data.js"
  node --check "$ROOT_DIR/shared/app-home.js"
  node --check "$ROOT_DIR/shared/gate.js"
  node --check "$ROOT_DIR/capital/projects.js"
  node --check "$ROOT_DIR/scripts/clean-text.js"
  node --check "$ROOT_DIR/scripts/budget-data.js"
  node --test "$ROOT_DIR/tests/clean-text.test.js" "$ROOT_DIR/tests/budget-data.test.js" "$ROOT_DIR/tests/reports.test.js" "$ROOT_DIR/tests/accounting-rollups.test.js" "$ROOT_DIR/tests/accounting-organization-map.test.js" "$ROOT_DIR/tests/display-name.test.js" "$ROOT_DIR/tests/labels.test.js"
  python3 "$ROOT_DIR/tests/test_generated.py"
  python3 "$ROOT_DIR/tests/test_budget_pages.py"
else
  printf 'SKIP: Node is unavailable; the generator and generated pages were not checked.\n' >&2
fi

if [[ "$RUN_BROWSER" == 1 ]]; then
  python3 "$ROOT_DIR/tests/browser_budget.py"
else
  printf 'SKIP: Browser tests not requested; run with --browser to include them.\n'
fi
printf 'Requested checks completed successfully.\n'
