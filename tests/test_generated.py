"""Checks the generated pages: language, title, one h1, local links and files, the tabs, and that each chart agrees with its table."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
PAGES = sorted([ROOT / "index.html", *(ROOT / "budget").rglob("*.html"), *(ROOT / "capital").rglob("*.html")])


def attr_values(html: str, name: str):
    return re.findall(rf'\b{name}="([^"]*)"', html)


class PageTests(unittest.TestCase):
    def test_pages_found(self):
        self.assertGreaterEqual(len(PAGES), 280)

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
        kpis = lambda rel: re.findall(r'<p class="app-help-text"[^>]*>([^<]*)</p><p class="mm-stats-kpi__value"[^>]*>([^<]*)<', (ROOT / rel).read_text(encoding="utf-8"))[-4:]
        dash, plan, stats = kpis("index.html"), kpis("capital/index.html"), kpis("capital/projects.html")
        self.assertEqual(dash, plan)
        self.assertEqual(plan, stats)
        display = json.loads((ROOT / "capital" / "data" / "cip-display.json").read_text(encoding="utf-8"))
        book = next(c for c in display["categoryTotals"] if c["label"] == "All Project Categories Total")
        self.assertEqual(plan[0][1], "$%.1fM" % (book["total"] / 1e6))
        self.assertEqual(plan[3][1], "$%.1fM" % (book["additionalFundsNeeded"] / 1e6))

    def test_dashboard_has_both_sections_and_links(self):
        text = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"<h1[ >]", text)), 1)
        self.assertEqual(re.findall(r'<h2 id="dash-[a-z]+">([^<]+)</h2>', text), ["Budget", "Capital improvement plan"])
        self.assertIn('<a href="./budget/">All Budget</a>', text)
        self.assertIn('<a href="./capital/projects.html">All Capital improvement plan</a>', text)
        nav = re.search(r'<nav class="org-tabs".*?</nav>', text, re.S).group(0)
        self.assertEqual(re.findall(r">([^<]+)</a>", nav), ["Dashboard", "Budget", "Capital improvement plan"])
        self.assertIn('aria-current="page">Dashboard', nav)

    def test_tabs_mark_the_current_section(self):
        for rel, current in (("budget/index.html", "Budget"), ("budget/funds.html", "Budget"), ("capital/index.html", "Capital improvement plan"), ("capital/projects.html", "Capital improvement plan")):
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
