#!/usr/bin/env node
// Builds the "Budget and spending" page on the County's financial-system export (budget/accounting/): one line for each department, with the
// figures the rollups hold, in the same tool as the budget books (scripts/budget-tool.js, budget/tool.js). The words on the page are in labels.js.
//
//   node scripts/build-accounting.js            (first: the rollups)
//   node scripts/build-spending.js
//
// Skipped, with a message, where data/accounting/rollups/ is not present (the accounting data is not committed yet).
//
// A line is a department. A column is one measure, one kind of amount and one year. What each measure adds up:
//   Expenditures                Expenses, except Transfers Out (58), Other Financing Uses (57) and Agency Disbursements (59)
//   Revenues                    Revenues, except Other Financing Srcs (48) and Agency Receipts (49)
//   Net County cost             expenses less revenues in funds 1000 and 2800 (the General Fund and HHS Operations); computed here
//   Contingencies               the Contingency object type
//   Transfers out / in          Transfers Out (58) / Other Financing Srcs (48)
//   Agency disbursements and other financing uses   (59 and 57);   Agency receipts   (49)
// so the pass-through and the transfers are shown apart and are not in the headline totals, and nothing is left out: Expenditures,
// Transfers out and the agency disbursements add up to all Expenses, and Revenues, Transfers in and agency receipts to all Revenues.

const fs = require('fs');
const path = require('path');
const { toolHtml, toolScripts, filtersFor, stampOf } = require('./budget-tool');
const { filterColumn } = require('./filter-column');
const { shell, dataStrip, esc } = require('./budget-shell');
const { jsonBlock, downloadMenu, copyMenu, fullscreenButton } = require('./page-actions');
const { writeSection } = require('./data-sections');
const L = require('./labels');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'data', 'accounting', 'rollups');
const OUT = path.join(ROOT, 'budget', 'accounting');
if (!fs.existsSync(path.join(RUN, 'index.json'))) {
  console.log('SKIP: data/accounting/rollups/ is not here, so budget/accounting/ was not built. Run node scripts/build-accounting.js first.');
  process.exit(0);
}
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const index = readJson('index.json');
const nodes = readJson('tree.json').nodes;
const deptFunds = readJson('department-funds.json').departments;
const failed = index.checks.filter((c) => !c.ok);
if (failed.length) { console.error(`The rollups failed a check (${failed[0].name}); not building.`); process.exit(1); }

// ---- the measures, the kinds of amount and the years ----
const gi = (type, code) => { const i = index.groups.findIndex((g) => g.objectType === type && g.code === code); if (i < 0) throw new Error(`no group ${type} ${code}`); return i; };
const all = (type) => index.groups.map((g, i) => (g.objectType === type ? i : -1)).filter((i) => i >= 0);
const without = (type, codes) => all(type).filter((i) => !codes.some((c) => gi(type, c) === i));
const MEASURES = [
  { id: 'exp', groups: without('Expenses', ['57', '58', '59']) },
  { id: 'rev', groups: without('Revenues', ['48', '49']) },
  { id: 'ncc', funds: ['1000', '2800'], bases: ['original', 'revised', 'actuals'] },
  { id: 'cont', groups: all('Contingency') },
  { id: 'xout', groups: [gi('Expenses', '58')] },
  { id: 'xin', groups: [gi('Revenues', '48')] },
  { id: 'pout', groups: [gi('Expenses', '59'), gi('Expenses', '57')] },
  { id: 'pin', groups: [gi('Revenues', '49')] },
].map((m) => ({ ...m, label: L.MEASURES[m.id] }));
const BASES = ['original', 'revised', 'actuals', 'encumbrance', 'available'].map((id) => ({ id, label: L.AMOUNTS[id] }));
const yearLabel = (key) => key.replace(/^fy(\d{4})_(\d{2})$/, 'FY $1-$2');
const YEARS = [...new Set(index.columns.map((c) => c.year))].sort();
const posOf = (year, basis) => index.columns.findIndex((c) => c.year === year && c.measure === basis);
const NOW = YEARS[YEARS.length - 1]; // the year in progress: its actuals are to date

