#!/usr/bin/env node
// Builds what the search box on the home page looks through: a list of things with a name, a code and an address.
//
//   node scripts/build-search.js
//
//   search-index.json                       contracts (by contract number), vendors, capital projects
//   budget/accounting/search-index.json     departments, divisions, programs, subprograms, budget units, funds, accounts, functions, categories
//                                           (built where the financial-system data is; the same decision about publishing applies to it)
//
// An entry is { k: kind, n: name, c: code or number, x: other words to match, h: address from the home page }.
// Names only and codes only: no amounts are in the index.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const write = (f, list) => fs.writeFileSync(path.join(ROOT, f), JSON.stringify(list) + '\n');

// ---- contracts, vendors and capital projects ----
const entries = [];
const contractsFile = 'contracts/data/contracts-display.json';
if (fs.existsSync(path.join(ROOT, contractsFile))) {
  const data = readJson(contractsFile);
  const nameOf = require('../shared/display-name');
  nameOf.use(null);
  data.contracts.forEach((c) => { c.name = nameOf(c.name); c.vendor = nameOf(c.vendor); });
  Object.values(data.vendors).forEach((v) => { v.name = nameOf(v.name); });
  data.contracts.forEach((c) => entries.push({ k: 'Contract', n: c.name, c: String(c.id), x: [c.vendor, c.dept ? `department ${c.dept}` : '', c.project ? `project ${c.project}` : ''].filter(Boolean).join('; '), h: `./contracts/c/${encodeURIComponent(c.id)}.html` }));
  Object.entries(data.vendors).forEach(([id, v]) => entries.push({ k: 'Vendor', n: v.name, c: String(id), x: '', h: `./contracts/vendors/${v.slug}.html` }));
}
const projectsFile = 'capital/data/cip-display.json';
if (fs.existsSync(path.join(ROOT, projectsFile))) {
  readJson(projectsFile).projects.forEach((p) => entries.push({ k: 'Capital project', n: p.name, c: '', x: [p.category, p.subcategory].filter(Boolean).join('; '), h: `./capital/projects/${p['@id'].split('/').pop()}.html` }));
}
write('search-index.json', entries);
console.log(`Wrote search-index.json: ${entries.length} entries.`);

// ---- the financial system's departments and what is under them ----
const RUN = path.join(ROOT, 'data', 'accounting', 'rollups');
if (!fs.existsSync(path.join(RUN, 'tree.json'))) process.exit(0);
const display = require('../shared/display-name');
const L = require('./labels');
display.use(L.approvedNames());
const tree = JSON.parse(fs.readFileSync(path.join(RUN, 'tree.json'), 'utf8')).nodes;
const index = JSON.parse(fs.readFileSync(path.join(RUN, 'index.json'), 'utf8'));
const tool = './budget/accounting/';
const pageOf = (dept) => `${tool}departments/${dept}.html`;
const deptName = new Map(tree.filter((n) => n.level === 'department').map((n) => [n.code, display(n.name, { kind: 'department', code: n.code })]));
const nameOf = new Map(tree.filter((n) => n.level !== 'serviceArea').map((n) => [n.id, display(n.name, { kind: n.level, code: n.code })]));
const KIND = { serviceArea: 'Service area', department: 'Department', division: 'Division', program: 'Program', subprogram: 'Subprogram' };
// Where a thing sits, from the department down: "Office of the County Executive > County Management & Budget > Budget".
const trail = (parts) => parts.filter(Boolean).join(' \u203a ');
const found = (dept, code) => `${pageOf(dept)}?find=${encodeURIComponent(code)}`; // the department's page, opened on what was found
const acc = [];
tree.forEach((n) => {
  const dept = n.id.split('/')[0];
  if (n.level === 'serviceArea') { acc.push({ k: KIND.serviceArea, n: n.name, c: '', x: '', h: `${tool}?area=${encodeURIComponent(n.name)}` }); return; }
  const ids = n.id.split('/');
  const above = ids.slice(0, -1).map((_, i) => nameOf.get(ids.slice(0, i + 1).join('/')));
  acc.push({ k: KIND[n.level], n: display(n.name, { kind: n.level, code: n.code }), c: n.code, x: trail(above), h: n.level === 'department' ? pageOf(dept) : found(dept, n.code) });
});
const seen = { fund: new Set(), object: new Set() };
fs.readdirSync(path.join(RUN, 'detail')).filter((f) => f.endsWith('.json')).forEach((f) => {
  const dept = f.replace(/\.json$/, '');
  const d = JSON.parse(fs.readFileSync(path.join(RUN, 'detail', f), 'utf8'));
  d.organizations.forEach((o) => acc.push({ k: 'Budget unit', n: display(o.name, { kind: 'organization', code: o.code }), c: o.code, x: trail([deptName.get(dept), nameOf.get(`${dept}/${o.division}`), nameOf.get(`${dept}/${o.division}/${o.program}`), nameOf.get(`${dept}/${o.division}/${o.program}/${o.subprogram}`)]), h: found(dept, o.code) }));
  d.funds.forEach((fund) => { if (!seen.fund.has(fund.code)) { seen.fund.add(fund.code); acc.push({ k: 'Fund', n: display(fund.name, { kind: 'fund', code: fund.code }), c: fund.code, x: '', h: `${tool}?fund=${fund.code}` }); } });
  d.objects.forEach((o) => { if (!seen.object.has(o.code)) { seen.object.add(o.code); acc.push({ k: 'Account', n: display(o.name, { kind: 'object', code: o.code }), c: o.code, x: o.objectType || '', h: `${tool}?q=${o.code}` }); } });
  d.functionalActivities.forEach((a) => { if (!seen.fn) seen.fn = new Set(); if (!seen.fn.has(a.code)) { seen.fn.add(a.code); acc.push({ k: 'Function', n: display(a.name, { kind: 'function', code: a.code }), c: a.code, x: '', h: `${tool}?function=${a.code}` }); } });
});
index.groups.forEach((g) => { if (!seen.cat) seen.cat = new Set(); if (!seen.cat.has(g.code)) { seen.cat.add(g.code); acc.push({ k: 'Category', n: display(g.name, { kind: 'category', code: g.code }), c: g.code, x: g.objectType || '', h: `${tool}?category=${g.code}` }); } });
write('budget/accounting/search-index.json', acc);
console.log(`Wrote budget/accounting/search-index.json: ${acc.length} entries.`);
