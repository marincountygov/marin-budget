#!/usr/bin/env node
// Builds the Contracts tab: the tool (filters, a Vendors and a Contracts list, and a Stats view, all drawn by
// contracts/contracts.js from the data file) and one page for each vendor.
//
//   python3 scripts/build_contracts_view.py   (contracts/data/contracts-display.json from the JSON-LD)
//   node scripts/build-contracts.js
//
// Edit the data, never the pages. A contract's value is the amount of the contract, not what has been paid.

const fs = require('fs');
const path = require('path');
const vd = require('./contracts-data');
const bd = require('./budget-data');
const { actions, jsonBlock } = require('./page-actions');
const { shell } = require('./budget-shell');
const { writeSection } = require('./data-sections');
const { filterColumn } = require('./filter-column');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'contracts');
const VEND = path.join(OUT, 'vendors');
const data = vd.load();
if (!data) { console.error('contracts/data/contracts-display.json is missing; run scripts/build_contracts_view.py first.'); process.exit(1); }
fs.mkdirSync(VEND, { recursive: true });
fs.writeFileSync(path.join(VEND, 'styles.css'), '@import url("../styles.css");\n');

const { esc, money } = bd;
const DOCS = 'https://marincountygov.github.io/marin-pulse/';
const orgs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'organizations.jsonld'), 'utf8'))['@graph'];
const slugOf = (id) => id.split(/[/:]/).pop();
const codeOf = (o) => ((Array.isArray(o.identifier) ? o.identifier : []).find((i) => i.propertyID === 'local:marin-budget-department-code') || {}).value;
const orgByCode = new Map(orgs.filter(codeOf).map((o) => [codeOf(o), o]));
const deptName = (code) => (orgByCode.get(code) ? orgByCode.get(code).name : data.groups[code] || code);
// A department's page in Marin Docs.
const deptHref = (code) => (orgByCode.get(code) ? `${DOCS}organization/${slugOf(orgByCode.get(code)['@id'])}.html` : null);

const rows = data.contracts;
const byDept = vd.group(rows, 'dept').map((g) => ({ ...g, name: deptName(g.key) }));
const json = (id, v) => `<script type="application/json" id="${id}">${JSON.stringify(v).replace(/</g, '\\u003c')}</script>`;

// ---- The tool ----------------------------------------------------------------------------------------
// The filter column is drawn by the shell from filters.json. The choices come from the contracts the page loads, so the page's script
// supplies each group's choices (options.app); the search reads the fields the script puts on each contract.
const filters = {
  $schema: '../vendor/marinos/filter-panel.schema.json', schemaVersion: '1.0.0',
  search: { id: 'vendor-search-input', fields: ['name', 'vendor', 'id', 'type', 'project', 'facet.department'], match: 'phrase' },
  groups: [['department', 'Departments', 'All departments'], ['type', 'Contract types', 'All types'], ['status', 'Statuses', 'All statuses'], ['year', 'Years', 'All years']]
    .map(([id, label, allLabel]) => ({ type: 'checkbox', id, label, allLabel, options: { app: true }, param: id, field: `facet.${id}` })),
};
fs.writeFileSync(path.join(OUT, 'filters.json'), JSON.stringify(filters, null, 2) + '\n');
const card = (id, title) => `<div class="app-card"><h3>${title}</h3><div class="chart-box" id="stats-${id}-box"><canvas id="stats-${id}-chart" role="img" data-chart-title="${title}" aria-label="${title}"></canvas></div><div class="visually-hidden" id="stats-${id}-table"></div></div>`;
// Sort sits in the toolbar as icon buttons, as in Marin Reach (Lucide: arrow-down-wide-narrow, arrow-up-narrow-wide, arrow-down-a-z, arrow-down-z-a).
const sortButton = (key, label, paths, pressed) => `<button type="button" class="action-button" data-sort="${key}" aria-pressed="${pressed}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></button>`;
const sortGroup = `<div class="action-group" role="group" aria-label="Sort" id="sort-group">` +
  sortButton('high', 'Value, high to low', '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>', true) +
  sortButton('low', 'Value, low to high', '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>', false) +
  sortButton('az', 'Name, A to Z', '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>', false) +
  sortButton('za', 'Name, Z to A', '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 18h-5"/>', false) + `</div>`;
