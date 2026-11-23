#!/usr/bin/env node
// Builds the home page, the Dashboard: a look at each tab, in the order of the tabs, with the names in it linked to the page
// of the tool that shows them (a service area opens the tool filtered to it). Run it after the other builders.
//
//   node scripts/build-dashboard.js
//
// Figures come from the same data as the pages they link to. A section ends with links to the other tabs of its tool and to its
// most used presets (a filter or a sort already set); the names in a table are the data's own and each opens the tool filtered to it.
// Edit the data, never the generated page.

const fs = require('fs');
const path = require('path');
const bd = require('./budget-data');
const { shell, esc } = require('./budget-shell');

const ROOT = path.join(__dirname, '..');
const stamp = (file) => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
const LIB = './vendor/chart.min.js';
const { YEARS, LATEST, PREVIOUS, CHANGE, kpi, millions, chart, charts, val, table, num, money, signed } = bd;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const graph = (f) => readJson(f)['@graph'];
const more = (href, label) => `<p class="org-dash__more"><a href="${href}">${esc(label)}</a></p>`;
// Links to the tabs of a section's tool, and to the presets people use most, each a page of the tool with its tab, filter or sort already set.
const shortcuts = (items) => `<ul class="dash-links">${items.map(([href, label]) => `<li><a href="${href}">${esc(label)}</a></li>`).join('')}</ul>`;
// The links to a tool's other tabs, with the tab names as the page has them: read from the page's own tab row, so a tab that is added,
// renamed or removed there is added, renamed or removed here.
function tabLinks(page, base) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const tabs = [...html.matchAll(/<button[^>]*id="(\w+)-toggle"[^>]*class="tab-button"[^>]*>([^<]+)<\/button>/g)].map((m) => [`${base}?tab=${m[1]}`, m[2].trim()]);
  return tabs.length ? shortcuts(tabs) : '';
}
const section = (id, title, body) => `<section class="org-dash" aria-labelledby="dash-${id}"><h2 id="dash-${id}">${esc(title)}</h2>${body}</section>`;
// A name in the data that opens the tool filtered to it (the filter's value is the name, as the tool shows it).
const link = (href, name) => `<a href="${esc(href)}">${esc(name)}</a>`;
const toolLink = (tool, facet, value) => `${tool}?${facet}=${encodeURIComponent(value)}`;
// A tool's own settings, as its page gives them (the measures, the years): what a link into the tool needs to say.
const toolConfig = (page) => JSON.parse(fs.readFileSync(path.join(ROOT, page), 'utf8').match(/<script type="application\/json" id="tool-config">(.*?)<\/script>/s)[1].replace(/\\u003c/g, '<'));
const pct = (now, before) => (before ? `${(((now - before) / Math.abs(before)) * 100).toFixed(1)}%` : '–');

// ---- Budget books: the book's totals and its service areas compared -----------------------------------------------
// The title is Budget books where Budget and spending is a tab beside it, and Budget where it is not.
function booksSection(beside) {
  const data = bd.load();
  if (!data) return '';
  const orgs = graph('data/organizations.jsonld');
  const county = orgs.find((o) => o.organizationClassification === 'government');
  const now = county && bd.figures(data, county['@id'], LATEST);
  const before = county && bd.figures(data, county['@id'], PREVIOUS);
  if (!now || !now.expTotal || !now.revTotal) return '';
  const e26 = val(now.expTotal);
  const e25 = before && before.expTotal ? val(before.expTotal) : null;
  // Each key number opens the book's tool on it: the measure, the year (by its place in the tool's own list), and the change between years.
  const cfg = toolConfig('budget/index.html');
  const years = [...new Set(cfg.columns.map((c) => c.label))];
  const yr = (label) => years.indexOf(label);
  const kpis = [kpi(`Spending, ${YEARS[2].label}`, millions(e26), `./budget/?measure=exp&year=${yr(YEARS[2].label)}`), kpi(`Revenue, ${YEARS[2].label}`, millions(val(now.revTotal)), `./budget/?measure=rev&year=${yr(YEARS[2].label)}`)];
  if (e25) kpis.push(kpi(`Spending, change from ${YEARS[1].label} to ${YEARS[2].label}`, pct(e26, e25), `./budget/?measure=exp&year=${yr(YEARS[1].label)},${yr(YEARS[2].label)}&change=1`));
  const totalOf = (a, key) => (data.idx.get(key).get(a['@id']) || new Map()).get('expenditure-total');
  const areas = orgs.filter((o) => o.organizationClassification === 'serviceArea')
    .map((a) => ({ a, then: val(totalOf(a, PREVIOUS)), v: val(totalOf(a, LATEST)) })).filter((x) => x.v).sort((p, q) => bd.byName(p.a.name, q.a.name));
  const largest = areas.reduce((m, x) => (x.v > m.v ? x : m));
  const spec = { labels: areas.map((x) => x.a.name), series: [{ name: YEARS[1].label, values: areas.map((x) => x.then || 0) }, { name: YEARS[2].label, values: areas.map((x) => x.v) }],
    summary: `${largest.a.name} is the largest service area at ${millions(largest.v)} of ${millions(e26)} in FY 2026-27.`,
    links: Object.fromEntries(areas.map((x) => [x.a.name, toolLink('./budget/', 'area', x.a.name)])) };
  return section('books', beside ? 'Budget books' : 'Budget', `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-areas', 'Spending by service area', 'bars', spec, false, LIB))}${tabLinks('budget/index.html', './budget/')}`);
}

