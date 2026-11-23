#!/usr/bin/env node
// Writes the two lists the County reviews to approve the plain labels:
//   data/accounting/label-review.csv      names to review, biggest first: the code, the export's name, the name now shown, and a blank for the County's wording
//   data/accounting/glossary-review.csv   the shorthand in those names, most common first, with its status in the glossary and where it appears
//
//   node scripts/build-label-review.js
//
// Money is only for putting the names in order: the FY 2026-27 adopted amount of spending and revenue under the name.

const fs = require('fs');
const path = require('path');
const display = require('../shared/display-name');
const L = require('./labels');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'data', 'accounting', 'rollups');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const parts = L.approvedNames();
display.use(parts);

const index = readJson('index.json');
const pos = index.columns.findIndex((c) => c.key === 'fy2026_27.original');
const counted = index.groups.map((g, i) => (g.objectType === 'Contingency' ? -1 : i)).filter((i) => i >= 0);
const amountOf = (v) => counted.reduce((s, g) => s + Math.abs((v[g] || [])[pos] || 0), 0);

const items = []; // { kind, code, name, amount, parent }
for (const n of readJson('tree.json').nodes) if (n.level !== 'serviceArea') items.push({ kind: n.level, code: n.code, name: n.name, amount: amountOf(n.v), where: n.id });
for (const f of readJson('funds.json').funds) items.push({ kind: 'fund', code: f.code, name: f.name, amount: amountOf(f.v), where: f.code });
for (const f of readJson('functional-activities.json').functionalActivities) items.push({ kind: 'function', code: f.code, name: f.name, amount: amountOf(f.v), where: f.code });
for (const g of index.groups) items.push({ kind: 'category', code: g.code, name: g.name, amount: 0, where: g.objectType });
// Objects and budget units come from each department's detail.
const objects = new Map();
const orgs = [];
for (const file of fs.readdirSync(path.join(RUN, 'detail'))) {
  const d = readJson(`detail/${file}`);
  for (const r of d.rows) {
    const o = d.objects[r[1]];
    const rec = objects.get(o.code) || { kind: 'object', code: o.code, name: o.name, amount: 0, where: o.objectType };
    rec.amount += Math.abs(r[2 + pos] || 0);
    objects.set(o.code, rec);
  }
  const byOrg = new Map();
  for (const r of d.rows) byOrg.set(r[0], (byOrg.get(r[0]) || 0) + Math.abs(r[2 + pos] || 0));
  d.organizations.forEach((o, i) => orgs.push({ kind: 'organization', code: o.code, name: o.name, amount: byOrg.get(i) || 0, where: `${d.department}/${o.division}/${o.program}/${o.subprogram}` }));
}
items.push(...objects.values(), ...orgs);

// ---- names ----
const LIMITS = { department: Infinity, division: 150, program: 150, subprogram: 100, fund: 100, function: Infinity, category: Infinity, object: 150, organization: 150 };
const taken = {};
const rows = [['Kind', 'Code', 'Name in the export', 'Name shown now', 'Plain name (County to write)', 'FY 2026-27 adopted amount', 'Where']];
for (const kind of Object.keys(LIMITS)) {
  const list = items.filter((i) => i.kind === kind).sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code));
  const seen = new Set();
  for (const i of list) {
    if (kind !== 'department' && taken[kind] >= LIMITS[kind]) break;
    if (['division', 'program', 'subprogram'].includes(kind)) { if (seen.has(`${i.code}|${i.name}`)) continue; seen.add(`${i.code}|${i.name}`); }
    taken[kind] = (taken[kind] || 0) + 1;
    rows.push([kind, i.code, i.name.trim(), display(i.name, { kind, code: i.code }), '', Math.round(i.amount), i.where]);
  }
}
fs.writeFileSync(path.join(ROOT, 'data/accounting/label-review.csv'), rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

// ---- shorthand ----
const glossary = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/accounting/glossary.json'), 'utf8'));
const dictionary = fs.existsSync('/usr/share/dict/words') ? new Set(fs.readFileSync('/usr/share/dict/words', 'utf8').split('\n').map((w) => w.trim().toLowerCase())) : new Set();
const KEEP = new Set(['hhs', 'ihss', 'csa', 'fcz', 'prd', 'csd', 'fpd', 'jpa', 'smd', 'pud', 'dpw', 'mcera', 'mcoe', 'uc', 'ii', 'cop', 'hvac', 'mcal']);
const tokens = new Map();
for (const i of items) {
  for (const t of new Set(i.name.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x && !/^\d+$/.test(x) && x.length > 1))) {
    // A word the dictionary has, or the plural or -ing form of one, needs no review.
    if (dictionary.has(t) || KEEP.has(t) || dictionary.has(t.replace(/(es|s|ing)$/, '')) || dictionary.has(t.replace(/s$/, ''))) continue;
    const e = tokens.get(t) || { count: 0, amount: 0, kinds: new Set(), examples: [] };
    e.count += 1; e.amount += i.amount; e.kinds.add(i.kind);
    if (e.examples.length < 2 && !e.examples.includes(i.name.trim())) e.examples.push(i.name.trim());
    tokens.set(t, e);
  }
}
const list = [...tokens].filter(([, e]) => e.count >= 3).sort((a, b) => b[1].count - a[1].count).slice(0, 250);
const g = [['Shorthand', 'Status', 'Written out', 'Names that use it', 'Adopted amount under them', 'Kinds', 'Examples', 'County: approve or write the wording']];
for (const [t, e] of list) {
  const entry = glossary.tokens[t];
  g.push([t.toUpperCase(), entry ? entry.status : 'not in the glossary', entry ? entry.to : '', e.count, Math.round(e.amount), [...e.kinds].sort().join(' '), e.examples.join(' | '), '']);
}
fs.writeFileSync(path.join(ROOT, 'data/accounting/glossary-review.csv'), g.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
const status = (s) => g.filter((r) => r[1] === s).length;
console.log(`label-review.csv: ${rows.length - 1} names (${Object.entries(taken).map(([k, n]) => `${n} ${k}`).join(', ')}).`);
console.log(`glossary-review.csv: ${g.length - 1} shorthand words that appear 3 or more times: ${status('certain')} certain, ${status('confirm')} to confirm, ${status('not in the glossary')} not in the glossary yet.`);
