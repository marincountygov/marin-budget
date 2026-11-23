#!/usr/bin/env node
// Builds the Budget collection from schemaGov JSON-LD.
//
//   node scripts/build-budget.js [source-dir]
//
// With a source-dir, funds.jsonld and sources.json are copied into budget/data/
// first. Then budget/index.html and budget/funds.html are written.
// Edit the data, never the generated pages.

const fs = require('fs');
const { cleanText } = require('./clean-text');
const bd = require('./budget-data');
const { actions, jsonBlock } = require('./page-actions');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'budget');
const DATA = path.join(OUT, 'data');

const src = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (src) {
  for (const f of ['funds.jsonld', 'sources.json']) fs.copyFileSync(path.join(src, f), path.join(DATA, f));
  bd.copyData(src);
}
const data = bd.load();
const orgFile = path.join(ROOT, 'data', 'organizations.jsonld');
const orgs = fs.existsSync(orgFile) ? JSON.parse(fs.readFileSync(orgFile, 'utf8'))['@graph'] : [];
const orgById = new Map(orgs.map((o) => [o['@id'], o]));
const programFile = path.join(ROOT, 'data', 'programs.jsonld');
const programNames = new Map((fs.existsSync(programFile) ? JSON.parse(fs.readFileSync(programFile, 'utf8'))['@graph'] : []).map((p) => [p['@id'], p.name]));
const slugOf = (id) => id.split(/[/:]/).pop();
const areaSlug = (o) => slugOf(o['@id']).replace(/^service-area-/, '');
const DOCS = 'https://marincountygov.github.io/marin-pulse/';
const orgHref = (o) => DOCS + (o.organizationClassification === 'serviceArea' ? `service-areas/${areaSlug(o)}.html` : `organization/${slugOf(o['@id'])}.html`);
const funds = JSON.parse(fs.readFileSync(path.join(DATA, 'funds.jsonld'), 'utf8'))['@graph'];
const sources = JSON.parse(fs.readFileSync(path.join(DATA, 'sources.json'), 'utf8'));

const { shell, esc } = require('./budget-shell');
const { toolHtml, toolScripts, filtersFor } = require('./budget-tool');
const { writeSection } = require('./data-sections');
const finalBook = require('./budget-2025-org');

const book = sources.budgetBook;
const sourceNote = book ? `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2><p>${esc(book.title)}. ${esc(book.note)}</p></section>` : '';

const fundCard = (f) => {
  const code = (f.identifier || []).find((i) => i.propertyID === 'local:fund-code');
  return `<li class="app-card mm-card"><div class="mm-card__body">${code ? `<div class="mm-card__meta"><span class="app-badge">Fund ${esc(code.value)}</span></div>` : ''}<h3 class="mm-card__title"><a href="./funds/${bd.fundSlug(f)}.html">${esc(bd.fundName(f))}</a></h3>${f.description ? `<p class="mm-card__text">${esc(cleanText(f.description))}</p>` : ''}</div></li>`;
};
const fundCsvs = [{ id: 'table', label: 'funds', rows: [['Fund code', 'Fund', 'Description'], ...funds.map((f) => { const c = (f.identifier || []).find((i) => i.propertyID === 'local:fund-code'); return [c ? c.value : '', bd.fundName(f), f.description ? cleanText(f.description) : '']; })] }];
const fundsSource = `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2><ul>${book ? `<li>${esc(book.title)}</li>` : ''}<li><a href="./data/funds.jsonld">Fund data (JSON-LD)</a></li></ul>${book ? `<p class="app-help-text">${esc(book.note)}</p>` : ''}</section>`;
const fundsPage = shell('Funds', 'The funds the County of Marin accounts for.', [['Marin Budget', '../index.html'], ['Budget', './index.html'], ['Funds', null]],
  `<article class="content"><h1 class="doc-title">Funds</h1>${actions('budget-funds', 'article.content', true, fundCsvs)}` +
  `<ul class="search-results-list" aria-label="Funds">${funds.map(fundCard).join('')}</ul>` +
  fundsSource + jsonBlock(funds, '../shared/page-data.js', fundCsvs) + '</article>');


