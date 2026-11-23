'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The accounting data and the chart of accounts are local files that are not committed yet; without them there is nothing to check.
const ROOT = path.join(__dirname, '..');
const have = fs.existsSync(path.join(ROOT, 'data/accounting/meta.json')) && fs.existsSync(path.join(ROOT, 'coa-schemagov-json/marin-accounting-dimensions.json'));
const opts = have ? {} : { skip: 'data/accounting and coa-schemagov-json are not in this checkout' };

let built;
const run = () => { if (!built) built = require('../scripts/build-accounting').build(); return built; };
const col = (index, key) => index.columns.findIndex((c) => c.key === key);

test('every check of the rollups passes: totals match meta.json to the cent, and each way of grouping adds back to the whole', opts, () => {
  const { checks } = run();
  const failed = checks.filter((c) => !c.ok);
  assert.deepStrictEqual(failed, []);
  assert.ok(checks.length >= 15);
});

test('a division, program or subprogram code shared by several parents keeps one node for each path', opts, () => {
  const nodes = run().outputs['tree.json'].nodes;
  const ids = nodes.map((n) => n.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  // Division 9001 (Non Departmental) is under three departments; division 6501 under two.
  assert.deepStrictEqual(nodes.filter((n) => n.level === 'division' && n.code === '9001').map((n) => n.id).sort(), ['100/9001', '320/9001', '900/9001']);
  assert.deepStrictEqual(nodes.filter((n) => n.level === 'division' && n.code === '6501').map((n) => n.id).sort(), ['605/6501', '650/6501']);
  // Every node's parent is a node, one level up.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const up = { department: 'serviceArea', division: 'department', program: 'division', subprogram: 'program' };
  nodes.filter((n) => n.parent).forEach((n) => assert.strictEqual(byId.get(n.parent).level, up[n.level], n.id));
});

test('service areas run A to Z with "No service area" last, and hold the departments the County listed', opts, () => {
  const nodes = run().outputs['tree.json'].nodes;
  const areas = nodes.filter((n) => n.level === 'serviceArea');
  assert.deepStrictEqual(areas.map((n) => n.name), ['Community & Environment', 'Health & Human Services', 'Justice & Welfare', 'Operations & Resources', 'No service area']);
  const kids = (id) => nodes.filter((n) => n.parent === id).map((n) => n.code).sort();
  assert.deepStrictEqual(kids('sa:justice-and-welfare'), ['200', '220', '240', '250', '260']);
  assert.deepStrictEqual(kids('sa:health-and-human-services'), ['100']);
  // Not listed by the County: no service area, not a guess.
  const none = kids('sa:none');
  ['900', '330', '659'].forEach((d) => assert.ok(none.includes(d), d));
});

test('the totals are the export\'s: Original expenses in FY 2026-27, revenues kept positive, contingencies apart from expenses', opts, () => {
  const { outputs } = run();
  const index = outputs['index.json'];
  const i = col(index, 'fy2026_27.original');
  const sum = (type) => index.groups.reduce((n, g, k) => n + (g.objectType === type ? outputs['tree.json'].nodes.filter((x) => x.level === 'department').reduce((m, d) => m + ((d.v[k] || [])[i] || 0), 0) : 0), 0);
  assert.strictEqual(Math.round(sum('Expenses') * 100), 117515057608);
  assert.strictEqual(Math.round(sum('Revenues') * 100), 115645440768);
  assert.ok(sum('Contingency') > 0);
  assert.deepStrictEqual(index.groups.filter((g) => g.objectType === 'Contingency').map((g) => g.name), ['Contingencies']);
  assert.ok(index.groups.every((g, k, all) => k === 0 || ['Expenses', 'Revenues', 'Contingency'].indexOf(g.objectType) >= ['Expenses', 'Revenues', 'Contingency'].indexOf(all[k - 1].objectType)));
});

test('72 departments have an FY 2026-27 budget, and a department is marked from its own amounts', opts, () => {
  const depts = run().outputs['tree.json'].nodes.filter((n) => n.level === 'department');
  assert.strictEqual(depts.length, 122);
  assert.strictEqual(depts.filter((d) => d.hasBudget).length, 72);
  assert.strictEqual(depts.find((d) => d.code === '601').hasBudget, false); // MCOE: actuals only
  assert.strictEqual(depts.find((d) => d.code === '260').hasBudget, true); // Sheriff
});

test('the tree carries Net County cost, and each department has a detail file that holds all of its account rows', opts, () => {
  const { outputs, checks } = run();
  const nodes = outputs['tree.json'].nodes;
  // Net County cost is on the departments that have an amount in funds 1000 and 2800, and adds up at every level (a check of the build).
  assert.ok(checks.filter((c) => /Net County cost/.test(c.name)).length >= 5);
  const sheriff = nodes.find((n) => n.id === '260');
  const i = outputs['index.json'].columns.findIndex((c) => c.key === 'fy2026_27.original');
  assert.strictEqual(Math.round(sheriff.ncc[i] * 100), 5595005800); // $55,950,058: expenses less revenues in funds 1000 and 2800, in cents
  const detail = outputs['detail/260.json'];
  assert.strictEqual(detail.rows.length, 5701);
  assert.ok(detail.rows.every((r) => r.length === 2 + outputs['index.json'].columns.length));
  assert.ok(detail.funds.some((f) => f.code === '1000') && detail.functionalActivities.length > 0);
  assert.ok(detail.objects.every((o) => Number.isInteger(o.group)));
  assert.strictEqual(Object.keys(outputs).filter((k) => k.startsWith('detail/')).length, 122);
});

test('every department, division, program, subprogram and fund has a name, not just its code', opts, () => {
  const { outputs } = run();
  const bare = outputs['tree.json'].nodes.filter((n) => n.level !== 'serviceArea' && n.name === n.code).map((n) => `${n.level} ${n.id}`);
  assert.deepStrictEqual(bare, []);
  assert.deepStrictEqual(outputs['funds.json'].funds.filter((f) => f.name === f.code).map((f) => f.code), []);
  assert.ok(outputs['funds.json'].funds.some((f) => f.code === '1000' && /general fund/i.test(f.name)));
});
