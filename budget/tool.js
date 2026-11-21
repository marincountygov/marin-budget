// The Budget tool (every budget book's home page): the filter column, a "Showing" line, live stats for what is selected, sort, and cards or a table.
// The page holds every line twice, as a card and as a table row, with its figures in data attributes. The shell draws the
// filter column from filters.json and matches the lines (column.filter); this script hides the cards that do not match and
// does the rest from the cards still showing. Filters, sort and view are kept in the address, so Copy link shares what is on screen.
(async () => {
  const cardsEl = document.getElementById("line-cards");
  const tableWrap = document.getElementById("line-table-wrap");
  const tbody = document.querySelector("#line-table tbody");
  const summaryEl = document.getElementById("active-filters");
  const bar = document.querySelector(".search-results .doc-actions");
  const exportEl = document.getElementById("line-export");
  const selectAll = document.getElementById("select-all-checkbox");
  const countEl = document.getElementById("selection-count");
  const selected = new Set();
  let showing = [];
  const cards = Array.from(cardsEl.children);
  const rows = new Map(Array.from(tbody.children).map((row) => [row.dataset.line, row]));
  const money = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US");
  const millions = (n) => (n < 0 ? "−" : "") + "$" + (Math.abs(n) / 1e6).toFixed(1) + "M";
  const params = () => new URLSearchParams(window.location.search);
  const remember = (name, value, fallback) => {
    const p = params();
    if (value === fallback) p.delete(name);
    else p.set(name, value);
    const next = p.toString();
    window.history.replaceState(null, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
  };
  const cfg = JSON.parse(document.getElementById("tool-config").textContent);
  // Every column, by position: the table, the CSV and the data attributes of a line (v0, v1, ...) use these.
  const YEARS = cfg.columns.map((c, k) => ({ key: String(k), label: c.label }));
  // With measures, a column is one measure in one year ("Total expenditures, FY 2026-27 Proposed"), so a figure is never read as another measure.
  // Without them, a column is a year. What is shown is a choice of measures and years; the first of the measures chosen, in its latest chosen year, is the main figure.
  const MULTI = Boolean(cfg.measures);
  const MEASURES = MULTI ? cfg.measures : [{ id: "", label: "" }];
  const measureLabel = Object.fromEntries(MEASURES.map((m) => [m.id, m.label]));
  const YEAR_LABELS = MULTI ? [...new Set(cfg.columns.map((c) => c.label))] : cfg.columns.map((c) => c.label);
  const colOf = (m, y) => cfg.columns.findIndex((c) => (MULTI ? c.measure === m : true) && c.label === YEAR_LABELS[y]); // -1 when the book has no such figure
  const columnName = (k) => (MULTI ? `${measureLabel[cfg.columns[k].measure]}, ${cfg.columns[k].label}` : cfg.columns[k].label);
  // The budget book: each book is its own page, so choosing one goes to it. Only a page of this site.
  const goTo = (href) => { const url = new URL(href, window.location.href); if (url.origin === window.location.origin) window.location.assign(url.href); };

  // ---- the filter column: drawn by the shell from filters.json, which also matches the lines ------------------------
  const column = document.querySelector("[data-filter-column]");
  const facetKey = (name) => `facet${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  // What the column matches: one record for each line, with the fields filters.json names.
  const records = cards.map((card) => ({ line: card.dataset.line, title: card.dataset.title, ...Object.fromEntries(cfg.facets.map((f) => [f.name, card.dataset[facetKey(f.name)]])) }));
  // An address from before the column was drawn from a file still works: a list in one parameter (a,b) with a comma inside
  // a value written %2C, and ?show=N on a page with measures.
  const legacyAddress = () => {
    const p = params();
    let changed = false;
    cfg.facets.forEach((f) => {
      const known = new Set(records.map((r) => r[f.name]));
      const raw = p.getAll(f.name);
      if (raw.length !== 1 || known.has(raw[0])) return;
      const parts = raw[0].split(",").filter(Boolean).map((v) => v.replace(/%2C/g, ","));
      if (parts.length && parts.every((v) => known.has(v))) { p.delete(f.name); parts.forEach((v) => p.append(f.name, v)); changed = true; }
    });
    if (MULTI && p.has("show") && !p.has("measure") && !p.has("year")) {
      const k = Number(p.get("show"));
      if (cfg.columns[k]) { p.set("measure", cfg.columns[k].measure); p.set("year", String(YEAR_LABELS.indexOf(cfg.columns[k].label))); }
      p.delete("show");
      changed = true;
    }
    if (changed) window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  };
  legacyAddress();
  if (!column.setOptions) await new Promise((resolve) => column.addEventListener("marin-filter-ready", resolve, { once: true }));

  // What the cards, stats and charts show. The table always shows every column.
  const DEFAULT_MEASURE = MULTI ? cfg.columns[cfg.defaultColumn].measure : "";
  const DEFAULT_YEAR = YEAR_LABELS.indexOf(cfg.columns[cfg.defaultColumn].label);
  let selMeasures = [DEFAULT_MEASURE];
  let selYears = [DEFAULT_YEAR];
  let compareOn = false;
  const tidy = () => {
    selMeasures = MEASURES.map((m) => m.id).filter((id) => selMeasures.includes(id));
    selYears = Array.from(new Set(selYears)).sort((a, b) => a - b);
  };
  const primaryColumn = () => {
    for (const m of selMeasures) {
      const ys = selYears.filter((y) => colOf(m, y) >= 0);
      if (ys.length) return colOf(m, ys[ys.length - 1]);
    }
    for (let y = YEAR_LABELS.length - 1; y >= 0; y -= 1) if (colOf(selMeasures[0], y) >= 0) return colOf(selMeasures[0], y); // none of the chosen years has a figure: the latest there is
    return cfg.defaultColumn;
  };
  let col = cfg.defaultColumn;
  const mainMeasure = () => (MULTI ? cfg.columns[col].measure : "");
  // Read what the column holds. At least one measure and one year stay chosen: unchecking the last one puts it back.
  const readColumn = () => {
    const g = column.filterState.groups;
    if (MULTI) {
      const measures = g.measure || [];
      const chosenYears = (g.year || []).map(Number);
      if (measures.length) selMeasures = measures; else column.setValue("measure", selMeasures);
      if (chosenYears.length) selYears = chosenYears; else column.setValue("year", selYears.map(String));
      compareOn = (g.change || []).includes("1");
    } else selYears = [Number(g.year)];
    tidy();
    col = primaryColumn();
  };
  readColumn();
  const signedMoney = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));
  const sentenceCase = (text) => text.charAt(0).toLowerCase() + text.slice(1);
  // Each card lists the figure for every measure and year chosen (a dash where the book has none) and, when asked, the change between the last two years.
  const fill = (el, dl) => {
    const num = (k) => (k < 0 || el.dataset[`v${k}`] === "" ? null : Number(el.dataset[`v${k}`]));
    const out = [];
    selMeasures.forEach((m) => {
      selYears.forEach((y) => out.push([MULTI ? `${measureLabel[m]}, ${YEAR_LABELS[y]}` : YEAR_LABELS[y], num(colOf(m, y)), false]));
      const ys = selYears.filter((y) => colOf(m, y) >= 0);
      // Each year is compared with the one before it that is shown, so Actual to Approved and Approved to Proposed are both there when all three years are chosen.
      if (compareOn) for (let i = 1; i < ys.length; i += 1) {
        const [a, b] = [num(colOf(m, ys[i - 1])), num(colOf(m, ys[i]))];
        const pct = a ? ` (${(((b - a) / Math.abs(a)) * 100).toFixed(1)}%)` : "";
        out.push([`Change in ${sentenceCase(MULTI ? measureLabel[m] : "expenditures")}, ${YEAR_LABELS[ys[i - 1]]} to ${YEAR_LABELS[ys[i]]}`, a == null || b == null ? null : b - a, true, pct]);
      }
    });
    dl.innerHTML = out.map(([label, v, change, pct]) => `<div><dt>${label.replace(/&/g, "&amp;")}</dt><dd>${v == null ? "–" : change ? signedMoney(v) + (pct || "") : money(v)}</dd></div>`).join("");
  };
  const applyColumn = () => {
    cards.forEach((card) => {
      fill(card, card.querySelector("dl.capital-figures"));
      card.querySelectorAll(".drill-row:not([data-none])").forEach((row) => fill(row, row.querySelector(":scope > dl.capital-figures")));
    });
    document.querySelectorAll("[data-column-label]").forEach((el) => { el.textContent = columnName(col); });
  };
  // The column matches the lines; the cards the lines do not match are hidden, and the counts beside each choice follow.
  const filterNow = () => {
    const hit = new Set(column.filter(records).map((r) => r.line));
    cards.forEach((card) => { card.hidden = !hit.has(card.dataset.line); });
    update(cards.filter((card) => !card.hidden));
    column.updateCounts(records);
  };
  column.addEventListener("marin-filter-change", (event) => {
    const source = event.detail.source;
    if (source === "book") { goTo(event.detail.state.groups.book); return; }
    if (source === "reset") {
      // Reset puts the book back to the latest, even if that is another page; it also goes back to the first tab.
      if (cfg.currentBook !== cfg.latestBook) { goTo(cfg.latestBook); return; }
      tab = "lines";
      applyView();
    }
    readColumn();
    applyColumn();
    filterNow();
  });

  // ---- sort and view ------------------------------------------------------------------------------------------
  const SORTS = {
    book: (a, b) => a.dataset.order - b.dataset.order,
    amount: (a, b) => (Number(b.dataset[`v${col}`]) || 0) - (Number(a.dataset[`v${col}`]) || 0) || a.dataset.order - b.dataset.order,
    name: (a, b) => a.dataset.name.localeCompare(b.dataset.name, "en", { sensitivity: "base", numeric: true }),
  };
  let sort = SORTS[params().get("sort")] ? params().get("sort") : "name";
  let view = params().get("view") === "table" ? "table" : "cards";
  const hasCompare = Boolean(document.getElementById("line-compare"));
  const PANELS = { stats: "line-stats", ...(hasCompare ? { compare: "line-compare" } : {}) };
  let tab = PANELS[params().get("tab")] ? params().get("tab") : "lines";
  const press = (group, attr, value) => group.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
  const applySort = () => {
    cards.slice().sort(SORTS[sort]).forEach((card) => {
      cardsEl.appendChild(card);
      tbody.appendChild(rows.get(card.dataset.line));
    });
    press(document.getElementById("sort-group"), "data-sort", sort);
    remember("sort", sort, "book");
    refreshOutput();
  };
  const listEl = document.getElementById("line-list");
  const linesTab = document.getElementById("lines-tab");
  const applyView = () => {
    const stats = tab === "stats";
    const other = false;
    listEl.querySelectorAll("#line-cards, #line-table-wrap, #select-all-field").forEach((el) => { if (tab !== "lines") el.hidden = true; });
    if (tab === "lines") { cardsEl.hidden = view !== "cards"; tableWrap.hidden = view !== "table"; }
    Object.entries(PANELS).forEach(([name, id]) => { const el = document.getElementById(id); if (el) el.hidden = tab !== name; });
    Object.keys(PANELS).forEach((name) => { const t = document.getElementById(`${name}-toggle`); if (t) t.setAttribute("aria-pressed", String(tab === name)); });
    if (linesTab) linesTab.setAttribute("aria-selected", String(tab === "lines"));
    if (tab === "stats") ensureCharts().then(renderCharts).catch((error) => console.error(error));
    if (tab === "compare") renderCompare();
    document.getElementById("sort-group").hidden = tab !== "lines";
    document.getElementById("view-group").hidden = tab !== "lines";
    document.querySelector(".search-results .mm-results-summary").hidden = other;
    document.querySelector(".search-results .action-toolbar").hidden = other;
    const chartActions = document.getElementById("chart-actions");
    if (chartActions) chartActions.hidden = !(stats || tab === "compare");
    if (bar) {
      bar.dataset.formatsFor = "#line-export";
      bar.querySelectorAll(".menu").forEach((el) => { el.hidden = stats; });
    }
    remember("tab", tab, "lines");
    press(document.getElementById("view-group"), "data-view", view);
    remember("view", view, "cards");
    refreshOutput();
  };
  Object.keys(PANELS).forEach((name) => { const t = document.getElementById(`${name}-toggle`); if (t) t.addEventListener("click", () => { tab = name; applyView(); }); });
  if (linesTab) linesTab.addEventListener("click", () => { tab = "lines"; applyView(); });
  document.getElementById("sort-group").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sort]");
    if (b) { sort = b.dataset.sort; applySort(); }
  });
  document.getElementById("view-group").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) { view = b.dataset.view; applyView(); }
  });

  // ---- the filters: what is chosen, in words ------------------------------------------------------------------------
  const chosenFacet = (f) => column.filterState.groups[f.name] || [];

  // ---- stats --------------------------------------------------------------------------------------------------
  const num = (el, key) => Number(el.dataset[key]) || 0;
  // A division is part of its department, so it is added only when no department-level line is showing with it.
  const sum = (list, key) => { const top = list.some((el) => !el.dataset.nested); return list.reduce((n, el) => n + (top && el.dataset.nested ? 0 : num(el, key)), 0); };
  const setStat = (name, text) => { const el = document.querySelector(`[data-stat="${name}"]`); if (el) el.textContent = text; };
  const yearRows = Array.from(document.querySelectorAll("#selection-years tr"));
  const facetRows = Array.from(document.querySelectorAll("#selection-facet tr"));
  const cell = (tr, i, text) => { tr.children[i].textContent = text; };

  // When the filters leave one line, its name is the title of the page.
  const titleEl = document.getElementById("selection-title");
  const setSelectionTitle = () => {
    if (!titleEl) return;
    const one = showing.length === 1 ? showing[0].dataset.title : "";
    titleEl.textContent = one;
    titleEl.hidden = !one;
  };

  const update = (visible) => {
    const shown = new Set(visible.map((c) => c.dataset.line));
    rows.forEach((row, slug) => { row.hidden = !shown.has(slug); });
    setStat("total", millions(sum(visible, `v${col}`)));
    setStat("n", String(visible.length));
    setStat("count", String(new Set(visible.map((c) => c.dataset[facetKey(cfg.countFacet)])).size));
    yearRows.forEach((tr) => { const k = colOf(mainMeasure(), Number(tr.dataset.year)); cell(tr, 1, k < 0 ? "–" : money(sum(visible, `v${k}`))); });
    if (MULTI) {
      const table = document.getElementById("selection-years").closest("table");
      table.querySelector("caption").textContent = `${measureLabel[mainMeasure()]} by year, for the selection`;
      table.querySelector("thead th:nth-child(2)").textContent = measureLabel[mainMeasure()];
    }
    facetRows.forEach((tr) => {
      const mine = visible.filter((c) => c.dataset[facetKey(cfg.chartFacets[0])] === tr.dataset.value);
      cell(tr, 1, String(mine.length));
      cell(tr, 2, money(sum(mine, `v${col}`)));
    });
    // As on Marin Mentions: each filter in order (what is shown first, then the others), then the count with a breakdown of every value, zeros too.
    const parts = [...(MULTI ? [selMeasures.map((m) => measureLabel[m]).join(", ")] : []), selYears.map((y) => YEAR_LABELS[y]).join(", "), ...cfg.facets.map((f) => { const on = chosenFacet(f); return on.length ? on.join(" or ") : f.all; })];
    const q = column.filterState.search.trim();
    // The overview is of the whole book: it shows only while nothing narrows the selection (the year is not a filter).
    const overview = document.getElementById("stats-overview");
    if (overview) overview.hidden = Boolean(q) || cfg.facets.some((f) => chosenFacet(f).length > 0);
    const breakdown = valuesOf(cfg.breakdownFacet).map((v) => `${v} ${visible.filter((c) => c.dataset[facetKey(cfg.breakdownFacet)] === v).length}`).join(", ");
    column.setResults(visible.length, `Showing: ${q ? `“${q}” · ` : ""}${parts.join(" · ")} (${visible.length} ${visible.length === 1 ? cfg.noun.one : cfg.noun.many} — ${breakdown})`);
    showing = visible;
    setSelectionTitle();
    refreshOutput();
    renderCharts();
    if (tab === "compare") renderCompare();
  };

  // ---- charts: drawn with Chart.js the first time Stats opens, then redrawn as the selection changes ---------------
  const BLUE = "#0072B2";
  const chartBox = document.getElementById("selection-charts");
  const charts = {};
  const amount = (n, short) => {
    if (!short) return money(n);
    const abs = Math.abs(n);
    return abs >= 1e6 ? `$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1).replace(/\.0$/, "")}M` : abs >= 1e3 ? `$${Math.round(abs / 1e3)}K` : `$${abs}`;
  };
  const loadChart = () => new Promise((resolve, reject) => {
    if (window.Chart) return resolve();
    const script = document.createElement("script");
    script.src = chartBox.dataset.chartLib;
    script.onload = resolve;
    script.onerror = () => reject(new Error("The chart library could not be loaded"));
    document.head.append(script);
  });
  const describe = (id, summary) => {
    const card = chartBox.querySelector(`[data-chart-card="${id}"]`);
    card.querySelector("canvas").setAttribute("aria-label", `${card.querySelector("h3").textContent}. ${summary}`);
  };
  const valuesOf = (name) => Array.from(new Set(cards.map((c) => c.dataset[facetKey(name)])));
  const presentValues = (name) => Array.from(new Set(showing.map((c) => c.dataset[facetKey(name)])));
  const make = (id, type, config) => {
    const canvas = chartBox.querySelector(`[data-chart-card="${id}"] canvas`);
    canvas.hidden = false;
    charts[id] = new window.Chart(canvas, { type, ...config });
  };
  // The charts are built once, even when two parts of the page ask for them before the chart library has loaded.
  let chartsBuilding;
  const ensureCharts = () => { chartsBuilding = chartsBuilding || buildCharts(); return chartsBuilding; };
  const buildCharts = async () => {
    if (!chartBox || charts.years) return;
    await loadChart();
    window.Chart.defaults.color = getComputedStyle(chartBox).color;
    window.Chart.defaults.borderColor = getComputedStyle(chartBox.querySelector(".app-card")).borderTopColor;
    const base = { responsive: true, maintainAspectRatio: false, animation: false };
    const axis = () => ({ beginAtZero: true, ticks: { callback: (v) => amount(v, true) } });
    const tip = { callbacks: { label: (item) => `${item.dataset.label}: ${amount(item.parsed[item.chart.options.indexAxis === "y" ? "x" : "y"])}` } };
    make("years", "bar", { data: { labels: YEARS.map((y) => y.label), datasets: [{ label: "Expenditures", data: [], backgroundColor: BLUE, borderRadius: 4, maxBarThickness: 48 }] },
      options: { ...base, plugins: { legend: { display: false }, tooltip: tip }, scales: { y: axis(), x: { grid: { display: false } } } } });
    // A bar opens the level below it: a service area leaves its departments; a department leaves its own line, with its divisions and programs open.
    const drillInto = (name, value) => {
      column.setValue(name, [value]);
      filterNow();
      if (name === cfg.chartFacets[cfg.chartFacets.length - 1]) {
        tab = "lines";
        applyView();
        const card = cards.find((c) => !c.hidden && c.dataset.title === value);
        const drill = card && card.querySelector("details.drill");
        if (drill) drill.open = true;
        if (card) card.scrollIntoView({ block: "nearest" });
      }
    };
    cfg.chartFacets.forEach((name) => make(name, "bar", { data: { labels: valuesOf(name), datasets: [{ label: "Expenditures", data: [], backgroundColor: BLUE, borderRadius: 4, maxBarThickness: 20 }] },
      options: { ...base, indexAxis: "y", onClick: (event, els, chart) => { if (els.length) drillInto(name, chart.data.labels[els[0].index]); }, onHover: (event, els) => { event.native.target.style.cursor = els.length ? "pointer" : "default"; }, plugins: { legend: { display: false }, tooltip: tip }, scales: { x: axis(), y: { grid: { display: false } } } } }));
  };
  const renderCharts = () => {
    if (!charts.years) return;
    const none = `No ${cfg.noun.many} selected.`;
    const yearsShown = YEAR_LABELS.map((_, y) => y).filter((y) => colOf(mainMeasure(), y) >= 0); // the years the book has this measure for
    const yearData = yearsShown.map((y) => sum(showing, `v${colOf(mainMeasure(), y)}`));
    charts.years.data.labels = yearsShown.map((y) => YEAR_LABELS[y]);
    charts.years.data.datasets[0].data = yearData;
    charts.years.data.datasets[0].label = MULTI ? measureLabel[mainMeasure()] : "Expenditures";
    if (MULTI) chartBox.querySelector('[data-chart-card="years"] h3').textContent = `${measureLabel[mainMeasure()]} by year`;
    const peak = yearData.indexOf(Math.max(...yearData));
    describe("years", showing.length ? `${YEAR_LABELS[yearsShown[peak]]} is the largest at ${amount(yearData[peak])}.` : none);
    cfg.chartFacets.forEach((name) => {
      // Service areas, departments and budget units run A to Z; other facets, largest first.
      const alpha = cfg.alphabeticalFacets.includes(name);
      const pairs = presentValues(name).map((v) => [v, sum(showing.filter((c) => c.dataset[facetKey(name)] === v), `v${col}`)]).sort(alpha ? (a, b) => a[0].replace(/^\d{3}\s+/, "").localeCompare(b[0].replace(/^\d{3}\s+/, ""), "en", { sensitivity: "base", numeric: true }) : (a, b) => b[1] - a[1]);
      const largest = pairs.reduce((m, p) => (p[1] > m[1] ? p : m), pairs[0] || ["", 0]);
      charts[name].data.labels = pairs.map((p) => p[0]);
      charts[name].data.datasets[0].data = pairs.map((p) => p[1]);
      const total = pairs.reduce((n, p) => n + p[1], 0);
      describe(name, showing.length ? `${largest[0]} is the largest at ${amount(largest[1])} of ${amount(total)} in ${columnName(col)}.` : none);
      // One bar only repeats the number above it, so the chart is left out until the selection has more than one.
      chartBox.querySelector(`[data-chart-card="${name}"]`).hidden = pairs.length < 2 && showing.length > 0;
    });
    Object.values(charts).forEach((chart) => { chart.resize(); chart.update("none"); });
  };

  // ---- compare: two to four lines side by side, as charts and as a table ------------------------------------------
  // The rows, and each line's numbers in the same order, are in the tool's config (cfg.compare). The picks are kept in
  // the address (?tab=compare&compare=sheriff,probation).
  const cmp = cfg.compare;
  const compareEl = document.getElementById("line-compare");
  let compared = (params().get("compare") || "").split(",").filter(Boolean);
  const SERIES = ["#0072B2", "#E69F00", "#009E73", "#D55E00"];
  const cmpCharts = {};
  const text = (n, kind) => {
    if (n === null || n === undefined) return "–";
    if (kind === "money") return money(n);
    if (kind === "change") return (n > 0 ? "+" : n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-US");
    if (kind === "percent") return `${n}%`;
    if (kind === "fte") return Number(n).toFixed(2);
    return String(n);
  };
  const comparedLines = () => {
    const open = new Map(cards.map((c) => [c.dataset.line, c])); // every line, not only the ones the filters leave showing
    return compared.filter((slug) => open.has(slug)).slice(0, cmp.max).map((slug) => open.get(slug));
  };
  const rememberCompare = () => remember("compare", compared.join(","), "");
  const renderPicker = () => {
    const list = document.getElementById("compare-list");
    const full = comparedLines().length >= cmp.max;
    list.innerHTML = cards.slice().sort(SORTS.name).map((c) => {
      const on = compared.includes(c.dataset.line);
      const label = c.dataset.title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      return `<li><label><input type="checkbox" value="${c.dataset.line}"${on ? " checked" : ""}${!on && full ? " disabled" : ""}> ${label}</label></li>`;
    }).join("");
  };
  const makeCompareChart = (id, labels, datasets) => {
    const canvas = document.querySelector(`#compare-charts [data-chart-card="${id}"] canvas`);
    if (!canvas) return;
    canvas.hidden = false;
    const data = { labels, datasets };
    if (cmpCharts[id]) { cmpCharts[id].data = data; cmpCharts[id].update("none"); cmpCharts[id].resize(); return; }
    const base = { responsive: true, maintainAspectRatio: false, animation: false };
    const tip = { callbacks: { label: (item) => `${item.dataset.label}: ${amount(item.parsed.y)}` } };
    cmpCharts[id] = new window.Chart(canvas, { type: "bar", data, options: { ...base, plugins: { legend: { display: true, position: "bottom" }, tooltip: tip },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => amount(v, true) } }, x: { grid: { display: false } } } } });
  };
  const describeCompare = (id, summary) => {
    const card = document.querySelector(`#compare-charts [data-chart-card="${id}"]`);
    if (card) card.querySelector("canvas").setAttribute("aria-label", `${card.querySelector("h3").textContent}. ${summary}`);
  };
  const compareTable = () => {
    const lines = comparedLines();
    const head = ["", ...lines.map((c) => c.dataset.title)];
    const body = cmp.rows.map((row, i) => [row.label, ...lines.map((c) => text((cmp.lines[c.dataset.line] || [])[i], row.kind))]);
    return { lines, head, body };
  };
  const renderCompare = async () => {
    if (!hasCompare) return;
    if (tab === "compare" && !comparedLines().length) {
      // Opening Compare with lines picked on the Budget tab compares those.
      compared = pickedIn(showing).slice(0, cmp.max).map((c) => c.dataset.line);
      rememberCompare();
    }
    renderPicker();
    const { lines, head, body } = compareTable();
    const ready = lines.length >= 2;
    document.getElementById("compare-empty").hidden = ready;
    document.getElementById("compare-body").hidden = !ready;
    refreshOutput();
    if (!ready) return;
    const block = document.querySelector("#compare-body .table-block");
    block.querySelector("thead tr").innerHTML = head.map((h, i) => (i ? `<th scope="col" class="budget-table__num"><a href="${lines[i - 1].querySelector("a").getAttribute("href")}">${h.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a></th>` : `<th scope="col">Measure</th>`)).join("");
    block.querySelector("tbody").innerHTML = body.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((t) => `<td class="budget-table__num">${t}</td>`).join("")}</tr>`).join("");
    await ensureCharts();
    // One chart per group of rows: the years side by side, or the latest year's measures.
    ["year", "latest"].forEach((group) => {
      const picked = cmp.rows.map((row, i) => ({ row, i, spec: [].concat(row.chart || []).find((c) => c.group === group) })).filter((x) => x.spec);
      if (!picked.length) return;
      const datasets = lines.map((c, k) => ({ label: c.dataset.title, backgroundColor: SERIES[k % SERIES.length], borderRadius: 4, maxBarThickness: 40, data: picked.map((x) => (cmp.lines[c.dataset.line] || [])[x.i] ?? 0) }));
      makeCompareChart("cmp-" + group, picked.map((x) => x.spec.name), datasets);
      const top = datasets.map((d) => d.data.reduce((a, b) => Math.max(a, b), 0));
      const best = top.indexOf(Math.max(...top));
      describeCompare("cmp-" + group, `${datasets[best].label} has the largest figure, ${amount(top[best])}.`);
    });
  };
  const exportCompare = () => {
    const { head, body } = compareTable();
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    exportEl.innerHTML = `<table><caption>${esc(cmp.caption)}</caption><thead><tr>${head.map((h, i) => `<th>${esc(i ? h : "Measure")}</th>`).join("")}</tr></thead><tbody>` + body.map((r) => `<tr>${r.map((t) => `<td>${esc(t)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    const csv = document.getElementById("csv-table");
    if (csv) {
      csv.dataset.first = csv.dataset.first || JSON.stringify(JSON.parse(csv.textContent)[0]);
      csv.textContent = JSON.stringify([["Measure", ...head.slice(1)], ...body]);
    }
  };
  if (hasCompare) {
    document.getElementById("compare-list").addEventListener("change", (e) => {
      const box = e.target.closest("input[type=checkbox]");
      if (!box) return;
      compared = box.checked ? [...compared.filter((s) => s !== box.value), box.value] : compared.filter((s) => s !== box.value);
      rememberCompare();
      renderCompare();
    });
  }

  // ---- chart actions: Copy the charts (images and a summary) and download all as PNG --------------------------------
  const dateText = () => new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
  const summaryOf = (canvas) => {
    const title = window.marinChartTitle(canvas);
    const label = canvas.getAttribute("aria-label") || "";
    return label.startsWith(`${title}.`) ? label.slice(title.length + 1).trim() : "";
  };
  const drawnCanvases = () => Array.from((tab === "compare" ? document.getElementById("compare-charts") : chartBox).querySelectorAll("canvas")).filter((canvas) => !canvas.hidden);
  const say = (message) => { const status = bar && bar.querySelector(".doc-action-status"); if (status) status.textContent = message; };
  const downloadAllButton = document.getElementById("download-all-png-button");
  if (downloadAllButton) downloadAllButton.addEventListener("click", () => {
    drawnCanvases().forEach((canvas, index) => setTimeout(() => window.marinChartPng(canvas), index * 150));
  });
  const copyChartsButton = document.getElementById("copy-charts-button");
  if (copyChartsButton) copyChartsButton.addEventListener("click", async () => {
    const header = `${cfg.statsTitle} ${tab === "compare" ? "comparison" : "stats"} — ${dateText()}`;
    const filters = summaryEl.textContent;
    const canvases = drawnCanvases();
    const text = [header, filters, "", ...canvases.flatMap((canvas) => [window.marinChartTitle(canvas), summaryOf(canvas), ""])].join("\n").trim();
    const escape = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const html = `<div><b>${escape(header)}</b><br>${escape(filters)}<br><br>` + canvases.map((canvas) => {
      const title = window.marinChartTitle(canvas);
      return `<b>${escape(title)}</b><br>${escape(summaryOf(canvas))}<br><img src="${window.marinChartImage(canvas).toDataURL("image/png")}" alt="${escape(title)}" width="${canvas.clientWidth}" height="${canvas.clientHeight}">`;
    }).join("<br><br>") + "</div>";
    try {
      if (!(await window.marinCopyRich(text, html))) throw new Error("The browser did not copy");
      say("Copied charts to clipboard.");
    } catch (error) {
      console.error(error);
      say("Could not copy.");
    }
  });

  // ---- selection: Copy and Download hold the selected lines, or everything showing when none are selected --------
  const pickedIn = (list) => list.filter((c) => selected.has(c.dataset.line));
  const refreshOutput = () => {
    const picked = pickedIn(showing);
    const out = (picked.length ? picked : showing).slice().sort(SORTS[sort]);
    document.querySelectorAll("input[data-select]").forEach((box) => { box.checked = selected.has(box.dataset.select); });
    selectAll.disabled = showing.length === 0;
    selectAll.checked = showing.length > 0 && picked.length === showing.length;
    selectAll.indeterminate = picked.length > 0 && picked.length < showing.length;
    countEl.textContent = picked.length ? `${picked.length} selected` : "";
    if (tab === "compare") { exportCompare(); return; }
    const head = [cfg.titleLabel, ...cfg.facets.map((f) => f.label.replace(/s$/, "")), ...YEARS.map((y, k) => columnName(k))];
    const cellsOf = (c) => [c.dataset.title, ...cfg.facets.map((f) => c.dataset[facetKey(f.name)]), ...YEARS.map((y) => (c.dataset[`v${y.key}`] === "" ? "" : money(num(c, `v${y.key}`))))];
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    exportEl.innerHTML = `<table><caption>${esc(cfg.exportCaption)}</caption><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
      out.map((c) => `<tr>${cellsOf(c).map((t) => `<td>${esc(t)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
    const csv = document.getElementById("csv-table");
    if (csv) {
      csv.dataset.first = csv.dataset.first || JSON.stringify(JSON.parse(csv.textContent)[0]);
      const first = JSON.parse(csv.dataset.first);
      csv.textContent = JSON.stringify([first, ...out.map((c) => [c.dataset.title, ...cfg.facets.map((f) => c.dataset[facetKey(f.name)]), ...YEARS.map((y) => (c.dataset[`v${y.key}`] === "" ? "" : num(c, `v${y.key}`))), c.dataset.page])]);
    }
    const ld = document.getElementById("page-data");
    if (ld) {
      ld.dataset.all = ld.dataset.all || ld.textContent;
      const all = JSON.parse(ld.dataset.all);
      const keep = new Set(out.map((c) => c.dataset.ref));
      all["@graph"] = all["@graph"].filter((n) => keep.has(n["@id"]));
      ld.textContent = JSON.stringify(all);
    }
  };
  document.getElementById("line-list").addEventListener("change", (e) => {
    const box = e.target.closest("input[data-select]");
    if (!box) return;
    if (box.checked) selected.add(box.dataset.select);
    else selected.delete(box.dataset.select);
    refreshOutput();
  });
  selectAll.addEventListener("change", () => {
    showing.forEach((c) => { if (selectAll.checked) selected.add(c.dataset.line); else selected.delete(c.dataset.line); });
    refreshOutput();
  });

  filterNow();
  applyColumn();
  applySort();
  applyView();
})().catch((error) => console.error(error));
