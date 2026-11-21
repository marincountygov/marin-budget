// Reads the contracts display file (built by scripts/build_contracts_view.py) and builds the figures,
// charts and tables for the Contracts tab, the vendor pages and the Dashboard.
// Used by build-contracts.js and build-dashboard.js.
//
// A contract's value is the amount of the contract, not what has been paid. Edit the data, never the pages.

const fs = require('fs');
const path = require('path');
const bd = require('./budget-data');

const DIR = path.join(__dirname, '..', 'contracts', 'data');
const FILE = 'contracts-display.json';
const { chart, charts, kpi, table, num, esc, money, millions } = bd;
const inMillions = (n) => '$' + (n / 1e6).toFixed(1) + ' million';

const NOTE = 'Each value is the amount of the contract, not what the County has paid. Contracts of $100 or less and test records are left out. Types and statuses are as the County records them.';

function load() {
  const file = path.join(DIR, FILE);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.byDept = new Map();
  data.byVendor = new Map();
  for (const c of data.contracts) {
    if (!data.byDept.has(c.dept)) data.byDept.set(c.dept, []);
    data.byDept.get(c.dept).push(c);
    if (!data.byVendor.has(c.vendorId)) data.byVendor.set(c.vendorId, []);
    data.byVendor.get(c.vendorId).push(c);
  }
  return data;
}

const sum = (rows) => rows.reduce((n, r) => n + r.value, 0);

// Total value and count for each value of `key` (a field name or a function), largest first.
function group(rows, key) {
  const f = typeof key === 'function' ? key : (r) => r[key];
  const m = new Map();
  for (const r of rows) {
    const k = f(r);
    const g = m.get(k) || { key: k, count: 0, value: 0 };
    g.count += 1;
    g.value += r.value;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
}

const vendorsOf = (rows) => group(rows, 'vendorId').map((g) => ({ ...g, name: rows.find((r) => r.vendorId === g.key).vendor }));
const vendorHref = (data, id, up = '') => (data.vendors[id] ? `${up}${data.vendors[id].slug}.html` : null);

// Key numbers for a set of contracts. A vendor's own page counts its departments instead of its vendors.
function kpis(rows, countDepartments = false) {
  const active = rows.filter((r) => r.status === 'active').length;
  const n = countDepartments ? new Set(rows.map((r) => r.dept)).size : new Set(rows.map((r) => r.vendorId)).size;
  return `<div class="mm-stats-kpis">${kpi('Contracts', rows.length.toLocaleString('en-US'))}${kpi('Active contracts', active.toLocaleString('en-US'))}${kpi('Total contract value', millions(sum(rows)))}${kpi(countDepartments ? 'Departments' : 'Vendors', n.toLocaleString('en-US'))}</div>`;
}

// Charts of where the value goes: by type, by vendor (unless `vendor` is set, on a vendor's own page) and by year.
// `byDept` adds a chart by department. A chart with one bar says nothing, so it is left out.
function allocationCharts(rows, idPrefix, opts = {}) {
  const chart = (id, title, kind, spec) => bd.chart(id, title, kind, spec, false, opts.lib); // opts.lib: where the chart library is, from the page
  const total = sum(rows);
  const share = (v) => Math.round((v / total) * 100);
  const out = [];
  if (opts.byDept && opts.byDept.length > 1) {
    const d = opts.byDept;
    out.push(chart(`${idPrefix}-depts`, 'Contract value by department', 'bars', { labels: d.map((g) => g.name), series: [{ name: 'Contract value', values: d.map((g) => g.value) }],
      summary: `${d[0].name} has the most contract value, ${inMillions(d[0].value)}, ${share(d[0].value)}% of the total.` }));
  }
  const types = group(rows, 'type');
  if (types.length > 1) out.push(chart(`${idPrefix}-types`, 'Contract value by type', 'bars', { labels: types.map((g) => g.key), series: [{ name: 'Contract value', values: types.map((g) => g.value) }],
    summary: `${types[0].key} is the largest type at ${inMillions(types[0].value)}, ${share(types[0].value)}% of the total.` }));
  if (!opts.vendor) {
    const top = vendorsOf(rows).slice(0, 10);
    out.push(chart(`${idPrefix}-vendors`, 'Top 10 vendors by contract value', 'bars', { labels: top.map((g) => g.name), series: [{ name: 'Contract value', values: top.map((g) => g.value) }],
      summary: `${top[0].name} is the largest vendor at ${inMillions(top[0].value)}. The top 10 hold ${share(top.reduce((n, g) => n + g.value, 0))}% of the total.` }));
  }
  const years = group(rows, 'year').sort((a, b) => a.key - b.key);
  if (years.length > 1) {
    const biggest = [...years].sort((a, b) => b.value - a.value)[0];
    out.push(chart(`${idPrefix}-years`, 'Contract value by year', 'columns', { labels: years.map((g) => String(g.key)), series: [{ name: 'Contract value', values: years.map((g) => g.value) }],
      summary: `${biggest.key} has the most contract value at ${inMillions(biggest.value)}.` }));
  }
  return out.length ? charts(...out) : '';
}

// A table of groups: the label (HTML, already escaped), contracts, value and share.
function groupTable(caption, head, groups, total, label) {
  const rows = groups.map((g) => `<tr><th scope="row">${label(g)}</th>${num(g.count, g.count.toLocaleString('en-US'))}${num(g.value, money(Math.round(g.value)))}${num(g.value, Math.round((g.value / total) * 100) + '%')}</tr>`);
  return table(caption, [head, 'Contracts', 'Contract value', 'Share'], rows);
}

module.exports = { NOTE, load, sum, group, vendorsOf, vendorHref, kpis, allocationCharts, groupTable, inMillions };
