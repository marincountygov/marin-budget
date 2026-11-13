#!/usr/bin/env python3
"""Browser test of Marin Budget over HTTP with Playwright.

- Login screen: a wrong password is refused, `marincounty` opens the page and stays open in the tab.
- Dashboard: the shell header and footer, the tabs, the shortcuts, About opens and hides the page.
- Header title links to the home page from a page two folders down.
- Budget tool: opens on Name A to Z; the County overview under Stats is hidden once a filter is chosen.
- Compare tab: picks fill the charts and the table, at most four, kept in the address; cards picked on the Budget tab carry over.
- Capital Projects tool: Stats shows the book's printed totals until a filter is chosen; the gap sort puts the
  largest funding gap first.
On every page: no console errors, and nothing visible runs off the edge at phone width.
Needs Playwright for Python and Google Chrome (or Chromium).  Run: python3 tests/browser_budget.py
"""
from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OVERFLOW = """() => [...document.querySelectorAll('body *')]
    .filter((e) => !e.closest('.visually-hidden') && e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('pre, table, .table-scroll, [class*=chart], .menu-panel'))
    .map((e) => e.tagName + '.' + e.className).slice(0, 5)"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    Thread(target=server.serve_forever, daemon=True).start()
    errors = []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome")
        except Exception:
            browser = p.chromium.launch()
        # Login screen, in a fresh context (nothing remembered).
        gate = browser.new_page(viewport={"width": 1280, "height": 900})
        gate.goto(base)
        gate.wait_for_selector("#gate-password")
        require(not gate.locator("marin-app-header").is_visible(), "the page is hidden behind the login screen")
        gate.fill("#gate-password", "wrong")
        gate.click(".gate__button")
        gate.wait_for_selector("#gate-error:not([hidden])")
        gate.fill("#gate-password", "marincounty")
        gate.click(".gate__button")
        gate.wait_for_selector("marin-app-header .app-title__link")
        require(gate.locator("#gate-password").count() == 0, "the login screen is gone once the password is right")
        gate.goto(base + "budget/")
        gate.wait_for_selector("marin-app-header .app-title__link")
        require(gate.locator("#gate-password").count() == 0, "other pages stay open in the same tab")
        gate.close()

        # Everything below runs signed in.
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        context.add_init_script("window.sessionStorage.setItem('marin-budget-unlocked', '1')")
        page = context.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 and "favicon" not in r.url else None)

        # Dashboard
        page.goto(base)
        page.wait_for_selector("marin-app-header .app-title__link")
        require(page.locator("marin-app-footer").count() == 1, "footer")
        require(page.locator(".org-tabs a").all_inner_texts() == ["Dashboard", "Budget", "Capital improvement plan"], "tabs")
        require(page.locator(".dash-links").count() == 2, "shortcuts for budget and capital")
        page.goto(base + "#about")
        page.wait_for_selector("#about")
        require(page.locator("#about").is_visible(), "About opens")
        require(not page.locator(".org-dashboard").is_visible(), "the dashboard hides while About is open")

        # The header title leads home from a page two folders down.
        page.goto(base + "budget/fy2025-26/personnel.html")
        page.wait_for_selector(".app-title__link")
        page.wait_for_function("document.querySelector('.app-title__link').getAttribute('href') === '../../'")

        # Budget tool: Name A to Z first, and the overview follows the filter.
        page.goto(base + "budget/?tab=stats")
        page.wait_for_selector("#stats-overview")
        require(page.locator('[data-sort="name"]').get_attribute("aria-pressed") == "true", "opens on Name, A to Z")
        require(page.locator("#stats-overview").is_visible(), "overview shows for the whole book")
        page.goto(base + "budget/?department=Health+and+Human+Services&tab=stats")
        page.wait_for_selector("#stats-overview", state="attached")
        require(not page.locator("#stats-overview").is_visible(), "overview hidden when a filter is chosen")
        page.goto(base + "budget/?tab=stats&sort=amount")
        require(page.locator('[data-sort="amount"]').get_attribute("aria-pressed") == "true", "shortcut sort")

        # Compare tab of the Budget tool: from the address, and from cards picked on the Budget tab.
        page.goto(base + "budget/?tab=compare&compare=sheriff,probation")
        page.wait_for_selector("#compare-body table")
        require(page.locator("#compare-body thead th").count() == 3, "two departments and the Measure column")
        # Both charts are drawn: the canvases are shown and have pixels in them.
        page.wait_for_function("""() => { const c = [...document.querySelectorAll('#compare-charts canvas')]; return c.length === 2 && c.every((x) => !x.hidden && x.getContext('2d').getImageData(0, 0, x.width, x.height).data.some((v) => v !== 0)); }""")
        for name in ("Parks", "Fire Department"):
            page.get_by_label(name, exact=True).check()
        require(page.locator("#compare-list input:checked").count() == 4, "up to four")
        require(page.locator("#compare-list input:disabled").count() > 0, "the rest are disabled at four")
        require("compare=" in page.url and "parks" in page.url, "picks are in the address")
        page.get_by_label("Parks", exact=True).uncheck()
        require(page.locator("#compare-body thead th").count() == 4, "three departments and the Measure column")
        page.goto(base + "budget/")
        page.wait_for_selector("input[data-select]")
        page.locator('#line-cards input[data-select="sheriff"]').check()
        page.locator('#line-cards input[data-select="probation"]').check()
        page.click("#compare-toggle")
        page.wait_for_selector("#compare-body table")
        require(page.locator("#compare-list input:checked").count() == 2, "Compare opens with the cards that were picked")
        page.goto(base + "budget/")
        page.click("#compare-toggle")
        require(page.locator("#compare-empty").is_visible(), "nothing picked: a prompt to choose")
        page.goto(base + "budget/fy2025-26/")
        require(page.locator("#compare-toggle").count() == 0, "FY 2025-26 has no Compare tab")

        # Capital Projects tool
        page.goto(base + "capital/projects.html?tab=stats")
        page.wait_for_selector("[data-stat='programmed']")
        require(page.locator("[data-stat='programmed']").inner_text() == "$542.3M", "printed total when nothing is filtered")
        page.goto(base + "capital/projects.html?tab=stats&category=Facilities")
        page.wait_for_function("document.querySelector(\"[data-stat='n']\").textContent !== '226'")
        require(page.locator("[data-stat='programmed']").inner_text() != "$542.3M", "a selection adds up its projects")
        page.goto(base + "capital/projects.html?gap=gap&sort=gap")
        page.wait_for_selector("#project-cards li:not([hidden])")
        needed = page.eval_on_selector_all("#project-cards li:not([hidden])", "els => els.map((e) => Number(e.dataset.needed))")
        require(needed and needed == sorted(needed, reverse=True) and needed[0] > 0, "gap sort puts the largest gap first")

        # Phone width
        page.set_viewport_size({"width": 390, "height": 800})
        for path in ("", "budget/", "budget/?tab=compare&compare=sheriff,probation", "capital/projects.html"):
            page.goto(base + path)
            page.wait_for_selector("marin-app-header .app-title__link")
            wide = page.evaluate(OVERFLOW)
            require(not wide, f"{path or 'home'} runs off the edge at phone width: {wide}")
        browser.close()
    server.shutdown()
    errors = [e for e in errors if "favicon" not in e]
    require(not errors, f"console errors: {errors[:3]}")
    print("Browser checks passed.")


if __name__ == "__main__":
    sys.exit(main())