// ---- the departments, in the tree's order (service areas A to Z, no service area last) ----
const byId = new Map(nodes.map((n) => [n.id, n]));
const depts = nodes.filter((n) => n.level === 'department');
const display = require('../shared/display-name');
const approved = L.approvedNames();
display.use(approved);

const cellOf = (node, groups, pos) => {
  let sum = 0; let seen = false;
  for (const g of groups) { const v = (node.v[g] || [])[pos]; if (v !== null && v !== undefined) { sum += v; seen = true; } }
  return seen ? Math.round(sum * 100) / 100 : (groups.length ? 0 : null);
};
const nccOf = (dept, pos) => {
  let sum = 0;
  for (const e of deptFunds[dept.code] || []) {
    if (!['1000', '2800'].includes(e.fund)) continue;
    for (const g of all('Expenses')) sum += (e.v[g] || [])[pos] || 0;
    for (const g of all('Revenues')) sum -= (e.v[g] || [])[pos] || 0;
  }
  return Math.round(sum * 100) / 100;
};
const value = (m, dept, basis, year) => {
  const pos = posOf(year, basis);
  return m.funds ? nccOf(dept, pos) : cellOf(dept, m.groups, pos);
};

// ---- the columns: every measure, kind of amount and year the data has; a column that is zero for every department is left out ----
const columns = [];
for (const m of MEASURES) for (const b of BASES) {
  if (m.bases && !m.bases.includes(b.id)) continue;
  for (const y of YEARS) {
    if (posOf(y, b.id) < 0) continue;
    const vals = depts.map((d) => value(m, d, b.id, y));
    if (vals.every((v) => v === 0 || v === null)) continue;
    columns.push({ label: yearLabel(y), measure: m.id, basis: b.id, year: y, stem: L.stem(m.id, b.id, y === NOW), name: L.columnName(m.id, b.id, yearLabel(y), y === NOW), shortStem: L.shortStem(m.id, b.id, y === NOW), short: L.shortName(m.id, b.id, yearLabel(y), y === NOW), vals });
  }
}
const defaultColumn = columns.findIndex((c) => c.measure === 'exp' && c.basis === 'original' && c.year === NOW);
if (defaultColumn < 0) throw new Error('no Expenditures, Original budget, current year column');
const measuresUsed = MEASURES.filter((m) => columns.some((c) => c.measure === m.id));
const basesUsed = BASES.filter((b) => columns.some((c) => c.basis === b.id));

// ---- every kind of expense and revenue is in one measure or another: nothing is dropped ----
for (const [type, parts] of [['Expenses', ['exp', 'xout', 'pout']], ['Revenues', ['rev', 'xin', 'pin']]]) {
  const mine = new Set(parts.flatMap((id) => MEASURES.find((m) => m.id === id).groups));
  const missing = all(type).filter((i) => !mine.has(i));
  if (missing.length || mine.size !== all(type).length) throw new Error(`${type}: ${missing.length} groups are in no measure, or one is in two`);
}

