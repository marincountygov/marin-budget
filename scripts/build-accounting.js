#!/usr/bin/env node
// Builds the rollups of the financial system's account data: the totals a page loads, so it never reads the 88,897 account rows
// except for the department a person opens.
//
//   node scripts/build-accounting.js            (writes data/accounting/rollups/, prints a report, exits 1 if a check fails)
//
// Inputs, none of them edited here:
//   data/accounting/accounts/{department}.json, dimensions.json, meta.json   the amounts (convert_export.py)
//   coa-schemagov-json/                                                  the County's chart of accounts: names and structure
//   data/accounting/service-areas.json                                        the County's list of departments in each service area
//
// The structure comes from the chart of accounts: an organization's fund, department, division, program, subprogram and
// functional activity are the ones on its COA record. The amounts come from the account files and are never changed.
// A division, program or subprogram code is not unique on its own (division 9001 sits under three departments), so a node of the
// tree is keyed on its whole path: "100", "100/1001", "100/1001/1000", "100/1001/1000/1001".
// Amounts are added as whole cents. A cell is null only when every amount added into it was null; 0 stays 0.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'accounting');
const COA = path.join(ROOT, 'coa-schemagov-json');
const OUT = path.join(DATA, 'rollups');
const TYPE_ORDER = ['Expenses', 'Revenues', 'Contingency'];
const LEVELS = ['serviceArea', 'department', 'division', 'program', 'subprogram'];
// Net County cost: expenses less revenues in the General Fund and HHS Operations (the County's answer), computed here at every level.
const NCC_FUNDS = ['1000', '2800'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const cents = (x) => (x === null || x === undefined ? null : Math.round(x * 100));
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.code.localeCompare(b.code);

// Sums of one set of amounts: one whole-cent total for each column, and whether any amount in it was not null.
class Sums {
  constructor(n) { this.v = new Array(n).fill(0); this.seen = new Array(n).fill(false); }
  add(cs) { for (let i = 0; i < cs.length; i += 1) if (cs[i] !== null) { this.v[i] += cs[i]; this.seen[i] = true; } }
  isEmpty() { return this.v.every((x, i) => x === 0 && this.seen[i]); } // only zeros: not listed (a group that is not listed has only zero amounts)
  out() { return this.v.map((x, i) => (this.seen[i] ? x / 100 : null)); }
}

// A map from a key to the sums of each group (object type and character code) under it.
class Rollup {
  constructor(n) { this.n = n; this.keys = new Map(); }
  add(key, group, cs) {
    if (!this.keys.has(key)) this.keys.set(key, new Map());
    const groups = this.keys.get(key);
    if (!groups.has(group)) groups.set(group, new Sums(this.n));
    groups.get(group).add(cs);
  }
  groupsOf(key) { return this.keys.get(key) || new Map(); }
  // {groupIndex: [amounts]} for the groups that have an amount other than zero.
  listed(key, groupIndex) {
    const out = {};
    for (const [g, s] of this.groupsOf(key)) if (!s.isEmpty()) out[groupIndex.get(g)] = s.out();
    return out;
  }
}

function load() {
  const meta = readJson(path.join(DATA, 'meta.json'));
  const fin = readJson(path.join(DATA, 'dimensions.json'));
  const coaDims = readJson(path.join(COA, 'marin-accounting-dimensions.json'));
  const coaObjects = readJson(path.join(COA, 'marin-accounting-objects.json')).objects;
  const entities = readJson(path.join(COA, 'schemagov-entities.json'))['@graph'];
  const serviceAreas = readJson(path.join(DATA, 'service-areas.json'));
  // Names of departments, divisions, programs and funds are on the schemaGov entities, by the code in their identifier.
  const names = { department: new Map(), division: new Map(), program: new Map(), fund: new Map() };
  for (const e of entities) {
    for (const i of e.identifier || []) {
      // The identifier is named as the chart-of-accounts files write it; this string is data, not a label.
      const m = /^Marin Munis (department|division|program|fund) code$/.exec(i.propertyID || '');
      if (m) names[m[1]].set(i.value, e.name);
    }
  }
  const files = fs.readdirSync(path.join(DATA, 'accounts')).filter((f) => f.endsWith('.json')).sort();
  const accounts = files.map((f) => ({ department: f.replace(/\.json$/, ''), ...readJson(path.join(DATA, 'accounts', f)) }));
  return { meta, fin, coaDims, coaObjects, names, serviceAreas, accounts };
}

function build() {
  const { meta, fin, coaDims, coaObjects, names, serviceAreas, accounts } = load();
  const columns = meta.columns;
  const N = columns.length;
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

  // ---- the structure: the chart of accounts, and what the financial file's own dimensions say about the same codes ----
  const coaOrg = new Map(coaDims.organizations.map((o) => [o.code, o]));
  const finOrg = new Map(fin.organizations.map((o) => [o.code, o]));
  const coaObj = new Map(coaObjects.map((o) => [o.code, o]));
  const finObj = new Map(fin.objects.map((o) => [o.code, o]));
  const subName = new Map(coaDims.subprograms.map((s) => [s.code, s.name]));
  const funcName = new Map(coaDims.functionalActivities.map((f) => [f.code, f.name]));
  // The service area of a department comes from the County's list; a department it does not list has none.
  const areaOf = new Map();
  const listedTwice = [];
  for (const a of serviceAreas.serviceAreas) for (const d of a.departments) { if (areaOf.has(d)) listedTwice.push(d); areaOf.set(d, a); }
  const NONE = { id: 'none', name: 'No service area' };

  // ---- one pass over the account rows ----
  const groups = new Map(); // "Expenses|51" -> { objectType, code, name }
  const tree = new Rollup(N);
  const funds = new Rollup(N);
  const funcs = new Rollup(N);
  const deptFunds = new Rollup(N);
  const total = new Rollup(N);
  const nccTree = new Rollup(N); // one group, 'ncc'
  const nccTotal = new Rollup(N);
  const detail = new Map(); // department -> { organizations, objects, rows }: what a page loads when a department is opened
  const problems = { missingOrg: 0, missingObject: 0, hierarchy: 0, wrongFile: 0, objectOnlyInFinancial: new Set(), codeDiffers: 0 };
  let rows = 0;
  const hierarchyExamples = [];
  for (const file of accounts) {
    if (JSON.stringify(file.columns) !== JSON.stringify(columns)) throw new Error(`${file.department}.json: its columns are not the ones in meta.json`);
    for (const row of file.rows) {
      rows += 1;
      const org = coaOrg.get(row[0]);
      const fo = finObj.get(row[1]);
      if (!org) { problems.missingOrg += 1; continue; }
      if (!fo) { problems.missingObject += 1; continue; }
      const co = coaObj.get(row[1]);
      if (!co) problems.objectOnlyInFinancial.add(row[1]);
      else if (co.characterCode !== fo.level2) problems.codeDiffers += 1;
      // Where the two files describe the same organization, they must agree on its place.
      const f = finOrg.get(row[0]);
      if (f && ['fund', 'department', 'division', 'program', 'subprogram'].some((k) => f[k] !== org[k])) { problems.hierarchy += 1; if (hierarchyExamples.length < 3) hierarchyExamples.push(row[0]); }
      if (org.department !== file.department) problems.wrongFile += 1;

      const code = co ? co.characterCode : fo.level2;
      const gKey = `${fo.objectType}|${code}`;
      if (!groups.has(gKey)) groups.set(gKey, { objectType: fo.objectType, code, name: fo.characterCode });
      const cs = row.slice(2).map(cents);
      const area = areaOf.get(org.department) || NONE;
      const d = org.department;
      const dv = `${d}/${org.division}`;
      const dp = `${dv}/${org.program}`;
      const ds = `${dp}/${org.subprogram}`;
      for (const key of [`sa:${area.id}`, d, dv, dp, ds]) tree.add(key, gKey, cs);
      if (NCC_FUNDS.includes(org.fund) && (fo.objectType === 'Expenses' || fo.objectType === 'Revenues')) {
        const signed = cs.map((x) => (x === null ? null : fo.objectType === 'Expenses' ? x : -x));
        for (const key of [`sa:${area.id}`, d, dv, dp, ds]) nccTree.add(key, 'ncc', signed);
        nccTotal.add('all', 'ncc', signed);
      }
      // The department's own detail: each organization and object once, and a row for each account.
      if (!detail.has(d)) detail.set(d, { orgs: new Map(), objs: new Map(), organizations: [], objects: [], rows: [] });
      const dt = detail.get(d);
      if (!dt.orgs.has(org.code)) { dt.orgs.set(org.code, dt.organizations.length); dt.organizations.push({ code: org.code, name: org.name, fund: org.fund, division: org.division, program: org.program, subprogram: org.subprogram, functionalActivity: org.functionalActivity }); }
      if (!dt.objs.has(row[1])) { dt.objs.set(row[1], dt.objects.length); dt.objects.push({ code: row[1], name: co ? co.name : fo.title.trim(), objectType: fo.objectType, characterCode: code, gKey }); }
      dt.rows.push([dt.orgs.get(org.code), dt.objs.get(row[1]), ...row.slice(2)]);
      funds.add(org.fund, gKey, cs);
      funcs.add(org.functionalActivity, gKey, cs);
      deptFunds.add(`${d}|${org.fund}`, gKey, cs);
      total.add('all', gKey, cs);
    }
  }
  const groupList = [...groups.entries()].map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.objectType) - TYPE_ORDER.indexOf(b.objectType) || a.code.localeCompare(b.code));
  const groupIndex = new Map(groupList.map((g, i) => [g.key, i]));

  // ---- the tree, in order: service areas A to Z (no service area last), then their departments, divisions, programs and subprograms A to Z ----
  const nodes = [];
  const pathsByParent = new Map(); // parent path -> child path pieces seen
  for (const key of tree.keys.keys()) {
    if (key.startsWith('sa:')) continue;
    const parts = key.split('/');
    const parent = parts.slice(0, -1).join('/');
    if (!pathsByParent.has(parent)) pathsByParent.set(parent, new Set());
    pathsByParent.get(parent).add(key);
  }
  const nameOf = (level, code) => (level === 'subprogram' ? subName.get(code) : names[level].get(code)) || code;
  const nccOf = (id) => { const s = nccTree.groupsOf(id).get('ncc'); return s && !s.isEmpty() ? { ncc: s.out() } : {}; };
  const addNode = (id, level, code, parent) => {
    const v = tree.listed(id, groupIndex);
    const node = { id, level, code, name: nameOf(level, code), parent, v, ...nccOf(id) };
    if (level === 'department') node.hasBudget = hasBudget(id);
    nodes.push(node);
  };
  const budgetCols = ['fy2026_27.original', 'fy2026_27.revised'].map((c) => columns.indexOf(c));
  // A department has a budget when it has an Original or Revised FY 2026-27 amount in expenses or revenues.
  const hasBudget = (id) => [...tree.groupsOf(id)].some(([g, s]) => g.split('|')[0] !== 'Contingency' && budgetCols.some((c) => s.v[c] !== 0));
  const walk = (parentId, level) => {
    const kids = [...(pathsByParent.get(parentId) || [])].map((id) => ({ id, code: id.split('/').pop() }));
    kids.forEach((k) => { k.name = nameOf(level, k.code); });
    kids.sort(byName);
    for (const k of kids) {
      addNode(k.id, level, k.code, parentId);
      const next = LEVELS[LEVELS.indexOf(level) + 1];
      if (next) walk(k.id, next);
    }
  };
  const areaNodes = [...serviceAreas.serviceAreas.map((a) => ({ ...a, code: a.id })).sort(byName), { ...NONE, code: NONE.id }];
  for (const a of areaNodes) {
    const id = `sa:${a.id}`;
    nodes.push({ id, level: 'serviceArea', code: a.id, name: a.name, parent: null, v: tree.listed(id, groupIndex), ...nccOf(id) });
    const members = [...tree.keys.keys()].filter((k) => !k.includes('/') && !k.startsWith('sa:') && (areaOf.get(k) || NONE).id === a.id).map((code) => ({ code, name: nameOf('department', code) })).sort(byName);
    for (const m of members) {
      addNode(m.code, 'department', m.code, id);
      walk(m.code, 'division');
    }
  }

  const fundsOut = [...funds.keys.keys()].map((code) => ({ code, name: names.fund.get(code) || code })).sort(byName)
    .map((f) => ({ ...f, v: funds.listed(f.code, groupIndex) }));
  const funcsOut = [...funcs.keys.keys()].map((code) => ({ code, name: funcName.get(code) || code })).sort(byName)
    .map((f) => ({ ...f, v: funcs.listed(f.code, groupIndex) }));
  const deptFundsOut = {};
  for (const key of [...deptFunds.keys.keys()].sort()) {
    const [d, f] = key.split('|');
    (deptFundsOut[d] = deptFundsOut[d] || []).push({ fund: f, v: deptFunds.listed(key, groupIndex) });
  }

  // ---- the checks ----
  const totalCents = (rollup, key, g, i) => (rollup.groupsOf(key).get(g) ? rollup.groupsOf(key).get(g).v[i] : 0);
  const typeSum = (rollup, key, type, i) => groupList.filter((g) => g.objectType === type).reduce((n, g) => n + totalCents(rollup, key, g.key, i), 0);
  check('every account row is read', rows === meta.rowsWritten, `${rows} rows read, ${meta.rowsWritten} written by the conversion`);
  check('every organization is in the chart of accounts', problems.missingOrg === 0, `${problems.missingOrg} account rows name an organization that is not`);
  check('every object has a record', problems.missingObject === 0, `${problems.missingObject} account rows name an object with no record`);
  check('the chart of accounts and the financial file agree on each organization\'s place', problems.hierarchy === 0, `${problems.hierarchy} account rows differ${hierarchyExamples.length ? `, for example organization ${hierarchyExamples.join(', ')}` : ''}`);
  check('an organization is in its own department\'s file', problems.wrongFile === 0, `${problems.wrongFile} account rows are in the file of another department`);
  check('the character code of an object is the same in both files', problems.codeDiffers === 0, `${problems.codeDiffers} account rows differ`);
  check('every department in the service area list exists and is listed once', listedTwice.length === 0 && [...areaOf.keys()].every((d) => finOrg && fin.departments.some((x) => x.code === d)),
    `${listedTwice.length} listed twice; ${[...areaOf.keys()].filter((d) => !fin.departments.some((x) => x.code === d)).join(', ') || 'none'} missing`);
  // The overall totals, to the cent, against the conversion's own totals (its "Other" is every object type that is not Expenses or Revenues).
  const overall = [];
  for (const [type, metaType] of [['Expenses', 'Expenses'], ['Revenues', 'Revenues'], ['Contingency', 'Other']]) {
    columns.forEach((col, i) => { if (typeSum(total, 'all', type, i) !== cents(meta.totals[metaType][col])) overall.push(`${type} ${col}`); });
  }
  check('the overall totals match meta.json to the cent', overall.length === 0, overall.length ? `differ: ${overall.slice(0, 4).join('; ')}` : `${3 * N} totals checked`);
  const perDept = [];
  const deptCodes = nodes.filter((n) => n.level === 'department').map((n) => n.code);
  for (const d of Object.keys(meta.totalsByDepartment)) {
    for (const [type, metaType] of [['Expenses', 'Expenses'], ['Revenues', 'Revenues'], ['Contingency', 'Other']]) {
      columns.forEach((col, i) => { if (typeSum(tree, d, type, i) !== cents(meta.totalsByDepartment[d][metaType][col])) perDept.push(`${d} ${type} ${col}`); });
    }
  }
  check('every department total matches meta.json to the cent', perDept.length === 0 && deptCodes.length === Object.keys(meta.totalsByDepartment).length,
    perDept.length ? `differ: ${perDept.slice(0, 4).join('; ')}` : `${deptCodes.length} departments, ${deptCodes.length * 3 * N} totals checked`);
  // Each way of grouping adds back to the whole: the sum of its nodes is the overall total, group by group and column by column.
  const sumLevel = (label, rollup, keys) => {
    const off = [];
    for (const g of groupList) for (let i = 0; i < N; i += 1) {
      const s = keys.reduce((n, k) => n + totalCents(rollup, k, g.key, i), 0);
      if (s !== totalCents(total, 'all', g.key, i)) off.push(`${g.key} ${columns[i]}`);
    }
    check(`the ${label} add up to the overall totals`, off.length === 0, off.length ? `differ: ${off.slice(0, 3).join('; ')}` : `${keys.length} nodes`);
  };
  const keysAt = (depth) => [...tree.keys.keys()].filter((k) => !k.startsWith('sa:') && k.split('/').length === depth);
  sumLevel('service areas', tree, [...tree.keys.keys()].filter((k) => k.startsWith('sa:')));
  sumLevel('departments', tree, keysAt(1));
  sumLevel('divisions', tree, keysAt(2));
  sumLevel('programs', tree, keysAt(3));
  sumLevel('subprograms', tree, keysAt(4));
  sumLevel('funds', funds, [...funds.keys.keys()]);
  sumLevel('functional activities', funcs, [...funcs.keys.keys()]);
  sumLevel('departments by fund', deptFunds, [...deptFunds.keys.keys()]);
  // Net County cost adds up at every level too.
  const sumNcc = (label, keys) => {
    const off = [];
    for (let i = 0; i < N; i += 1) if (keys.reduce((n, k) => n + totalCents(nccTree, k, 'ncc', i), 0) !== totalCents(nccTotal, 'all', 'ncc', i)) off.push(columns[i]);
    check(`the ${label} add up to the Net County cost`, off.length === 0, off.length ? `differ: ${off.slice(0, 3).join('; ')}` : `${keys.length} nodes`);
  };
  sumNcc('service areas', [...tree.keys.keys()].filter((k) => k.startsWith('sa:')));
  for (const [label, depth] of [['departments', 1], ['divisions', 2], ['programs', 3], ['subprograms', 4]]) sumNcc(label, keysAt(depth));
  // A department's detail holds every one of its account rows, and adds up to the department's totals (all object types together).
  const detailRows = [...detail.values()].reduce((n, x) => n + x.rows.length, 0);
  check('the department detail files hold every account row', detailRows === rows, `${detailRows} rows in ${detail.size} departments`);
  const detailOff = [];
  for (const [dept, dt] of detail) {
    const sums = new Array(N).fill(0);
    for (const r of dt.rows) for (let i = 0; i < N; i += 1) sums[i] += cents(r[2 + i]) || 0;
    columns.forEach((c, i) => { if (sums[i] !== ['Expenses', 'Revenues', 'Other'].reduce((n, ty) => n + cents(meta.totalsByDepartment[dept][ty][c]), 0)) detailOff.push(`${dept} ${c}`); });
  }
  check('each department detail adds up to its totals in meta.json', detailOff.length === 0, detailOff.length ? `differ: ${detailOff.slice(0, 3).join('; ')}` : `${detail.size} departments`);

  // ---- what the build found, for the report ----
  const unmapped = nodes.filter((n) => n.level === 'department' && n.parent === 'sa:none');
  const origExp = columns.indexOf('fy2026_27.original');
  const expIdx = (n) => groupList.map((g, i) => (g.objectType === 'Expenses' ? i : -1)).filter((i) => i >= 0).reduce((s, i) => s + ((n.v[i] || [])[origExp] || 0), 0);
  const index = {
    format: 1,
    source: { file: meta.source, exportDate: meta.exportDate, conversion: 'data/accounting/convert_export.py', structure: 'coa-schemagov-json (COA Object List.xlsx, COA Org with Long Account Mapping.xlsx)', serviceAreas: serviceAreas.source },
    columns: columns.map((key) => { const [year, measure] = key.split('.'); return { key, year, measure }; }),
    groups: groupList.map(({ objectType, code, name }) => ({ objectType, code, name })),
    files: { detail: 'detail/{department}.json', tree: 'tree.json', funds: 'funds.json', functionalActivities: 'functional-activities.json', departmentFunds: 'department-funds.json' },
    counts: { accountRows: rows, nodes: nodes.length, departments: deptCodes.length, funds: fundsOut.length, functionalActivities: funcsOut.length },
    nccFunds: NCC_FUNDS,
    notes: [
      'Revenue amounts are positive. Expense amounts are as the export gives them, so a credit can be negative.',
      'A group that is not listed under a node has only zero amounts there.',
      'The names of the character codes are as the export gives them, cut at 20 characters.',
    ],
    checks,
  };
  const detailFiles = {};
  const uniq = (list) => [...new Set(list)].sort();
  for (const [dept, dt] of detail) detailFiles[`detail/${dept}.json`] = { department: dept, columns,
    funds: uniq(dt.organizations.map((o) => o.fund)).map((code) => ({ code, name: names.fund.get(code) || code })),
    functionalActivities: uniq(dt.organizations.map((o) => o.functionalActivity)).map((code) => ({ code, name: funcName.get(code) || code })),
    organizations: dt.organizations, objects: dt.objects.map(({ gKey, ...o }) => ({ ...o, group: groupIndex.get(gKey) })), rows: dt.rows };
  const outputs = {
    ...detailFiles,
    'index.json': index,
    'tree.json': { nodes },
    'funds.json': { funds: fundsOut },
    'functional-activities.json': { functionalActivities: funcsOut },
    'department-funds.json': { departments: deptFundsOut },
  };
  const report = {
    objectsOnlyInFinancial: [...problems.objectOnlyInFinancial].sort(),
    unmapped: unmapped.map((n) => ({ code: n.code, name: n.name, originalExpenses: expIdx(n), hasBudget: n.hasBudget })).sort((a, b) => b.originalExpenses - a.originalExpenses),
    withBudget: nodes.filter((n) => n.level === 'department' && n.hasBudget).length,
    departments: deptCodes.length,
  };
  return { outputs, checks, report, index };
}

