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
        # The filter column is drawn by the shell from capital/filters.json: the page holds only the element, and no hand-written sidebar.
        filters = json.loads((ROOT / "capital/filters.json").read_text(encoding="utf-8"))
        self.assertEqual([g["id"] for g in filters["groups"]], ["category", "subcategory", "status", "year", "size", "gap"])
        self.assertIn('data-filter-column="filters.json"', tool)
        self.assertNotIn("search-sidebar", tool)
        for needle in ('id="active-filters" data-filter-results', 'id="selection-kpis"', 'id="selection-kpis"', 'data-view="table"', 'data-sort="cost"', 'src="projects.js?v='):
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
        self.assertIn("$1,068.0M", index)  # Schedule 7, subtotal financing uses, adopted
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
        for needle in ('id="stats-toggle"', 'data-filter-column="filters.json"', 'data-filter-results', 'budget/tool.js?v='):
            self.assertIn(needle, lines)
        self.assertNotIn("search-sidebar", lines)
        # The book is a choice of one by radio buttons and the year by a drop-down (four years); the functions, activities and budget units are checkbox lists.
        filters = json.loads((base / "filters.json").read_text(encoding="utf-8"))
        self.assertEqual([(g["id"], g["type"]) for g in filters["groups"]], [("book", "radio"), ("year", "select"), ("function", "checkbox"), ("activity", "checkbox"), ("unit", "checkbox")])
        self.assertEqual(filters["groups"][0]["default"], "./index.html")
        notes = json.loads((base / "data/notes.json").read_text(encoding="utf-8"))
        self.assertNotIn('id="notes-toggle"', lines)
        data_page = (ROOT / "data/index.html").read_text(encoding="utf-8")
        for text in notes["notes"]:
            self.assertIn(text, data_page)
        self.assertEqual(len(notes["totalsThatDifferFromTheirParts"]), data_page.count('<th scope="row">FY 20'))
        # A card's title stays in the tool: it applies that line as a filter and opens Stats.
        self.assertRegex(lines, r'<h3 class="mm-card__title"><a href="\?unit=[^"]+&amp;tab=stats">')
        # Cited pages link to the book at the right PDF page (printed page + 8): Schedule 1 is printed page 1, PDF page 9.
        one = (base / "schedule-1.html").read_text(encoding="utf-8")
        self.assertRegex(one, r'page <a href="https://assets\.marincounty\.gov/[^"]*Not%20Remediated\.pdf#page=9">1</a>')
        # Schedule 9 lists each budget unit once, though the book prints it for each function.
        nine = (base / "schedule-9.html").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'<h2 id="s\d+-100-', nine)), 1)
        # The Budget page links to the book's pages, and the JSON-LD loads as schemaGov entities.
        # The other budget book is one of the choices of the book in the filter column (budget/filters.json).
        self.assertIn("fy2025-26/index.html", (ROOT / "budget/filters.json").read_text(encoding="utf-8"))
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
        # The overview's pies and table come from the same figures; the Data page cites pages 20 and 21 of the book.
        self.assertIn("chart-county-expenditures-data", text)
        data = (ROOT / "data/index.html").read_text(encoding="utf-8")
        self.assertRegex(data, r"pages <a [^>]*#page=22\">20</a>, <a [^>]*#page=23\">21</a>")

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
            # Only a fund with figures has a Dashboard tab; the others open on About.
            expected = ["Dashboard", "About", "Data"] if link.startswith("1000-") else ["About", "Data"]
            self.assertEqual([l for l in labels if l not in ("Budget",)], expected, link)
            self.assertNotIn("Insights", text, link)
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


ACCOUNTING = ROOT / "budget/accounting/index.html"