const budgetLabel = (d) => (d.hasBudget ? L.STATUS.has : L.STATUS.none);
// What each department holds, for the filters and for search: its funds, functions and categories, and every code in it.
const funds = readJson('funds.json').funds;
const functions = readJson('functional-activities.json').functionalActivities;
const fundNames = Object.fromEntries(funds.map((f) => [f.code, display(f.name, { kind: 'fund', code: f.code })]));
const functionNames = Object.fromEntries(functions.map((f) => [f.code, display(f.name, { kind: 'function', code: f.code })]));
const categoryNames = Object.fromEntries(index.groups.map((g) => [g.code, display(g.name, { kind: 'category', code: g.code })]));
const nonZero = (v) => Object.values(v).some((a) => a.some((x) => x));
const lines = depts.map((d, order) => {
  const title = display(d.name, { kind: 'department', code: d.code });
  const area = byId.get(d.parent).name;
  const detail = JSON.parse(fs.readFileSync(path.join(RUN, 'detail', `${d.code}.json`), 'utf8'));
  const fundCodes = (deptFunds[d.code] || []).filter((e) => nonZero(e.v)).map((e) => e.fund).sort();
  const functionCodes = [...new Set(detail.organizations.map((o) => o.functionalActivity))].sort();
  const categoryCodes = Object.keys(d.v).map((g) => index.groups[g].code).sort();
  const codes = [...new Set([...nodes.filter((n) => n.id.startsWith(`${d.code}/`)).map((n) => n.code), ...detail.organizations.map((o) => o.code), ...detail.objects.map((o) => o.code)])].join(' ');
  const terms = [...fundCodes.map((c) => fundNames[c]), ...functionCodes.map((c) => functionNames[c]), ...categoryCodes.map((c) => categoryNames[c]), d.name].join(' ').toLowerCase();
  return { slug: `d${d.code}`, ref: d.id, code: d.code, codes, terms, title, order, values: columns.map((c) => c.vals[depts.indexOf(d)]),
    facets: { area, department: title, budget: budgetLabel(d), fund: fundCodes, function: functionCodes, category: categoryCodes }, badges: [], href: `departments/${d.code}.html`, page: '' };
});
const slugs = new Set(lines.map((l) => l.slug));
if (slugs.size !== lines.length) throw new Error('two departments have the same slug');

// ---- Compare tab: the current year, by measure ----
const compareCols = [['exp', 'original'], ['exp', 'revised'], ['exp', 'actuals'], ['exp', 'available'], ['rev', 'original'], ['rev', 'revised'], ['rev', 'actuals'], ['ncc', 'original'], ['ncc', 'revised']]
  .map(([m, b]) => columns.findIndex((c) => c.measure === m && c.basis === b && c.year === NOW)).filter((k) => k >= 0);
const compare = { rows: compareCols.map((k) => ({ label: columns[k].stem, kind: 'money', chart: { group: 'latest', name: columns[k].stem } })),
  lines: Object.fromEntries(lines.map((l) => [l.slug, compareCols.map((k) => l.values[k])])), titles: { latest: `${yearLabel(NOW)}, by measure` } };

const cfg = {
  up: '../../', id: 'accounting', titleLabel: 'Department', noun: { one: 'department', many: 'departments', Many: 'Departments' }, codes: true,
  years: YEARS.map(yearLabel), columns: columns.map(({ vals, year, ...c }) => c), measures: measuresUsed.map(({ id, label }) => ({ id, label })), bases: basesUsed, defaultColumn, skipMissing: true,
  facets: [
    { name: 'area', label: 'Service areas', all: 'All service areas' },
    { name: 'department', label: 'Departments', all: 'All departments', noColumn: true },
    // The departments with an FY 2026-27 budget are the ones shown to begin with; the others are one choice away.
    { name: 'budget', label: 'Budget statuses', one: 'Budget status', all: 'All budget statuses', default: [L.STATUS.has] },
    // Funds, functions and categories are codes: the page supplies their choices, named or coded as the choice of Names and codes says.
    { name: 'fund', label: 'Funds', one: 'Fund', all: 'All funds', list: true, app: true, noColumn: true, names: fundNames },
    { name: 'function', label: 'Functions', one: 'Function', all: 'All functions', list: true, app: true, noColumn: true, names: functionNames },
    { name: 'category', label: 'Categories', one: 'Category', all: 'All categories', list: true, app: true, noColumn: true, names: categoryNames },
  ],
  chartFacets: ['area'], breakdownFacet: 'area', countFacet: 'area', countLabel: 'Service areas', linkFacet: 'department',
  lines, compare, compareNoun: 'departments', compareLabel: 'Departments', compareCaption: 'Departments side by side',
  exportCaption: `Departments in the County of Marin budget and spending data, exported ${index.source.exportDate}`, statsTitle: 'Budget and spending', lib: '../../vendor/chart.min.js',
};