const longDate = (iso) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const tool = `<h1 class="visually-hidden">Contracts</h1>` +
  `<div class="search-layout">${filterColumn('contracts')}<div class="search-results"><div id="view-tab-row" class="tab-list"><div role="tablist" aria-label="List" id="view-tabs">` +
  `<button type="button" role="tab" aria-selected="true" data-view="contracts" class="tab-button">Contracts</button><button type="button" role="tab" aria-selected="false" data-view="vendors" class="tab-button">Vendors</button></div>` +
  `<button type="button" id="stats-toggle" class="tab-button" aria-pressed="false">Stats</button></div>` +
  `<div class="mm-results-summary"><p class="app-help-text" id="active-filters" data-filter-results tabindex="-1">Loading contracts&hellip;</p></div>` +
  `<div class="action-toolbar" id="results-toolbar">${sortGroup}` + actions('vendors', null, false, [{ id: 'vendors', label: 'vendors' }, { id: 'contracts', label: 'contracts' }], null, true, '', '.search-results') + `</div>` +
  `<script type="application/json" id="csv-vendors">[]</script><script type="application/json" id="csv-contracts">[]</script>` +
    `<ul class="search-results-list" id="contracts-results" aria-label="Contracts"></ul><ul class="search-results-list" id="vendors-results" aria-label="Vendors" hidden></ul>` +
  `<p id="more-row" hidden><button type="button" class="action-button" id="more-button" data-icon="chevron-down">Show more</button></p>` +
  `<div id="stats-view" hidden><div class="mm-stats-kpis" id="stats-kpis"></div><div class="mm-stats-grid">${card('departments', 'Contract value by department')}${card('types', 'Contract value by type')}${card('vendors', 'Top 10 vendors by contract value')}${card('years', 'Contract value by year')}</div></div>` +
  `</div></div>` +
  json('department-names', Object.fromEntries(byDept.map((g) => [g.key, g.name]))) +
  json('department-links', Object.fromEntries(byDept.filter((g) => deptHref(g.key)).map((g) => [g.key, deptHref(g.key)]))) +
  json('vendor-pages', Object.fromEntries(Object.entries(data.vendors).map(([id, v]) => [id, v.slug])));
writeSection('contracts', 'Contracts', `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2><ul><li><a href="./data/contracts-display.json">Contract data (JSON)</a></li></ul><p class="app-help-text">${esc(vd.NOTE)} ${data.excluded.count} placeholder records are left out.</p></section>`, '../contracts/');
fs.writeFileSync(path.join(OUT, 'index.html'), shell('Contracts', 'The vendors the County of Marin contracts with, with filters, contracts and stats.', [['Marin Budget', '../index.html'], ['Contracts', null]], tool +
  '<script src="../vendor/chart.min.js"></script><script src="../shared/page-data.js" defer></script><script src="../shared/display-name.js"></script><script src="contracts.js"></script>'));

// ---- One page for each vendor --------------------------------------------------------------------------
// Pages of vendors that are no longer in the data are removed.
for (const f of fs.readdirSync(VEND)) if (f.endsWith('.html')) fs.unlinkSync(path.join(VEND, f));
const contractRow = (r) => `<tr><th scope="row"><a href="../c/${esc(r.id)}.html">${esc(r.name)}</a></th><td>${deptHref(r.dept) ? `<a href="${deptHref(r.dept)}">${esc(deptName(r.dept))}</a>` : esc(deptName(r.dept))}</td><td>${esc(r.type || '')}</td><td>${r.status === 'active' ? 'Active' : 'Terminated'}</td>${bd.num(r.value, money(Math.round(r.value)))}<td>${esc([r.start, r.end].filter(Boolean).join(' to '))}</td></tr>`;
let count = 0;
for (const [id, v] of Object.entries(data.vendors)) {
  const mine = data.byVendor.get(id).slice().sort((a, b) => b.value - a.value);
  const total = vd.sum(mine);
  const depts = vd.group(mine, 'dept').map((g) => ({ ...g, name: deptName(g.key) }));
  const csvs = [{ id: 'contracts', label: 'contracts', rows: [['Contract', 'Contract id', 'Department', 'Type', 'Status', 'Year', 'Start', 'End', 'Value'], ...mine.map((r) => [r.name, r.id, deptName(r.dept), r.type || '', r.status, r.year, r.start || '', r.end || '', r.value])] }];
  const body = `<article class="content"><h1 class="doc-title">${esc(v.name)}</h1>${actions(v.slug, 'article.content', false, csvs)}` +
    `<section class="section" aria-labelledby="summary"><h2 id="summary">Summary</h2>${vd.kpis(mine, true)}${vd.allocationCharts(mine, 'vendor-chart', { byDept: depts, vendor: true, lib: '../../vendor/chart.min.js' })}</section>` +
    `<section class="section" aria-labelledby="by-department"><h2 id="by-department">Departments</h2>${vd.groupTable(`Contract value of ${v.name} by department`, 'Department', depts, total, (g) => (deptHref(g.key) ? `<a href="${deptHref(g.key)}">${esc(g.name)}</a>` : esc(g.name)))}</section>` +
    `<section class="section" aria-labelledby="contracts"><h2 id="contracts">Contracts</h2>${bd.table(`Contracts of ${v.name}`, ['Contract', 'Department', 'Type', 'Status', 'Value', 'Term'], mine.map(contractRow), '', [4])}</section>` +
    `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2><ul><li><a href="../data/contracts-display.json">Contract data (JSON)</a></li><li>Vendor record <code>urn:marin:vendor:${esc(id)}</code> in <code>vendors.jsonld</code></li></ul><p class="app-help-text">${esc(vd.NOTE)}</p></section>${jsonBlock(null, '../../shared/page-data.js', csvs)}</article>`;
  fs.writeFileSync(path.join(VEND, `${v.slug}.html`), shell(v.name, `Contracts the County of Marin has with ${v.name}.`, [['Marin Budget', '../../index.html'], ['Contracts', '../index.html'], [v.name, null]], body, '../'));
  count += 1;
}