// ---- Budget and spending: the adopted budget by service area and the largest departments ------------------------------
function spendingSection() {
  const file = path.join(ROOT, 'data', 'accounting', 'summary.json');
  if (!fs.existsSync(file) || !fs.existsSync(path.join(ROOT, 'budget', 'accounting', 'index.html'))) return '';
  const s = readJson('data/accounting/summary.json');
  const t = s.totals;
  const tool = './budget/accounting/';
  const kpis = [kpi(s.labels.spending, millions(t.spending), `${tool}?measure=exp&basis=original&year=${s.yearIndex}`),
    kpi(s.labels.revenue, millions(t.revenue), `${tool}?measure=rev&basis=original&year=${s.yearIndex}`),
    kpi(`${s.labels.spendingStem}, change from ${s.previousYear} to ${s.year}`, pct(t.spending, t.spendingBefore), `${tool}?measure=exp&basis=original&year=${s.previousYearIndex},${s.yearIndex}&change=1`),
    kpi(`Departments with a ${s.year} budget`, String(t.departments), `${tool}?budget=${encodeURIComponent(s.statusHas)}`)];
  const largest = s.serviceAreas.reduce((m, x) => (x.spending > m.spending ? x : m));
  const spec = { labels: s.serviceAreas.map((a) => a.name), series: [{ name: s.previousYear, values: s.serviceAreas.map((a) => a.spendingBefore) }, { name: s.year, values: s.serviceAreas.map((a) => a.spending) }],
    summary: `${largest.name} is the largest service area at ${millions(largest.spending)} of ${millions(t.spending)} in ${s.year}.` };
  const departments = s.largest;
  const deptSpec = { labels: departments.map((d) => d.name), series: [{ name: `Spending, adopted budget, ${s.year}`, values: departments.map((d) => d.spending) }],
    summary: `${departments[0].name} is the largest department at ${millions(departments[0].spending)}.`,
    links: Object.fromEntries(departments.map((d) => [d.name, `./budget/accounting/departments/${d.code}.html`])) };
  spec.links = Object.fromEntries(s.serviceAreas.map((a) => [a.name, toolLink('./budget/accounting/', 'area', a.name)]));
  return section('spending', 'Budget and spending', `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-spending', 'Adopted spending by service area', 'bars', spec, false, LIB), chart('chart-dash-departments', 'Largest departments by adopted spending', 'bars', deptSpec, false, LIB))}${tabLinks('budget/accounting/index.html', './budget/accounting/')}`);
}

// ---- The year so far: what is spent, committed and left of the current budget, and the largest Net County cost ----------------
function positionSection() {
  const file = path.join(ROOT, 'data', 'accounting', 'summary.json');
  if (!fs.existsSync(file) || !fs.existsSync(path.join(ROOT, 'budget', 'accounting', 'index.html'))) return '';
  const s = readJson('data/accounting/summary.json');
  const p = s.position;
  if (!p) return '';
  const n = p.names;
  const open = (area) => `./budget/accounting/?${area ? `area=${encodeURIComponent(area)}&` : ''}${p.links.position}`;
  // The section's title says the year and that it is spending, so a card says only what the amount is; each opens the tool on that amount.
  const short = (k) => p.shortNames[k];
  const card = (k) => kpi(short(k), millions(p.totals[k]), `./budget/accounting/?measure=exp&basis=${p.links.bases[k]}&year=${s.yearIndex}`);
  const kpis = ['current', 'spent', 'committed', 'left'].map(card);
  const areas = p.serviceAreas;
  const spec = { labels: areas.map((a) => a.name), series: [{ name: short('spent'), values: areas.map((a) => a.spent) }, { name: short('committed'), values: areas.map((a) => a.committed) }, { name: short('left'), values: areas.map((a) => a.left) }],
    summary: `Of ${millions(p.totals.current)} in the current budget, ${millions(p.totals.spent)} is spent so far, ${millions(p.totals.committed)} is committed and ${millions(p.totals.left)} is left.`,
    links: Object.fromEntries(areas.map((a) => [a.name, open(a.name)])) };
  return section('position', `${s.year} so far`, `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-position', `${s.year} so far, by service area`, 'bars', spec, true, LIB))}`);
}

