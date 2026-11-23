"""Checks the generated pages: language, title, one h1, local links and files, the tabs, and that each chart agrees with its table."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTING = (ROOT / "budget/accounting/index.html").exists()  # the financial-system pages are built only where its data is


def present(*rels):
    return tuple(r for r in rels if (ROOT / r).exists())


BUDGET_TABS = ["Budget and spending", "Budget books"] if (ROOT / "data/accounting/rollups/index.json").exists() else ["Budget"]
PAGES = sorted([ROOT / "index.html", *(ROOT / "budget").rglob("*.html"), *(ROOT / "capital").rglob("*.html"), *(ROOT / "contracts").rglob("*.html"), *(ROOT / "reports").rglob("*.html")])


def attr_values(html: str, name: str):
    return re.findall(rf'\b{name}="([^"]*)"', html)


class PageTests(unittest.TestCase):
    def test_pages_found(self):
        self.assertGreaterEqual(len(PAGES), 1900)

    def test_every_page_has_language_title_and_one_h1(self):
        for page in PAGES:
            text = page.read_text(encoding="utf-8")
            rel = page.relative_to(ROOT)
            self.assertIn('<html lang="en">', text, rel)
            self.assertRegex(text, r"<title>[^<]+ \| Marin Budget</title>", rel)
            self.assertEqual(len(re.findall(r"<h1[ >]", text)), 1, rel)

    def test_local_links_and_files_exist(self):
        for page in PAGES:
            text = page.read_text(encoding="utf-8")
            for value in attr_values(text, "href") + attr_values(text, "src") + attr_values(text, "data-chart-lib"):
                url = urlparse(value.replace("&amp;", "&"))
                if url.scheme or value.startswith(("#", "?", "data:", "mailto:")) or not url.path:
                    continue
                target = (page.parent / unquote(url.path)).resolve()
                self.assertTrue(target.exists(), f"{page.relative_to(ROOT)}: {value}")

    def test_no_link_to_a_moved_docs_path(self):
        # Organization, service area and program pages are in Marin Docs; the links are absolute.
        for page in PAGES:
            text = page.read_text(encoding="utf-8")
            self.assertNotRegex(text, r'href="(\.\./)+(organization|service-areas|programs)/', page.relative_to(ROOT))

    def test_app_icon_is_banknote(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('<rect width="20" height="12" x="2" y="6" rx="2"/>', text)

    def test_every_page_is_behind_the_login_screen(self):
        # shared/gate.js comes first in the head, before the shell, so nothing shows until the password is entered.
        for page in PAGES:
            text = page.read_text(encoding="utf-8")
            rel = page.relative_to(ROOT)
            self.assertEqual(text.count("shared/gate.js"), 1, rel)
            self.assertLess(text.index("shared/gate.js"), text.index("vendor/marinos/marinos.js"), rel)
        gate = (ROOT / "shared" / "gate.js").read_text(encoding="utf-8")
        self.assertNotIn("marincounty", gate)  # only a hash of the password is kept

    def test_every_page_uses_the_app_shell(self):
        # The header, About / Security / Accessibility / Updates, footer and feedback are the shell's, as in the other apps.
        for page in PAGES:
            text = page.read_text(encoding="utf-8")
            rel = page.relative_to(ROOT)
            self.assertIn('<marin-app-header app-name="Marin Budget"', text, rel)
            self.assertIn('<marin-app-info app-name="Marin Budget" repo="marin-budget"', text, rel)
            self.assertIn('<marin-app-footer app-name="Marin Budget"></marin-app-footer>', text, rel)
            self.assertIn("<marin-app-feedback></marin-app-feedback>", text, rel)
            self.assertNotIn('class="site-header"', text, rel)
            # No page defines the ids the shell's own sections use.
            for taken in ("about", "security", "accessibility", "updates", "app-nav"):
                self.assertNotIn(f' id="{taken}"', text, f"{rel}: {taken}")

    def test_capital_figures_agree_on_every_page(self):
        # The same four figures on the Dashboard, the plan page and the Stats tab; totals the book prints are the book's.
        # A card's label may be a link (on the Dashboard it opens the tool on that number), so the text is read without it.
        kpis = lambda rel: [(label, re.sub(r"<[^>]+>", "", value)) for value, label in re.findall(r'<p class="mm-stats-kpi__value"[^>]*>((?:(?!</p>).)*)</p><p class="app-help-text"[^>]*>([^<]*)<', (ROOT / rel).read_text(encoding="utf-8"))]
        dash, plan, stats = kpis("index.html")[-8:-4], kpis("capital/index.html")[-4:], kpis("capital/projects.html")[-4:]  # the Dashboard ends with Contracts
        self.assertEqual(dash, plan)
        self.assertEqual(plan, stats)
        display = json.loads((ROOT / "capital" / "data" / "cip-display.json").read_text(encoding="utf-8"))
        book = next(c for c in display["categoryTotals"] if c["label"] == "All Project Categories Total")
        self.assertEqual(plan[0][1], "$%.1fM" % (book["total"] / 1e6))
        self.assertEqual(plan[3][1], "$%.1fM" % (book["additionalFundsNeeded"] / 1e6))

    def test_dashboard_has_both_sections_and_links(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"<h1[ >]", text)), 1)
        # One section for each tab, in the order of the tabs; where there is spending data, a section after Budget and spending says where this year stands.
        sections = re.findall(r'<h2 id="dash-[a-z]+">([^<]+)</h2>', text)
        if len(BUDGET_TABS) == 2:
            year = json.loads((ROOT / "data/accounting/summary.json").read_text(encoding="utf-8"))["year"]
            self.assertEqual(sections, ["Budget and spending", f"{year} so far", "Budget books", "Capital improvement plan", "Contracts"])
        else:
            self.assertEqual(sections, ["Budget", "Capital improvement plan", "Contracts"])
        # The home page is cards and charts: no tables, no lists of links, no "All ..." lines.
        self.assertNotIn("<table", text)
        # Each section ends with a row of links to its tool's tabs and presets, the tab names read from the tool's own page.
        lists = [re.findall(r'<a href="([^"]+)">([^<]+)</a>', m) for m in re.findall(r'<ul class="dash-links">(.*?)</ul>', text, re.S)]
        self.assertEqual(len(lists), len(BUDGET_TABS) + 2)
        links = {label: href for items in lists for href, label in items}
        self.assertEqual(links["Active contracts"], "./contracts/?status=Active")
        self.assertEqual(links["Vendors"], "./contracts/?view=vendors")
        self.assertEqual(links["Contract stats"], "./contracts/?view=stats")
        for gone in ("Departments, largest first", "Funds", "FY 2025-26 Final Budget", "Budget book stats", "Compare departments"):
            self.assertNotIn(gone, links)
        self.assertNotIn('class="org-dash__more"', text)
        charts = re.findall(r'<script type="application/json" id="(chart-dash-[a-z]+)-data">(.*?)</script>', text, re.S)
        self.assertGreaterEqual(len(charts), 5 if ACCOUNTING else 3)
        # Each bar of a chart is a link: the chart's data names an address for what it draws, and the script that follows the links is on the page.
        for id_, raw in charts:
            spec = json.loads(raw.replace("\\u003c", "<"))
            self.assertTrue(spec.get("links"), id_)
            self.assertTrue(all(h.startswith("./") for h in spec["links"].values()), id_)
        self.assertIn('src="./shared/chart-links.js?v=', text)
        # A search box finds a contract number, a code or a name; the lists it looks through are built beside the pages.
        self.assertIn('id="home-search-input"', text)
        self.assertIn('src="./shared/home-search.js?v=', text)
        self.assertTrue((ROOT / "search-index.json").exists())
        flat = {}
        nav = re.search(r'<nav class="org-tabs".*?</nav>', text, re.S).group(0)
        # Where the financial-system data is built, the budget books and Budget and spending are two tabs; otherwise there is one, Budget.
        self.assertEqual(re.findall(r">([^<]+)</a>", nav), ["Dashboard", *BUDGET_TABS, "Capital improvement plan", "Contracts", "Reports", "Data"])
        self.assertIn('aria-current="page">Dashboard', nav)

    def test_a_key_number_and_a_tag_on_a_card_open_the_tool_on_it(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        cards = re.findall(r'<div class="mm-stats-kpi"><p class="mm-stats-kpi__value">(.*?)</p><p class="app-help-text">([^<]*)</p>', text)
        self.assertGreaterEqual(len(cards), 15 if ACCOUNTING else 11)
        # Every key number on the Dashboard is a link into its tool, and the words under it are text.
        self.assertTrue(all(c[0].startswith('<a href="./') for c in cards), [c for c in cards if not c[0].startswith('<a href="./')])
        self.assertIn('<a href="./contracts/?status=Active">', text)
        self.assertIn('</p><p class="app-help-text">Active contracts</p>', text)
        self.assertIn('<a href="./capital/projects.html?gap=gap&amp;sort=gap">', text)
        # A tag on a card is a button that applies the filter (content that is a button, as the shell's audit asks).
        # A card has no badge except a status: the capital cards have one, the budget cards none.
        page = (ROOT / "capital/projects.html").read_text(encoding="utf-8")
        self.assertRegex(page, r'<button type="button" class="app-status" data-status="(open|warning)" data-button-kind="content" data-badge-facet="status" data-badge-value="[^"]+"')
        self.assertNotIn('data-badge-facet="category"', page)
        self.assertNotIn('data-badge-facet="subcategory"', page)
        self.assertNotIn('data-badge-facet="area"', (ROOT / "budget/index.html").read_text(encoding="utf-8"))
        contracts = (ROOT / "contracts/contracts.js").read_text(encoding="utf-8")
        self.assertNotIn('tag("type"', contracts)
        self.assertIn('tag("status",', contracts)

    def test_contracts_have_pages_and_simple_cards(self):
        data = json.loads((ROOT / "contracts/data/contracts-display.json").read_text(encoding="utf-8"))
        pages = {p.name for p in (ROOT / "contracts/c").glob("*.html")}
        self.assertEqual(pages, {f"{c['id']}.html" for c in data["contracts"]})
        first = data["contracts"][0]
        page = (ROOT / "contracts/c" / f"{first['id']}.html").read_text(encoding="utf-8")
        heading = re.search(r'<h1 class="doc-title">([^<]*)</h1>', page).group(1)
        self.assertEqual(heading.lower().replace("&amp;", "&"), first["name"].lower())
        self.assertNotEqual(heading, heading.upper())  # written as a department's name is, not in capitals
        self.assertIn('class="facts"', page)
        for label in ("Copy, choose a format", "Copy link", "Download, choose a format"):
            self.assertIn(f'aria-label="{label}"', page)
        self.assertIn('data-download-csv="contract"', page)
        vendor_page = next((ROOT / "contracts/vendors").glob("*.html")).read_text(encoding="utf-8")
        self.assertEqual(page.count('class="doc-actions"'), 1)
        self.assertIn('class="doc-actions"', vendor_page)
        for label in ("Vendor", "Department", "Amount", "Status", "Contract number"):
            self.assertIn(f"<dt>{label}</dt>", page)
        js = (ROOT / "contracts/contracts.js").read_text(encoding="utf-8")
        # A contract card: name (a link to its page), vendor, amount, and a status. A vendor card: name, number of contracts, total.
        card = js[js.index("function contractCard"):js.index("// ---- Stats")]
        self.assertIn('href="c/${escapeHtml(c.id)}.html"', card)
        self.assertNotIn("mini-dl", js)
        vendor = js[js.index("function vendorCard"):js.index("function dateRange")]
        self.assertEqual(vendor.count("mm-card__text"), 2)
        # The table of a vendor's contracts is a table with its buttons.
        some = next((ROOT / "contracts/vendors").glob("*.html")).read_text(encoding="utf-8")
        self.assertIn("contracts-of-", some)
        self.assertRegex(some, r'<div class="table-block" id="contracts-of-[^"]+">.*?data-fullscreen-target="#contracts-of-')
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.mm-card__title \{[^}]*font-size: 1\.25rem;\s*font-weight: 700")
        self.assertIn('class="app-status"', js)
        self.assertIn("window.marinDisplayName", js)

    def test_every_table_and_tool_can_open_fullscreen(self):
        stats = (ROOT / ("budget/accounting/index.html" if ACCOUNTING else "budget/index.html")).read_text(encoding="utf-8")
        blocks = re.findall(r'<div class="table-block" id="([^"]+)">(.*?)<div class="table-scroll"', stats, re.S)
        self.assertTrue(blocks)
        self.assertTrue(all(f'data-fullscreen-target="#{i}"' in head for i, head in blocks))
        for rel in present("budget/index.html", "budget/accounting/index.html", "capital/projects.html", "contracts/index.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            self.assertIn('data-fullscreen-target=".search-results"', page, rel)
            self.assertIn("shared/table-fullscreen.js", page, rel)
        self.assertTrue((ROOT / "shared/table-fullscreen.js").exists())

    def test_a_result_opens_its_page_with_nothing_added_to_the_address(self):
        # No row of links back to the results, no query in the address; the page of results lists them.
        self.assertFalse((ROOT / "shared/search-trail.js").exists())
        search = (ROOT / "shared/home-search.js").read_text(encoding="utf-8")
        self.assertNotIn("sq=", search)
        self.assertIn("home-search__group", search)
        for rel in present("index.html", "contracts/index.html", "budget/accounting/departments/300.html", "capital/projects.html"):
            self.assertNotIn("search-trail", (ROOT / rel).read_text(encoding="utf-8"), rel)

    def test_the_line_above_results_is_the_count_then_what_narrows(self):
        helper = (ROOT / "shared/results-line.js").read_text(encoding="utf-8")
        self.assertIn("results-line__count", helper)
        self.assertNotIn("Reset filters", helper)
        self.assertIn("+${list.length - 3} more", helper)
        for rel in ("budget/tool.js", "capital/projects.js", "contracts/contracts.js"):
            js = (ROOT / rel).read_text(encoding="utf-8")
            self.assertIn("marinResultsLine", js, rel)
            self.assertNotIn("Showing:", js, rel)
        for rel in present("budget/accounting/index.html", "budget/index.html", "capital/projects.html", "contracts/index.html", "search.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("Showing:", page, rel)
            self.assertIn("shared/results-line.js", page, rel)
        # No bold on the line.
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertNotRegex(css, r"\.mm-results-summary p \{\s*font-weight: 700")

    def test_the_report_preview_has_the_buttons_of_a_table(self):
        page = (ROOT / "reports/index.html").read_text(encoding="utf-8")
        head = page[page.index('id="report-preview-heading"'):page.index('id="report-preview" class="mm-report-doc"')]
        # The buttons are a toolbar under the heading, as a tool's are, and the file button at the top is an icon button in a toolbar too.
        self.assertIn('<div class="action-toolbar"><div class="doc-actions"', head)
        self.assertIn('<div class="action-toolbar report-open"><div class="action-group" role="group" aria-label="Report file"><button type="button" id="report-open" class="action-button" data-icon="folder-open" aria-label="Open a saved report"', page)
        order = [head.index(n) for n in ('aria-label="Copy, choose a format"', 'aria-label="Download, choose a format"', 'data-fullscreen-target="#report-preview-wrap"')]
        self.assertEqual(order, sorted(order))
        # No Copy link: the address cannot hold the report that was built (a report file does).
        self.assertNotIn('data-action="share"', head)

    def test_a_key_number_tile_is_a_card(self):
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.mm-stats-kpi__value \{[^}]*font-size: 1\.25rem;\s*font-weight: 700")
        self.assertRegex(css, r"\.mm-stats-kpi \.app-help-text \{[^}]*font-size: 1rem;\s*font-weight: 400")
        self.assertNotIn("margin-top: auto", (ROOT / "capital/styles.css").read_text(encoding="utf-8"))

    def test_a_capital_card_shows_its_name_its_cost_and_its_status(self):
        page = (ROOT / "capital/projects.html").read_text(encoding="utf-8")
        card = re.search(r'<li class="app-card mm-card"[^>]*>(.*?)</li>', page, re.S).group(1)
        labels = re.findall(r"<dt>([^<]+)</dt>", card)
        self.assertEqual(labels[0], "Cost estimate")
        self.assertLessEqual(len(labels), 2)
        self.assertNotIn("Funding in the plan", card)
        self.assertEqual(card.count('data-badge-facet='), 1)
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.mm-card \.capital-figures > div \{\s*display: flex;")

    def test_a_chart_title_is_a_card_title(self):
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.app-card > h3 \{[^}]*font-size: 1\.25rem;\s*font-weight: 700")

    def test_the_buttons_of_a_chart_or_a_table_are_one_rem_above_it(self):
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.chart-block > \.doc-actions,\s*\.table-block > \.doc-actions \{\s*margin-bottom: 1rem;")

    def test_the_shared_stylesheet_has_no_accidental_copy_of_itself(self):
        css = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        for needle in (".budget-table__num {", ".table-block {", ".chart-block {", ".gate__title {", "details.drill {"):
            self.assertEqual(css.count("\n" + needle), 1, needle)

    def test_the_stats_toolbar_keeps_the_order_of_the_buttons(self):
        for rel in present("budget/accounting/index.html", "budget/index.html", "capital/projects.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            toolbar = page[page.index('<div class="action-toolbar">'):]
            toolbar = toolbar[:toolbar.index('data-fullscreen-target=".search-results"')]
            order = [toolbar.index(n) for n in ('aria-label="Copy charts"', 'aria-label="Copy link"', 'aria-label="Download all charts as PNG"')]
            self.assertEqual(order, sorted(order), rel)

    def test_a_chart_has_the_buttons_of_a_table(self):
        page = (ROOT / "index.html").read_text(encoding="utf-8")
        bars = re.findall(r'<div class="doc-actions chart-actions">(.*?)<span class="doc-action-status"', page, re.S)
        self.assertGreaterEqual(len(bars), 5 if ACCOUNTING else 3)
        for bar in bars:
            order = [bar.index(n) for n in ('aria-label="Copy, choose a format"', 'aria-label="Copy link"', 'aria-label="Download, choose a format"', 'data-fullscreen-target=".chart-block"')]
            self.assertEqual(order, sorted(order))
        self.assertRegex((ROOT / "shared/styles.css").read_text(encoding="utf-8"), r"\.org-dash h2 \{\s*font-size: 1\.75rem")

    def test_the_tables_of_a_stats_tab_have_the_buttons_of_every_table(self):
        for rel in present("budget/accounting/index.html", "budget/index.html", "budget/fy2025-26/index.html", "capital/projects.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            box = page[page.index('<div class="capital-stats__tables">'):]
            blocks = re.findall(r'<div class="table-block" id="(stats-[^"]+)">(.*?)<div class="table-scroll"', box[:60000], re.S)
            self.assertEqual(len(blocks), 2, rel)
            for id_, head in blocks:
                for needle in ('aria-label="Copy, choose a format"', 'aria-label="Copy link"', 'aria-label="Download, choose a format"', f'data-fullscreen-target="#{id_}"'):
                    self.assertIn(needle, head, f"{rel} {id_}")
                self.assertIn(f'data-download-csv="{id_}"', head)
                # The file is read from the table as it is (it changes with the filters), so no rows are kept for it.
                self.assertNotIn(f'id="csv-{id_}"', page, rel)
            # In the toolbar the Fullscreen button is last, after Copy link.
            toolbar = page[page.index('<div class="action-toolbar">'):]
            toolbar = toolbar[:toolbar.index('</div></div>', toolbar.index('data-fullscreen-target=".search-results"')) + 12]
            self.assertLess(toolbar.index('aria-label="Copy link"'), toolbar.index('data-fullscreen-target=".search-results"'), rel)
        self.assertIn("querySelector(\"table\")", (ROOT / "shared/page-data.js").read_text(encoding="utf-8"))

    def test_the_count_above_results_is_one_standard(self):
        # What it counts: the unit of the view, one noun.
        js = (ROOT / "contracts/contracts.js").read_text(encoding="utf-8")
        self.assertIn('state.view === "contracts" ? plural(filtered.length, "contract", "contracts") : plural(vendors.length, "vendor", "vendors")', js)
        for rel in ("budget/tool.js", "capital/projects.js"):
            self.assertIn("marinResultsLine.count(", (ROOT / rel).read_text(encoding="utf-8"), rel)
        self.assertIn("line.count = (n, one, many)", (ROOT / "shared/results-line.js").read_text(encoding="utf-8"))
        self.assertIn("departments and divisions", (ROOT / "scripts/build-budget.js").read_text(encoding="utf-8"))
        self.assertIn("budget units", (ROOT / "scripts/build-budget-2025.js").read_text(encoding="utf-8"))
        # Its look is set once: 1rem above and below, regular weight; no tool restyles it.
        shared = (ROOT / "shared/styles.css").read_text(encoding="utf-8")
        self.assertRegex(shared, r"\.mm-results-summary \{[^}]*margin: 1rem 0 0.5rem;")
        for rel in ("capital/styles.css", "contracts/styles.css", "budget/styles.css"):
            css = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("mm-results-summary", css, rel)
            self.assertNotIn("#active-filters", css, rel)
        # Every stylesheet that one stylesheet imports carries a stamp, so a changed style is read at once.
        for css in ROOT.rglob("styles.css"):
            if any(part in css.parts for part in ("node_modules", "vendor", "plans")):
                continue
            for line in css.read_text(encoding="utf-8").splitlines():
                if line.startswith("@import"):
                    self.assertRegex(line, r'\?v=[0-9a-f]{8}"\);', f"{css.relative_to(ROOT)}: {line}")

    def test_tabs_mark_the_current_section(self):
        for rel, current in (("budget/index.html", BUDGET_TABS[-1]), ("budget/funds.html", BUDGET_TABS[-1]), ("capital/index.html", "Capital improvement plan"), ("capital/projects.html", "Capital improvement plan"), ("contracts/index.html", "Contracts"), ("reports/index.html", "Reports"), ("contracts/vendors/" + sorted(p.name for p in (ROOT / "contracts" / "vendors").glob("*.html"))[0], "Contracts")):
            nav = re.search(r'<nav class="org-tabs".*?</nav>', (ROOT / rel).read_text(encoding="utf-8"), re.S).group(0)
            self.assertEqual(re.findall(r'aria-current="page">([^<]+)<', nav), [current], rel)

    def test_departments_and_service_areas_run_a_to_z(self):
        for rel in ("budget/index.html", "budget/fy2025-26/index.html"):
            text = (ROOT / rel).read_text(encoding="utf-8")
            names = re.findall(r'<li class="app-card mm-card" [^>]*data-name="([^"]*)"', text)
            self.assertGreater(len(names), 10, rel)
            self.assertEqual(names, sorted(names), rel)
            self.assertIn('aria-label="Name, A to Z"', text)
            self.assertRegex(text, r'data-sort="name"[^>]*aria-pressed="true"', rel)
            # The whole-book overview is wrapped so the script can hide it when a filter is chosen.
            self.assertIn('<div id="stats-overview" data-whole-only>', text, rel)
        rows = re.findall(r'<tr><th scope="row"><a href="[^"]+">([^<]+)</a></th>', (ROOT / "budget/departments.html").read_text(encoding="utf-8"))
        self.assertEqual(rows, sorted(rows, key=str.casefold))
        sections = re.findall(r'<h2 id="[^"]+"><a href="[^"]+">([^<]+)</a></h2>', (ROOT / "budget/service-areas.html").read_text(encoding="utf-8"))
        self.assertEqual(sections, sorted(sections, key=str.casefold))

    def test_dashboard_charts_match_the_data(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        specs = {m[0]: json.loads(m[1]) for m in re.findall(r'<script type="application/json" id="([^"]+)">(.*?)</script>', text, re.S)}
        areas = specs["chart-dash-areas-data"]
        self.assertEqual(len(areas["labels"]), len(areas["series"][0]["values"]))
        # Service areas run A to Z.
        self.assertEqual(areas["labels"], sorted(areas["labels"], key=str.casefold))
        display = json.loads((ROOT / "capital" / "data" / "cip-display.json").read_text(encoding="utf-8"))
        cats = specs["chart-dash-categories-data"]
        total = sum(v for s in cats["series"] for v in s["values"])
        book = next(c for c in display["categoryTotals"] if c["label"] == "All Project Categories Total")["total"]
        self.assertEqual(total, book)


if __name__ == "__main__":
    unittest.main()


class ContractsTests(unittest.TestCase):
    def test_contract_pages_agree_with_the_data(self):
        data = json.loads((ROOT / "contracts" / "data" / "contracts-display.json").read_text(encoding="utf-8"))
        self.assertEqual(len(list((ROOT / "contracts" / "vendors").glob("*.html"))), len(data["vendors"]))
        rows = {}
        for c in data["contracts"]:
            rows.setdefault(c["vendorId"], []).append(c)
        # Every vendor in the data has a page, and every contract in the data belongs to a vendor with a page.
        self.assertEqual(set(rows), set(data["vendors"]))
        # A vendor page shows the vendor's contract count and total.
        vid, v = next(iter(data["vendors"].items()))
        text = (ROOT / "contracts" / "vendors" / f"{v['slug']}.html").read_text(encoding="utf-8")
        self.assertIn(f"${round(sum(c['value'] for c in rows[vid])):,}", text)

    def test_placeholder_contracts_are_left_out(self):
        data = json.loads((ROOT / "contracts" / "data" / "contracts-display.json").read_text(encoding="utf-8"))
        self.assertTrue(all(c["value"] > 100 and "test contract" not in c["name"].lower() for c in data["contracts"]))
        self.assertEqual(data["excluded"]["count"], len(data["excluded"]["contracts"]))


class ReportsTests(unittest.TestCase):
    def test_each_source_file_has_what_the_page_needs(self):
        for name in ("budget", "capital", "contracts"):
            d = json.loads((ROOT / "reports" / "data" / f"{name}.json").read_text(encoding="utf-8"))
            self.assertTrue(d["lines"] and d["columns"] and d["dimensions"] and d["source"]["url"], name)
            dims = {x["id"] for x in d["dimensions"]}
            for line in d["lines"]:
                self.assertEqual(len(line["values"]), len(d["columns"]), f"{name}: {line['title']}")
                self.assertTrue(dims <= set(line["facets"]), f"{name}: {line['title']}")

    def test_report_data_agrees_with_the_tabs(self):
        contracts = json.loads((ROOT / "contracts" / "data" / "contracts-display.json").read_text(encoding="utf-8"))
        d = json.loads((ROOT / "reports" / "data" / "contracts.json").read_text(encoding="utf-8"))
        self.assertEqual(len(d["lines"]), len(contracts["contracts"]))
        self.assertEqual(round(sum(l["values"][0] for l in d["lines"])), round(sum(c["value"] for c in contracts["contracts"])))
        cip = json.loads((ROOT / "capital" / "data" / "cip-display.json").read_text(encoding="utf-8"))
        c = json.loads((ROOT / "reports" / "data" / "capital.json").read_text(encoding="utf-8"))
        self.assertEqual(len(c["lines"]), len(cip["projects"]))
        self.assertEqual(sum(l["values"][0] for l in c["lines"]), sum(p["costEstimate"] for p in cip["projects"]))


class PhaseTwoMeasureTests(unittest.TestCase):
    def test_budget_tool_has_measures_and_reports_source_has_seven_columns(self):
        data = json.loads((ROOT / "reports/data/budget.json").read_text(encoding="utf-8"))
        self.assertEqual([c["key"] for c in data["columns"]], ["exp"] * 3 + ["rev"] * 2 + ["ncc"] * 2)
        self.assertTrue(all(len(l["values"]) == 7 for l in data["lines"]))
        self.assertTrue(any(l["values"][5] is not None for l in data["lines"]))
        page = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        # What to show is three open checkbox lists in filters.json, drawn by the shell: the measures, the years and whether to compare.
        filters = json.loads((ROOT / "budget/filters.json").read_text(encoding="utf-8"))
        shown = {g["id"]: g for g in filters["groups"]}
        for name in ("measure", "year", "change"):
            self.assertEqual((shown[name]["type"], shown[name]["collapsed"]), ("checkbox", False), name)
        self.assertEqual([o["label"] for o in shown["measure"]["options"]["values"]], ["Total expenditures", "Revenues", "Net County cost"])
        self.assertIn('data-filter-column="filters.json"', page)
        self.assertIn("Net County cost", page)
        self.assertEqual([c["basis"] for c in data["columns"]], ["Actual", "Approved", "Proposed"] + ["Approved", "Proposed"] * 2)
        # Drill-down: a department lists its divisions and programs, and a division with no amounts in the book says so.
        self.assertIn('<details class="drill">', page)
        self.assertIn("No amounts in the budget book", page)
        self.assertIn("4 divisions, 12 programs", page)
        # Funds and reorganizations: a department by fund group, and the book's own words on a reorganization, with its pages.
        self.assertIn("By fund group", page)
        self.assertIn("Responsibility for Facilities and Planning and Marin Commons has been transferred", page)
        self.assertIn("Responsibility for the Procurement Division has been transferred", page)


class PhaseOneTests(unittest.TestCase):
    def test_the_data_page_says_where_the_data_comes_from_and_that_it_is_static(self):
        text = (ROOT / "data/index.html").read_text(encoding="utf-8")
        strip = re.search(r'<p class="data-strip[^>]*>(.*?)</p>', text, re.S)
        self.assertIsNotNone(strip)
        self.assertIn("Static, read from", strip.group(1))
        self.assertRegex(strip.group(1), r"Pages built [A-Z][a-z]+ \d+, \d{4}")
        for part in ("Proposed Budget FY 2026-28", "Capital Improvement Plan", "contract records", "Past budget books", "Schedule 1", "Notes", "do not add up to the totals the book prints"):
            self.assertIn(part, text)
        for rel in ("index.html", "budget/index.html", "capital/projects.html", "contracts/index.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn('class="data-strip', page, rel)
            self.assertNotIn('id="data-toggle"', page, rel)
            self.assertNotIn('id="notes-toggle"', page, rel)
            self.assertIn('href="../data/"' if rel != "index.html" else 'href="data/"', page, rel)

    def test_a_change_says_what_it_compares(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("Spending, change from FY 2025-26 Approved to FY 2026-27 Proposed", text)
        budget = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        self.assertIn("Change, FY 2025-26 Approved to FY 2026-27 Proposed", budget)

    def test_budget_figures_are_named_for_what_they_measure(self):
        budget = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        self.assertIn("Total expenditures, FY 2026-27 Proposed", budget)

    def test_there_is_no_insights_tab_anywhere(self):
        for page in PAGES:
            self.assertNotIn('data-tab-section="insights"', page.read_text(encoding="utf-8"), page.relative_to(ROOT))
