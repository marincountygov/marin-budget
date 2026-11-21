// The Reports page: a report built from sections, each a table from one dataset (Budget, Capital improvement plan or
// Contracts). The report is plain data (shared/reports.js) drawn as a document in the Preview; Copy, Download and the
// report file all hold that same document. Each dataset is a file in data/ (see scripts/build-reports.js).
(() => {
  const R = window.BudgetReports;
  const $ = (id) => document.getElementById(id);
  const manifest = JSON.parse($("report-sources").textContent);
  const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const money = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
  const signed = (n) => (n > 0 ? "+" : "") + money(n);
  const pct = (p) => `${p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
  const MAX_ROWS = 500; // a table in a report holds this many rows
  const cache = new Map();
  const load = (id) => {
    if (!cache.has(id)) cache.set(id, fetch(`data/${id}.json`).then((r) => { if (!r.ok) throw new Error(`${id} could not be loaded`); return r.json(); }));
    return cache.get(id);
  };

  const list = $("report-sections");
  const previewEl = $("report-preview");
  const statusEl = $("report-status");
  const bar = document.querySelector(".report-preview-head .doc-actions");
  const sections = [];
  let nextUid = 1;
  let opened = null; // a report opened from a file, shown until something is changed
  const say = (text) => { statusEl.textContent = text; };

  // ---- Sections ----------------------------------------------------------------------------------------------------
  const newSection = (src) => ({
    uid: nextUid++, src, title: "", group: src.dimensions[0].id, columns: src.defaultColumns.slice(), change: src.compare, percent: src.compare, total: true,
    sort: "name", limit: 0, filterDim: "", filterValue: "", chart: "", chartCol: src.compare ? "all" : String(src.defaultColumns[0]),
  });
  const dimLabel = (s, id) => (s.src.dimensions.find((d) => d.id === id) || {}).label || "";
  const valuesOf = (s, dim) => [...new Set(s.src.lines.map((l) => l.facets[dim]))].sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" }));
  const field = (id, label, control) => `<div class="app-field"><label for="${id}">${esc(label)}</label>${control}</div>`;
  const select = (id, opt, options, value) => `<select id="${id}" data-opt="${opt}">${options.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  const sectionHtml = (s) => {
    const d = s.src;
    const dims = d.dimensions.map((x) => [x.id, x.label]);
    const id = (name) => `s${s.uid}-${name}`;
    const checks = (opt, items) => items.map(([v, label, on]) => `<li><label><input type="checkbox" data-opt="${opt}" value="${esc(v)}"${on ? " checked" : ""}> ${esc(label)}</label></li>`).join("");
    const include = [...(d.compare ? [["change", "Change", s.change], ["percent", "Change, percent", s.percent]] : []), ["total", "Total row", s.total]];
    return `<li class="app-card report-section" data-uid="${s.uid}"><h3>${esc(d.label)}</h3><div class="app-form-grid">` +
      field(id("title"), "Title", `<input type="text" id="${id("title")}" data-opt="title" maxlength="200" value="${esc(s.title)}" placeholder="${esc(autoTitle(s))}">`) +
      field(id("group"), "Group by", select(id("group"), "group", [["", `Each ${d.titleLabel.toLowerCase()}`], ...dims], s.group)) +
      field(id("filterDim"), "Filter by", select(id("filterDim"), "filterDim", [["", "None"], ...dims], s.filterDim)) +
      field(id("filterValue"), "Is", `<select id="${id("filterValue")}" data-opt="filterValue" disabled></select>`) +
      field(id("sort"), "Sort", select(id("sort"), "sort", [["name", "Name, A to Z"], ["amount", "Largest first"]], s.sort)) +
      field(id("limit"), "Rows", select(id("limit"), "limit", [[0, "All"], [5, "First 5"], [10, "First 10"], [25, "First 25"]], s.limit)) +
      field(id("chart"), "Chart", select(id("chart"), "chart", [["", "None"], ["bars", "Bars"], ["columns", "Columns"]], s.chart)) +
      field(id("chartCol"), "Chart shows", `<select id="${id("chartCol")}" data-opt="chartCol" disabled></select>`) +
      `<fieldset class="app-field"><legend>Columns</legend><ul class="search-facet-list">${checks("col", d.columns.map((c, k) => [k, c.label, s.columns.includes(k)]))}</ul></fieldset>` +
      `<fieldset class="app-field"><legend>Include</legend><ul class="search-facet-list">${checks("inc", include)}</ul></fieldset></div>` +
      `<div class="report-section-actions"><button type="button" class="action-button" data-act="up" data-icon="arrow-up" aria-label="Move up" title="Move up"></button><button type="button" class="action-button" data-act="down" data-icon="arrow-down" aria-label="Move down" title="Move down"></button><button type="button" class="action-button is-danger" data-act="remove" data-icon="trash" aria-label="Remove section" title="Remove section"></button></div></li>`;
  };
  const renderList = () => {
    list.innerHTML = sections.map(sectionHtml).join("");
    sections.forEach((s) => { fillValues(s); fillChartCols(s); });
    preview();
  };
  const sectionEl = (s) => list.querySelector(`[data-uid="${s.uid}"]`);
  // The values of the filter: shown once a field is chosen.
  const fillValues = (s) => {
    const el = sectionEl(s);
    if (!el) return;
    const box = el.querySelector('[data-opt="filterValue"]');
    box.disabled = !s.filterDim;
    box.innerHTML = s.filterDim ? [["", "All"], ...valuesOf(s, s.filterDim).map((v) => [v, v])].map(([v, label]) => `<option value="${esc(v)}"${v === s.filterValue ? " selected" : ""}>${esc(label)}</option>`).join("") : "";
  };

  // What the chart shows: one of the chosen columns, or all of them side by side (for the years of the Budget).
  const fillChartCols = (s) => {
    const el = sectionEl(s);
    if (!el) return;
    const cols = s.columns.slice().sort((a, b) => a - b);
    const options = [...(s.src.compare && cols.length > 1 ? [["all", "All chosen years"]] : []), ...cols.map((k) => [String(k), s.src.columns[k].label])];
    if (!options.some(([v]) => v === s.chartCol)) s.chartCol = options.length ? options[0][0] : "";
    const box = el.querySelector('[data-opt="chartCol"]');
    box.disabled = !s.chart || !options.length;
    box.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}"${v === s.chartCol ? " selected" : ""}>${esc(label)}</option>`).join("");
  };

  // ---- Charts: drawn here to a picture, so the preview, Copy and the downloads all hold the same thing -----------------
  const PALETTE = ["#0072B2", "#E69F00", "#009E73", "#D55E00"];
  const MAX_BARS = 12;
  const short = (text) => (text.length > 42 ? text.slice(0, 41) + "…" : text);
  const axisText = (kind, n) => (kind === "count" ? n.toLocaleString("en-US") : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : money(n));
  const drawChart = (spec) => {
    if (typeof window.Chart !== "function") return null;
    const horizontal = spec.kind === "bars";
    const many = spec.series.length > 1;
    const width = 900;
    const height = horizontal ? 90 + spec.labels.length * 34 + (many ? 30 : 0) : 440;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const valueAxis = { beginAtZero: true, ticks: { color: "#1f1f1f", font: { size: 13 }, callback: (v) => axisText(spec.format, v) }, grid: { color: "#d0d0d0" } };
    const labelAxis = { ticks: { color: "#1f1f1f", font: { size: 13 } }, grid: { display: false } };
    const chart = new window.Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: spec.labels.map(short), datasets: spec.series.map((one, i) => ({ label: one.name, data: one.values, backgroundColor: PALETTE[i % PALETTE.length] })) },
      options: {
        indexAxis: horizontal ? "y" : "x", responsive: false, animation: false, devicePixelRatio: 1,
        plugins: { legend: { display: many, position: "bottom", labels: { color: "#1f1f1f", font: { size: 13 } } } },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
      },
      plugins: [{ id: "paper", beforeDraw: (c) => { const x = c.ctx; x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height); x.restore(); } }],
    });
    const image = canvas.toDataURL("image/png");
    chart.destroy();
    return { image, width, height };
  };
  // The chart of a table: its groups (the largest few) and the column or columns chosen.
  const chartOf = (s, lines, cols, title) => {
    if (!s.chart) return null;
    const r = R.build({ lines, years: cols, groupBy: s.group, total: false, sort: "amount", limit: 0 }); // every group, so the largest are the largest of all
    const idx = s.chartCol === "all" ? cols.map((_, i) => i) : [cols.indexOf(Number(s.chartCol))].filter((i) => i >= 0);
    if (!idx.length) return null;
    const last = idx[idx.length - 1];
    const rows = r.rows.filter((row) => row.values[last] != null).sort((a, b) => (b.values[last] || 0) - (a.values[last] || 0)).slice(0, MAX_BARS);
    if (!rows.length) return null;
    const kind = s.src.columns[cols[last]].kind;
    const spec = { kind: s.chart, format: kind, labels: rows.map((row) => row.label), series: idx.map((i) => ({ name: s.src.columns[cols[i]].label, values: rows.map((row) => row.values[i] || 0) })) };
    const total = r.rows.length;
    const top = rows[0];
    const summary = `${top.label} is the largest at ${fmt(kind, top.values[last])} in ${s.src.columns[cols[last]].label}${total > rows.length ? `. The ${rows.length} largest of ${total.toLocaleString("en-US")} are shown` : ""}.`;
    const picture = drawChart(spec);
    return { kind: s.chart, title: title + (idx.length === 1 ? `, ${s.src.columns[cols[idx[0]]].label}` : ""), summary, labels: spec.labels, series: spec.series, ...(picture || {}) };
  };

  // ---- The report ----------------------------------------------------------------------------------------------------
  const autoTitle = (s) => `${s.src.label}${s.group ? ` by ${dimLabel(s, s.group).toLowerCase()}` : ""}${s.filterDim && s.filterValue ? ` (${dimLabel(s, s.filterDim)}: ${s.filterValue})` : ""}`;
  const fmt = (kind, n) => (n == null ? "–" : kind === "count" ? Math.round(n).toLocaleString("en-US") : money(n));
  // A table holds MAX_ROWS rows at most, so "All" is not offered when more would be listed.
  const rowsAvailable = (s, lines) => (s.group ? new Set(lines.map((l) => l.facets[s.group])).size : lines.length);
  const tableFor = (s) => {
    const d = s.src;
    const lines = R.filterLines(d.lines, s.filterDim, s.filterValue);
    const over = rowsAvailable(s, lines) > MAX_ROWS;
    const limit = s.limit === 0 && over ? 25 : s.limit;
    const cols = s.columns.slice().sort((a, b) => a - b);
    if (!cols.length) return null;
    const r = R.build({ lines, years: cols, groupBy: s.group, change: s.change, percent: s.percent, total: s.total, sort: s.sort, limit });
    const named = (c) => (c.measure ? `${c.measure}, ${c.label}` : c.label);
    // A change compares two years of the same measure: each chosen year with the one before it (never expenditures against revenues).
    const groups = new Map();
    cols.forEach((k, i) => { const m = d.columns[k].measure || ""; (groups.get(m) || groups.set(m, []).get(m)).push(i); });
    const pairs = d.compare && cols.length > 1 ? [...groups.values()].flatMap((g) => g.slice(1).map((j, n) => [g[n], j])) : [];
    const withChange = s.change && pairs.length > 0;
    const withPercent = s.percent && pairs.length > 0;
    const pairName = ([i, j]) => { const prev = d.columns[cols[i]]; const last = d.columns[cols[j]]; return `${prev.measure ? `Change in ${prev.measure.toLowerCase()}` : "Change"}, ${prev.label} to ${last.label}`; };
    const diff = (row, [i, j]) => { const x = row.values[i]; const y = row.values[j]; return x == null || y == null ? null : y - x; };
    const pctOf = (row, [i, j]) => { const x = row.values[i]; const y = row.values[j]; return x == null || y == null || x === 0 ? null : Math.round(((y - x) / x) * 1000) / 10; };
    const head = [s.group ? dimLabel(s, s.group) : d.titleLabel, ...cols.map((k) => named(d.columns[k])), ...(withChange ? pairs.map(pairName) : []), ...(withPercent ? pairs.map((p) => `${pairName(p)}, percent`) : [])];
    const all = [...r.rows, ...(r.other ? [r.other] : []), ...(r.total ? [r.total] : [])];
    const cells = (row) => [row.label, ...row.values.map((v, i) => fmt(d.columns[cols[i]].kind, v)), ...(withChange ? pairs.map((p) => { const v = diff(row, p); return v == null ? "–" : signed(v); }) : []), ...(withPercent ? pairs.map((p) => { const v = pctOf(row, p); return v == null ? "–" : pct(v); }) : [])];
    const raw = (row) => [row.label, ...row.values.map((v) => (v == null ? "" : v)), ...(withChange ? pairs.map((p) => { const v = diff(row, p); return v == null ? "" : v; }) : []), ...(withPercent ? pairs.map((p) => { const v = pctOf(row, p); return v == null ? "" : v; }) : [])];
    const title = s.title.trim() || autoTitle(s);
    const chart = chartOf(s, lines, cols, title);
    return { type: "table", title, head, rows: all.map(cells), values: all.map(raw), over, ...(chart ? { chart } : {}) };
  };
  const syncControls = () => sections.forEach((s) => {
    const el = sectionEl(s);
    if (!el) return;
    const lines = R.filterLines(s.src.lines, s.filterDim, s.filterValue);
    const limitBox = el.querySelector('[data-opt="limit"]');
    const over = rowsAvailable(s, lines) > MAX_ROWS;
    limitBox.querySelector('option[value="0"]').disabled = over;
    if (over && s.limit === 0) { s.limit = 25; limitBox.value = "25"; }
    el.querySelector('[data-opt="title"]').placeholder = autoTitle(s);
  });
  const makeReport = () => {
    const tables = sections.map(tableFor).filter(Boolean);
    if (!tables.length) return null;
    const sources = [];
    if ($("report-source").checked) sections.forEach((s) => { const x = s.src.source; if (x && !sources.some((y) => y.url === x.url)) sources.push(x); });
    return R.create({ title: $("report-title").value.trim() || "Report", prepared: $("report-prepared").checked ? R.pacificToday() : "", filters: "", sources, sections: tables.map(({ over, ...t }) => t) }).report;
  };
  const fileName = (report) => (report ? report.title : "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  let report = null;
  function preview() {
    syncControls();
    report = opened || makeReport();
    if (!report) { previewEl.innerHTML = '<p class="app-empty">Add a section.</p>'; $("csv-report").textContent = "[]"; return; }
    const html = R.renderHtml(report); // every value is escaped by the renderer
    previewEl.innerHTML = html;
    $("csv-report").textContent = JSON.stringify(R.csvRows(report));
    if (bar) bar.dataset.fileName = fileName(report);
  }

  // ---- Events --------------------------------------------------------------------------------------------------------
  const changed = () => { opened = null; say(""); };
  const sectionOf = (el) => { const li = el.closest("[data-uid]"); return li && sections.find((s) => s.uid === Number(li.dataset.uid)); };
  const onOption = (e) => {
    const s = sectionOf(e.target);
    const opt = e.target.dataset.opt;
    if (!s || !opt) return;
    changed();
    const el = sectionEl(s);
    if (opt === "title") s.title = e.target.value;
    else if (opt === "group") s.group = e.target.value;
    else if (opt === "sort") s.sort = e.target.value;
    else if (opt === "limit") s.limit = Number(e.target.value);
    else if (opt === "filterDim") { s.filterDim = e.target.value; s.filterValue = ""; fillValues(s); }
    else if (opt === "filterValue") s.filterValue = e.target.value;
    else if (opt === "col") { s.columns = Array.from(el.querySelectorAll('[data-opt="col"]:checked')).map((b) => Number(b.value)); fillChartCols(s); }
    else if (opt === "chart") { s.chart = e.target.value; fillChartCols(s); }
    else if (opt === "chartCol") s.chartCol = e.target.value;
    else if (opt === "inc") { const on = (v) => Boolean(el.querySelector(`[data-opt="inc"][value="${v}"]:checked`)); s.change = on("change"); s.percent = on("percent"); s.total = on("total"); }
    preview();
  };
  list.addEventListener("input", (e) => { if (e.target.dataset.opt === "title") onOption(e); });
  list.addEventListener("change", onOption);
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const s = b && sectionOf(b);
    if (!s) return;
    changed();
    const i = sections.indexOf(s);
    if (b.dataset.act === "remove") sections.splice(i, 1);
    else if (b.dataset.act === "up" && i > 0) sections.splice(i - 1, 0, sections.splice(i, 1)[0]);
    else if (b.dataset.act === "down" && i < sections.length - 1) sections.splice(i + 1, 0, sections.splice(i, 1)[0]);
    renderList();
    const again = sectionEl(s) && sectionEl(s).querySelector(`[data-act="${b.dataset.act}"]`);
    if (again) again.focus();
    else if ($("report-add")) $("report-add").focus();
  });
  $("report-form").addEventListener("submit", (e) => e.preventDefault());
  $("report-form").addEventListener("input", () => { changed(); preview(); });
  $("report-form").addEventListener("change", () => { changed(); preview(); });

  const addSection = async (id) => {
    say("Loading…");
    try {
      const src = await load(id);
      sections.push(newSection(src));
      changed();
      renderList();
    } catch (error) {
      console.error(error);
      say("Could not load that data right now. Try reloading the page.");
    }
  };
  $("report-add").addEventListener("click", () => addSection($("report-add-source").value));

  // Copy and Download hold the report itself, not the page: the picture of each chart goes with the HTML, so pasting into Word brings the charts.
  const formats = () => (report ? { text: R.toText(report), html: R.renderHtml(report), markdown: R.toMarkdown(report) } : { text: "", html: "", markdown: "" });
  const wireMenus = () => { if (bar && window.marinFormatMenus) window.marinFormatMenus(bar, formats, { fileName: "report" }); };
  if (window.marinFormatMenus) wireMenus();
  else document.addEventListener("marinos:shell-ready", wireMenus, { once: true });
  // Download > HTML is the whole page (the HTML under Copy stays the part to paste), and Download > Report file saves the report to open again.
  if (bar) {
    bar.addEventListener("click", (e) => {
      const html = e.target.closest('[data-download-format="html"]');
      const file = e.target.closest("[data-download-report]");
      if (!html && !file) return;
      e.stopImmediatePropagation();
      if (!report) return;
      if (html) { window.marinDownload({ content: R.standaloneHtml(report), name: `${fileName(report)}.html` }); say("HTML file downloaded."); }
      else { window.marinDownload({ content: R.toJson(report), name: `${fileName(report)}.json` }); say("Report file downloaded."); }
    }, true);
  }
  // The shell script is deferred, so it may not be there yet: the file chooser is wired once the page has loaded.
  const wireOpen = () => window.marinUpload({
    button: $("report-open"), input: $("report-file"), accept: [".json"], maxBytes: 4000000, overlay: false, onMessage: say,
    onFile: async (file) => {
      const read = await window.marinReadText(file);
      const made = R.parseJson(read.text);
      if (!made.report) { say(made.errors[0]); return; }
      opened = made.report;
      say(`Opened ${file.name}.`);
      preview();
    },
  });
  if (typeof window.marinUpload === "function") wireOpen();
  else document.addEventListener("DOMContentLoaded", () => { if (typeof window.marinUpload === "function") wireOpen(); });

  addSection(manifest[0].id);
})();
