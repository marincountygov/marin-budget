# Working on this Marin application

## Architecture

This is a static, zero-build MarinOS docs-shell application. It uses the MarinOS App Shell (installed with `marin-app-shell/scripts/install.sh`, version recorded in `platform.shell` in `marin.yml`) and follows `marin-digital-standards`. See `marin.yml` for this project's owner, status, and platform versions.

The pages are generated from marin-data by `scripts/build-all.sh`; do not edit `index.html`, `budget/` or `capital/` pages by hand. The Dashboard (`index.html`) is a tight look at each tab with a link to it, like an organization page's Dashboard in marin-docs.

## Before making changes

1. Check `marin-ui/docs/components.md` for an existing pattern before writing new CSS or JS.
2. Prefer existing semantic tokens over raw values.
3. Keep the default view immediately functional; there is no intro text above the content.
4. Do not use "view" in button or link text.

## Before finishing

Run `bash scripts/build-all.sh` if a generator or the data changed, then `bash scripts/check.sh`. Then check the pages in a browser: keyboard operation, narrow layout, light and dark.

## References

- `marin-data`: the extractors and the data these pages are built from
- `marin-docs`: organization, service area and program pages, which carry the Budget tab: https://github.com/marincountygov/marin-docs
- `marin-ui`, `marin-digital-standards`, `marin-skills`, `marin-os`: https://github.com/marincountygov
