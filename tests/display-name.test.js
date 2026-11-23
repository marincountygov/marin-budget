'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const display = require('../shared/display-name');
const { approvedNames } = require('../scripts/labels');
// The glossary and the names are the County's financial-system work and are not in every checkout.
const glossaryFile = path.join(__dirname, '../data/accounting/glossary.json');
const noGlossary = fs.existsSync(glossaryFile) ? false : 'data/accounting is not in this checkout';

test('a name gets a capital on each word, the short words stay small and acronyms are kept (nothing approved yet)', () => {
  display.use(null);
  assert.strictEqual(display('HEALTH AND HUMAN SERVICES'), 'Health and Human Services');
  assert.strictEqual(display('CSA 1 LOMA VERDE'), 'CSA 1 Loma Verde');
  assert.strictEqual(display('MARIN COUNTY FREE LIBRARY'), 'Marin County Free Library');
  assert.strictEqual(display('MCERA'), 'MCERA');
  assert.strictEqual(display('OF THE PEOPLE'), 'Of the People'); // the first word keeps its capital
  assert.strictEqual(display('MT VIEW AVE LAGUNITAS PRD'), 'Mt View Ave Lagunitas PRD');
  assert.strictEqual(display('GF HHS GEN ADMINISTRATION     '), 'Gf HHS Gen Administration'); // padding is trimmed; nothing is written out until the County has approved it
  assert.strictEqual(display('1973 PR3 GO BOND'), '1973 PR3 Go Bond'); // letters with numbers are a code
});

test('approved shorthand is written out, an acronym the County has not expanded stays in capitals, and an approved prefix is dropped', { skip: noGlossary }, () => {
  display.use(approvedNames());
  assert.strictEqual(display('CDA EXECUTIVE ADMN'), 'CDA Executive Administration');
  assert.strictEqual(display('MCFL BOLINAS LIBRARY'), 'MCFL Bolinas Library');
  assert.strictEqual(display('ROSS VALLEY SAN DIST 1'), 'Ross Valley Sanitary District 1');
  assert.strictEqual(display('INFORMATION SVC AND TECHNOLOGY'), 'Information Services and Technology');
  assert.strictEqual(display('1973 PR3 GO BOND'), '1973 PR3 GO Bond');
  // GF is dropped on an organization only (the fund says it), not on any other name.
  assert.strictEqual(display('GF PARK FACILITIES', { kind: 'organization', code: '10012701' }), 'Park Facilities');
  assert.strictEqual(display('GF PARK FACILITIES', { kind: 'subprogram', code: '1' }), 'GF Park Facilities');
  // The County's own name for a department wins (marin-data's name where the code is matched; a name written by hand).
  assert.strictEqual(display('SHERIFF CORONERS OFFICE', { kind: 'department', code: '260' }), 'Sheriff');
  assert.strictEqual(display('SERVICES AND SUPPLIE', { kind: 'category', code: '52' }), 'Services and Supplies');
  display.use(null);
});

test('only entries marked certain are applied, and a certain entry is an ordinary word with a real expansion', { skip: noGlossary }, () => {
  const glossary = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/accounting/glossary.json'), 'utf8'));
  const parts = approvedNames();
  Object.entries(glossary.tokens).forEach(([word, e]) => {
    assert.match(word, /^[a-z0-9]+$/, word);
    if (e.status === 'certain') { assert.ok(e.to && e.to.length > word.length, `${word} needs an expansion`); assert.strictEqual(parts.tokens[word], e.to); }
    else { assert.strictEqual(parts.tokens[word], undefined, `${word} is not approved, so it must not be applied`); assert.ok(['confirm'].includes(e.status), word); }
  });
});

const dims = path.join(__dirname, '../data/accounting/dimensions.json');
test('the GF prefix is only dropped because every organization that starts with it is in the General Fund', { skip: fs.existsSync(dims) ? false : 'data/accounting is not in this checkout' }, () => {
  const orgs = JSON.parse(fs.readFileSync(dims, 'utf8')).organizations.filter((o) => /^GF\b/i.test(o.name.trim()));
  assert.ok(orgs.length > 250);
  assert.ok(orgs.every((o) => o.fund === '1000'), orgs.filter((o) => o.fund !== '1000').map((o) => o.name).join('; '));
});
