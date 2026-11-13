#!/usr/bin/env node
// Builds the home page, the Dashboard: a look at the Budget and the Capital improvement plan, each with a link to
// its pages. Run it after build-budget.js and build-capital.js.
//
//   node scripts/build-dashboard.js
//
// Figures come from the same data as the pages they link to. Edit the data, never the generated page.

const fs = require('fs');
const path = require('path');
const bd = require('./budget-data');
const { shell, esc } = require('./budget-shell');

const ROOT = path.join(__dirname, '..');
const LIB = './vendor/chart.min.js';
const { YEARS, LATEST, PREVIOUS, kpi, millions, chart, charts, val, table, num, money, signed } = bd;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const graph = (f) => readJson(f)['@graph'];
const more = (href, label) => `<p class="org-dash__more"><a href="${href}">${esc(label)}</a></p>`;
// Links to the views people ask for most, each a page of the tool with its filter or sort already set.
const shortcuts = (items) => `<ul class="dash-links">${items.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul>`;
const section = (id, title, body, href, label) => `<section class="org-dash" aria-labelledby="dash-${id}"><h2 id="dash-${id}">${esc(title)}</h2>${body}${more(href, label)}</section>`;

// ---- Budget: the County's totals and the service areas compared -------------------------------------------------
function budgetSection() {
  const data = bd.load();
  if (!data) return '';
  const orgs = graph('data/organizations.jsonld');
  const county = orgs.find((o) => o.organizationClassification === 'government');
  const now = county && bd.figures(data, county['@id'], LATEST);
  const before = county && bd.figures(data, county['@id'], PREVIOUS);
  if (!now || !now.expTotal || !now.revTotal) return '';
  const e26 = val(now.expTotal);
  const e25 = before && before.expTotal ? val(before.expTotal) : null;
  const kpis = [kpi('Expenditures, FY 2026-27', millions(e26)), kpi('Revenues, FY 2026-27', millions(val(now.revTotal)))];
  if (e25) kpis.push(kpi('Change in expenditures', `${(((e26 - e25) / e25) * 100).toFixed(1)}%`));
  const totalOf = (a, key) => (data.idx.get(key).get(a['@id']) || new Map()).get('expenditure-total');
  const areas = orgs.filter((o) => o.organizationClassification === 'serviceArea')
    .map((a) => ({ a, then: val(totalOf(a, PREVIOUS)), v: val(totalOf(a, LATEST)) })).filter((x) => x.v).sort((p, q) => bd.byName(p.a.name, q.a.name));
  const largest = areas.reduce((m, x) => (x.v > m.v ? x : m));
  const spec = { labels: areas.map((x) => x.a.name), series: [{ name: YEARS[1].label, values: areas.map((x) => x.then || 0) }, { name: YEARS[2].label, values: areas.map((x) => x.v) }],
    summary: `${largest.a.name} is the largest service area at ${millions(largest.v)} of ${millions(e26)} in FY 2026-27.` };
  const pct = (x) => (x.then ? `${(((x.v - x.then) / x.then) * 100).toFixed(1)}%` : '–');
  const changes = table('Change in expenditures by service area', ['Service area', YEARS[1].label, YEARS[2].label, 'Change', 'Change, percent'],
    areas.map((x) => `<tr><th scope="row">${esc(x.a.name)}</th>${num(x.then, money(x.then))}${num(x.v, money(x.v))}${num(x.v - x.then, signed(x.v - x.then))}<td class="budget-table__num">${pct(x)}</td></tr>`));
  return section('budget', 'Budget', `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-areas', 'Expenditures by service area', 'bars', spec, false, LIB))}${changes}` +
    shortcuts([['./budget/?sort=amount', 'Departments, largest first'], ['./budget/?tab=compare', 'Compare departments'], ['./budget/funds.html', 'Funds'], ['./budget/fy2025-26/', 'FY 2025-26 Final Budget']]), './budget/', 'All Budget');
}

// ---- Capital improvement plan: the book's totals and the funding by category and year --------------------------
function capitalSection() {
  if (!fs.existsSync(path.join(ROOT, 'capital', 'data', 'cip-display.json'))) return '';
  const display = readJson('capital/data/cip-display.json');
  const cat = (label) => display.categoryTotals.find((c) => c.label === label);
  const ALL = cat('All Project Categories Total');
  const years = display.years;
  const GROUPS = ['Facilities', 'Public Safety', 'Special Projects', 'Transportation', 'Water Resources'];
  const groups = GROUPS.map((g) => ({ g, t: cat(g === 'Special Projects' ? 'Special Projects Total' : g + ' Total') })).filter((x) => x.t).sort((a, b) => b.t.total - a.t.total);
  // The same four figures as the Capital improvement plan page and the Projects Stats tab: the book's printed totals, the projects listed, and their cost estimates.
  const sum = (f) => display.projects.reduce((n, p) => n + f(p), 0);
  const kpis = [kpi(`Programmed, FY ${years[0]} to ${years[years.length - 1]}`, millions(ALL.total)), kpi('Projects', String(display.projects.length)),
    kpi('Cost estimate', millions(sum((p) => p.costEstimate))), kpi('Additional funds needed', millions(ALL.additionalFundsNeeded))];
  const spec = { labels: years.map((y) => 'FY' + y.slice(-2)), series: groups.map(({ g, t }) => ({ name: g, values: years.map((y) => t.byYear[y]) })),
    summary: `${groups[0].g} is the largest category at ${millions(groups[0].t.total)} of ${millions(ALL.total)} over five years.` };
  return section('capital', 'Capital improvement plan', `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-categories', 'Planned spending by category and year', 'bars', spec, true, LIB))}` +
    shortcuts([['./capital/projects.html?gap=gap&sort=gap', 'Projects needing funding'], ['./capital/projects.html?status=New', 'New projects'], ['./capital/projects.html?sort=cost', 'Largest projects'], ['./capital/index.html', 'Categories and fund sources']]), './capital/projects.html', 'All Capital improvement plan');
}

const body = `<article class="content"><h1 class="doc-title">Dashboard</h1>` +
  `<div class="org-dashboard">${budgetSection()}${capitalSection()}</div></article>`;
fs.writeFileSync(path.join(ROOT, 'index.html'), shell('Dashboard', 'The County of Marin budget and Capital Improvement Plan at a glance.', [['Marin Budget', null]], body, 'root'));
console.log('Wrote index.html.');
