// A department's page on the "Budget and spending" tab: its figures for the measures, amounts and years that are chosen, and what it is
// made of, opened one level at a time in an accordion.
//   Divisions, programs and accounts   division > program > subprogram > budget unit > account
//   Funds                              fund > budget unit > account
//   Categories                         category (Salary and Benefits, Taxes, ...) > account
//   Functions                          function > budget unit > account
// A level is loaded when it is opened: the tree (every department's divisions, programs and subprograms) once, and this department's detail
// (its budget units, accounts and account rows) when a level that needs it is opened. Every row carries a figure for every column the tool has,
// so the choice of measures, amounts and years (the filter column of this page) applies at every level.
//
// A row has a name and a code. The choice of Names and codes says whether a row shows both (the code in brackets after the name), the name, or
// the code. A code is a link: it opens the tool of departments filtered by it.
(() => {
  const page = document.getElementById("department-page");
  const top = document.getElementById("department-top");
  if (!page || !top) return;
  const dept = page.dataset.dept;
  const column = document.querySelector("[data-filter-column]");
  const display = window.marinDisplayName;
  const cache = new Map();
  const getJson = (url) => {
    if (!cache.has(url)) cache.set(url, fetch(url).then((response) => { if (!response.ok) throw new Error(`${url}: ${response.status}`); return response.json(); }));
    return cache.get(url);
  };
  const ready = new Promise((resolve) => (column.setOptions ? resolve() : column.addEventListener("marin-filter-ready", resolve, { once: true })));

  Promise.all([getJson("config.json"), ready]).then(([dc]) => {
    display.use(dc.approved); // the approved shorthand and names, the same ones the pages were built with
    const RAW = dc.rawLabels.length; // the amounts a department's account rows hold: every year and kind of amount
    const treeKids = () => getJson(`${dc.base}tree.json`).then(({ nodes }) => {
      const kids = new Map();
      nodes.forEach((n) => kids.set(n.parent, [...(kids.get(n.parent) || []), n]));
      return kids;
    });
    let scopeOrg = null; // when the page is opened on one thing from a search: which budget units that thing covers, (org) => boolean
    const detailAll = () => getJson(`${dc.base}detail/${dept}.json`).then((d) => {
      if (!d.byOrg) { d.byOrg = new Map(); d.rows.forEach((r) => d.byOrg.set(r[0], [...(d.byOrg.get(r[0]) || []), r])); }
      return d;
    });
    // Opened on one thing from a search (scopeOrg is set): the charts and the table are of that thing's accounts only.
    const detail = () => detailAll().then((d) => {
      if (!scopeOrg) return d;
      if (!d.scoped) {
        const rows = d.rows.filter((r) => scopeOrg(d.organizations[r[0]]));
        const byOrg = new Map();
        rows.forEach((r) => byOrg.set(r[0], [...(byOrg.get(r[0]) || []), r]));
        d.scoped = { ...d, rows, byOrg };
      }
      return d.scoped;
    });

    // ---- what is chosen ----
    const ids = (list) => list.map((x) => x.id);
    let selMeasures = [dc.measures[0].id];
    let selBases = [dc.bases[0].id];
    let selYears = [dc.years.length - 1];
    let compareOn = false;
    const read = () => {
      const g = column.filterState.groups;
      // At least one measure, one amount and one year stay chosen: unchecking the last one puts it back.
      const keep = (id, chosen, current) => (chosen.length ? chosen : (column.setValue(id, current.map(String)), current));
      selMeasures = ids(dc.measures).filter((id) => (keep("measure", g.measure || [], selMeasures)).includes(id));
      selBases = ids(dc.bases).filter((id) => (keep("basis", g.basis || [], selBases)).includes(id));
      selYears = keep("year", (g.year || []).map(Number), selYears).slice().sort((a, b) => a - b);
      compareOn = (g.change || []).includes("1");
    };
    const mode = () => column.filterState.groups.labels || "both";
    const colOf = (m, b, y) => dc.columns.findIndex((c) => c.measure === m && c.basis === b && c.label === dc.years[y]);
    const money = (n) => { const r = Math.round(Math.abs(n)); return (n < 0 && r > 0 ? "−" : "") + "$" + r.toLocaleString("en-US"); };
    const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));

    // ---- figures: a row has a value for every column in its data-v attributes; the figures list shows the ones that are chosen ----
    const figuresOf = (el) => {
      const num = (k) => (k < 0 || el.dataset[`v${k}`] === "" ? null : Number(el.dataset[`v${k}`]));
      const single = selMeasures.length === 1; // one measure: the amount says it all; several: the measure comes first
      const out = [];
      selMeasures.forEach((m) => selBases.forEach((b) => {
        selYears.forEach((y) => { const k = colOf(m, b, y); if (k >= 0) out.push([single ? dc.columns[k].short : dc.columns[k].name, num(k), false]); });
        const ys = selYears.filter((y) => colOf(m, b, y) >= 0);
        if (compareOn) for (let i = 1; i < ys.length; i += 1) {
          const [a, c] = [num(colOf(m, b, ys[i - 1])), num(colOf(m, b, ys[i]))];
          const stem = single ? dc.columns[colOf(m, b, ys[0])].shortStem : dc.columns[colOf(m, b, ys[0])].stem;
          const pct = a ? ` (${(((c - a) / Math.abs(a)) * 100).toFixed(1)}%)` : "";
          out.push([`${stem}, change from ${dc.years[ys[i - 1]]} to ${dc.years[ys[i]]}`, a == null || c == null ? null : c - a, true, pct]);
        }
      }));
      return out;
    };
    const figureText = ([, v, change, pct]) => (v == null ? "–" : change ? signed(v) + (pct || "") : money(v));
    const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    // The box at the top: a list of the service area and the chosen figures.
    const fillTop = () => {
      const dl = top.querySelector("dl");
      const fixed = [...dl.querySelectorAll("[data-fixed]")].map((row) => row.outerHTML).join(""); // the facts (the service area, or what the found thing sits under) stay in the list
      dl.innerHTML = fixed + figuresOf(top).map((f) => `<div><dt>${escapeHtml(f[0])}</dt><dd>${figureText(f)}</dd></div>`).join("");
    };
    // The tables below: one column for each chosen figure, named once in the header.
    const refill = () => {
      fillTop();
      const labels = figuresOf(top).map((f) => f[0]);
      const names = ["Name", ...labels];
      const letterOf = (i) => { let s = ""; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
      page.querySelectorAll(".drill-table thead").forEach((head) => {
        head.innerHTML = `<tr class="col-handles"><th class="corner" data-select aria-label="Select all"></th>${names.map((l, i) => `<th class="col-handle${i ? " drill-num" : ""}" data-select-column="${i}" aria-label="Select column ${letterOf(i)}, ${escapeHtml(l)}">${letterOf(i)}</th>`).join("")}</tr>` +
          `<tr><th scope="col" class="row-handle"></th><th scope="col">Name</th>${labels.map((l) => `<th scope="col" class="drill-num">${escapeHtml(l)}</th>`).join("")}</tr>`;
      });
      page.querySelectorAll("tr.drill-row").forEach((row) => {
        row.querySelectorAll("td").forEach((td) => td.remove());
        figuresOf(row).forEach((f) => row.append(Object.assign(document.createElement("td"), { className: "drill-num", textContent: figureText(f) })));
      });
    };

    // ---- amounts: a vector holds the sums of one row, by group (object type and character code) and its Net County cost ----
    const newVec = () => ({ v: {}, ncc: null });
    const addRow = (vec, d, row) => {
      const object = d.objects[row[1]];
      const org = d.organizations[row[0]];
      const arr = vec.v[object.group] || (vec.v[object.group] = new Array(RAW).fill(0));
      for (let i = 0; i < RAW; i += 1) arr[i] += row[2 + i] || 0;
      if (dc.nccFunds.includes(org.fund) && (object.objectType === "Expenses" || object.objectType === "Revenues")) {
        vec.ncc = vec.ncc || new Array(RAW).fill(0);
        const sign = object.objectType === "Expenses" ? 1 : -1;
        for (let i = 0; i < RAW; i += 1) vec.ncc[i] += sign * (row[2 + i] || 0);
      }
      return vec;
    };
    const vecOf = (d, rows) => rows.reduce((vec, row) => addRow(vec, d, row), newVec());
    const isZero = (vec) => Object.values(vec.v).every((a) => a.every((x) => !x));
    const columnValues = (vec) => dc.columns.map((c, k) => {
      const pos = dc.columnPos[k];
      if (c.measure === "ncc") return vec.ncc ? vec.ncc[pos] || 0 : 0;
      return dc.measureGroups[c.measure].reduce((sum, g) => sum + ((vec.v[g] || [])[pos] || 0), 0);
    });

    // ---- names and codes ----
    const shownName = (name, code) => (mode() === "codes" ? code : name);
    const toolHref = (kind, code, name) => (kind === "fund" || kind === "function" || kind === "category" ? `../?${kind}=${encodeURIComponent(code)}` : kind === "department" ? `../?department=${encodeURIComponent(name)}` : `../?q=${encodeURIComponent(code)}`);
    const applyLabels = (root) => {
      root.querySelectorAll("[data-label-name]").forEach((el) => { el.textContent = shownName(el.dataset.labelName, el.dataset.labelCode); });
      root.querySelectorAll("a.code-link").forEach((el) => { el.hidden = mode() !== "both"; });
    };
    const codeLink = (kind, code, name) => {
      const a = document.createElement("a");
      a.className = "code-link";
      a.href = toolHref(kind, code, name);
      a.dataset.codeKind = kind;
      a.dataset.code = code;
      a.hidden = mode() !== "both";
      a.textContent = `(${code})`;
      a.title = "Filter by this code";
      return a;
    };

    // ---- rows ----
    const KIND = { division: "Division", program: "Program", subprogram: "Subprogram", organization: "Budget unit", account: "Account", fund: "Fund", function: "Function", category: "Category" };
    const toggleHolder = document.createElement("template");
    toggleHolder.innerHTML = `<button type="button" class="drill-toggle" data-button-kind="content" aria-expanded="false"></button>`;
    const rowEl = (item, depth) => {
      const tr = document.createElement("tr");
      tr.className = "drill-row";
      tr.dataset.depth = String(depth);
      columnValues(item.vec).forEach((value, k) => { tr.dataset[`v${k}`] = String(Math.round(value * 100) / 100); });
      const head = document.createElement("th");
      head.scope = "row";
      head.style.paddingLeft = `${0.5 + depth * 1.5}rem`;
      if (item.children) {
        const toggle = toggleHolder.content.firstElementChild.cloneNode(true);
        toggle.setAttribute("aria-label", `Open ${item.childLabel.toLowerCase()} of ${item.name}`);
        toggle.addEventListener("click", () => toggleRow(tr, toggle, item, depth));
        head.append(toggle);
      }
      const kind = document.createElement("span");
      kind.className = "drill-kind";
      kind.textContent = `${KIND[item.kind] || ""}: `;
      const name = document.createElement("span");
      name.dataset.labelName = item.name;
      name.dataset.labelCode = item.code;
      name.textContent = shownName(item.name, item.code);
      head.append(kind, name, " ", codeLink(item.kind, item.code, item.name));
      const handle = document.createElement("th");
      handle.className = "row-handle";
      handle.setAttribute("data-select-row", "");
      handle.setAttribute("aria-label", "Select row");
      tr.append(handle, head);
      return tr;
    };
    const note = (text) => { const tr = document.createElement("tr"); const td = Object.assign(document.createElement("td"), { className: "app-help-text", textContent: text }); td.colSpan = 99; tr.append(td); return tr; };
    // Opening a row puts its next level under it, one step in; closing it takes them away.
    const closeRow = (tr) => {
      const depth = Number(tr.dataset.depth);
      while (tr.nextElementSibling && (!tr.nextElementSibling.dataset.depth || Number(tr.nextElementSibling.dataset.depth) > depth)) tr.nextElementSibling.remove();
    };
    const toggleRow = (tr, toggle, item, depth) => {
      if (toggle.getAttribute("aria-expanded") === "true") { closeRow(tr); toggle.setAttribute("aria-expanded", "false"); return; }
      toggle.setAttribute("aria-expanded", "true");
      const loading = note("Loading…");
      tr.after(loading);
      item.children().then((items) => {
        const rows = items.length ? items.map((child) => rowEl(child, depth + 1)) : [note("Nothing here.")];
        loading.replaceWith(...rows);
        rows.forEach((row) => { if (row.classList.contains("drill-row")) { const cells = figuresOf(row); cells.forEach((f) => row.append(Object.assign(document.createElement("td"), { className: "drill-num", textContent: figureText(f) }))); } });
        applyLabels(page);
      }).catch((error) => {
        console.error(error);
        toggle.setAttribute("aria-expanded", "false");
        loading.replaceWith(note("Could not load this. Open it again to try again."));
      });
    };
    const populate = (body, items) => {
      const rows = items.length ? items.map((item) => rowEl(item, 0)) : [note("Nothing here.")];
      body.replaceChildren(...rows);
      rows.forEach((row) => { if (row.classList.contains("drill-row")) figuresOf(row).forEach((f) => row.append(Object.assign(document.createElement("td"), { className: "drill-num", textContent: figureText(f) }))); });
    };
    const fillWhenOpened = (details, body, load) => {
      details.addEventListener("toggle", () => {
        if (!details.open || details.dataset.loaded) return;
        details.dataset.loaded = "1";
        body.replaceChildren(note("Loading…"));
        load().then((items) => { populate(body, items); applyLabels(page); }).catch((error) => {
          console.error(error);
          details.dataset.loaded = "";
          body.replaceChildren(note("Could not load this. Close it and open it again to try again."));
        });
      });
      if (details.open) details.dispatchEvent(new Event("toggle")); // one that starts open is filled now
    };

    // ---- what each level lists ----
    const accountItems = (d, orgIndex) => (d.byOrg.get(orgIndex) || []).map((row) => ({ kind: "account", code: d.objects[row[1]].code, name: display(d.objects[row[1]].name, { kind: "object", code: d.objects[row[1]].code }), vec: addRow(newVec(), d, row) }))
      .filter((item) => !isZero(item.vec)).sort((a, b) => a.code.localeCompare(b.code));
    const orgItems = (d, test) => d.organizations.map((org, i) => ({ org, i })).filter(({ org }) => test(org))
      .map(({ org, i }) => ({ kind: "organization", code: org.code, name: display(org.name, { kind: "organization", code: org.code }), vec: vecOf(d, d.byOrg.get(i) || []), children: () => Promise.resolve(accountItems(d, i)), childLabel: "Accounts" }))
      .filter((item) => !isZero(item.vec)).sort((a, b) => a.name.localeCompare(b.name));
    const treeItems = (parentId) => Promise.all([treeKids(), detail()]).then(([kids, d]) => (kids.get(parentId) || []).map((node) => {
      const sub = kids.get(node.id) || [];
      const item = { kind: node.level, code: node.code, name: display(node.name, { kind: node.level, code: node.code }), vec: { v: node.v, ncc: node.ncc || null }, childLabel: dc.next[node.level] };
      if (sub.length) item.children = () => treeItems(node.id);
      else if (node.level === "subprogram") item.children = () => Promise.resolve(orgItems(d, (o) => `${dept}/${o.division}/${o.program}/${o.subprogram}` === node.id));
      return item;
    }));
    const groupBy = (d, key) => {
      const groups = new Map();
      d.rows.forEach((row) => { const k = key(row); groups.set(k, [...(groups.get(k) || []), row]); });
      return groups;
    };
    const byName = (a, b) => a.name.localeCompare(b.name);
    const VIEWS = {
      structure: () => treeItems(dept),
      funds: () => detail().then((d) => [...groupBy(d, (row) => d.organizations[row[0]].fund)].map(([code, rows]) => ({
        kind: "fund", code, name: display((d.funds.find((f) => f.code === code) || { name: code }).name, { kind: "fund", code }), vec: vecOf(d, rows), childLabel: dc.next.subprogram,
        children: () => Promise.resolve(orgItems(d, (o) => o.fund === code)),
      })).filter((item) => !isZero(item.vec)).sort(byName)),
      objects: () => detail().then((d) => [...groupBy(d, (row) => d.objects[row[1]].group)].map(([g, rows]) => ({
        kind: "category", code: dc.groups[g].code, name: dc.groups[g].name, vec: vecOf(d, rows), childLabel: "Accounts",
        children: () => Promise.resolve([...groupBy({ rows }, (row) => row[1])].map(([o, objectRows]) => ({ kind: "account", code: d.objects[o].code, name: display(d.objects[o].name, { kind: "object", code: d.objects[o].code }), vec: vecOf(d, objectRows) }))
          .filter((item) => !isZero(item.vec)).sort((a, b) => a.code.localeCompare(b.code))),
      })).filter((item) => !isZero(item.vec)).sort((a, b) => a.code.localeCompare(b.code))),
      functions: () => detail().then((d) => [...groupBy(d, (row) => d.organizations[row[0]].functionalActivity)].map(([code, rows]) => ({
        kind: "function", code, name: display((d.functionalActivities.find((f) => f.code === code) || { name: code }).name, { kind: "function", code }), vec: vecOf(d, rows), childLabel: dc.next.subprogram,
        children: () => Promise.resolve(orgItems(d, (o) => o.functionalActivity === code)),
      })).filter((item) => !isZero(item.vec)).sort(byName)),
    };
    page.querySelectorAll("details[data-view]").forEach((details) => fillWhenOpened(details, details.querySelector("tbody"), VIEWS[details.dataset.view]));

    // ---- the accounts of this department, as a file: one row for each account, with every amount the export holds ----
    const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
    const title = document.querySelector("#department-title [data-label-name]").dataset.labelName;
    const fileBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    document.addEventListener("click", (event) => {
      const item = event.target.closest("[data-accounts-format]");
      if (!item) return;
      const format = item.dataset.accountsFormat;
      detail().then((d) => {
        const head = ["Department", "Budget unit code", "Budget unit", "Division", "Program", "Subprogram", "Fund", "Function", "Account code", "Account", "Type", "Category", ...dc.rawLabels];
        const lines = d.rows.filter((row) => !scopeOrg || scopeOrg(d.organizations[row[0]])).map((row) => {
          const org = d.organizations[row[0]];
          const object = d.objects[row[1]];
          const fund = d.funds.find((f) => f.code === org.fund);
          const activity = d.functionalActivities.find((f) => f.code === org.functionalActivity);
          return [title, org.code, org.name, org.division, org.program, org.subprogram, `${org.fund} ${fund ? fund.name : ""}`.trim(), `${org.functionalActivity} ${activity ? activity.name : ""}`.trim(), object.code, object.name, object.objectType, dc.groups[object.group] ? dc.groups[object.group].name : "", ...row.slice(2, 2 + RAW)];
        });
        if (format === "json") {
          window.marinDownload({ content: JSON.stringify(lines.map((line) => Object.fromEntries(head.map((h, i) => [h, line[i]]))), null, 1), name: `${fileBase}${scopeOrg ? `-${new URLSearchParams(window.location.search).get("find")}` : ""}-accounts.json`, type: "application/json" });
        } else {
          window.marinDownload({ content: [head, ...lines].map((line) => line.map(csvCell).join(",")).join("\n"), name: `${fileBase}${scopeOrg ? `-${new URLSearchParams(window.location.search).get("find")}` : ""}-accounts.csv`, type: "text/csv" });
        }
      }).catch((error) => console.error(error));
    });

    // ---- the second layout: every account of the department, with all its fields, in one table that scrolls ----
    const tabSummary = document.getElementById("dept-tab-summary");
    const tabCharts = document.getElementById("dept-tab-charts");
    const tabTable = document.getElementById("dept-tab-table");
    const panelSummary = document.getElementById("dept-panel-summary");
    const panelCharts = document.getElementById("dept-panel-charts");
    const panelTable = document.getElementById("dept-panel-table");
    let layout = "summary";
    let activeCopy = null; // reads the selection of the table that holds it: () => { rows, what }
    let clearAccounts = () => {};
    let clearCharts = () => {};
    const show = (which) => {
      layout = which;
      const url = new URL(window.location.href);
      if (which === "summary" || (url.searchParams.get("find") && which === "table")) url.searchParams.delete("layout"); else url.searchParams.set("layout", which);
      window.history.replaceState(null, "", url);
      activeCopy = null;
      clearAccounts();
      clearCharts();
      page.querySelectorAll(".drill-table table").forEach((table) => table.dispatchEvent(new CustomEvent("drill-clear")));
      panelSummary.hidden = which !== "summary";
      panelCharts.hidden = which !== "charts";
      panelTable.hidden = which !== "table";
      [[tabSummary, "summary"], [tabCharts, "charts"], [tabTable, "table"]].forEach(([button, name]) => button.setAttribute("aria-pressed", String(which === name)));
      if (which === "table") buildAccounts();
      if (which === "charts") drawCharts();
    };
    const copyStatus = document.getElementById("dept-status");
    document.addEventListener("click", (event) => {
      const item = event.target.closest("[data-copy-selection]");
      if (!item) return;
      const picked = activeCopy ? activeCopy() : null;
      if (!picked) { copyStatus.textContent = "Select a row, column or cell first."; return; }
      if (!picked.rows) { copyStatus.textContent = "Select rows, columns or one range to copy."; return; }
      const text = picked.rows.map((r) => (item.dataset.copySelection === "csv" ? r.map(csvCell).join(",") : r.join("\t"))).join("\n");
      Promise.resolve(window.marinCopyText(text)).then((ok) => { copyStatus.textContent = ok ? `Copied ${picked.what}.` : "Could not copy."; });
    });
    tabSummary.addEventListener("click", () => show("summary"));
    tabCharts.addEventListener("click", () => show("charts"));
    tabTable.addEventListener("click", () => show("table"));

    // ---- the third layout: charts of the figure that is chosen (the first measure and amount, the last year), by what the department is made of ----
    // Colors that stay apart for people who see color differently; the figures are also in the Summary, so color is never the only signal.
    const COLORS = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#8c6d1f", "#555555", "#999999"];
    const chartLib = () => (window.Chart ? Promise.resolve() : new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement("script"), { src: panelCharts.dataset.lib, onload: resolve, onerror: () => reject(new Error("the chart library did not load")) });
      document.head.append(script);
    }));
    const drawn = [];
    const short = (n) => {
      const abs = Math.abs(n);
      const sign = n < 0 ? "−" : "";
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1).replace(/[.]0$/, "")}M`;
      if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
      return `${sign}$${Math.round(abs)}`;
    };
    const label = (item) => (mode() === "codes" ? item.code : mode() === "names" ? item.name : `${item.name} (${item.code})`);
    const card = (title, summary, height) => {
      const section = document.createElement("section");
      section.className = "app-card";
      const heading = document.createElement("h3");
      heading.textContent = title;
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.height = `${height}px`;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${title}. ${summary}`);
      wrap.append(canvas);
      section.append(heading, wrap);
      return [section, canvas];
    };
    // Bars and slices are selected as cells are: press one, drag across several, Shift for a range, Ctrl (Command) to add or take one away; the title of the chart selects all.
    // The selected ones keep their color and the rest fade; Copy copies the selected as a table of names and amounts (with the chart's name above).
    const charted = new Set();
    const selectable = (section, canvas, points, seriesName, title, chart) => {
      const state = { chart, selected: new Set(), anchor: null, dragging: false };
      const base = chart.config.type === "pie" ? chart.data.datasets[0].backgroundColor.slice() : chart.data.datasets[0].backgroundColor;
      const fade = (color) => `${color}55`;
      const paint = () => {
        const some = state.selected.size > 0;
        const set = chart.data.datasets[0];
        set.backgroundColor = chart.config.type === "pie" ? base.map((color, i) => (!some || state.selected.has(i) ? color : fade(color))) : points.map((_, i) => (!some || state.selected.has(i) ? base : fade(base)));
        set.borderColor = points.map((_, i) => (state.selected.has(i) ? "#1b1b1b" : "transparent"));
        set.borderWidth = points.map((_, i) => (state.selected.has(i) ? 2 : 0));
        chart.update("none");
        if (some) activeCopy = copyOf; else if (activeCopy === copyOf) activeCopy = null;
      };
      const copyOf = () => {
        const picked = [...state.selected].sort((a, b) => a - b);
        if (!picked.length) return null;
        const label = chart.config.type === "pie" ? "Fund" : title.replace(/^.*, by /, "").replace(/^./, (c) => c.toUpperCase());
        return { rows: [[label, seriesName], ...picked.map((i) => [points[i].label, String(Math.round(points[i].value * 100) / 100)])], what: picked.length === points.length ? "the chart" : picked.length === 1 ? "the value" : `${picked.length} values` };
      };
      const indexAt = (event) => {
        const hit = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true)[0];
        return hit ? hit.index : null;
      };
      const range = (a, b) => new Set(Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k));
      const apply = (index, event, drag) => {
        if (drag && state.anchor !== null) state.selected = range(state.anchor, index);
        else if (event.shiftKey && state.anchor !== null) state.selected = range(state.anchor, index);
        else if (event.ctrlKey || event.metaKey) { if (state.selected.has(index)) state.selected.delete(index); else state.selected.add(index); state.anchor = index; }
        else { state.selected = state.selected.size === 1 && state.selected.has(index) ? new Set() : new Set([index]); state.anchor = index; }
        charted.forEach((other) => { if (other !== state) other.clear(); }); // one chart holds the selection that Copy copies
        paint();
      };
      state.clear = () => { if (state.selected.size) { state.selected = new Set(); state.anchor = null; paint(); } };
      canvas.addEventListener("mousedown", (event) => {
        const index = indexAt(event);
        if (index === null) return;
        if (event.shiftKey) event.preventDefault();
        apply(index, event, false);
        state.dragging = !event.shiftKey && !event.ctrlKey && !event.metaKey;
      });
      canvas.addEventListener("mousemove", (event) => {
        const index = indexAt(event);
        canvas.style.cursor = index === null ? "default" : "pointer";
        if (state.dragging && event.buttons === 1 && index !== null) apply(index, event, true);
        else if (event.buttons !== 1) state.dragging = false;
      });
      document.addEventListener("mouseup", () => { state.dragging = false; });
      const heading = section.querySelector("h3");
      heading.style.cursor = "pointer";
      heading.addEventListener("click", () => {
        const all = state.selected.size === points.length;
        charted.forEach((other) => { if (other !== state) other.clear(); });
        state.selected = all ? new Set() : new Set(points.map((_, i) => i));
        state.anchor = null;
        paint();
      });
      charted.add(state);
      return chart;
    };
    clearCharts = () => { charted.forEach((state) => state.clear()); charted.clear(); };
    const drawCharts = () => {
      const m = selMeasures[0];
      const b = selBases[0];
      const y = selYears[selYears.length - 1];
      const k = colOf(m, b, y);
      charted.clear();
      drawn.splice(0).forEach((c) => c.destroy());
      panelCharts.replaceChildren();
      if (k < 0) { panelCharts.append(note("Nothing to chart for this choice.")); return; }
      Promise.all([chartLib(), scopeOrg ? Promise.resolve([]) : VIEWS.structure(), VIEWS.funds(), VIEWS.objects(), VIEWS.functions()]).then(([, ...lists]) => {
        if (layout !== "charts") return;
        window.Chart.defaults.color = getComputedStyle(panelCharts).color;
        window.Chart.defaults.borderColor = getComputedStyle(page).getPropertyValue("--app-border") || "#ccc";
        const name = dc.columns[k].name;
        const make = (title, items, wantPie) => {
          const rows = items.map((item) => ({ label: label(item), value: columnValues(item.vec)[k] })).filter((r) => r.value).sort((p, q) => Math.abs(q.value) - Math.abs(p.value));
          if (!rows.length) return;
          const pie = wantPie && rows.length > 1; // one slice says nothing: a bar instead
          const shown = rows.slice(0, 10);
          if (rows.length > 10) shown.push({ label: `${rows.length - 10} others`, value: rows.slice(10).reduce((sum, r) => sum + r.value, 0) });
          const [section, canvas] = card(`${name}, ${title}`, `${shown[0].label} is the largest at ${money(shown[0].value)}, of ${rows.length}.`, pie ? 300 : 70 + shown.length * 30);
          panelCharts.append(section);
          drawn.push(selectable(section, canvas, shown, name, title, new window.Chart(canvas, pie ? {
            type: "pie",
            data: { labels: shown.map((r) => r.label), datasets: [{ data: shown.map((r) => Math.max(r.value, 0)), backgroundColor: shown.map((_, i) => COLORS[i % COLORS.length]) }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } } },
          } : {
            type: "bar",
            data: { labels: shown.map((r) => r.label), datasets: [{ label: name, data: shown.map((r) => r.value), backgroundColor: COLORS[0] }] },
            options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.x) } } }, scales: { x: { ticks: { callback: (v) => short(v) } } } },
          })));
        };
        // The same figure in each year the data has, for the measure and amount chosen.
        const years = dc.years.map((yearLabel, yi) => ({ label: yearLabel, k: colOf(m, b, yi) })).filter((x) => x.k >= 0);
        if (years.length > 1) {
          const values = years.map((x) => (top.dataset[`v${x.k}`] === "" ? 0 : Number(top.dataset[`v${x.k}`])));
          const [section, canvas] = card(`${name.replace(/, FY [0-9]{4}-[0-9]{2}$/, "")}, by year`, `${years[values.indexOf(Math.max(...values))].label} is the highest at ${money(Math.max(...values))}.`, 300);
          panelCharts.append(section);
          drawn.push(selectable(section, canvas, years.map((x, i) => ({ label: x.label, value: values[i] })), name, `${name.replace(/, FY [0-9]{4}-[0-9]{2}$/, "")}, by year`, new window.Chart(canvas, {
            type: "bar",
            data: { labels: years.map((x) => x.label), datasets: [{ label: name, data: values, backgroundColor: COLORS[0] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } }, scales: { y: { ticks: { callback: (v) => short(v) } } } },
          })));
        }
        make("by division", lists[0], false);
        make("by fund", lists[1], true);
        make("by category", lists[2], false);
        make("by function", lists[3], false);
        if (!panelCharts.children.length) panelCharts.append(note("Nothing to chart for this choice."));
      }).catch((error) => { console.error(error); panelCharts.replaceChildren(note("Could not draw the charts.")); });
    };
    let accountsBuilt = false;
    const buildAccounts = () => {
      if (accountsBuilt) return;
      accountsBuilt = true;
      const body = panelTable.querySelector("tbody");
      const scroller = panelTable.querySelector(".accounts-scroll");
      Promise.all([detailAll(), getJson(`${dc.base}tree.json`)]).then(([d, { nodes }]) => {
        const named = new Map(nodes.map((n) => [n.id, `${display(n.name, { kind: n.level, code: n.code })} (${n.code})`]));
        const text = (name, code, kind) => `${display(name, { kind, code })} (${code})`;
        const head = ["Budget unit", "Division", "Program", "Subprogram", "Fund", "Function", "Account", "Type", "Category", ...dc.rawLabels];
        const letter = (i) => { let s = ""; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
        // As in a spreadsheet: the letters above the columns select a column, the numbers beside the rows select a row, the corner selects everything.
        panelTable.querySelector("thead").innerHTML = `<tr class="col-handles"><th class="corner" data-select="all" aria-label="Select all"></th>${head.map((h, i) => `<th class="col-handle${i >= 9 ? " drill-num" : ""}" data-select-column="${i}" aria-label="Select column ${letter(i)}, ${escapeHtml(h)}">${letter(i)}</th>`).join("")}</tr>` +
          `<tr><th scope="col" class="row-handle"></th>${head.map((h, i) => `<th scope="col" aria-sort="none"${i >= 9 ? ' class="drill-num"' : ""}><button type="button" class="sort-button" data-sort-column="${i}">${escapeHtml(h)}</button></th>`).join("")}</tr>`;
        const lines = d.rows.map((row) => {
          const org = d.organizations[row[0]];
          const object = d.objects[row[1]];
          const fund = d.funds.find((f) => f.code === org.fund);
          const activity = d.functionalActivities.find((f) => f.code === org.functionalActivity);
          return [text(org.name, org.code, "organization"), named.get(`${dept}/${org.division}`) || org.division, named.get(`${dept}/${org.division}/${org.program}`) || org.program,
            named.get(`${dept}/${org.division}/${org.program}/${org.subprogram}`) || org.subprogram, fund ? text(fund.name, fund.code, "fund") : org.fund,
            activity ? text(activity.name, activity.code, "function") : org.functionalActivity, text(object.name, object.code, "object"), object.objectType, dc.groups[object.group] ? dc.groups[object.group].name : "",
            ...row.slice(2, 2 + RAW)];
        });
        // Opened from a search result (?find=<code>): the page is about that one thing. Its name is the heading, its facts and its own figure are the list
        // below it, and only its accounts are in the table.
        const asked = new URLSearchParams(window.location.search);
        const find = asked.get("find");
        if (find) {
          const here = (code) => `${window.location.pathname}?find=${encodeURIComponent(code)}`;
          const whole = window.location.pathname;
          const prefix = (org) => `${dept}/${org.division}/${org.program}/${org.subprogram}`;
          // What was found: a budget unit (by its code), or a level of the department (division, program, subprogram).
          const unit = d.organizations.find((o) => o.code === find);
          const node = unit ? null : nodes.find((n) => n.code === find && n.id.startsWith(`${dept}/`) && n.level !== "department");
          const label = (id) => named.get(id) || id;
          const KINDS = { division: "Division", program: "Program", subprogram: "Subprogram" };
          let facts = []; // [name of the fact, text, address]
          let foundName = null;
          let kind = null;
          if (unit) {
            kind = "Budget unit";
            foundName = display(unit.name, { kind: "organization", code: unit.code });
            scopeOrg = (org) => org.code === find;
            const fund = d.funds.find((f) => f.code === unit.fund);
            const activity = d.functionalActivities.find((f) => f.code === unit.functionalActivity);
            facts = [["Department", `${title} (${dept})`, whole], ["Division", label(`${dept}/${unit.division}`), here(unit.division)], ["Program", label(`${dept}/${unit.division}/${unit.program}`), here(unit.program)],
              ["Subprogram", label(prefix(unit)), here(unit.subprogram)], ["Fund", fund ? text(fund.name, fund.code, "fund") : unit.fund, `../?fund=${encodeURIComponent(unit.fund)}`],
              ["Function", activity ? text(activity.name, activity.code, "function") : unit.functionalActivity, `../?function=${encodeURIComponent(unit.functionalActivity)}`]];
          } else if (node) {
            kind = KINDS[node.level];
            foundName = display(node.name, { kind: node.level, code: node.code });
            scopeOrg = (org) => prefix(org) === node.id || prefix(org).startsWith(`${node.id}/`);
            const up = node.id.split("/");
            facts = [["Department", `${title} (${dept})`, whole], ...up.slice(1, -1).map((_, i) => [KINDS[["division", "program", "subprogram"][i]], label(up.slice(0, i + 2).join("/")), here(up[i + 1])])];
          }
          if (kind) {
            const kept = lines.filter((line) => String(line[unit ? 0 : { Division: 1, Program: 2, Subprogram: 3 }[kind]]).endsWith(`(${find})`));
            foundCount = { kept: kept.length };
            lines.splice(0, lines.length, ...kept);
            // The heading is what was found; the kind sits under it.
            const heading = document.getElementById("department-title");
            heading.replaceChildren();
            const nameEl = Object.assign(document.createElement("span"), { textContent: foundName });
            nameEl.dataset.labelName = foundName;
            nameEl.dataset.labelCode = find;
            const codeEl = Object.assign(document.createElement("a"), { className: "code-link", href: `../?q=${encodeURIComponent(find)}`, textContent: `(${find})`, title: "Filter by this code" });
            codeEl.dataset.codeKind = unit ? "organization" : node.level;
            codeEl.dataset.code = find;
            heading.append(nameEl, " ", codeEl);
            document.getElementById("dept-showing").parentElement.hidden = true; // a page about one thing, not a filtered list: no "Showing:" line
            document.title = document.title.replace(/^[^|]*/, `${foundName} `);
            // Its own figures, for the choices in the filter column: summed from its accounts, not the department's.
            const mine = d.rows.filter((row) => scopeOrg(d.organizations[row[0]]));
            columnValues(vecOf(d, mine)).forEach((value, k) => { top.dataset[`v${k}`] = String(Math.round(value * 100) / 100); });
            const list = top.querySelector("dl");
            list.querySelectorAll("[data-fixed]").forEach((row) => row.remove());
            list.insertAdjacentHTML("afterbegin", facts.map(([name, value, href]) => `<div data-fixed><dt>${escapeHtml(name)}</dt><dd><a href="${escapeHtml(href)}">${escapeHtml(value)}</a></dd></div>`).join(""));
            document.getElementById("dept-tab-summary").hidden = true; // the Summary is of the whole department; the table and the charts are of this thing
            update();
          }
        }
        let paintRows = () => {};
        let clearRowSelections = () => {};
        let shown = 0;
        const more = () => {
          const rows = lines.slice(shown, shown + 300).map((line, offset) => `<tr data-i="${shown + offset}"><th scope="row" class="row-handle" data-select-row="${shown + offset}" aria-label="Select row ${shown + offset + 1}">${shown + offset + 1}</th>${line.map((cell, i) => (i >= 9 ? `<td class="drill-num">${cell == null || cell === "" ? "–" : money(Number(cell))}</td>` : `<td>${escapeHtml(String(cell == null ? "" : cell))}</td>`)).join("")}</tr>`);
          const before = body.children.length;
          body.insertAdjacentHTML("beforeend", rows.join(""));
          shown += rows.length;
          paintRows([...body.children].slice(before));
        };
        more();
        // A column sorts when its heading is pressed (again for the other way); the rows are sorted here, not on the page, because only some of them are drawn.
        const original = lines.slice();
        let sortColumn = -1;
        let sortDirection = "ascending";
        panelTable.querySelector("thead").addEventListener("click", (event) => {
          const button = event.target.closest("[data-sort-column]");
          if (!button) return;
          const column = Number(button.dataset.sortColumn);
          sortDirection = sortColumn === column && sortDirection === "ascending" ? "descending" : "ascending";
          sortColumn = column;
          const numeric = column >= 9;
          const sign = sortDirection === "ascending" ? 1 : -1;
          lines.splice(0, lines.length, ...original.slice().sort((a, b) => sign * (numeric ? (Number(a[column]) || 0) - (Number(b[column]) || 0) : String(a[column] == null ? "" : a[column]).localeCompare(String(b[column] == null ? "" : b[column]), undefined, { numeric: true, sensitivity: "base" }))));
          panelTable.querySelectorAll("thead tr:last-child th").forEach((th, i) => th.setAttribute("aria-sort", i === column + 1 ? sortDirection : "none"));
          clearRowSelections();
          body.replaceChildren();
          shown = 0;
          scroller.scrollTop = 0;
          more();
        });
        scroller.addEventListener("scroll", () => { if (shown < lines.length && scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 400) more(); });
        // ---- what is selected, as in a spreadsheet ----
        // A selection is one or more ranges: { r1, r2, c1, c2 }, rows and columns counted in the table's order. A cell is a range of one; a row is every column of it;
        // a column is every row. Drag across cells, or press one and then press another with Shift, for a range. Press with Ctrl (Command on a Mac) to add another range,
        // or to take one away. Rows and columns are chosen the same way from the numbers and letters. Pressed again, a lone selection clears.
        const tableEl = panelTable.querySelector("table");
        tableEl.id = "accounts-table";
        const last = head.length - 1;
        let ranges = [];
        let anchor = null; // where the last plain or Ctrl press was: { row, column }
        const lastRow = () => lines.length - 1;
        const wholeTable = (r) => r.r1 === 0 && r.r2 >= lastRow() && r.c1 === 0 && r.c2 === last;
        const sameRange = (a, b) => a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;
        // The rows on the page are marked from the ranges; rows drawn later are marked as they are drawn.
        paintRows = (trs) => {
          const all = ranges.some(wholeTable);
          tableEl.classList.toggle("select-all", all);
          trs.forEach((tr) => {
            const i = Number(tr.dataset.i);
            const covering = all ? [] : ranges.filter((r) => i >= r.r1 && i <= r.r2);
            tr.children[0].toggleAttribute("data-sel", all || covering.some((r) => r.c1 === 0 && r.c2 === last));
            for (let c = 0; c <= last; c += 1) {
              const cell = tr.children[c + 1];
              const on = covering.some((r) => c >= r.c1 && c <= r.c2);
              if (on !== cell.hasAttribute("data-sel")) cell.toggleAttribute("data-sel", on);
            }
          });
        };
        const paint = () => {
          paintRows([...body.children]);
          panelTable.querySelectorAll("thead [data-select-column]").forEach((th) => {
            const c = Number(th.dataset.selectColumn);
            th.toggleAttribute("data-sel", ranges.some((r) => c >= r.c1 && c <= r.c2 && r.r1 === 0 && r.r2 >= lastRow()) || ranges.some(wholeTable));
          });
          panelTable.querySelector(".corner").toggleAttribute("data-sel", ranges.some(wholeTable));
          if (ranges.length) activeCopy = grid; else if (activeCopy === grid) activeCopy = null;
        };
        clearAccounts = () => { ranges = []; anchor = null; paint(); };
        clearRowSelections = () => { ranges = ranges.filter((r) => r.r1 === 0 && r.r2 >= lastRow()); paint(); }; // after a sort, the rows are not the same rows
        const normal = (a, b) => ({ r1: Math.min(a.row, b.row), r2: Math.max(a.row, b.row), c1: Math.min(a.column, b.column), c2: Math.max(a.column, b.column) });
        // What a press on a cell, a row number, a column letter or the corner means.
        const target = (el) => {
          const handle = el.closest("[data-select], [data-select-column], [data-select-row]");
          if (handle && handle.dataset.select) return { row: 0, column: 0, rows: [0, lastRow()], columns: [0, last] };
          if (handle && handle.dataset.selectColumn !== undefined) { const c = Number(handle.dataset.selectColumn); return { row: 0, column: c, rows: [0, lastRow()], columns: [c, c], by: "column" }; }
          if (handle && handle.dataset.selectRow !== undefined) { const r = Number(handle.dataset.selectRow); return { row: r, column: 0, rows: [r, r], columns: [0, last], by: "row" }; }
          const cell = el.closest("tbody td");
          if (cell) { const r = Number(cell.parentElement.dataset.i); const c = cell.cellIndex - 1; return { row: r, column: c, rows: [r, r], columns: [c, c] }; }
          return null;
        };
        const apply = (t, event, dragging) => {
          const range = { r1: t.rows[0], r2: t.rows[1], c1: t.columns[0], c2: t.columns[1] };
          if (dragging && anchor) {
            ranges[ranges.length - 1] = t.by === "column" ? { r1: 0, r2: lastRow(), c1: Math.min(anchor.column, t.column), c2: Math.max(anchor.column, t.column) }
              : t.by === "row" ? { r1: Math.min(anchor.row, t.row), r2: Math.max(anchor.row, t.row), c1: 0, c2: last } : normal(anchor, t);
          } else if (event.shiftKey && anchor) {
            const extended = t.by === "column" ? { r1: 0, r2: lastRow(), c1: Math.min(anchor.column, t.column), c2: Math.max(anchor.column, t.column) }
              : t.by === "row" ? { r1: Math.min(anchor.row, t.row), r2: Math.max(anchor.row, t.row), c1: 0, c2: last } : normal(anchor, t);
            ranges = event.ctrlKey || event.metaKey ? [...ranges.slice(0, -1), extended] : [extended];
          } else if (event.ctrlKey || event.metaKey) {
            const at = ranges.findIndex((r) => sameRange(r, range));
            if (at >= 0) ranges.splice(at, 1); else ranges.push(range);
            anchor = { row: t.row, column: t.column };
          } else {
            ranges = ranges.length === 1 && sameRange(ranges[0], range) ? [] : [range]; // pressed again, it clears
            anchor = { row: t.row, column: t.column };
          }
          paint();
        };
        let dragging = false;
        tableEl.addEventListener("mousedown", (event) => {
          if (event.button !== 0 || event.target.closest("a, button")) return;
          const t = target(event.target);
          if (!t || (!event.target.closest("tbody td") && !event.target.closest("[data-select-row], [data-select-column], [data-select]"))) return;
          if (event.shiftKey) event.preventDefault(); // no text selected by the browser while a range is chosen
          apply(t, event, false);
          dragging = !event.shiftKey && !event.ctrlKey && !event.metaKey && Boolean(event.target.closest("tbody td, [data-select-row], [data-select-column]"));
        });
        tableEl.addEventListener("mouseover", (event) => {
          if (!dragging || event.buttons !== 1) { dragging = false; return; }
          const t = target(event.target);
          if (t) apply(t, event, true);
        });
        document.addEventListener("mouseup", () => { dragging = false; });
        // What is selected, as text: a tab between cells and a line between rows (as a spreadsheet pastes), or as CSV.
        const value = (line, column) => (column >= 9 ? (line[column] == null || line[column] === "" ? "" : String(Math.round(Number(line[column]) * 100) / 100)) : String(line[column] == null ? "" : line[column]));
        const columnsOf = (list) => [...new Set(list.flatMap((r) => Array.from({ length: r.c2 - r.c1 + 1 }, (_, k) => r.c1 + k)))].sort((a, b) => a - b);
        const grid = () => {
          if (!ranges.length) return null;
          if (ranges.some(wholeTable)) return { rows: [head, ...lines.map((line) => head.map((_, c) => value(line, c)))], what: "the table" };
          const wholeRow = (r) => r.c1 === 0 && r.c2 === last;
          const wholeColumn = (r) => r.r1 === 0 && r.r2 >= lastRow();
          if (ranges.length === 1) {
            const r = ranges[0];
            const cols = columnsOf([r]);
            const body = lines.slice(r.r1, r.r2 + 1).map((line) => cols.map((c) => value(line, c)));
            const withHeading = wholeColumn(r) ? [cols.map((c) => head[c]), ...body] : body;
            const what = wholeColumn(r) ? (cols.length === 1 ? "the column" : `${cols.length} columns`) : wholeRow(r) ? (body.length === 1 ? "the row" : `${body.length} rows`) : body.length === 1 && cols.length === 1 ? "the cell" : `${body.length} ${body.length === 1 ? "row" : "rows"} by ${cols.length} ${cols.length === 1 ? "column" : "columns"}`;
            return { rows: withHeading, what };
          }
          if (ranges.every(wholeRow)) { const picked = ranges.flatMap((r) => lines.slice(r.r1, r.r2 + 1)); return { rows: picked.map((line) => head.map((_, c) => value(line, c))), what: `${picked.length} rows` }; }
          if (ranges.every(wholeColumn)) { const cols = columnsOf(ranges); return { rows: [cols.map((c) => head[c]), ...lines.map((line) => cols.map((c) => value(line, c)))], what: `${cols.length} columns` }; }
          return { rows: null };
        };
      }).catch((error) => { console.error(error); accountsBuilt = false; console.error("Could not load the accounts."); });
    };

    // ---- the same selection in the tables of the Summary: drag or Shift for a range, Ctrl (Command) to add one; the letters, numbers and corner select a column, a row, everything ----
    // The rows of these tables come and go as levels are opened and closed, so a range is kept as the two rows it runs between (and read from the page when it is used).
    const drillSelection = (table) => {
      const body = table.querySelector("tbody");
      let ranges = []; // { a: row, b: row, c1, c2, allRows, allColumns }
      let anchor = null;
      let dragging = false;
      const rowsOf = () => [...body.querySelectorAll("tr.drill-row")];
      const lastColumn = () => Math.max(0, table.querySelectorAll("thead tr:last-child th").length - 2); // the first heading is the row number's
      const resolve = (rows) => ranges.map((r) => {
        const i1 = r.allRows ? 0 : rows.indexOf(r.a);
        const i2 = r.allRows ? rows.length - 1 : rows.indexOf(r.b);
        if (i1 < 0 || i2 < 0) return null;
        return { r1: Math.min(i1, i2), r2: Math.max(i1, i2), c1: r.allColumns ? 0 : r.c1, c2: r.allColumns ? lastColumn() : r.c2, allRows: r.allRows, allColumns: r.allColumns };
      }).filter(Boolean);
      const paint = () => {
        const rows = rowsOf();
        const live = resolve(rows);
        ranges = ranges.filter((r) => r.allRows || (rows.includes(r.a) && rows.includes(r.b)));
        const last = lastColumn();
        const everything = live.some((r) => r.allRows && r.allColumns);
        table.classList.toggle("select-all", everything);
        rows.forEach((tr, i) => {
          const covering = everything ? [] : live.filter((r) => i >= r.r1 && i <= r.r2);
          tr.children[0].toggleAttribute("data-sel", everything || covering.some((r) => r.c1 === 0 && r.c2 >= last));
          for (let c = 0; c <= last; c += 1) {
            const cell = tr.children[c + 1];
            if (!cell) continue;
            const on = covering.some((r) => c >= r.c1 && c <= r.c2);
            if (on !== cell.hasAttribute("data-sel")) cell.toggleAttribute("data-sel", on);
          }
        });
        table.querySelectorAll("thead [data-select-column]").forEach((th) => {
          const c = Number(th.dataset.selectColumn);
          th.toggleAttribute("data-sel", everything || live.some((r) => r.allRows && c >= r.c1 && c <= r.c2));
        });
        const corner = table.querySelector(".corner");
        if (corner) corner.toggleAttribute("data-sel", everything);
        if (live.length) activeCopy = grid; else if (activeCopy === grid) activeCopy = null;
      };
      let queued = false;
      new MutationObserver(() => { if (!queued) { queued = true; window.requestAnimationFrame(() => { queued = false; paint(); }); } }).observe(table, { childList: true, subtree: true });
      const target = (el) => {
        const handle = el.closest("[data-select], [data-select-column], [data-select-row]");
        if (handle && handle.dataset.select !== undefined) return { allRows: true, allColumns: true };
        if (handle && handle.dataset.selectColumn !== undefined) { const c = Number(handle.dataset.selectColumn); return { allRows: true, c1: c, c2: c, column: c, by: "column" }; }
        const tr = el.closest("tbody tr.drill-row");
        if (!tr) return null;
        if (handle) return { a: tr, b: tr, allColumns: true, row: tr, by: "row" };
        const cell = el.closest("td, th");
        const c = cell.cellIndex - 1;
        return { a: tr, b: tr, c1: c, c2: c, row: tr, column: c };
      };
      const rangeFor = (t, from) => {
        if (t.allRows && t.allColumns) return { allRows: true, allColumns: true };
        if (t.by === "column") { const c0 = from ? from.column : t.column; return { allRows: true, c1: Math.min(c0, t.column), c2: Math.max(c0, t.column) }; }
        if (t.by === "row") return { a: from ? from.row : t.row, b: t.row, allColumns: true };
        const f = from || t;
        return { a: f.row, b: t.row, c1: Math.min(f.column, t.column), c2: Math.max(f.column, t.column) };
      };
      const same = (x, y) => x.allRows === y.allRows && x.allColumns === y.allColumns && x.a === y.a && x.b === y.b && x.c1 === y.c1 && x.c2 === y.c2;
      const apply = (t, event, drag) => {
        if (drag && anchor) ranges[ranges.length - 1] = rangeFor(t, anchor);
        else if (event.shiftKey && anchor) { const extended = rangeFor(t, anchor); ranges = event.ctrlKey || event.metaKey ? [...ranges.slice(0, -1), extended] : [extended]; }
        else if (event.ctrlKey || event.metaKey) {
          const range = rangeFor(t, null);
          const at = ranges.findIndex((r) => same(r, range));
          if (at >= 0) ranges.splice(at, 1); else ranges.push(range);
          anchor = t;
        } else {
          const range = rangeFor(t, null);
          ranges = ranges.length === 1 && same(ranges[0], range) ? [] : [range];
          anchor = t;
        }
        // Only one table holds the selection that Copy copies.
        page.querySelectorAll(".drill-table table").forEach((other) => { if (other !== table) other.dispatchEvent(new CustomEvent("drill-clear")); });
        paint();
      };
      table.addEventListener("drill-clear", () => { ranges = []; anchor = null; paint(); });
      table.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || event.target.closest("a, button, .drill-toggle")) return;
        const t = target(event.target);
        if (!t) return;
        if (event.shiftKey) event.preventDefault();
        apply(t, event, false);
        dragging = !event.shiftKey && !event.ctrlKey && !event.metaKey;
      });
      table.addEventListener("mouseover", (event) => {
        if (!dragging || event.buttons !== 1) { dragging = false; return; }
        const t = target(event.target);
        if (t && t.by !== "column") apply(t, event, true);
      });
      document.addEventListener("mouseup", () => { dragging = false; });
      // What is selected, as text.
      const text = (cell) => cell.textContent.replace(/\s+/g, " ").trim();
      const amount = (cell) => {
        const raw = text(cell);
        if (!/^[−-]?\$[\d,]+/.test(raw) && !/^[+−-]?\$/.test(raw)) return raw;
        const negative = /^[−-]/.test(raw);
        return `${negative ? "-" : ""}${raw.replace(/[^\d.]/g, "")}`;
      };
      const valueOf = (tr, c) => { const cell = tr.children[c + 1]; if (!cell) return ""; if (cell.classList.contains("drill-num")) return text(cell) === "–" ? "" : amount(cell); return text(cell); };
      const headingOf = (c) => { const th = table.querySelectorAll("thead tr:last-child th")[c + 1]; return th ? text(th) : ""; };
      const grid = () => {
        const rows = rowsOf();
        const live = resolve(rows);
        if (!live.length) return null;
        const last = lastColumn();
        const everything = live.some((r) => r.allRows && r.allColumns);
        const wholeRow = (r) => r.c1 === 0 && r.c2 >= last;
        const wholeColumn = (r) => r.allRows || (r.r1 === 0 && r.r2 >= rows.length - 1);
        const cols = (list) => [...new Set(list.flatMap((r) => Array.from({ length: r.c2 - r.c1 + 1 }, (_, k) => r.c1 + k)))].sort((a, b) => a - b);
        if (everything) { const all = Array.from({ length: last + 1 }, (_, c) => c); return { rows: [all.map(headingOf), ...rows.map((tr) => all.map((c) => valueOf(tr, c)))], what: "the table" }; }
        if (live.length === 1) {
          const r = live[0];
          const cs = cols([r]);
          const body = rows.slice(r.r1, r.r2 + 1).map((tr) => cs.map((c) => valueOf(tr, c)));
          const rowsOut = wholeColumn(r) ? [cs.map(headingOf), ...body] : body;
          const what = wholeColumn(r) ? (cs.length === 1 ? "the column" : `${cs.length} columns`) : wholeRow(r) ? (body.length === 1 ? "the row" : `${body.length} rows`) : body.length === 1 && cs.length === 1 ? "the cell" : `${body.length} ${body.length === 1 ? "row" : "rows"} by ${cs.length} ${cs.length === 1 ? "column" : "columns"}`;
          return { rows: rowsOut, what };
        }
        if (live.every(wholeRow)) { const picked = live.flatMap((r) => rows.slice(r.r1, r.r2 + 1)); const all = Array.from({ length: last + 1 }, (_, c) => c); return { rows: picked.map((tr) => all.map((c) => valueOf(tr, c))), what: `${picked.length} rows` }; }
        if (live.every(wholeColumn)) { const cs = cols(live); return { rows: [cs.map(headingOf), ...rows.map((tr) => cs.map((c) => valueOf(tr, c)))], what: `${cs.length} columns` }; }
        return { rows: null };
      };
    };
    page.querySelectorAll(".drill-table table").forEach((table, n) => { table.id = table.id || `dept-table-${n}`; drillSelection(table); });

    const wanted = new URLSearchParams(window.location.search).get("layout");
    if (new URLSearchParams(window.location.search).get("find")) show(wanted === "charts" ? "charts" : "table"); // a search result opens on its accounts
    else if (wanted === "charts" || wanted === "table") show(wanted); // a shared link opens on the layout that was shared

    // ---- start, and follow the choices ----
    // What the figures are, in the words of the filter column: the choices made in it.
    // The one "Showing:" line, as the filter column writes it: the choices made in the filter column, then the count.
    let foundCount = null; // { kept } when the page is opened on one thing found by a search
    const showing = () => {
      const pick = (list, chosen) => list.filter((x) => chosen.includes(x.id)).map((x) => x.label);
      const years = selYears.map((y) => dc.years[y]);
      const figures = figuresOf(top).length;
      const parts = [pick(dc.measures, selMeasures).join(", "), pick(dc.bases, selBases).join(", "), years.join(", ")];
      if (compareOn) parts.push("Change between years");
      document.getElementById("dept-showing").textContent = parts.join(" \u00b7 "); // which figures these are, as the filter column has them chosen
    };
    const update = () => { read(); refill(); showing(); applyLabels(page); if (layout === "charts") drawCharts(); };
    column.addEventListener("marin-filter-change", (event) => {
      // Reset puts the choices back and closes what was opened, as when the page was first opened.
      update();
    });
    // Reset closes what was opened, even when the choices were already the first ones.
    document.addEventListener("click", (event) => {
      if (!event.target.closest('[aria-label="Reset filters"]')) return;
      page.querySelectorAll("details.drill").forEach((d) => { d.open = d.dataset.view === "structure"; });
      page.querySelectorAll("tr.drill-row").forEach((row) => { if (row.dataset.depth !== "0") row.remove(); else { const b = row.querySelector(".drill-toggle"); if (b) b.setAttribute("aria-expanded", "false"); } });
    });
    update();
  }).catch((error) => console.error(error));
})();