// ---- Capital improvement plan: the plan's totals and where the money goes ----------------------------------------------
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
  const kpis = [kpi(`Programmed, FY ${years[0]} to ${years[years.length - 1]}`, millions(ALL.total), './capital/projects.html?tab=stats'), kpi('Projects', String(display.projects.length), './capital/projects.html'),
    kpi('Cost estimate', millions(sum((p) => p.costEstimate)), './capital/projects.html?sort=cost'), kpi('Additional funds needed', millions(ALL.additionalFundsNeeded), './capital/projects.html?gap=gap&sort=gap')];
  const spec = { labels: years.map((y) => 'FY' + y.slice(-2)), series: groups.map(({ g, t }) => ({ name: g, values: years.map((y) => t.byYear[y]) })),
    summary: `${groups[0].g} is the largest category at ${millions(groups[0].t.total)} of ${millions(ALL.total)} over five years.`,
    links: Object.fromEntries(groups.map(({ g }) => [g, toolLink('./capital/projects.html', 'category', g)])) };
  return section('capital', 'Capital improvement plan', `<div class="mm-stats-kpis">${kpis.join('')}</div>${charts(chart('chart-dash-categories', 'Planned spending by category and year', 'bars', spec, true, LIB))}${shortcuts([['./capital/projects.html?gap=gap&sort=gap', 'Projects needing funding'], ['./capital/projects.html?status=New', 'New projects'], ['./capital/projects.html?sort=cost', 'Largest projects'], ['./capital/index.html', 'Categories and fund sources']])}`);
}

// ---- Contracts: the value of the County's contracts and where it goes -----------------------------------------------
function contractsSection() {
  const vd = require('./contracts-data');
  const data = vd.load();
  if (!data) return '';
  const rows = data.contracts;
  const top = vd.vendorsOf(rows).slice(0, 10);
  const spec = { labels: top.map((g) => g.name), series: [{ name: 'Contract value', values: top.map((g) => g.value) }],
    summary: `${top[0].name} is the largest vendor at ${vd.inMillions(top[0].value)}.`,
    links: Object.fromEntries(top.filter((g) => data.vendors[g.key]).map((g) => [g.name, `./contracts/vendors/${data.vendors[g.key].slug}.html`])) };
  return section('contracts', 'Contracts', `${vd.kpis(rows, false, { contracts: './contracts/', active: './contracts/?status=Active', value: './contracts/?view=stats', count: './contracts/?view=vendors' })}${charts(chart('chart-dash-vendors', 'Top 10 vendors by contract value', 'bars', spec, false, LIB))}${shortcuts([['./contracts/?status=Active', 'Active contracts'], ['./contracts/?view=vendors', 'Vendors'], ['./contracts/?view=stats', 'Contract stats']])}`);
}

// The box is the filter column's own search field (label above, the same field), so it looks as it does in Marin Mentions. On the home page it lists the first
// few results and goes to the page of results (search.html) when it is sent; on that page it lists them all.
const searchBox = (all) => `<search class="home-search" id="home-search" aria-label="Search the budget"${all ? ' data-all' : ''}><div class="search-input-field"><label for="home-search-input">Search</label><input type="search" id="home-search-input" autocomplete="off" placeholder="A contract number, a code, a name"></div>` +
  `<div class="mm-results-summary"><p class="app-help-text" id="home-search-status" role="status" aria-live="polite"></p></div><ul id="home-search-results" class="home-search__results"></ul></search>` +
  `<script src="./shared/chart-links.js?v=${stamp('shared/chart-links.js')}" defer></script><script src="./shared/home-search.js?v=${stamp('shared/home-search.js')}" defer></script>`;
const spending = spendingSection();
const body = `<article class="content"><h1 class="doc-title">Dashboard</h1>${searchBox(false)}` +
  `<div class="org-dashboard">${spending}${positionSection()}${booksSection(Boolean(spending))}${capitalSection()}${contractsSection()}</div></article>`;
fs.writeFileSync(path.join(ROOT, 'index.html'), shell('Dashboard', 'The County of Marin budget, spending, Capital Improvement Plan and contracts at a glance.', [['Marin Budget', null]], body, 'root'));
console.log('Wrote index.html.');
// The page of results: the same box, with every result and where each one sits.
fs.writeFileSync(path.join(ROOT, 'search.html'), shell('Search', 'Search the County of Marin budget, spending, Capital Improvement Plan and contracts by name, code or contract number.', [['Marin Budget', './index.html'], ['Search', null]],
  `<article class="content"><h1 class="doc-title">Search</h1>${searchBox(true)}</article>`, 'root'));
console.log('Wrote search.html.');