const { YEARS, LATEST, money, signed, change, num, table, label, val, pagesText, fteText, chart, charts } = bd;
const inMillions = (n) => '$' + (n / 1e6).toFixed(1) + ' million';
const link = (o, text) => (o ? `<a href="${orgHref(o)}">${esc(text || o.name)}</a>` : esc(text));
const NOTE = 'Figures are whole dollars as printed; the final edition still labels FY 2026-27 as Proposed.';
// A page's Source: the book with its pages, and the data files, one item each.
const sourceSection = (pageNums, files, note = NOTE) => `<section class="section" aria-labelledby="source">${bd.sourceList(data, pageNums, files, note, 2, 'source')}</section>`;

let indexOverview = '';
let indexCsvs = [];
let statsOverview = '';
let toolLines = [];
// What the Budget tool measures. Revenues and Net County cost are in the book for two years; expenditures for three.
// Net County cost is what the County pays from its own funds after revenues and transfers, and is the book's own figure.
const MEASURES = [{ id: 'exp', label: 'Total expenditures' }, { id: 'rev', label: 'Revenues' }, { id: 'ncc', label: 'Net County cost' }];
const MEASURE_NAME = Object.fromEntries(MEASURES.map((m) => [m.id, m.label]));
// Every figure is tagged with its basis: what was spent (Actual), what was adopted for the year (Approved), or what is proposed for it (Proposed).
const BASIS = { Actuals: 'Actual', Approved: 'Approved', Proposed: 'Proposed' };
const basisOf = (label) => BASIS[label.split(' ').pop()] || '';
const COLUMNS = [...YEARS.map((y) => ({ label: y.label, measure: 'exp' })), ...YEARS.slice(1).map((y) => ({ label: y.label, measure: 'rev' })), ...YEARS.slice(1).map((y) => ({ label: y.label, measure: 'ncc' }))].map((c) => ({ ...c, basis: basisOf(c.label) }));
let lineGraph = [];
let indexSources = new Set();
let areasPage = '';
let deptsPage = '';
let toolCompare = null;
if (data) {
  const areas = orgs.filter((o) => o.organizationClassification === 'serviceArea').sort((a, b) => bd.byName(a.name, b.name));
  const pages = new Set();
  const totalOf = (area, y) => (data.idx.get(y.key).get(area['@id']) || new Map()).get('expenditure-total');
  const areaCsv = [['Service area', 'Department or division', ...YEARS.map((y) => y.label), bd.CHANGE, 'FTE']];
  const sections = areas.map((a) => {
    const b = bd.areaBudget(data, a, { orgById, orgHref });
    if (!b) return '';
    b.pages.forEach((p) => pages.add(p));
    areaCsv.push(...b.csvRows);
    return `<section class="section" aria-labelledby="${areaSlug(a)}"><h2 id="${areaSlug(a)}"><a href="${orgHref(a)}">${esc(a.name)}</a></h2>${b.chart}${b.table}</section>`;
  }).join('');
  const areaTotals = areas.map((a) => ({ a, v: YEARS.map((y) => val(totalOf(a, y))) })).filter((x) => x.v[2]);
  const areaLargest = areaTotals.reduce((m, x) => (x.v[2] > m.v[2] ? x : m));
  const overviewFor = (base) => `<section class="section" aria-labelledby="areas-compared"><h2 id="areas-compared">Service areas</h2>` +
    charts(chart('chart-areas', 'Expenditures by service area', 'bars', { labels: areaTotals.map((x) => x.a.name), series: YEARS.map((y, i) => ({ name: y.label, values: areaTotals.map((x) => x.v[i]) })),
      summary: `${areaLargest.a.name} is the largest at ${inMillions(areaLargest.v[2])} in FY 2026-27.` })) +
    table('Expenditures by service area', ['Service area', ...YEARS.map((y) => y.label)], areaTotals.map((x) => `<tr><th scope="row"><a href="${base}#${areaSlug(x.a)}">${esc(x.a.name)}</a></th>${x.v.map((v) => num(v, money(v))).join('')}</tr>`)) + '</section>';
  areasPage = shell('Budget by service area', 'What each County of Marin service area spends, department by department.', [['Marin Budget', '../index.html'], ['Budget', './index.html'], ['Service areas', null]],
    `<article class="content"><h1 class="doc-title">Service areas</h1><p class="app-help-text">Expenditures for each service area. Non Departmental, which holds countywide revenues and transfers, is not included.</p>${actions('budget-by-service-area', 'article.content', true, [{ id: 'table', label: 'service areas' }])}${overviewFor('')}${sections}${sourceSection(pages, [['Budget lines (JSON-LD)', './data/budget-lines.jsonld'], ['Budgets (JSON-LD)', './data/budgets.jsonld']])}` +
    jsonBlock(areas.flatMap((a) => YEARS.map((y) => totalOf(a, y)).filter(Boolean).flatMap((t) => [t, ...(t.hasPart || []).map((p) => data.byId.get(p['@id']))])), '../shared/page-data.js', [{ id: 'table', rows: areaCsv }]) + '</article>');

  const dpages = new Set();
  const depRows = [];
  for (const [oid, o] of orgById) {
    // The County as a whole and a service area are not departments.
    if (o.organizationClassification === 'serviceArea' || o.organizationClassification === 'government') continue;
    const f = bd.figures(data, oid, LATEST);
    if (!f || !f.expTotal || !f.expTypes.length) continue;
    const d = (data.display.organizations || {})[oid] || {};
    const ncc = (d.department || {})['Net County Cost'];
    const fte = bd.fteFor(data, o, o.parentOrganization && orgById.get(o.parentOrganization['@id']));
    dpages.add(data.display.linePages[f.expTotal['@id']]);
    depRows.push({ o, exp: val(f.expTotal), rev: val(f.revTotal), ncc: ncc && ncc.fy2026_27, fte, line: f.expTotal });
  }
  depRows.sort((a, b) => bd.byName(a.o.name, b.o.name));
  // The Budget page opens with the picture: the service areas compared, and the largest departments.
  const top = [...depRows].sort((a, b) => b.exp - a.exp).slice(0, 10); // a ranking, so by amount
  const county = orgs.find((o) => o.organizationClassification === 'government');
  const cw = county && bd.countywideOverview(data, county);
  indexOverview = (cw ? cw.html : '') + overviewFor('./service-areas.html') +
    `<section class="section" aria-labelledby="largest"><h2 id="largest">Departments</h2>` +
    charts(chart('chart-largest', 'Largest departments, FY 2026-27', 'bars', { labels: top.map((r) => r.o.name), series: [{ name: 'FY 2026-27 Proposed', values: top.map((r) => r.exp) }],
      summary: `${top[0].o.name} is the largest at ${inMillions(top[0].exp)} of ${depRows.length} departments.` })) +
    table('Largest departments, FY 2026-27', ['Department', 'Expenditures'], top.map((r) => `<tr><th scope="row">${link(r.o)}</th>${num(r.exp, money(r.exp))}</tr>`)) +
    `<p><a href="./departments.html">All ${depRows.length} departments</a></p></section>`;
  indexCsvs = [...(cw ? [{ id: 'overview', label: 'overview', rows: cw.csv }] : []), { id: 'areas', label: 'service areas', rows: [['Service area', ...YEARS.map((y) => y.label)], ...areaTotals.map((x) => [x.a.name, ...x.v])] },
    { id: 'departments', label: 'largest departments', rows: [['Department', 'Expenditures FY 2026-27'], ...top.map((r) => [r.o.name, r.exp])] }];
  indexSources = new Set([...pages, ...dpages, ...(cw ? cw.pages : [])]);
  // The tool's lines: each department or division, with its expenditures in each year the book prints.
  const expAt = (oid, key) => { const m = (data.idx.get(key) || new Map()).get(oid); const l = m && (m.get('expenditure-total-department-page') || m.get('expenditure-total')); return l ? val(l) : null; };
  const areaOf = (o) => { for (let p = o; p; p = p.parentOrganization && orgById.get(p.parentOrganization['@id'])) if (p.organizationClassification === 'serviceArea') return p.name; return 'Other'; };
  statsOverview = cw ? cw.html : '';
  const rank = new Map([...depRows].sort((a, b) => b.exp - a.exp).map((r, i) => [r, i]));
  toolLines = depRows.map((r) => ({ order: rank.get(r), slug: slugOf(r.o['@id']), ref: r.line['@id'], title: r.o.name, href: orgHref(r.o), values: YEARS.map((y) => expAt(r.o['@id'], y.key)),
    facets: { area: areaOf(r.o), department: r.o.name, kind: r.o.organizationClassification === 'department' ? 'Department' : 'Division' }, badges: [], page: data.display.linePages[r.line['@id']] }));
  // Divisions the book prints as programs (a program with the division's name under its department). Their amounts are the
  // program's expenditures, all fund groups added. Divisions the book prints no amounts for are left out, not estimated.
  const have = new Set(toolLines.map((l) => l.slug));
  for (const o of orgs) {
    if (o.organizationClassification !== 'division' || have.has(slugOf(o['@id']))) continue;
    const own = YEARS.map((y) => expAt(o['@id'], y.key));
    if (own.some((v) => v != null)) { // a division the service-area table prints with its own totals (Health and Human Services)
      const l = (data.idx.get(LATEST).get(o['@id']) || new Map()).get('expenditure-total');
      toolLines.push({ order: toolLines.length, slug: slugOf(o['@id']), ref: l ? l['@id'] : null, title: o.name, href: orgHref(o), values: own,
        facets: { area: areaOf(o), department: o.name, kind: 'Division' }, badges: [], page: l ? data.display.linePages[l['@id']] : undefined, nested: true });
      continue;
    }
    const parent = o.parentOrganization && o.parentOrganization['@id'];
    const prog = [...data.byProgram.keys()].find((id) => (programNames.get(id) || '').toLowerCase() === o.name.toLowerCase() && data.byProgram.get(id).some((l) => (l.administrativeClassification || {})['@id'] === parent));
    if (!prog) continue;
    const lines = data.byProgram.get(prog).filter((l) => l.direction === 'expenditure');
    const values = YEARS.map((y) => { const m = lines.filter((l) => l['@id'].includes(`/${y.key}/`)); return m.length ? m.reduce((s, l) => s + val(l), 0) : null; });
    if (values.every((v) => v == null)) continue;
    toolLines.push({ order: toolLines.length, slug: slugOf(o['@id']), ref: lines[0]['@id'], title: o.name, href: orgHref(o), values, prog,
      facets: { area: areaOf(o), department: o.name, kind: 'Division' }, badges: [], nested: true });
  }
  // Revenues and Net County cost, as the book prints them for FY 2025-26 and FY 2026-27, beside the expenditures. A line the book
  // gives none for (a division with no figures of its own) has none, and shows a dash.
  const orgBySlug = new Map(orgs.map((o) => [slugOf(o['@id']), o]));
  const revAt = (oid, key) => { const f = bd.figures(data, oid, key); return f && f.revTotal ? val(f.revTotal) : null; };
  const nccAt = (oid, field) => { const n = ((((data.display.organizations || {})[oid] || {}).department || {})['Net County Cost']) || {}; return n[field] == null ? null : n[field]; };
  const progSum = (id, field) => { const rs = (data.display.programRows || []).filter((r) => r.program === id); return rs.length ? rs.reduce((n, r) => n + (r[field] || 0), 0) : null; };
  for (const l of toolLines) {
    const oid = orgBySlug.get(l.slug)['@id'];
    const rev = l.prog ? [progSum(l.prog, 'rev_fy2025_26'), progSum(l.prog, 'rev_fy2026_27')] : [revAt(oid, YEARS[1].key), revAt(oid, YEARS[2].key)];
    const ncc = l.prog ? [progSum(l.prog, 'ncc_fy2025_26'), progSum(l.prog, 'ncc_fy2026_27')] : [nccAt(oid, 'fy2025_26'), nccAt(oid, 'fy2026_27')];
    l.values = [...l.values, ...rev, ...ncc];
  }
  // The levels below a line: a department's divisions, and the programs the book prints for it or for a division. A division the
  // book prints no amounts for is listed without them; nothing is estimated.
  const progOrg = new Map();
  for (const [pid, ls] of data.byProgram) { const o = ls.map((l) => (l.administrativeClassification || {})['@id']).find(Boolean); if (o) (progOrg.get(o) || progOrg.set(o, []).get(o)).push(pid); }
  const progValues = (pid) => {
    const ls = data.byProgram.get(pid) || [];
    const at = (dir, y) => { const m = ls.filter((l) => l.direction === dir && l['@id'].includes(`/${y.key}/`)); return m.length ? m.reduce((n, l) => n + val(l), 0) : null; };
    return [...YEARS.map((y) => at('expenditure', y)), ...YEARS.slice(1).map((y) => at('revenue', y)), progSum(pid, 'ncc_fy2025_26'), progSum(pid, 'ncc_fy2026_27')];
  };
  const lineBySlug = new Map(toolLines.map((l) => [l.slug, l]));
  const parentOf = (o) => o.parentOrganization && o.parentOrganization['@id'];
  const childrenOf = (o, ownProg) => {
    const divisions = orgs.filter((d) => d.organizationClassification === 'division' && parentOf(d) === o['@id']).map((d) => {
      const ln = lineBySlug.get(slugOf(d['@id']));
      return { kind: 'Division', title: d.name, href: orgHref(d), values: ln ? ln.values : null, children: childrenOf(d, ln && ln.prog) };
    });
    const programs = (progOrg.get(o['@id']) || []).filter((p) => p !== ownProg).map((pid) => ({ kind: 'Program', title: programNames.get(pid) || pid, values: progValues(pid), children: [] }));
    const by = (a, b) => a.title.localeCompare(b.title);
    return [...divisions.sort(by), ...programs.sort(by)];
  };
  for (const l of toolLines) { const kids = childrenOf(orgBySlug.get(l.slug), l.prog); if (kids.length) l.children = kids; }
  // A department by fund group, from the book's program tables: General Fund, HHS Operations Fund and Other Funds. The programs add up to the
  // department's total, so the groups do too. The figures follow the choice of measures and years, and a change shows the difference between years.
  const GROUPS = ['General Fund', 'HHS Operations Fund', 'Other Funds'];
  for (const l of toolLines) {
    if (l.facets.kind !== 'Department') continue;
    const oid = orgBySlug.get(l.slug)['@id'];
    const rows = (data.display.programRows || []).filter((r) => r.department === oid);
    const sumOf = (g, f) => { const m = rows.filter((r) => r.fundGroup === g && r[f] != null); return m.length ? m.reduce((n, r) => n + r[f], 0) : null; };
    const funds = GROUPS.filter((g) => rows.some((r) => r.fundGroup === g)).map((g) => ({ kind: 'Fund group', title: g, children: [],
      values: [null, sumOf(g, 'exp_fy2025_26'), sumOf(g, 'exp_fy2026_27'), sumOf(g, 'rev_fy2025_26'), sumOf(g, 'rev_fy2026_27'), sumOf(g, 'ncc_fy2025_26'), sumOf(g, 'ncc_fy2026_27')] }));
    if (funds.length) l.funds = funds;
    // Where the book says the department was reorganized, its own words and pages.
    const ch = data.changes[oid];
    const said = ch ? ch.paragraphs.filter((p) => /transferred|reorganiz|restructur/i.test(p)) : [];
    if (said.length) l.reorg = { paragraphs: said, pages: bd.pagesText(data, ch.pages) };
  }
  lineGraph = depRows.map((r) => r.line);
  // Compare (the Compare tab of the tool): every department's figures, in the order of the rows below.
  const YL = YEARS.map((y) => y.label);
  const compareRows = [
    { label: `Expenditures, ${YL[0]}`, kind: 'money', chart: { group: 'year', name: YL[0] } },
    { label: `Expenditures, ${YL[1]}`, kind: 'money', chart: { group: 'year', name: YL[1] } },
    { label: `Expenditures, ${YL[2]}`, kind: 'money', chart: [{ group: 'year', name: YL[2] }, { group: 'latest', name: 'Expenditures' }] },
    { label: bd.CHANGE, kind: 'change' },
    { label: `${bd.CHANGE}, percent`, kind: 'percent' },
    { label: `Revenues, ${YL[1]}`, kind: 'money' },
    { label: `Revenues, ${YL[2]}`, kind: 'money', chart: { group: 'latest', name: 'Revenues' } },
    { label: `Net County cost, ${YL[1]}`, kind: 'money' },
    { label: `Net County cost, ${YL[2]}`, kind: 'money', chart: { group: 'latest', name: 'Net County cost' } },
    { label: 'Full-time equivalent staff', kind: 'fte' },
  ];
  const compareLines = {};
  for (const r of depRows) {
    const f = (key) => bd.figures(data, r.o['@id'], key) || {};
    const ncc = (((data.display.organizations || {})[r.o['@id']] || {}).department || {})['Net County Cost'] || {};
    const e = YEARS.map((y) => expAt(r.o['@id'], y.key));
    compareLines[slugOf(r.o['@id'])] = [...e, e[1] != null && e[2] != null ? e[2] - e[1] : null, e[1] ? Math.round(((e[2] - e[1]) / e[1]) * 1000) / 10 : null,
      val(f(YEARS[1].key).revTotal), val(f(YEARS[2].key).revTotal), ncc.fy2025_26 ?? null, ncc.fy2026_27 ?? null, r.fte ?? null];
  }
  // A division inside a department is compared by its expenditures; the other rows are the department's own figures.
  for (const l of toolLines.filter((x) => x.nested)) {
    const e = l.values.slice(0, YEARS.length); // the expenditures
    compareLines[l.slug] = [...e, e[1] != null && e[2] != null ? e[2] - e[1] : null, e[1] ? Math.round(((e[2] - e[1]) / e[1]) * 1000) / 10 : null, null, null, null, null, null];
  }
  toolCompare = { rows: compareRows, lines: compareLines, titles: { year: 'Expenditures by year', latest: `${YL[2]}: expenditures, revenues and net County cost` } };
  // The lines for the Reports page: each department or division with its expenditures, and the department it belongs to.
  const deptOf = (l) => { const o = orgBySlug.get(l.slug); const p = o && o.parentOrganization && orgById.get(o.parentOrganization['@id']); return l.nested && p && p.organizationClassification !== 'serviceArea' ? p.name : l.facets.department; };
  fs.mkdirSync(path.join(ROOT, 'reports', 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'reports', 'data', 'budget.json'), JSON.stringify({
    id: 'budget', label: 'Budget', titleLabel: 'Department or division', columns: COLUMNS.map((c) => ({ label: c.label, kind: 'money', measure: MEASURE_NAME[c.measure], key: c.measure, basis: c.basis })), defaultColumns: [1, 2], compare: true,
    dimensions: [{ id: 'area', label: 'Service area' }, { id: 'dept', label: 'Department' }, { id: 'kind', label: 'Type' }],
    source: book ? { label: book.title, url: book.url } : null,
    lines: toolLines.map((l) => ({ title: l.title, nested: Boolean(l.nested), facets: { area: l.facets.area, dept: deptOf(l), kind: l.facets.kind }, values: l.values })),
  }) + '\n');
  const rows = depRows.map((r) => `<tr><th scope="row">${link(r.o)}</th>${num(r.exp, money(r.exp))}${num(r.rev, money(r.rev))}${num(r.ncc, money(r.ncc))}${num(r.fte, fteText(r.fte))}</tr>`);
  deptsPage = shell('Budget by department', 'Expenditures, revenues and net County cost for each County of Marin department.', [['Marin Budget', '../index.html'], ['Budget', './index.html'], ['Departments', null]],
    `<article class="content"><h1 class="doc-title">Departments</h1><p class="app-help-text">FY 2026-27, largest first.</p>${actions('budget-by-department', 'article.content', true, [{ id: 'table', label: 'departments' }])}` +
    charts(chart('chart-departments', 'Expenditures by department, FY 2026-27', 'bars', { labels: depRows.map((r) => r.o.name), series: [{ name: 'FY 2026-27 Proposed', values: depRows.map((r) => r.exp) }],
      summary: `${depRows[0].o.name} is the largest at ${inMillions(depRows[0].exp)} of ${depRows.length} departments.` })) +
    table('Budget by department, FY 2026-27', ['Department', 'Expenditures', 'Revenues', 'Net County cost', 'FTE'], rows) + sourceSection(dpages, [['Budget lines (JSON-LD)', './data/budget-lines.jsonld']]) +
    jsonBlock(depRows.flatMap((r) => { const f = bd.figures(data, r.o['@id'], LATEST); return [f.expTotal, f.revTotal].filter(Boolean); }), '../shared/page-data.js', [{ id: 'table', rows: [['Department', 'Expenditures FY 2026-27', 'Revenues FY 2026-27', 'Net County cost FY 2026-27', 'FTE FY 2026-27'], ...depRows.map((r) => [r.o.name, r.exp, r.rev == null ? '' : r.rev, r.ncc == null ? '' : r.ncc, r.fte == null ? '' : r.fte])] }]) + '</article>');
}

