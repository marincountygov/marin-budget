// The Contracts tool: the filter column (drawn by the shell from filters.json, which also matches the contracts), a Vendors and a
// Contracts list, and a Stats view. The choices in the column come from the contracts loaded here. Filters are kept in the address by
// the column; this script keeps the sort and the view.
(() => {
  const DATA_URL = "data/contracts-display.json";
  const asked = new URLSearchParams(window.location.search); // the address as it was opened, for links written before the column was drawn from a file
  const PAGE = 100;
  const $ = (id) => document.getElementById(id);
  const vendorsEl = $("vendors-results");
  const contractsEl = $("contracts-results");
  const summaryEl = $("active-filters");
  const column = document.querySelector("[data-filter-column]");
  const statsToggle = $("stats-toggle");
  const moreRow = $("more-row");
  const deptNames = JSON.parse($("department-names").textContent);
  const deptLinks = JSON.parse($("department-links").textContent);
  const vendorPages = JSON.parse($("vendor-pages").textContent);

  // Each facet's words for "nothing chosen" (the same as in filters.json) and the value a contract has for it.
  const FACETS = [
    { name: "department", all: "All departments", of: (c) => deptNames[c.dept] || c.dept },
    { name: "type", all: "All types", of: (c) => c.type || "Not recorded" },
    { name: "status", all: "All statuses", of: (c) => (c.status === "active" ? "Active" : c.status === "terminated" ? "Terminated" : c.status) },
    { name: "year", all: "All years", of: (c) => String(c.year) },
  ];

  const SORTS = ["high", "low", "az", "za"];
  const state = { sort: "high", view: "contracts", stats: false, shown: PAGE, charts: {} };
  const chosen = (facet) => column.filterState.groups[facet.name] || [];
  const searched = () => column.filterState.search.trim();
  let contracts = [];
  let filtered = [];
  let current = { vendors: [] };

  const escapeHtml = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const millions = (n) => "$" + (n / 1e6).toFixed(1) + "M";
  const plural = (n, one, many) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

  // ---- State and the address -------------------------------------------------------------------------
  // The column keeps the search and the filters in the address; this script keeps the sort and the view there too.
  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    state.sort = SORTS.includes(params.get("sort")) ? params.get("sort") : "high";
    const view = params.get("view");
    state.view = view === "vendors" ? "vendors" : "contracts";
    state.stats = view === "stats";
  }

  function writeUrl() {
    const params = new URLSearchParams(window.location.search);
    params.delete("sort");
    params.delete("view");
    if (state.sort !== "high") params.set("sort", state.sort);
    if (state.stats) params.set("view", "stats");
    else if (state.view === "vendors") params.set("view", "vendors");
    const next = params.toString();
    window.history.replaceState(null, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
  }

  // ---- The column's choices: every value the contracts have for a facet, with how many contracts have it -------------
  function supplyChoices() {
    FACETS.forEach((facet) => {
      const counts = new Map();
      contracts.forEach((c) => counts.set(c.facet[facet.name], (counts.get(c.facet[facet.name]) || 0) + 1));
      column.setOptions(facet.name, [...counts.keys()].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value, count: counts.get(value) })));
      // A link written before the column was drawn from a file lists several values in one parameter (a,b).
      const raw = asked.getAll(facet.name);
      const known = new Set(counts.keys());
      if (raw.length === 1 && !known.has(raw[0])) {
        const parts = raw[0].split(",").filter(Boolean);
        if (parts.length > 1 && parts.every((v) => known.has(v))) column.setValue(facet.name, parts);
      }
    });
  }

  // "All departments · All types · Any status · All years (1,648 vendors, 5,236 contracts — Active 2,129, Terminated 3,107)"
  function describeFilters(vendors) {
    // The count first, then only the choices that narrow it.
    const parts = FACETS.map((f) => (chosen(f).length ? window.marinResultsLine.values(chosen(f)) : "")).filter(Boolean);
    if (searched()) parts.unshift(`matching \u201c${searched()}\u201d`);
    // One count, the unit of the view: contracts on Contracts (and on its Stats), vendors on Vendors (and on its Stats). A vendor's contracts are on its card.
    const counts = state.view === "contracts" ? plural(filtered.length, "contract", "contracts") : plural(vendors.length, "vendor", "vendors");
    return window.marinResultsLine({ count: counts, filters: parts });
  }

  // ---- Lists -------------------------------------------------------------------------------------------
  // Sort: by value (the filtered total) or by name, in either direction.
  function sorter(name, value) {
    const by = { high: (a, b) => value(b) - value(a), low: (a, b) => value(a) - value(b), az: (a, b) => name(a).localeCompare(name(b)), za: (a, b) => name(b).localeCompare(name(a)) }[state.sort];
    return (a, b) => by(a, b) || name(a).localeCompare(name(b));
  }

  function vendorList() {
    const map = new Map();
    filtered.forEach((c) => {
      const v = map.get(c.vendorId) || { id: c.vendorId, name: c.vendor, count: 0, value: 0, depts: new Map() };
      v.count += 1;
      v.value += c.value;
      v.depts.set(c.dept, (v.depts.get(c.dept) || 0) + c.value);
      map.set(c.vendorId, v);
    });
    return [...map.values()].sort(sorter((v) => v.name, (v) => v.value));
  }

  // A card is a name that opens the page, and a line or two of plain text: a vendor's number of contracts and its total, a contract's vendor and its amount.
  function vendorCard(v) {
    const page = vendorPages[v.id];
    return `<li class="app-card mm-card"><div class="mm-card__body">
      <h3 class="mm-card__title">${page ? `<a href="vendors/${escapeHtml(page)}.html">${escapeHtml(v.name)}</a>` : escapeHtml(v.name)}</h3>
      <p class="mm-card__text">${plural(v.count, "contract", "contracts")}</p>
      <p class="mm-card__text">${money(v.value)}</p>
    </div></li>`;
  }

  function dateRange(c) {
    if (c.start && c.end) return `${c.start} to ${c.end}`;
    return c.end ? `Ends ${c.end}` : c.start ? `Starts ${c.start}` : "";
  }

  // A tag on a contract is a button that applies that filter.
  // The status of a contract is the shell's status badge: blue while it is active, green when it is done.
  const STATUS_KIND = { Active: "open", Terminated: "done" };
  const tag = (facet, value) => `<button type="button" class="app-status" data-status="${STATUS_KIND[value] || "open"}" data-button-kind="content" data-badge-facet="${facet}" data-badge-value="${escapeHtml(value)}" title="Filter by this" aria-label="Filter by ${facet}: ${escapeHtml(value)}">${escapeHtml(value)}</button>`;

  function contractCard(c) {
    const page = vendorPages[c.vendorId];
    return `<li class="app-card mm-card"><div class="mm-card__body">
      <h3 class="mm-card__title"><a href="c/${escapeHtml(c.id)}.html">${escapeHtml(c.name)}</a></h3>
      <p class="mm-card__text">${page ? `<a href="vendors/${escapeHtml(page)}.html">${escapeHtml(c.vendor)}</a>` : escapeHtml(c.vendor)}</p>
      <p class="mm-card__text">${money(c.value)}</p>
      <div class="mm-terms">${tag("status", c.status === "active" ? "Active" : "Terminated")}</div>
    </div></li>`;
  }

  // ---- Stats -------------------------------------------------------------------------------------------
  const sumBy = (key) => {
    const m = new Map();
    filtered.forEach((c) => { const k = key(c); m.set(k, (m.get(k) || 0) + c.value); });
    return [...m.entries()];
  };

  function applyChartTheme() {
    if (typeof Chart === "undefined") return;
    Chart.defaults.color = getComputedStyle(document.querySelector("#main")).color;
    Chart.defaults.borderColor = getComputedStyle(document.querySelector("#stats-view .app-card")).borderTopColor;
  }

  function drawChart(key, entries, kind, title) {
    const canvas = $(`stats-${key}-chart`);
    const table = $(`stats-${key}-table`);
    const total = entries.reduce((n, [, v]) => n + v, 0);
    if (!entries.length) {
      canvas.setAttribute("aria-label", `${title}: no data for the current filters.`);
      table.innerHTML = "";
      if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
      return;
    }
    const [topLabel, topValue] = entries[0];
    canvas.setAttribute("aria-label", `${title}. ${topLabel} is largest at ${millions(topValue)}, ${Math.round((topValue / total) * 100)}% of ${millions(total)} shown.`);
    table.innerHTML = `<table><caption>${escapeHtml(title)}</caption><thead><tr><th scope="col">Name</th><th scope="col">Contract value</th></tr></thead><tbody>${entries.map(([l, v]) => `<tr><th scope="row">${escapeHtml(l)}</th><td>${money(v)}</td></tr>`).join("")}</tbody></table>`;
    // A box of set height, so every label of a ranked list has room and none is skipped.
    $(`stats-${key}-box`).style.height = `${kind === "bars" ? Math.max(180, entries.length * 28 + 50) : 320}px`;
    const data = { labels: entries.map(([l]) => l), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: "#0777cf" }] };
    if (state.charts[key]) {
      state.charts[key].data = data;
      state.charts[key].update();
      return;
    }
    applyChartTheme();
    const valueAxis = { ticks: { callback: (v) => (v >= 1e6 ? `$${v / 1e6}M` : v >= 1e3 ? `$${v / 1e3}K` : `$${v}`) }, beginAtZero: true };
    state.charts[key] = new Chart(canvas, {
      type: "bar",
      data,
      options: {
        indexAxis: kind === "bars" ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => money(ctx.parsed[kind === "bars" ? "x" : "y"]) } } },
        scales: kind === "bars" ? { x: valueAxis, y: { ticks: { autoSkip: false } } } : { y: valueAxis },
      },
    });
  }

  function renderStats() {
    const vendors = new Set(filtered.map((c) => c.vendorId)).size;
    const depts = new Set(filtered.map((c) => c.dept)).size;
    const kpi = (label, value) => `<div class="mm-stats-kpi"><p class="app-help-text">${label}</p><p class="mm-stats-kpi__value">${value}</p></div>`;
    $("stats-kpis").innerHTML = kpi("Contracts", filtered.length.toLocaleString("en-US")) +
      kpi("Active contracts", filtered.filter((c) => c.status === "active").length.toLocaleString("en-US")) +
      kpi("Total contract value", millions(filtered.reduce((n, c) => n + c.value, 0))) +
      kpi("Vendors", vendors.toLocaleString("en-US")) + kpi("Departments", depts.toLocaleString("en-US"));
    const ranked = (entries, n) => entries.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
    drawChart("departments", ranked(sumBy((c) => deptNames[c.dept] || c.dept), 30), "bars", "Contract value by department");
    drawChart("types", ranked(sumBy((c) => c.type || "Not recorded"), 30), "bars", "Contract value by type");
    const vendorNames = new Map(filtered.map((c) => [c.vendorId, c.vendor]));
    drawChart("vendors", ranked(sumBy((c) => c.vendorId), 10).map(([id, v]) => [vendorNames.get(id), v]), "bars", "Top 10 vendors by contract value");
    drawChart("years", sumBy((c) => String(c.year)).sort((a, b) => a[0].localeCompare(b[0])), "columns", "Contract value by year");
  }

  // ---- Render ------------------------------------------------------------------------------------------
  function render() {
    filtered = column.filter(contracts);
    const vendors = vendorList();
    filtered.sort(sorter((c) => c.name, (c) => c.value));
    const lists = state.view === "vendors" ? vendors : filtered;
    const noun = state.view === "vendors" ? ["vendor", "vendors"] : ["contract", "contracts"];
    const total = state.view === "vendors" ? new Set(contracts.map((c) => c.vendorId)).size : contracts.length;

    $("view-tabs").querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-selected", String(!state.stats && b.dataset.view === state.view)));
    statsToggle.setAttribute("aria-pressed", String(state.stats));
    $("stats-view").hidden = !state.stats;
    vendorsEl.hidden = state.stats || state.view !== "vendors";
    contractsEl.hidden = state.stats || state.view !== "contracts";

    column.setResults(filtered.length, describeFilters(vendors));

    if (state.stats) {
      moreRow.hidden = true;
      if (filtered.length) renderStats();
      else Object.keys(state.charts).forEach((k) => { state.charts[k].destroy(); delete state.charts[k]; });
    } else {
      const el = state.view === "vendors" ? vendorsEl : contractsEl;
      const draw = state.view === "vendors" ? vendorCard : contractCard;
      el.innerHTML = lists.slice(0, state.shown).map(draw).join("");
      moreRow.hidden = lists.length <= state.shown;
      $("more-button").textContent = `Show more (${Math.min(PAGE, lists.length - state.shown)} of ${(lists.length - state.shown).toLocaleString("en-US")} left)`;
    }
    document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)));
    $("sort-group").hidden = state.stats; // Stats has nothing to sort
    writeUrl();
    current = { vendors };
  }

  // ---- Copy, link and download: what is filtered, not only the 100 cards on screen -----------------------
  const mdCell = (v) => String(v).replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const htmlCell = (v) => escapeHtml(v);
  const SORT_LABEL = { high: "value, high to low", low: "value, low to high", az: "name, A to Z", za: "name, Z to A" };

  function filterLines() {
    const lines = FACETS.filter((f) => chosen(f).length).map((f) => `${f.name[0].toUpperCase()}${f.name.slice(1)}: ${chosen(f).join(", ")}`);
    if (searched()) lines.unshift(`Search: ${searched()}`);
    return lines.length ? lines.join("; ") : "No filters";
  }

  function tables() {
    const total = (rows) => rows.reduce((n, c) => n + c.value, 0);
    const vendorRows = current.vendors.map((v) => [v.name, v.count, money(v.value)]);
    const contractRows = filtered.map((c) => [c.name, c.vendor, deptNames[c.dept] || c.dept, c.type || "", c.status === "active" ? "Active" : "Terminated", money(c.value), dateRange(c)]);
    if (state.stats) {
      const by = (key, n) => sumBy(key).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, money(v)]);
      const names = new Map(filtered.map((c) => [c.vendorId, c.vendor]));
      return { title: "Contracts: stats", count: `${plural(filtered.length, "contract", "contracts")} from ${plural(current.vendors.length, "vendor", "vendors")}, ${money(total(filtered))} in all`, sections: [
        { heading: "Contract value by department", head: ["Department", "Contract value"], rows: by((c) => deptNames[c.dept] || c.dept, 40) },
        { heading: "Contract value by type", head: ["Type", "Contract value"], rows: by((c) => c.type || "Not recorded", 40) },
        { heading: "Top 10 vendors by contract value", head: ["Vendor", "Contract value"], rows: sumBy((c) => c.vendorId).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => [names.get(id), money(v)]) },
        { heading: "Contract value by year", head: ["Year", "Contract value"], rows: sumBy((c) => String(c.year)).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, money(v)]) },
      ] };
    }
    if (state.view === "contracts") return { title: "Contracts", count: `${plural(filtered.length, "contract", "contracts")}, ${money(total(filtered))} in all`, sections: [{ heading: "Contracts", head: ["Contract", "Vendor", "Department", "Type", "Status", "Value", "Term"], rows: contractRows }] };
    return { title: "Vendors", count: `${plural(current.vendors.length, "vendor", "vendors")}, ${money(total(filtered))} in all`, sections: [{ heading: "Vendors", head: ["Vendor", "Contracts", "Contract value"], rows: vendorRows }] };
  }

  function formats() {
    const t = tables();
    const intro = `${filterLines()}. Sorted by ${SORT_LABEL[state.sort]}. ${t.count}.`;
    const note = "Each value is the amount of the contract, not what the County has paid.";
    const text = [t.title, intro, ...t.sections.flatMap((s) => ["", s.heading, ...s.rows.map((r) => r.join(" | "))]), "", note].join("\n");
    const html = `<h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(intro)}</p>` + t.sections.map((s) => `<h3>${escapeHtml(s.heading)}</h3><table><thead><tr>${s.head.map((h) => `<th>${htmlCell(h)}</th>`).join("")}</tr></thead><tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${htmlCell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("") + `<p>${escapeHtml(note)}</p>`;
    const markdown = [`## ${t.title}`, "", intro, ...t.sections.flatMap((s) => ["", `### ${s.heading}`, "", `| ${s.head.join(" | ")} |`, `| ${s.head.map(() => "---").join(" | ")} |`, ...s.rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)]), "", note].join("\n");
    return { text, html, markdown };
  }

  // The CSV items read their rows from these two blocks (organization/page-data.js), so they hold the current filter.
  function refreshCsv() {
    $("csv-vendors").textContent = JSON.stringify([["Vendor", "Vendor id", "Contracts", "Contract value"], ...current.vendors.map((v) => [v.name, v.id, v.count, v.value])]);
    $("csv-contracts").textContent = JSON.stringify([["Contract", "Contract id", "Vendor", "Department", "Type", "Status", "Year", "Start", "End", "Value"], ...filtered.map((c) => [c.name, c.id, c.vendor, deptNames[c.dept] || c.dept, c.type || "", c.status, c.year, c.start || "", c.end || "", c.value])]);
  }

  function wireActions() {
    const bar = document.querySelector(".doc-actions");
    // The shell loads after this script on a fast connection; wire the menus once it is ready.
    const wire = () => bar && window.marinFormatMenus && window.marinFormatMenus(bar, formats, { fileName: "vendors" });
    if (window.marinFormatMenus) wire();
    else document.addEventListener("marinos:shell-ready", wire, { once: true });
    bar?.addEventListener("pointerdown", refreshCsv, true);
    bar?.addEventListener("keydown", refreshCsv, true);
  }

  function refilter() {
    state.shown = PAGE;
    render();
    column.updateCounts(contracts);
  }

  function init(data) {
    contracts = data.contracts;
    // What the column matches: a value for each facet, with the department by name.
    contracts.forEach((c) => {
      c.facet = Object.fromEntries(FACETS.map((f) => [f.name, f.of(c)]));
    });
    supplyChoices();
    column.addEventListener("marin-filter-change", (event) => {
      // Reset also goes back to the first tab (Stats off); it leaves the sort and the list alone.
      if (event.detail.source === "reset") state.stats = false;
      refilter();
    });
    $("sort-group").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort]");
      if (!button) return;
      state.sort = button.dataset.sort;
      refilter();
    });
    wireActions();
    contractsEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-badge-facet]");
      if (!button) return;
      column.setValue(button.dataset.badgeFacet, [button.dataset.badgeValue]);
      refilter();
    });
    $("view-tabs").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      state.view = button.dataset.view;
      state.stats = false;
      state.shown = PAGE;
      render();
    });
    statsToggle.addEventListener("click", () => { state.stats = !state.stats; render(); });
    $("more-button").addEventListener("click", () => { state.shown += PAGE; render(); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
      Object.values(state.charts).forEach((chart) => chart.destroy());
      state.charts = {};
      if (state.stats) render();
    });
    render();
    column.updateCounts(contracts);
  }

  readUrl();
  // The data and the drawn column are both needed before the choices can be supplied.
  const columnReady = new Promise((resolve) => (column.setOptions ? resolve() : column.addEventListener("marin-filter-ready", resolve, { once: true })));
  Promise.all([fetch(DATA_URL).then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad response")))), columnReady])
    .then(([data]) => { const display = window.marinDisplayName; data.contracts.forEach((c) => { c.name = display(c.name); c.vendor = display(c.vendor); }); Object.values(data.vendors || {}).forEach((v) => { v.name = display(v.name); }); return init(data); })
    .catch(() => { summaryEl.textContent = "Could not load the contracts right now. Try reloading the page."; });
})();
