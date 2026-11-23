// Checks the budget lines in budget/data against themselves, the way the budget book adds up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'budget', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))['@graph'];
const lines = read('budget-lines.jsonld');
const budgets = new Map(read('budgets.jsonld').map((b) => [b['@id'], b]));
const orgs = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'organizations.jsonld'), 'utf8'))['@graph'].map((o) => o['@id']));
const byId = new Map(lines.map((l) => [l['@id'], l]));
const programs = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'programs.jsonld'), 'utf8'))['@graph'].map((x) => x['@id']));
const funds = new Set(JSON.parse(fs.readFileSync(path.join(DIR, 'funds.jsonld'), 'utf8'))['@graph'].map((x) => x['@id']));

test('every line has a budget, an amount in dollars and a direction', () => {
  assert.ok(lines.length > 0);
  for (const l of lines) {
    assert.ok(budgets.has(l.budget['@id']), `${l['@id']}: budget`);
    assert.strictEqual(l.amount.currency, 'USD');
    assert.ok(['revenue', 'expenditure', 'financing'].includes(l.direction), l['@id']);
  }
});

test('every organization a line names exists', () => {
  for (const l of lines) if (l.administrativeClassification) assert.ok(orgs.has(l.administrativeClassification['@id']), l['@id']);
});

test('a parent line equals the sum of its parts, to the dollar the book rounds by', () => {
  for (const p of lines.filter((l) => l.hasPart)) {
    const sum = p.hasPart.reduce((n, c) => n + byId.get(c['@id']).amount.value, 0);
    assert.ok(Math.abs(sum - p.amount.value) <= 1, `${p['@id']}: ${p.amount.value} against ${sum}`);
    for (const c of p.hasPart) assert.strictEqual(byId.get(c['@id']).isPartOf['@id'], p['@id']);
  }
});

test('revenues are positive and no fiscal state is mixed into another budget', () => {
  for (const l of lines) {
    if (l.direction === 'revenue') assert.ok(l.amount.value > 0, l['@id']);
    assert.ok(l['@id'].includes(`/${l.budget['@id'].split('/').pop()}/`), `${l['@id']} is in another budget's id space`);
  }
  assert.ok(![...budgets.keys()].some((k) => /2027-28/.test(k)), 'planned year added');
});

test('a program or fund a line names exists, and a program line names its fund group', () => {
  const programLines = lines.filter((l) => l.program);
  assert.ok(programLines.length > 0);
  for (const l of lines) {
    if (l.program) assert.ok(programs.has(l.program['@id']), `${l['@id']}: program`);
    if (l.fund) assert.ok(funds.has(l.fund['@id']), `${l['@id']}: fund`);
    if (l.programClassification) assert.ok(l.fundSource, `${l['@id']}: a program row is in a fund group`);
  }
});

test('a choice of one is radio buttons for a few options and a dropdown for a longer list', () => {
  const { choiceGroup } = require('../scripts/filter-column');
  const options = (n) => Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
  const few = choiceGroup('book', 'Budget books', options(2), '1', 'book');
  assert.strictEqual(few.type, 'radio');
  assert.strictEqual(few.default, '1');
  assert.strictEqual(few.param, 'book');
  const many = choiceGroup('year', 'Years', options(5), '1', 'show');
  assert.strictEqual(many.type, 'select');
  assert.strictEqual(many.default, '1');
});

test('the filter column element is only the element; the shell draws it from filters.json', () => {
  const { filterColumn } = require('../scripts/filter-column');
  assert.strictEqual(filterColumn('budget'), '<div class="search-side" data-filter-column="filters.json" data-filter-name="budget"></div>');
});

test('the Budget filters list the book, then what to show, then the facets', () => {
  const { filtersFor } = require('../scripts/budget-tool');
  const columns = [{ label: 'FY 2025-26 Approved', measure: 'exp' }, { label: 'FY 2026-27 Proposed', measure: 'exp' }, { label: 'FY 2025-26 Approved', measure: 'rev' }, { label: 'FY 2026-27 Proposed', measure: 'rev' }];
  const lines = [{ slug: 'a', title: 'Zoo', facets: { area: 'Services', department: 'Zoo' } }, { slug: 'b', title: 'Assessor', facets: { area: 'Finance', department: 'Assessor' } }];
  const cfg = { up: '../', columns, measures: [{ id: 'exp', label: 'Total expenditures' }, { id: 'rev', label: 'Revenues' }], defaultColumn: 1, lines,
    facets: [{ name: 'area', label: 'Service areas', all: 'All service areas' }, { name: 'department', label: 'Departments', all: 'All departments' }],
    books: [{ label: 'FY 2026-27 Proposed', href: './index.html' }, { label: 'FY 2025-26 Final', href: './fy2025-26/index.html' }], currentBook: './index.html' };
  const f = filtersFor(cfg);
  assert.strictEqual(f.schemaVersion, '1.0.0');
  assert.deepStrictEqual(f.groups.map((g) => g.id), ['book', 'measure', 'year', 'change', 'area', 'department']);
  const [book, measure, year, change, area, department] = f.groups;
  assert.strictEqual(book.type, 'radio');
  assert.strictEqual(book.default, './index.html');
  // What to show: open checkbox lists with defaults, read and written as one parameter like the links before the column was drawn from a file.
  [measure, year, change].forEach((g) => { assert.strictEqual(g.type, 'checkbox'); assert.strictEqual(g.collapsed, false); assert.strictEqual(g.separator, ','); });
  assert.deepStrictEqual(measure.default, ['exp']);
  assert.deepStrictEqual(year.default, ['1']);
  assert.deepStrictEqual(year.options.values.map((o) => o.label), ['FY 2025-26 Approved', 'FY 2026-27 Proposed']);
  // The facets are plural names with "All ..." words, matched on a field of the same name; departments run A to Z.
  assert.strictEqual(area.allLabel, 'All service areas');
  assert.strictEqual(area.field, 'area');
  assert.deepStrictEqual(department.options.values.map((o) => o.value), ['Assessor', 'Zoo']);
  assert.deepStrictEqual(f.search.fields, ['title', 'area', 'department']);
  assert.ok(f.groups.every((g) => g.label.startsWith(g.label[0].toUpperCase()) && !g.label.includes(':')));
});

test('a book with one measure chooses its year from a list, the latest first shown', () => {
  const { filtersFor } = require('../scripts/budget-tool');
  const columns = ['2023-24 Actual', '2024-25 Estimated', '2025-26 Adopted'].map((label) => ({ label }));
  const cfg = { up: '../../', columns, defaultColumn: 2, lines: [], facets: [], books: [{ label: 'A', href: '../index.html' }, { label: 'B', href: './index.html' }], currentBook: './index.html' };
  const year = filtersFor(cfg).groups.find((g) => g.id === 'year');
  assert.strictEqual(year.type, 'radio');
  assert.strictEqual(year.default, '2');
  assert.strictEqual(year.param, 'show');
});