const YEAR_OPTIONS = [{ label: 'FY 2026-27 Proposed', href: './index.html' }, { label: 'FY 2025-26 Final', href: './fy2025-26/index.html' }];
// The County's own list of final adopted budget books, kept in marin-data's sources.json.
const past = sources.pastBudgetBooks;
const pastBooksHtml = past && past.books ? `<h3 id="past-books">Past budget books</h3><ul>${past.books.map((b) => `<li><a href="${esc(b.url)}">${esc(b.title)}</a></li>`).join('')}<li><a href="${esc(past.url)}">${esc(past.title)}</a></li></ul>` : '';
const indexTool = data && toolLines.length ? (() => {
  const csv = [['Department or division', 'Service area', 'Type', ...COLUMNS.map((c) => `${MEASURE_NAME[c.measure]}, ${c.label}`), 'Book page'], ...toolLines.map((l) => [l.title, l.facets.area, l.facets.kind, ...l.values, l.page || ''])];
  const dataHtml = bd.sourceList(data, indexSources, [['Budget lines (JSON-LD)', './data/budget-lines.jsonld'], ['Budgets (JSON-LD)', './data/budgets.jsonld']], '', 2, 'source').replace(/^/, '<section class="section" aria-labelledby="source">').concat(pastBooksHtml + '</section>') +
    `<section class="section" aria-labelledby="pages"><h2 id="pages">Pages</h2><ul><li><a href="./service-areas.html">Service areas</a></li><li><a href="./departments.html">Departments</a></li><li><a href="./funds.html">Funds</a></li></ul></section>`;
  const notesHtml = `<ul>${[NOTE, book && book.note].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  writeSection('budget-2026-28', 'Budget, FY 2026-28 book', dataHtml + `<section class="section" aria-labelledby="notes"><h2 id="notes">Notes</h2>${notesHtml}</section>`, '../budget/');
  const toolCfg = { up: '../', id: 'fy2026-28', titleLabel: 'Department or division', noun: { one: 'department or division', many: 'departments and divisions', Many: 'Departments and divisions' }, columns: COLUMNS, measures: MEASURES, defaultColumn: YEARS.length - 1,
    facets: [{ name: 'area', label: 'Service areas', all: 'All service areas' }, { name: 'department', label: 'Departments and divisions', all: 'All departments and divisions' }, { name: 'kind', label: 'Types', all: 'All types' }],
    chartFacets: ['area', 'department'], breakdownFacet: 'kind', countFacet: 'department', countLabel: 'Departments', lines: toolLines, statsExtra: statsOverview, compare: toolCompare, compareNoun: 'departments', compareLabel: 'Departments', compareCaption: 'Departments side by side', exportCaption: 'Budget lines in the County of Marin Proposed Budget FY 2026-28', statsTitle: 'Budget', lib: '../vendor/chart.min.js', books: YEAR_OPTIONS, currentBook: './index.html' };
  // The filter column is drawn by the shell from this file.
  fs.writeFileSync(path.join(OUT, 'filters.json'), JSON.stringify(filtersFor(toolCfg), null, 2) + '\n');
  const html = toolHtml(toolCfg);
  return html + jsonBlock(lineGraph, '../shared/page-data.js', [{ id: 'table', rows: csv }]) + toolScripts('../');
})() : '';
const index = shell('Budget', 'The County of Marin budget: service areas, departments and funds.', [['Marin Budget', '../index.html'], ['Budget', null]],
  `<h1 class="visually-hidden">Budget</h1>` +
  (indexTool || (indexOverview + (data ? sourceSection(indexSources, [['Budget lines (JSON-LD)', './data/budget-lines.jsonld'], ['Budgets (JSON-LD)', './data/budgets.jsonld']], `${NOTE}${book ? ' ' + esc(book.note) : ''}`) : sourceNote))));


// ---- A page for each fund -----------------------------------------------------------------------------------------
const FUNDS = path.join(OUT, 'funds');
fs.rmSync(FUNDS, { recursive: true, force: true });
fs.mkdirSync(FUNDS, { recursive: true });
fs.writeFileSync(path.join(FUNDS, 'styles.css'), '@import url("../../shared/styles.css");\n');
const row = (label, html) => `<dt>${esc(label)}</dt><dd>${html}</dd>`;

function fundPage(f) {
  const name = bd.fundName(f);
  const fb = bd.fundBudget(data, f, { orgById, orgHref, programName: (id) => programNames.get(id), lib: '../../vendor/chart.min.js' });
  const facts = [row('Fund code', `<code>${esc(bd.fundCode(f))}</code>`), row('Type', 'Fund')];
  if (f.description) facts.push(row('Description', esc(cleanText(f.description))));
  // A fund for capital projects points to the plan that lists them.
  if (/capital/i.test(name) || /capital (improvement|projects)|\bCIP\b/i.test(f.description || '')) facts.push(row('Capital plan', '<a href="../../capital/projects.html">Capital Improvement Plan</a>'));
  const budgetTab0 = fb
    ? `<section class="section" id="budget" data-tab-section="budget" aria-labelledby="budget-heading" hidden><h2 id="budget-heading">Budget</h2>${fb.kpis}<h3 id="budget-departments">Departments</h3>${charts(fb.pie)}` +
      bd.table('Budget by department', fb.head, fb.body, fb.foot) +
      bd.sourceList(data, fb.pages, [['Budget lines (JSON-LD)', '../data/budget-lines.jsonld']], `The budget book lists each program under a fund group, and ${esc(name)} is the group these figures come from. Figures are whole dollars as printed; revenues are positive and net County cost is the book's own figure.`) + '</section>'
    : '';
  // The FY 2025-26 Final Budget's rows for this fund number, when the book has them, join the Budget tab.
  const fin = finalBook.fundSection(bd.fundCode(f), '../../');
  const budgetTab = fb ? budgetTab0.replace(/<\/section>$/, fin + '</section>') : fin ? `<section class="section" id="budget" data-tab-section="budget" aria-labelledby="budget-heading" hidden><h2 id="budget-heading">Budget</h2>${fin}</section>` : '';
  const tabs = ['details', (fb || fin) && 'budget', 'data'].filter(Boolean);
  const csvs = fb ? [{ id: 'departments', label: 'departments', rows: fb.csvDepartments, tab: 'budget' }, { id: 'programs', label: 'programs', rows: fb.csvPrograms, tab: 'budget' }] : [];
  // A fund with no figures has nothing for a Dashboard to say beyond About, so it has no Dashboard tab and opens on About.
  const nav = `<nav id="page-tabs" class="org-tabs" aria-label="Sections">${fb ? '<a href="#dashboard">Dashboard</a>' : ''}<a href="#details">About</a>${fb || fin ? '<a href="#budget">Budget</a>' : ''}<a href="#data">Data</a></nav>`;
  const dashboard = fb ? `<div id="dashboard" data-tab-section="dashboard" data-no-copy><div class="org-dashboard"><section class="org-dash" aria-labelledby="dash-budget"><h2 id="dash-budget">Budget</h2>${fb.kpis}<p class="org-dash__more"><a href="#budget">All Budget</a></p></section></div></div>` : '';
  const body = `<article class="content"><h1 class="doc-title">${esc(name)}</h1>${nav}${actions('fund-' + bd.fundSlug(f), 'article.content', true, csvs, { content: tabs, json: tabs })}` + dashboard +
    `<div id="details" data-tab-section="details"${fb ? ' hidden' : ''}><section class="section" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><dl class="org-facts">${facts.join('')}</dl></section></div>` + budgetTab +
    `<div id="data" data-tab-section="data" hidden><section class="section" aria-labelledby="record"><h2 id="record">Record</h2><dl class="org-facts">${row('Record id', `<code>${esc(f['@id'])}</code>`)}${row('Record type', `<code>${esc(f['@type'])}</code>`)}</dl></section>` +
    `<section class="section" aria-labelledby="source"><h2 id="source">Source</h2><ul><li><a href="../data/funds.jsonld">Fund data (JSON-LD)</a></li>${fb ? '<li><a href="../data/budget-lines.jsonld">Budget lines (JSON-LD)</a></li>' : ''}</ul>${book ? `<p class="app-help-text">${esc(book.note)}</p>` : ''}</section></div>` +
    jsonBlock({ details: [f], data: [f], budget: fb ? fb.lines : [] }, '../../shared/page-data.js', csvs) + '</article>';
  return shell(name, f.description ? cleanText(f.description) : `A fund of the County of Marin.`, [['Marin Budget', '../../index.html'], ['Budget', '../index.html'], ['Funds', '../funds.html'], [name, null]], body, '../');
}
for (const f of funds) fs.writeFileSync(path.join(FUNDS, `${bd.fundSlug(f)}.html`), fundPage(f));

fs.writeFileSync(path.join(OUT, 'index.html'), index);
fs.writeFileSync(path.join(OUT, 'funds.html'), fundsPage);
for (const [f, html] of [['service-areas.html', areasPage], ['departments.html', deptsPage]]) {
  if (html) fs.writeFileSync(path.join(OUT, f), html);
  else if (fs.existsSync(path.join(OUT, f))) fs.unlinkSync(path.join(OUT, f));
}
console.log(`Wrote budget/index.html, budget/funds.html and ${funds.length} fund pages.`);
