"""Checks the generated pages: language, title, one h1, local links and files, the tabs, and that each chart agrees with its table."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
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
        kpis = lambda rel: re.findall(r'<p class="app-help-text"[^>]*>([^<]*)</p><p class="mm-stats-kpi__value"[^>]*>([^<]*)<', (ROOT / rel).read_text(encoding="utf-8"))
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
        self.assertEqual(re.findall(r'<h2 id="dash-[a-z]+">([^<]+)</h2>', text), ["Budget", "Capital improvement plan", "Contracts"])
        self.assertIn('<a href="./budget/">All Budget</a>', text)
        self.assertIn('<a href="./capital/projects.html">All Capital improvement plan</a>', text)
        self.assertIn('<a href="./contracts/">All Contracts</a>', text)
        nav = re.search(r'<nav class="org-tabs".*?</nav>', text, re.S).group(0)
        self.assertEqual(re.findall(r">([^<]+)</a>", nav), ["Dashboard", "Budget", "Capital improvement plan", "Contracts", "Reports", "Data"])
        self.assertIn('aria-current="page">Dashboard', nav)

    def test_tabs_mark_the_current_section(self):
        for rel, current in (("budget/index.html", "Budget"), ("budget/funds.html", "Budget"), ("capital/index.html", "Capital improvement plan"), ("capital/projects.html", "Capital improvement plan"), ("contracts/index.html", "Contracts"), ("reports/index.html", "Reports"), ("contracts/vendors/" + sorted(p.name for p in (ROOT / "contracts" / "vendors").glob("*.html"))[0], "Contracts")):
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
        self.assertIn("Change in expenditures, FY 2025-26 Approved to FY 2026-27 Proposed", text)
        budget = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        self.assertIn("Change, FY 2025-26 Approved to FY 2026-27 Proposed", budget)

    def test_budget_figures_are_named_for_what_they_measure(self):
        budget = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        self.assertIn("Total expenditures, FY 2026-27 Proposed", budget)

    def test_there_is_no_insights_tab_anywhere(self):
        for page in PAGES:
            self.assertNotIn('data-tab-section="insights"', page.read_text(encoding="utf-8"), page.relative_to(ROOT))
