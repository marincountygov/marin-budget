'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Needs the accounting data and marin-data next to this repo; without them there is nothing to map.
const ROOT = path.join(__dirname, '..');
const have = fs.existsSync(path.join(ROOT, 'data/accounting/dimensions.json')) && fs.existsSync(path.join(ROOT, '../marin-data/output/organizations.jsonld'));
const opts = have ? {} : { skip: 'data/accounting or marin-data is not in this checkout' };
const map = () => require('../scripts/map-accounting-organizations').build();

test('every department of the export is mapped once, and no organization is matched to two departments', opts, () => {
  const { rows, counts } = map();
  const dims = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/accounting/dimensions.json'), 'utf8')).departments;
  assert.deepStrictEqual(rows.map((r) => r.code).sort(), dims.map((d) => d.code).sort());
  assert.strictEqual(counts.code + counts.name + counts.candidate + counts.none, dims.length);
  const ids = rows.filter((r) => r.organization).map((r) => r.organization);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('the departments marin-data already gives a code are matched by code, and their names agree with the export', opts, () => {
  const { rows, codeLinksNotInExport } = map();
  assert.deepStrictEqual(codeLinksNotInExport, []);
  const coded = rows.filter((r) => r.match === 'code');
  // 23 departments had a code; Marin Transit (658) and Zero Waste Marin (653) were added to marin-data after, so a checkout of marin-data from before that has 23.
  assert.ok(coded.length === 23 || coded.length === 25, `${coded.length} by code`);
  assert.ok(['658', '653'].every((c) => ['code', 'candidate'].includes(rows.find((r) => r.code === c).match)));
  assert.ok(coded.every((r) => r.namesAgree), coded.filter((r) => !r.namesAgree).map((r) => r.name).join(', '));
  const sheriff = rows.find((r) => r.code === '260');
  assert.strictEqual(sheriff.organizationName, 'Sheriff');
  assert.match(sheriff.organization, /\/id\/organization\/sheriff$/);
});

test('a looser match is only a candidate, and the organizations that have a code are never offered', opts, () => {
  const { rows } = map();
  const candidates = rows.filter((r) => r.match === 'candidate');
  // Only the two that marin-data had not yet given a code can be candidates (none, once it has).
  assert.ok(candidates.every((r) => ['653', '658'].includes(r.code)));
  candidates.forEach((r) => assert.strictEqual(r.organization, undefined));
  const codedIds = new Set(rows.filter((r) => r.match === 'code').map((r) => r.organization));
  candidates.forEach((r) => r.candidates.forEach((c) => assert.ok(!codedIds.has(c.organization))));
  // Not in marin-data: a special district and the County's own items with no organization record.
  ['900', '659', '701', '702', '370', '613'].forEach((code) => assert.strictEqual(rows.find((r) => r.code === code).match, 'none', code));
});
