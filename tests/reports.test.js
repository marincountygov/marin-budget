const test = require('node:test');
const assert = require('node:assert');
const { build } = require('../shared/reports.js');

const lines = [
  { title: 'Health', nested: false, facets: { area: 'HHS' }, values: [100, 120] },
  { title: 'Social Services', nested: true, facets: { area: 'HHS' }, values: [60, 70] },
  { title: 'Sheriff', nested: false, facets: { area: 'Safety' }, values: [50, null] },
];

test('one row per line, total skips a division counted with its department', () => {
  const r = build({ lines, years: [0, 1] });
  assert.deepStrictEqual(r.rows.map((x) => x.label), ['Health', 'Sheriff', 'Social Services']);
  assert.deepStrictEqual(r.total.values, [150, 120]);
});

test('grouped by area, change and percent use the last two years', () => {
  const r = build({ lines, years: [0, 1], groupBy: 'area' });
  const hhs = r.rows.find((x) => x.label === 'HHS');
  assert.deepStrictEqual(hhs.values, [100, 120]);
  assert.strictEqual(hhs.change, 20);
  assert.strictEqual(hhs.percent, 20);
  assert.strictEqual(r.rows.find((x) => x.label === 'Safety').change, null);
});

test('a division alone is counted', () => {
  const r = build({ lines: [lines[1]], years: [1] });
  assert.deepStrictEqual(r.total.values, [70]);
});

test('largest first with a limit adds an All others row', () => {
  const r = build({ lines, years: [0], sort: 'amount', limit: 5 });
  assert.strictEqual(r.other, null);
  const many = Array.from({ length: 7 }, (_, i) => ({ title: 'L' + i, nested: false, facets: {}, values: [i + 1] }));
  const s = build({ lines: many, years: [0], sort: 'amount', limit: 5 });
  assert.deepStrictEqual(s.rows.map((x) => x.label), ['L6', 'L5', 'L4', 'L3', 'L2']);
  assert.deepStrictEqual(s.other.values, [3]);
  assert.deepStrictEqual(s.total.values, [28]);
});

const R = require('../shared/reports.js');
const sample = () => R.create({ title: 'Budget <report>', prepared: '2026-11-18', filters: 'Showing: all', sources: [{ label: 'Book', url: 'https://example.org/b.pdf' }, { label: 'Bad', url: 'javascript:alert(1)' }],
  sections: [{ type: 'table', head: ['Area', 'FY 2026-27'], rows: [['Safety', '$1'], ['A|B', '$2']], values: [['Safety', 1], ['A|B', 2]] }] }).report;

test('a report is escaped, dated, and keeps only safe links', () => {
  const r = sample();
  const html = R.renderHtml(r);
  assert.match(html, /<h2>Budget &lt;report&gt;<\/h2><p>Prepared November 18, 2026<\/p>/);
  assert.match(html, /<a href="https:\/\/example.org\/b.pdf">Book<\/a>/);
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<report>'));
});

test('text, markdown, standalone page and csv come from the same report', () => {
  const r = sample();
  assert.match(R.toText(r), /^Budget <report>\nPrepared November 18, 2026\nShowing: all\n\nArea \| FY 2026-27\nSafety \| \$1/);
  assert.match(R.toMarkdown(r), /\| A\\\|B \| \$2 \|/);
  assert.match(R.standaloneHtml(r), /^<!doctype html>.*<h1>Budget &lt;report&gt;<\/h1>/);
  assert.deepStrictEqual(R.csvRows(r)[1], ['Safety', 1]);
});

test('a report file reads back the same, and a wrong file is refused', () => {
  const r = sample();
  const back = R.parseJson(R.toJson(r));
  assert.deepStrictEqual(back.report, r);
  assert.ok(R.parseJson('{"schema":"9"}').errors.length);
  assert.ok(R.parseJson('not json').errors.length);
  assert.ok(R.parseJson('{"schema":"1.0","sections":[]}').errors.length);
});

test('fields left empty are not drawn', () => {
  const r = R.create({ title: 'T', sections: [{ type: 'table', head: ['A'], rows: [['x']] }] }).report;
  assert.doesNotMatch(R.renderHtml(r), /Prepared|Source/);
});

test('several tables make one csv, each under its title', () => {
  const r = R.create({ title: 'T', sections: [{ type: 'table', title: 'A', head: ['x'], rows: [['1']] }, { type: 'table', title: 'B', head: ['y'], rows: [['2']] }] }).report;
  assert.deepStrictEqual(R.csvRows(r), [['A'], ['x'], ['1'], [], ['B'], ['y'], ['2']]);
});

test('a filter keeps the lines with that value', () => {
  const ls = [{ facets: { d: 'Sheriff' } }, { facets: { d: 'Fire' } }];
  assert.strictEqual(R.filterLines(ls, 'd', 'Fire').length, 1);
  assert.strictEqual(R.filterLines(ls, '', '').length, 2);
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const withChart = (image) => R.create({ title: 'T', sections: [{ type: 'table', title: 'S', head: ['A', 'B'], rows: [['x', '1']],
  chart: { kind: 'columns', title: 'S chart', summary: 'x is the largest.', labels: ['x'], series: [{ name: 'B', values: [1] }], image, width: 900, height: 400 } }] }).report;

test('a chart is drawn from its picture and said in words for text', () => {
  const r = withChart(PNG);
  assert.match(R.renderHtml(r), /<figure[^>]*><img src="data:image\/png;base64,iVBORw0KGgo=" alt="S chart. x is the largest." width="900" height="400"/);
  assert.match(R.toText(r), /Chart: x is the largest\./);
  assert.match(R.toMarkdown(r), /Chart: x is the largest\./);
  assert.strictEqual(R.parseJson(R.toJson(r)).report.sections[0].chart.image, PNG);
});

test('a chart picture that is not a PNG data address is dropped, and the sentence stays', () => {
  const r = withChart('javascript:alert(1)');
  assert.strictEqual(r.sections[0].chart.image, '');
  assert.ok(!R.renderHtml(r).includes('<img'));
  assert.match(R.renderHtml(r), /<p>x is the largest\.<\/p>/);
});