@unittest.skipUnless(ACCOUNTING.exists(), "the accounting page is built only where the accounting data is")
class AccountingPageTests(unittest.TestCase):
    """The Budget tool on the accounting data: a line for each department, a column for each measure, kind of amount and year."""

    @classmethod
    def setUpClass(cls):
        cls.page = ACCOUNTING.read_text(encoding="utf-8")
        cls.filters = json.loads((ACCOUNTING.parent / "filters.json").read_text(encoding="utf-8"))
        raw = re.search(r'<script type="application/json" id="tool-config">(.*?)</script>', cls.page, re.S).group(1)
        cls.config = json.loads(raw.replace("\\u003c", "<"))

    def test_the_filter_column_is_the_shells_and_the_words_are_plain(self):
        self.assertIn('data-filter-column="filters.json"', self.page)
        self.assertNotIn("search-sidebar", self.page)
        groups = {g["id"]: g for g in self.filters["groups"]}
        # There is no book to choose: the budget books are their own tab. Names and codes is a choice of one; funds, functions and categories are lists the page supplies.
        self.assertEqual(list(groups), ["measure", "basis", "year", "change", "labels", "area", "department", "budget", "fund", "function", "category"])
        self.assertEqual([o["label"] for o in groups["basis"]["options"]["values"]], ["Adopted budget", "Current budget", "Spent or received so far", "Committed", "Left to spend or receive"])
        self.assertEqual(groups["basis"]["default"], ["original"])
        self.assertEqual(groups["measure"]["default"], ["exp"])
        self.assertEqual([o["label"] for o in groups["year"]["options"]["values"]], [f"FY {y}-{str(y + 1)[2:]}" for y in range(2022, 2027)])
        self.assertEqual(groups["year"]["default"], ["4"])
        labels = [o["label"] for o in groups["measure"]["options"]["values"]]
        self.assertEqual(labels[:4], ["Spending", "Revenue", "Net County cost", "Set-asides"])
        self.assertEqual(labels[4:], ["Transfers to other funds", "Transfers from other funds", "Pass-through payments", "Pass-through receipts"])
        # A code is shown with its name to begin with; the departments with an FY 2026-27 budget are shown to begin with.
        self.assertEqual((groups["labels"]["type"], groups["labels"]["default"]), ("radio", "both"))
        self.assertEqual([o["label"] for o in groups["labels"]["options"]["values"]], ["Names and codes", "Names only", "Codes only"])
        self.assertEqual(groups["budget"]["default"], ["FY 2026-27 budget"])
        self.assertTrue(all(groups[g]["options"] == {"app": True} for g in ("fund", "function", "category")))
        self.assertIn("codes", self.filters["search"]["fields"])

    def test_the_words_on_the_page_are_not_the_accounting_systems(self):
        text = visible_text(self.page)
        for word in ("Munis", "Encumbrance", "Actuals", "Character code", "Functional activity", "Agency disbursements"):
            self.assertNotIn(word, text, word)
        names = [c["name"] for c in self.config["columns"]]
        self.assertIn("Spending, adopted budget, FY 2026-27", names)
        self.assertIn("Spending, spent so far, FY 2026-27", names)
        self.assertIn("Spending, actual spending, FY 2025-26", names)
        self.assertTrue(all("Original" not in n and "Revised" not in n and "Actuals" not in n and "Available" not in n for n in names))

    def test_a_card_and_a_table_row_for_each_department_with_a_figure_for_every_column_and_a_code_that_filters(self):
        columns = self.config["columns"]
        self.assertTrue(all({"label", "measure", "basis", "name", "stem"} <= set(c) for c in columns))
        cards = re.findall(r'<li class="app-card mm-card" data-line="(d\d+)"([^>]*)>', self.page)
        self.assertEqual(len(cards), 122)
        self.assertEqual(len(re.findall(r"<tr data-line=", self.page)), 122)
        for slug, attrs in cards:
            self.assertEqual(len(re.findall(r'data-v\d+="', attrs)), len(columns), slug)
            self.assertIn(f'data-code="{slug[1:]}"', attrs)
        # Every department's code is plain text beside its name (a card and a table row each have one).
        self.assertEqual(len(re.findall(r'<span class="code-text" data-code-kind="department" data-code="\d+"', self.page)), 244)
        # A card is simple: a name and code, the chosen figures, and a link to the department's page; no tags and nothing opens inside it.
        self.assertNotIn("<details", "".join(re.findall(r'<li class="app-card mm-card" data-line="d\d+".*?</li>', self.page, re.S)))
        self.assertEqual(len(re.findall(r'href="departments/\d+\.html"', self.page)), 244)
        # The year in progress has its amount so far; the amount committed and what is left exist only for it.
        self.assertTrue(any(c["basis"] == "actuals" and c["name"] == "Spending, spent so far, FY 2026-27" and c["short"] == "Spent so far, FY 2026-27" for c in columns))
        self.assertTrue(all(c["label"] == "FY 2026-27" for c in columns if c["basis"] in ("encumbrance", "available")))
        self.assertEqual({c["basis"] for c in columns if c["measure"] == "ncc"}, {"original", "revised", "actuals"})

    def test_the_budget_books_and_budget_and_spending_are_two_tabs(self):
        def tabs(rel):
            nav = re.search(r'<nav class="org-tabs"[^>]*>(.*?)</nav>', (ROOT / rel).read_text(encoding="utf-8"), re.S).group(1)
            return re.findall(r'<a href="[^"]*"( aria-current="page")?>([^<]+)</a>', nav)
        for rel, current in (("budget/index.html", "Budget books"), ("budget/accounting/index.html", "Budget and spending"), ("capital/index.html", "Capital improvement plan")):
            found = tabs(rel)
            self.assertEqual([label for _, label in found], ["Dashboard", "Budget and spending", "Budget books", "Capital improvement plan", "Contracts", "Reports", "Data"], rel)
            self.assertEqual([label for cur, label in found if cur], [current], rel)
        for rel in ("budget/filters.json", "budget/fy2025-26/filters.json"):
            book = json.loads((ROOT / rel).read_text(encoding="utf-8"))["groups"][0]
            self.assertEqual([o["label"] for o in book["options"]["values"]], ["FY 2026-27 Proposed", "FY 2025-26 Final"], rel)

    def test_a_department_has_its_own_page_with_its_levels_in_an_accordion(self):
        pages = sorted((ROOT / "budget/accounting/departments").glob("*.html"))
        self.assertEqual(len(pages), 122)
        page = (ROOT / "budget/accounting/departments/260.html").read_text(encoding="utf-8")
        views = re.findall(r'<details class="drill" data-view="(\w+)"', page)
        self.assertEqual(views, ["structure", "funds", "objects", "functions"])
        self.assertEqual(re.findall(r'<details class="drill" data-view="\w+"(?: open)?><summary>([^<]+)</summary>', page), ["Divisions, programs and accounts", "Funds", "Categories", "Functions"])
        # The download is a menu of CSV and JSON above the tables, and the two layouts are icon buttons named for what they show.
        self.assertIn('data-action="share"', page)
        self.assertLess(page.index('data-copy-selection="text"'), page.index('data-action="share"'))
        self.assertLess(page.index('data-action="share"'), page.index('data-accounts-format="csv"'))
        js = (ROOT / "budget/department.js").read_text(encoding="utf-8")
        self.assertIn('wanted === "charts"', js)
        self.assertIn('className: "code-link"', js)
        self.assertIn('data-accounts-format="csv"', page)
        self.assertIn('data-accounts-format="json"', page)
        self.assertLess(page.index('data-accounts-format="csv"'), page.index('data-view="structure"'))
        self.assertIn('aria-label="All accounts" title="All accounts"', page)
        self.assertNotIn("listed; more come", page)
        # Two layouts: the summary, and one table of every account with all its fields.
        self.assertIn('id="dept-tab-summary"', page)
        script = (ROOT / "budget/department.js").read_text(encoding="utf-8")
        self.assertIn('class="sort-button"', script)
        self.assertIn("data-select-column", script)
        self.assertIn("data-select-row", script)
        self.assertIn("event.shiftKey", script)
        self.assertIn("event.ctrlKey || event.metaKey", script)
        styles = (ROOT / "budget/styles.css").read_text(encoding="utf-8")
        self.assertIn("border-collapse: separate", styles)
        self.assertNotRegex(styles, r"\.accounts-table[^{]*\{[^}]*position: sticky;[^}]*left:")
        self.assertIn('data-copy-selection="csv"', page)
        self.assertIn("drillSelection", script)
        self.assertIn("activeCopy", script)
        self.assertRegex((ROOT / "shared/styles.css").read_text(encoding="utf-8"), r"thead th \{\s*font-weight: 700;")
        self.assertIn('data-fullscreen-target="#dept-expandable"', page)
        self.assertIn('id="dept-showing"', page)
        # One "Showing:" line, and a line under the heading for what a search found; there is no row of links back.
        self.assertEqual(page.count("Showing:"), 0)
        self.assertEqual(page.count('id="dept-showing"'), 1)
        self.assertNotIn('id="dept-kind"', page)
        self.assertNotIn('id="dept-found"', page)
        self.assertNotIn("search-trail", page)
        self.assertIn("detailAll", js)
        self.assertIn("selectable", script)
        self.assertIn('id="dept-tab-charts"', page)
        self.assertIn('aria-label="Charts" title="Charts"', page)
        self.assertIn('id="dept-panel-charts"', page)
        self.assertIn('id="dept-tab-table"', page)
        self.assertIn('class="accounts-table"', page)
        self.assertIn("department.js?v=", page)
        self.assertIn("display-name.js?v=", page)
        self.assertIn("accounting.js?v=", self.page)
        self.assertNotIn("drill-config", self.page)
        # The home page search finds a department's code, a budget unit's code and an account's code, and the index holds no amounts.
        index = json.loads((ROOT / "budget/accounting/search-index.json").read_text(encoding="utf-8"))
        found = {(e["k"], e["c"]) for e in index}
        for kind in ("Department", "Budget unit", "Account"):
            self.assertTrue(any(k == kind for k, _ in found), kind)
        self.assertTrue(all(set(e) <= {"k", "n", "c", "x", "h"} for e in index))
        # A budget unit's result opens its department's page on that unit, and says where the unit sits.
        unit = next(e for e in index if e["k"] == "Budget unit")
        self.assertTrue(unit["h"].endswith(f"?find={unit['c']}"))
        self.assertIn("\u203a", unit["x"])
        # The page of results exists and is the same box.
        results = (ROOT / "search.html").read_text(encoding="utf-8")
        self.assertIn('<search class="home-search" id="home-search" aria-label="Search the budget" data-all>', results)
        self.assertIn('class="search-input-field"', results)


if __name__ == "__main__":
    unittest.main()
