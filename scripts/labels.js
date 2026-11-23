// The words the accounting page uses, and the approved parts of the names (shared/display-name.js). Everything a person reads on the page that is
// not a name comes from here, so the wording is in one place and a test can check it.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// ---- the measures and the kinds of amount ----
const MEASURES = {
  exp: 'Spending', rev: 'Revenue', ncc: 'Net County cost', cont: 'Set-asides',
  xout: 'Transfers to other funds', xin: 'Transfers from other funds', pout: 'Pass-through payments', pin: 'Pass-through receipts',
};
// What a column of the Amounts group is called where it covers both sides (spending and revenue).
const AMOUNTS = { original: 'Adopted budget', revised: 'Current budget', actuals: 'Spent or received so far', encumbrance: 'Committed', available: 'Left to spend or receive' };
const SIDE = { exp: 'exp', cont: 'exp', xout: 'exp', pout: 'exp', rev: 'rev', xin: 'rev', pin: 'rev', ncc: 'ncc' };
// The amount in words, for the side it is on: "Adopted budget", "Spent so far", "Received so far", "Left to spend".
function amount(measure, basis, inProgress) {
  const side = SIDE[measure];
  if (basis === 'original' || basis === 'revised' || basis === 'encumbrance') return AMOUNTS[basis];
  if (basis === 'actuals') return side === 'exp' ? (inProgress ? 'Spent so far' : 'Actual spending') : side === 'rev' ? (inProgress ? 'Received so far' : 'Actual revenue') : (inProgress ? 'Actual so far' : 'Actual');
  if (basis === 'available') return side === 'exp' ? 'Left to spend' : side === 'rev' ? 'Left to receive' : 'Left';
  throw new Error(`no label for ${measure} ${basis}`);
}
const lower = (text) => text.charAt(0).toLowerCase() + text.slice(1);
// A column has two names. Where one measure is shown, the amount says it all ("Adopted budget, FY 2026-27", "Spent so far, FY 2026-27");
// where several are shown, or in a table or a file, the measure comes first ("Spending, adopted budget, FY 2026-27").
const shortStem = amount;
const stem = (measure, basis, inProgress) => `${MEASURES[measure]}, ${lower(amount(measure, basis, inProgress))}`;
const columnName = (measure, basis, year, inProgress) => `${stem(measure, basis, inProgress)}, ${year}`;
const shortName = (measure, basis, year, inProgress) => `${amount(measure, basis, inProgress)}, ${year}`;

// ---- the levels of a department, and the sections that open ----
const LEVELS = { division: 'Division', program: 'Program', subprogram: 'Subprogram', organization: 'Budget unit', account: 'Account', fund: 'Fund', category: 'Category', function: 'Function' };
const NEXT = { division: 'Programs', program: 'Subprograms', subprogram: 'Budget units and accounts' };
const SECTIONS = [
  { view: 'structure', label: 'Divisions, programs and accounts' }, { view: 'funds', label: 'Funds' },
  { view: 'objects', label: 'Categories' }, { view: 'functions', label: 'Functions' },
];
const STATUS = { has: 'FY 2026-27 budget', none: 'No FY 2026-27 budget' };

// ---- the names: what the County has approved ----
function approvedNames() {
  const glossary = readJson('data/accounting/glossary.json');
  const parts = { tokens: {}, phrases: {}, prefixes: {}, names: {}, acronyms: {} };
  for (const [word, e] of Object.entries(glossary.tokens)) {
    if (e.status === 'certain') parts.tokens[word] = e.to;
    else if (e.as !== 'word') parts.acronyms[word] = 1;
  }
  for (const [phrase, e] of Object.entries(glossary.phrases)) if (e.status === 'certain') parts.phrases[phrase] = e.to;
  for (const [prefix, e] of Object.entries(glossary.prefixes)) if (e.status === 'certain' && e.strip) parts.prefixes[prefix] = { kind: e.kind };
  // The name marin-data gives a department it has matched by code is the County's own, so it is the plain name.
  const mapFile = path.join(ROOT, 'data', 'accounting', 'organization-map.json');
  if (fs.existsSync(mapFile)) for (const d of readJson('data/accounting/organization-map.json').departments) if (d.match === 'code') parts.names[`department:${d.code}`] = d.organizationName;
  // Names the County has written by hand win over all of it.
  const namesFile = path.join(ROOT, 'data', 'accounting', 'names.json');
  if (fs.existsSync(namesFile)) Object.assign(parts.names, readJson('data/accounting/names.json').names || {});
  return parts;
}

module.exports = { MEASURES, AMOUNTS, SIDE, amount, stem, shortStem, columnName, shortName, LEVELS, NEXT, SECTIONS, STATUS, approvedNames };
