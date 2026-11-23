// The Data page: where the data of every tab comes from, in one place. Each tool writes its own sources, files and pages
// (see data-sections.js); this page adds the one-line statement of what the data is and when the pages were built.
const fs = require('fs');
const path = require('path');
const { shell, dataStrip, esc } = require('./budget-shell');
const { readSections } = require('./data-sections');

const ROOT = path.join(__dirname, '..');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const s = readJson('budget/data/sources.json');
const c = readJson('capital/data/sources.json');
const strip = dataStrip([{ label: s.budgetBook.title, url: s.budgetBook.url }, { label: c.cipBook.title, url: c.cipBook.url }, { label: 'County of Marin contract records', url: '../contracts/data/contracts-display.json' }], 'the books and an export of the contract records');

// A tool's section sits under its own heading here, so its headings step down one level and its ids are made unique.
const nest = (id, html) => html
  .replace(/<(\/?)h3/g, '<$1h4').replace(/<(\/?)h2/g, '<$1h3')
  .replace(/\b(id|aria-labelledby)="([^"]+)"/g, (_, a, v) => `${a}="${id}-${v}"`);

// The accounting data has a section where its page was built.
const sections = readSections(['budget-2026-28', 'budget-2025-26', 'budget-accounting', 'capital', 'contracts'].filter((id) => id !== 'budget-accounting' || fs.existsSync(path.join(ROOT, 'data', 'sections', 'budget-accounting.json'))));
const body = `<article class="content"><h1 class="doc-title">Data</h1>${strip}` +
  sections.map((x) => `<section class="section" aria-labelledby="data-${x.id}"><h2 id="data-${x.id}">${esc(x.title)}</h2>${nest(x.id, x.html)}</section>`).join('') + `</article>`;
fs.writeFileSync(path.join(ROOT, 'data', 'index.html'), shell('Data', 'Where the County of Marin budget, Capital Improvement Plan and contracts data comes from.', [['Marin Budget', '../index.html'], ['Data', null]], body));
console.log('Wrote data/index.html.');
