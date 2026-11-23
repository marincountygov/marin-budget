'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../scripts/labels');

test('a column is named for what it is, and says "spent" or "received" for the actual amount instead of "actuals"', () => {
  const y = 'FY 2026-27';
  const full = (m, b, yr, now) => L.columnName(m, b, yr, now);
  const short = (m, b, yr, now) => L.shortName(m, b, yr, now);
  assert.strictEqual(full('exp', 'original', y, true), 'Spending, adopted budget, FY 2026-27');
  assert.strictEqual(full('exp', 'revised', y, true), 'Spending, current budget, FY 2026-27');
  assert.strictEqual(short('exp', 'original', y, true), 'Adopted budget, FY 2026-27');
  assert.strictEqual(short('exp', 'actuals', y, true), 'Spent so far, FY 2026-27');
  assert.strictEqual(short('exp', 'actuals', 'FY 2025-26', false), 'Actual spending, FY 2025-26');
  assert.strictEqual(short('rev', 'actuals', y, true), 'Received so far, FY 2026-27');
  assert.strictEqual(short('rev', 'actuals', 'FY 2025-26', false), 'Actual revenue, FY 2025-26');
  assert.strictEqual(short('exp', 'available', y, true), 'Left to spend, FY 2026-27');
  assert.strictEqual(short('rev', 'available', y, true), 'Left to receive, FY 2026-27');
  assert.match(full('exp', 'actuals', y, true), /^Spending, spent so far, FY 2026-27$/);
  assert.match(full('ncc', 'actuals', y, true), /^Net County cost, /);
});

test('no word of the accounting system shows in a label', () => {
  const words = [...Object.values(L.MEASURES), ...Object.values(L.AMOUNTS), ...Object.values(L.LEVELS), ...Object.values(L.NEXT), ...L.SECTIONS.map((s) => s.label), ...Object.values(L.STATUS)].join(' | ');
  assert.doesNotMatch(words, /encumbr|actuals|munis|character code|object|functional activity|agency disbursements/i);
  // Every measure the page builds has a label.
  ['exp', 'rev', 'ncc', 'cont', 'xout', 'xin', 'pout', 'pin'].forEach((m) => assert.ok(L.MEASURES[m], m));
});