function main() {
  const { outputs, checks, report } = build();
  fs.mkdirSync(path.join(OUT, 'detail'), { recursive: true });
  for (const [name, data] of Object.entries(outputs)) fs.writeFileSync(path.join(OUT, name), JSON.stringify(data) + '\n');
  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  const kb = (n) => Math.round(fs.statSync(path.join(OUT, n)).size / 1024);
  const details = Object.keys(outputs).filter((n) => n.startsWith('detail/'));
  console.log(`\nWrote ${Object.keys(outputs).length} files to data/accounting/rollups/: ${Object.keys(outputs).filter((n) => !n.startsWith('detail/')).map((n) => `${n} ${kb(n)} KB`).join(', ')}; ${details.length} detail files, ${Math.round(details.reduce((s, n) => s + kb(n), 0) / 1024 * 10) / 10} MB in all, the largest ${Math.max(...details.map(kb))} KB`);
  console.log(`${report.withBudget} of ${report.departments} departments have an FY 2026-27 Original or Revised budget in expenses or revenues.`);
  console.log(`Objects the chart of accounts does not have (named from the financial file): ${report.objectsOnlyInFinancial.length ? report.objectsOnlyInFinancial.join(', ') : 'none'}.`);
  console.log(`Departments with no service area (${report.unmapped.length}), by FY 2026-27 Original expenses:`);
  for (const u of report.unmapped.slice(0, 12)) console.log(`  ${u.code} ${u.name}: $${(u.originalExpenses / 1e6).toFixed(1)}M${u.hasBudget ? '' : ' (no budget)'}`);
  if (checks.some((c) => !c.ok)) { console.error('\nA check failed. The files were written, but do not use them until the cause is found.'); process.exit(1); }
}

if (require.main === module) main();
module.exports = { build };