// ---- One page for each contract ------------------------------------------------------------------------
// The name of the contract, its vendor and department as links, and its own facts in one list. Pages of contracts that are no longer in the data are removed.
const CONTRACTS = path.join(OUT, 'c');
fs.mkdirSync(CONTRACTS, { recursive: true });
fs.writeFileSync(path.join(CONTRACTS, 'styles.css'), '@import url("../styles.css");\n');
for (const f of fs.readdirSync(CONTRACTS)) if (f.endsWith('.html')) fs.unlinkSync(path.join(CONTRACTS, f));
const fact = (name, html) => (html ? `<div><dt>${esc(name)}</dt><dd>${html}</dd></div>` : '');
let contractPages = 0;
for (const c of rows) {
  const vendor = data.vendors[c.vendorId];
  const facts = fact('Vendor', vendor ? `<a href="../vendors/${esc(vendor.slug)}.html">${esc(c.vendor)}</a>` : esc(c.vendor)) +
    fact('Department', deptHref(c.dept) ? `<a href="${deptHref(c.dept)}">${esc(deptName(c.dept))}</a>` : esc(deptName(c.dept))) +
    fact('Amount', esc(money(Math.round(c.value)))) + fact('Status', c.status === 'active' ? 'Active' : 'Terminated') + fact('Type', esc(c.type || '')) + fact('Method', esc(c.method || '')) +
    fact('Start', esc(longDate(c.start))) + fact('End', esc(longDate(c.end))) + fact('Year', esc(String(c.year || ''))) + fact('Project', esc(c.project || '')) + fact('Contract number', esc(c.id));
  // The same buttons as a vendor's page (Copy, Copy link, Download), and a CSV of the contract.
  const csvs = [{ id: 'contract', label: 'contract', rows: [['Contract', 'Contract number', 'Vendor', 'Department', 'Amount', 'Status', 'Type', 'Method', 'Start', 'End', 'Year', 'Project'],
    [c.name, c.id, c.vendor, deptName(c.dept), Math.round(c.value), c.status === 'active' ? 'Active' : 'Terminated', c.type || '', c.method || '', c.start || '', c.end || '', c.year || '', c.project || '']] }];
  const body = `<article class="content"><h1 class="doc-title">${esc(c.name)}</h1>${actions(c.id, 'article.content', false, csvs)}<div class="facts"><dl>${facts}</dl></div>${jsonBlock(null, '../../shared/page-data.js', csvs)}</article>`;
  fs.writeFileSync(path.join(CONTRACTS, `${c.id}.html`), shell(c.name, `Contract ${c.id} of the County of Marin with ${c.vendor}.`, [['Marin Budget', '../../index.html'], ['Contracts', '../index.html'], [c.name, null]], body, '../'));
  contractPages += 1;
}
console.log(`contracts: index.html, ${count} vendor pages and ${contractPages} contract pages (${rows.length} contracts)`);
