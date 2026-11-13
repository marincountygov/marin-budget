"""Checks the Budget and Capital improvement plan pages against their data and the book's own checks."""
import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse


class _VisibleText(HTMLParser):
    """The text a page shows: everything outside script and style elements."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._hidden += 1
        else:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._hidden:
            self._hidden -= 1

    def handle_data(self, data):
        if not self._hidden:
            self.parts.append(data)


def visible_text(html: str) -> str:
    parser = _VisibleText()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)

ROOT = Path(__file__).resolve().parents[1]


class BudgetPageTests(unittest.TestCase):
    def test_capital_pages_match_their_data(self):
        data = json.loads((ROOT / "capital/data/cip-display.json").read_text(encoding="utf-8"))
        projects = data["projects"]
        self.assertEqual(len(list((ROOT / "capital/projects").glob("*.html"))), len(projects))
        # Every project row adds up to its own printed total.
        for p in projects:
            years = sum(p["byYear"].values())
            self.assertEqual(p["priorApprovals"] + years, p["totalFunding"], p["name"])
            self.assertEqual(p["totalFunding"] + p["additionalFundsNeeded"], p["costEstimate"], p["name"])
        # The projects page is a tool: a card and a table row for every project, the filters, and the stats the script keeps current.
        tool = (ROOT / "capital/projects.html").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'<li class="app-card mm-card" data-project=', tool)), len(projects))
        self.assertEqual(len(re.findall(r'<tr data-project=', tool)), len(projects))
        for facet in ("category", "subcategory", "status", "year", "size", "gap"):
            self.assertIn(f'id="facet-{facet}"', tool)
        for needle in ('id="active-filters"', 'id="selection-kpis"', 'data-view="table"', 'data-sort="cost"', 'src="projects.js?v='):
            self.assertIn(needle, tool)
        # The landing page shows the book's all-categories total.
        all_total = next(c for c in data["categoryTotals"] if c["label"] == "All Project Categories Total")["total"]
        index = (ROOT / "capital/index.html").read_text(encoding="utf-8")
        self.assertIn(f"${all_total:,}", index)
        # A fund for capital projects links to the plan; the General Fund does not.
        self.assertIn("<dt>Capital plan</dt>", (ROOT / "budget/funds/1420-countywide-capital-projects-fund.html").read_text(encoding="utf-8"))
        self.assertNotIn("<dt>Capital plan</dt>", (ROOT / "budget/funds/1000-general-fund.html").read_text(encoding="utf-8"))

    def test_budget_2025_pages_match_the_book_and_its_checks(self):
        base = ROOT / "budget/fy2025-26"
        data = json.loads((base / "data/schedules.json").read_text(encoding="utf-8"))
        schedules = {s["number"]: s for s in data["schedules"]}
        self.assertEqual(sorted(schedules), list(range(1, 16)))
        for n in schedules:
            self.assertTrue((base / f"schedule-{n}.html").exists(), n)
        for name in ("index", "road-fund", "personnel", "property-tax-trends"):
            self.assertTrue((base / f"{name}.html").exists(), name)

        def rows(n):
            return [x for x in schedules[n]["items"] if "heading" not in x]
        # The book's own totals: financing sources equal financing uses, and the schedule rows add up to them.
        total = next(x for x in rows(1) if x["label"] == "Total All Funds")
        self.assertEqual(total["values"][3], total["values"][6])
        self.assertEqual(sum(total["values"][:3]), total["values"][3])
        governmental = next(x for x in rows(1) if x["label"] == "Total Governmental Funds")
        groups = [x for x in rows(2) if x["code"] is None and x["label"] in ("Total General Fund", "Total Special Revenue Funds", "Total Capital Project Funds", "Total Debt Service Funds")]
        self.assertEqual(len(groups), 4)
        for k in range(7):
            self.assertEqual(sum(g["values"][k] for g in groups), governmental["values"][k], k)
        # Every fund row: sources add up and equal uses.
        for x in rows(2):
            v = x["values"]
            self.assertEqual(v[0] + v[1] + v[2], v[3], x["label"])
            self.assertEqual(v[3], v[6], x["label"])
        # The book's printed headline numbers are on the overview, and the buttons are on every page.
        index = (base / "index.html").read_text(encoding="utf-8")
        self.assertIn("$1068.0M", index)  # Schedule 7, subtotal financing uses, adopted
        self.assertIn("$488.4M", index)  # Schedule 2, General Fund financing uses
        for page in sorted(base.glob("*.html")):
            text = page.read_text(encoding="utf-8")
            self.assertIn('data-download-csv', text, page.name)
            self.assertIn("page-data.js?v=", text, page.name)
        # The tool on the home page: a year dropdown, a card and a row for every Schedule 8 unit line, the filters, the tabs, and the notes from the data.
        lines = (base / "index.html").read_text(encoding="utf-8")
        unit_lines = [x for x in rows(8) if x["code"]]
        self.assertEqual(len(re.findall(r'<li class="app-card mm-card" data-line=', lines)), len(unit_lines))
        self.assertEqual(len(re.findall(r'<tr data-line=', lines)), len(unit_lines))
        for needle in ('id="facet-function"', 'id="facet-unit"', 'id="stats-toggle"', 'id="notes-toggle"', 'id="line-notes"', 'id="book-filter"', 'id="column-filter"', 'budget/tool.js?v='):
            self.assertIn(needle, lines)
        notes = json.loads((base / "data/notes.json").read_text(encoding="utf-8"))
        for text in notes["notes"]:
            self.assertIn(text, lines)
        self.assertEqual(len(notes["totalsThatDifferFromTheirParts"]), lines.count('<th scope="row">FY 20'))
        # A card's title stays in the tool: it applies that line as a filter and opens Stats.
        self.assertRegex(lines, r'<h3 class="mm-card__title"><a href="\?unit=[^"]+&amp;tab=stats">')
        # Cited pages link to the book at the right PDF page (printed page + 8): Schedule 1 is printed page 1, PDF page 9.
        one = (base / "schedule-1.html").read_text(encoding="utf-8")
        self.assertRegex(one, r'page <a href="https://assets\.marincounty\.gov/[^"]*Not%20Remediated\.pdf#page=9">1</a>')
        # Schedule 9 lists each budget unit once, though the book prints it for each function.
        nine = (base / "schedule-9.html").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'<h2 id="s\d+-100-', nine)), 1)
        # The Budget page links to the book's pages, and the JSON-LD loads as schemaGov entities.
        self.assertIn("fy2025-26/index.html", (ROOT / "budget/index.html").read_text(encoding="utf-8"))
        budgets = json.loads((base / "data/budgets-2025-26.jsonld").read_text(encoding="utf-8"))["@graph"]
        self.assertEqual([b["budgetPhase"] for b in budgets], ["executed", "adjusted", "proposed", "approved"])

    def test_budget_and_capital_sections_carry_the_test_banner_and_nothing_else_does(self):
        text = "TEST: This is a design test. Data shown has not been fully reviewed and is for test use only."
        for rel in ("budget/index.html", "budget/fy2025-26/index.html", "budget/funds/1000-general-fund.html", "budget/fy2025-26/schedule-4.html", "budget/departments.html", "capital/index.html", "capital/projects.html"):
            page = (ROOT / rel).read_text(encoding="utf-8")
            self.assertIn(f'<div class="app-test-banner" role="note">{text}</div>', page, rel)
            # Directly under the header navigation, above the page content.
            self.assertLess(page.index("</marin-app-header>"), page.index("app-test-banner"), rel)
            self.assertLess(page.index("app-test-banner"), page.index('<main id="main"'), rel)

    def test_budget_page_opens_with_the_countywide_overview(self):
        text = (ROOT / "budget/index.html").read_text(encoding="utf-8")
        # The County as a whole is on the Stats tab, after the selection's own stats.
        self.assertLess(text.index('id="selection-charts"'), text.index('id="overview"'))
        self.assertIn("$902.6M", text)
        self.assertIn("$855.6M", text)
        self.assertIn("4.2%", text)
        # The overview's pies and table come from the same figures, and cite pages 20 and 21 of the book.
        self.assertIn("chart-county-expenditures-data", text)
        self.assertRegex(text, r"pages <a [^>]*#page=22\">20</a>, <a [^>]*#page=23\">21</a>")

    def test_every_fund_has_a_page(self):
        funds = (ROOT / "budget/funds.html").read_text(encoding="utf-8")
        cards = funds[funds.index('<ul class="search-results-list"'):funds.index("</ul>", funds.index('<ul class="search-results-list"'))]
        links = re.findall(r'<h3 class="mm-card__title"><a href="\./funds/([^"]+\.html)">', cards)
        self.assertEqual(len(links), 28)
        for link in links:
            page = (ROOT / "budget/funds" / link)
            self.assertTrue(page.exists(), link)
            text = page.read_text(encoding="utf-8")
            labels = re.findall(r">([^<]+)</a>", re.search(r'<nav id="page-tabs"[^>]*>(.*?)</nav>', text, re.S).group(1))
            self.assertEqual([l for l in labels if l not in ("Budget",)], ["Dashboard", "About", "Data", "Insights"], link)
        # Only the General Fund has figures, from the program rows that name it; the others say what the data says.
        general = (ROOT / "budget/funds/1000-general-fund.html").read_text(encoding="utf-8")
        self.assertIn('data-tab-section="budget"', general)
        self.assertIn("fund-chart-departments-data", general)
        self.assertRegex(general, r"Source</h3><ul><li>[^<]*pages? <a href=")
        # The others have a Budget tab only for what the FY 2025-26 Final Budget prints for the fund number: no departments table.
        building = (ROOT / "budget/funds/2080-building-inspection-fund.html").read_text(encoding="utf-8")
        self.assertIn('id="budget-fy2025-26"', building)
        self.assertNotIn("fund-chart-departments-data", building)
        # Names are written as the County writes them, and a program's General Fund row links to the page.
        shown = visible_text(funds)  # the JSON is the data as it is
        self.assertIn("HHS Social Services Realignment", shown)
        self.assertNotIn("Hhs ", shown)


if __name__ == "__main__":
    unittest.main()