// ---- the summary the Dashboard reads: the same figures as the tool's first view (departments that have an FY 2026-27 budget, adopted budget) ----
{
  const prev = YEARS[YEARS.length - 2];
  const col = (m, b, y) => columns.findIndex((c) => c.measure === m && c.basis === b && c.year === y);
  const [spend, spendBefore, revenue] = [col('exp', 'original', NOW), col('exp', 'original', prev), col('rev', 'original', NOW)];
  const inScope = lines.map((l, i) => ({ l, d: depts[i] })).filter(({ d }) => d.hasBudget);
  const sum = (list, k) => Math.round(list.reduce((n, { l }) => n + (l.values[k] || 0), 0) * 100) / 100;
  const areas = [...new Set(inScope.map(({ l }) => l.facets.area))].map((name) => {
    const mine = inScope.filter(({ l }) => l.facets.area === name);
    return { name, spending: sum(mine, spend), spendingBefore: sum(mine, spendBefore), departments: mine.length };
  }).filter((a) => a.spending || a.spendingBefore);
  const summary = {
    labels: { spending: columns[spend].name, revenue: columns[revenue].name, spendingStem: columns[spend].stem },
    exportDate: index.source.exportDate, year: yearLabel(NOW), previousYear: yearLabel(prev), yearIndex: YEARS.length - 1, previousYearIndex: YEARS.length - 2, scope: 'departments that have an FY 2026-27 budget', statusHas: L.STATUS.has,
    totals: { spending: sum(inScope, spend), spendingBefore: sum(inScope, spendBefore), revenue: sum(inScope, revenue), departments: inScope.length },
    serviceAreas: areas,
    largest: inScope.map(({ l, d }) => ({ name: l.title, code: d.code, serviceArea: l.facets.area, spending: l.values[spend] || 0 })).sort((a, b) => b.spending - a.spending).slice(0, 8),
  };
  // Where the year stands (the current budget, what is spent, committed and left) and the largest Net County cost, with the names of the columns
  // as the page gives them and the address that opens the tool on them, so the Dashboard says and links what the tool says.
  const pos = { current: col('exp', 'revised', NOW), spent: col('exp', 'actuals', NOW), committed: col('exp', 'encumbrance', NOW), left: col('exp', 'available', NOW) };
  const ncc = col('ncc', 'original', NOW);
  if (Object.values(pos).every((k) => k >= 0) && ncc >= 0) {
    const names = Object.fromEntries(Object.entries({ ...pos, ncc }).map(([k, i]) => [k, columns[i].name]));
    const shortNames = Object.fromEntries(Object.entries({ ...pos, ncc }).map(([k, i]) => [k, columns[i].shortStem]));
    const total = (list, k) => sum(list, pos[k]);
    summary.position = {
      names, shortNames,
      totals: Object.fromEntries(Object.keys(pos).map((k) => [k, total(inScope, k)])),
      serviceAreas: areas.map((a) => { const mine = inScope.filter(({ l }) => l.facets.area === a.name); return { name: a.name, ...Object.fromEntries(Object.keys(pos).map((k) => [k, total(mine, k)])) }; }),
      largestNetCountyCost: inScope.map(({ l, d }) => ({ name: l.title, code: d.code, serviceArea: l.facets.area, value: l.values[ncc] || 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 8),
      // The address that opens the tool on these amounts for this year.
      links: { position: `measure=exp&basis=revised,actuals,encumbrance,available&year=${YEARS.length - 1}`, ncc: `measure=ncc&basis=original&year=${YEARS.length - 1}`, bases: { current: 'revised', spent: 'actuals', committed: 'encumbrance', left: 'available' } },
    };
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'accounting', 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'styles.css'), '@import url("../styles.css");\n');
fs.writeFileSync(path.join(OUT, 'filters.json'), JSON.stringify(filtersFor(cfg), null, 2) + '\n');
const head = ['Department', 'Department code', 'Service area', 'Budget status', ...columns.map((c) => c.name)];
const csv = [head, ...lines.map((l) => [l.title, l.code, l.facets.area, l.facets.budget, ...l.values.map((v) => (v === null ? '' : v))])];
const tool = toolHtml(cfg);
// ---- a page for each department: its figures, and what it is made of, in an accordion ----
// What the department pages' script needs to show a row of the rollups or of a department's detail in the columns the page has.
const drill = {
  base: '../../../data/accounting/rollups/', nccFunds: index.nccFunds, groups: index.groups.map((g) => ({ objectType: g.objectType, code: g.code, name: categoryNames[g.code] })),
  measureGroups: Object.fromEntries(MEASURES.filter((m) => m.groups).map((m) => [m.id, m.groups])),
  columnPos: columns.map((c) => posOf(c.year, c.basis)),
  columns: columns.map(({ measure, basis, label, name, short, stem, shortStem }) => ({ measure, basis, label, name, short, stem, shortStem })),
  years: cfg.years, measures: cfg.measures, bases: cfg.bases,
  rawLabels: index.columns.map((c) => `${yearLabel(c.year)} ${{ original: 'Adopted budget', revised: 'Current budget', actuals: c.year === NOW ? 'Actual so far' : 'Actual', encumbrance: 'Committed', available: 'Left to spend or receive' }[c.measure]}`),
  levels: L.LEVELS, next: L.NEXT, approved,
};
const DEPTS = path.join(OUT, 'departments');
fs.mkdirSync(DEPTS, { recursive: true });
for (const f of fs.readdirSync(DEPTS)) if (f.endsWith('.html')) fs.unlinkSync(path.join(DEPTS, f));
fs.writeFileSync(path.join(DEPTS, 'styles.css'), '@import url("../styles.css");\n');
fs.writeFileSync(path.join(DEPTS, 'config.json'), JSON.stringify(drill) + '\n');
// The page has the measures, amounts and years to choose, and how names and codes show; the departments' own filters are on the page of departments.
const deptFilters = filtersFor(cfg);
fs.writeFileSync(path.join(DEPTS, 'filters.json'), JSON.stringify({ $schema: '../../../vendor/marinos/filter-panel.schema.json', schemaVersion: '1.0.0', groups: deptFilters.groups.filter((g) => ['measure', 'basis', 'year', 'change', 'labels'].includes(g.id)) }, null, 2) + '\n');
const svg = (d) => `<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24">${d}</svg>`;
const LAYOUT_ICONS = {
  summary: svg('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
  charts: svg('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
  table: svg('<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'),
};
const SECTION_VIEWS = L.SECTIONS.map((z) => `<details class="drill" data-view="${esc(z.view)}"${z.view === 'structure' ? ' open' : ''}><summary>${esc(z.label)}</summary><div class="drill-table"><table><thead></thead><tbody></tbody></table></div></details>`).join('');
depts.forEach((d, i) => {
  const l = lines[i];
  const top = l.values.map((v, k) => ` data-v${k}="${v == null ? '' : v}"`).join('');
  const areaHref = `../?area=${encodeURIComponent(l.facets.area)}`;
  const body = `<div class="search-layout" id="department-page" data-dept="${esc(d.code)}">${filterColumn('department')}<div class="search-results">` +
        `<h1 class="doc-title" id="department-title"><span data-label-name="${esc(l.title)}" data-label-code="${esc(d.code)}">${esc(l.title)}</span> <a class="code-link" href="../?department=${encodeURIComponent(l.title)}" data-code-kind="department" data-code="${esc(d.code)}" title="Filter by this code">(${esc(d.code)})</a></h1>` +
    `<div id="department-top"${top}><dl class="capital-figures"><div data-fixed><dt>Service area</dt><dd><a href="${esc(areaHref)}">${esc(l.facets.area)}</a></dd></div></dl></div>` +
    `<div class="mm-results-summary"><p class="app-help-text" id="dept-showing" aria-live="polite"></p></div>` +
    `<div id="dept-expandable"><div class="doc-actions dept-actions"><div class="action-group" role="group" aria-label="Layout" id="dept-layout">` +
    `<button type="button" class="action-button" id="dept-tab-summary" aria-pressed="true" aria-label="Summary" title="Summary">${LAYOUT_ICONS.summary}</button>` +
    `<button type="button" class="action-button" id="dept-tab-charts" aria-pressed="false" aria-label="Charts" title="Charts">${LAYOUT_ICONS.charts}</button>` +
    `<button type="button" class="action-button" id="dept-tab-table" aria-pressed="false" aria-label="All accounts" title="All accounts">${LAYOUT_ICONS.table}</button></div>` +
    `<span id="dept-copy">${copyMenu('accounts', [['data-copy-selection="text"', 'Text'], ['data-copy-selection="csv"', 'CSV']])}</span>` +
    `<button type="button" class="action-button" data-action="share" data-icon="link" aria-label="Copy link" title="Copy link"></button>` +
    `${downloadMenu('accounts', [['data-accounts-format="csv"', 'CSV'], ['data-accounts-format="json"', 'JSON']])}${fullscreenButton('#dept-expandable')}<span class="doc-action-status" id="dept-status" role="status" aria-live="polite"></span></div>` +
    `<div id="dept-panel-summary" class="drill-sections">${SECTION_VIEWS}</div>` +
    `<div id="dept-panel-charts" class="dept-charts" hidden data-lib="../../../vendor/chart.min.js"></div>` +
    `<div id="dept-panel-table" hidden><div class="accounts-scroll" role="region" tabindex="0" aria-label="All accounts of ${esc(l.title)}"><table class="accounts-table"><thead></thead><tbody></tbody></table></div></div></div>` +
    `</div></div>` +
    `<script src="../../../shared/display-name.js?v=${stampOf('shared/display-name.js')}"></script><script src="../../department.js?v=${stampOf('budget/department.js')}"></script>`;
  fs.writeFileSync(path.join(DEPTS, `${d.code}.html`), shell(l.title, `Budget and spending for ${l.title}: its figures, and what it is made of.`, [['Marin Budget', '../../../index.html'], ['Budget and spending', null]], body, '../../'));
});

const crumbs = [['Marin Budget', '../../index.html'], ['Budget and spending', null]];
const strip = dataStrip([{ label: 'County financial system budget export', edition: `exported ${index.source.exportDate}` }], 'the export');
fs.writeFileSync(path.join(OUT, 'index.html'), shell('Budget and spending', 'Budget, spending, revenue and Net County cost by department, from the County of Marin financial system.', crumbs,
  `<h1 class="visually-hidden">Budget and spending</h1>${tool}` + jsonBlock(null, '../../shared/page-data.js', [{ id: 'table', rows: csv }]) + toolScripts('../../') +
  `<script src="../accounting.js?v=${stampOf('budget/accounting.js')}"></script>`, '../'));

// ---- what the Data page says about it ----
const bits = (list) => list.map((x) => `<li>${x}</li>`).join('');
writeSection('budget-accounting', 'Budget and spending', `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2>${strip}<ul>${bits([
  `County financial system budget export, ${esc(index.source.file)}, exported ${esc(index.source.exportDate)}`,
  'Names and structure: the County chart of accounts (COA Object List and COA Org with Long Account Mapping), with shorthand written out where the County has approved it',
  'Service areas: the County list of departments in each service area',
])}</ul></section>` +
`<section class="section" aria-labelledby="notes"><h2 id="notes">Notes</h2><ul>${bits([
  'Revenue amounts are positive. Expense amounts are as the export gives them, so a credit can be negative.',
  'Spending leaves out transfers to other funds and pass-through payments; Revenue leaves out transfers from other funds and pass-through receipts. Each is its own measure.',
  'Net County cost is computed here: expenses less revenues in the General Fund and HHS Operations (funds 1000 and 2800).',
  `Spent so far and Received so far for ${yearLabel(NOW)} are to the date of the export.`,
])}</ul></section>`, '../budget/accounting/');
console.log(`Wrote budget/accounting/: ${lines.length} departments, ${columns.length} columns (${measuresUsed.length} measures, ${basesUsed.length} kinds of amount, ${YEARS.length} years).`);
