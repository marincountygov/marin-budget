#!/usr/bin/env node
// Builds the Reports page: one report from the Budget, the Capital improvement plan and Contracts.
//
//   node scripts/build-reports.js     (after build-budget.js, build_contracts_view.py and build-capital.js)
//
// Each dataset is a report source: a file in reports/data/ with its lines (a name, the values to add up, and the fields a
// section can group or filter by), its columns and the book or file it comes from. reports/reports.js draws the page from them.
// Edit the data, never the generated page.

const fs = require('fs');
const path = require('path');
const { shell, esc } = require('./budget-shell');
const { actions, jsonBlock } = require('./page-actions');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports');
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(DATA, name), JSON.stringify(value) + '\n');

// ---- Capital improvement plan: each project, with what it costs and what is programmed each year ----------------------
const cip = readJson('capital/data/cip-display.json');
const cipSources = readJson('capital/data/sources.json');
const fy = (y) => 'FY ' + y;
write('capital.json', {
  id: 'capital', label: 'Capital improvement plan', titleLabel: 'Project',
  columns: [{ label: 'Cost estimate', kind: 'money' }, { label: 'Prior approvals', kind: 'money' }, ...cip.years.map((y) => ({ label: fy(y), kind: 'money' })), { label: 'Total funding', kind: 'money' }, { label: 'Additional funds needed', kind: 'money' }],
  defaultColumns: [0, cip.years.length + 2, cip.years.length + 3], compare: false,
  dimensions: [{ id: 'category', label: 'Category' }, { id: 'status', label: 'Status' }],
  source: cipSources.cipBook ? { label: cipSources.cipBook.title, url: cipSources.cipBook.url } : null,
  lines: cip.projects.map((p) => ({ title: p.name, nested: false, facets: { category: p.category || 'Other', status: p.cipStatus || 'Not recorded' },
    values: [p.costEstimate, p.priorApprovals, ...cip.years.map((y) => (p.byYear && p.byYear[y] != null ? p.byYear[y] : null)), p.totalFunding, p.additionalFundsNeeded].map((v) => (v == null ? null : v)) })),
});

// ---- Contracts: each contract, with its value ----------------------------------------------------------------------------
const vd = require('./contracts-data');
const contracts = vd.load();
const orgs = readJson('data/organizations.jsonld')['@graph'];
const codeOf = (o) => ((Array.isArray(o.identifier) ? o.identifier : []).find((i) => i.propertyID === 'local:marin-budget-department-code') || {}).value;
const orgByCode = new Map(orgs.filter(codeOf).map((o) => [codeOf(o), o]));
const deptName = (code) => (orgByCode.get(code) ? orgByCode.get(code).name : contracts.groups[code] || code);
if (contracts) {
  write('contracts.json', {
    id: 'contracts', label: 'Contracts', titleLabel: 'Contract',
    columns: [{ label: 'Contract value', kind: 'money' }, { label: 'Contracts', kind: 'count' }], defaultColumns: [0, 1], compare: false,
    dimensions: [{ id: 'dept', label: 'Department' }, { id: 'type', label: 'Contract type' }, { id: 'status', label: 'Status' }, { id: 'year', label: 'Year' }, { id: 'vendor', label: 'Vendor' }],
    source: { label: 'County of Marin contract data', url: 'https://marincountygov.github.io/marin-budget/contracts/data/contracts-display.json' },
    lines: contracts.contracts.map((c) => ({ title: c.name, nested: false, facets: { dept: deptName(c.dept), type: c.type || 'Not recorded', status: c.status === 'active' ? 'Active' : 'Terminated', year: String(c.year), vendor: c.vendor }, values: [c.value, 1] })),
  });
}

// ---- The page --------------------------------------------------------------------------------------------------------------
const sources = ['budget', 'capital', 'contracts'].filter((id) => fs.existsSync(path.join(DATA, id + '.json'))).map((id) => { const d = readJson(`reports/data/${id}.json`); return { id: d.id, label: d.label }; });
const csvs = [{ id: 'report', label: 'report', rows: [] }];
const body = `<h1 class="visually-hidden">Reports</h1><div class="reports-page" id="reports-page" data-sources-src="data/">` +
  `<div class="report-open"><button type="button" id="report-open" class="action-button" data-icon="folder-open">Open a saved report</button>` +
  `<input type="file" id="report-file" accept=".json" class="visually-hidden" tabindex="-1" aria-label="Saved report file"><span class="app-help-text" id="report-status" role="status" aria-live="polite"></span></div>` +
  `<form id="report-form" class="app-form-grid report-form">` +
  `<div class="app-field"><label for="report-title">Title</label><input type="text" id="report-title" value="Budget report" maxlength="120"></div>` +
  `<fieldset class="app-field"><legend>Include</legend><ul class="search-facet-list"><li><label><input type="checkbox" id="report-prepared" checked> Date prepared</label></li><li><label><input type="checkbox" id="report-source" checked> Source</label></li></ul></fieldset>` +
  `</form>` +
  `<ol class="report-sections" id="report-sections" aria-label="Sections"></ol>` +
  `<div class="report-add"><div class="app-field"><label for="report-add-source">Add a section from</label><div class="report-add-row"><select id="report-add-source">${sources.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select>` +
  `<button type="button" id="report-add" class="action-button" data-icon="plus">Add section</button></div></div></div>` +
  `<div class="report-preview-head"><h2 id="report-preview-heading">Preview</h2>${actions('report', null, false, [{ id: 'report', label: 'report' }], null, false, '<button type="button" data-button-kind="menu-item" data-download-report>Report file</button>')}</div>` +
  `<div id="report-preview" class="mm-report-doc"></div></div>` +
  `<script type="application/json" id="report-sources">${JSON.stringify(sources)}</script>` +
  jsonBlock(null, '../shared/page-data.js', csvs) +
  `<script src="../vendor/chart.min.js"></script><script src="../shared/reports.js"></script><script src="reports.js"></script>`;
fs.writeFileSync(path.join(OUT, 'index.html'), shell('Reports', 'Reports from the County of Marin budget, Capital Improvement Plan and contracts.', [['Marin Budget', '../index.html'], ['Reports', null]], body));
console.log(`reports: index.html and ${sources.length} sources`);
