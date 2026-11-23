#!/usr/bin/env node
// Puts a stamp on every stylesheet one stylesheet imports, so a changed style is read at once.
//
//   node scripts/stamp-css.js
//
// A page links its stylesheet with a stamp (`styles.css?v=...`, scripts/budget-shell.js), but a browser keeps the files that stylesheet imports
// (`@import url("../shared/styles.css")`) by their own address, so an old copy of one stayed after a change. This writes the same stamp on each import:
// `@import url("../shared/styles.css?v=...")`. The stamp is made from the styles with the stamps taken out, so running this again changes nothing.
// Run it last, after every builder (the builders write some of these files).

const fs = require('fs');
const path = require('path');
const { CSS_STAMP } = require('./budget-shell');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'vendor', 'plans', 'coa-schemagov-json']);
const IMPORT = /@import url\("([^"?]+)(?:\?v=[0-9a-f]+)?"\);/g;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.css')) files.push(full);
  }
}(ROOT));

let changed = 0;
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(IMPORT, (m, target) => `@import url("${target}?v=${CSS_STAMP}");`);
  if (after !== before) { fs.writeFileSync(file, after); changed += 1; }
}
console.log(`stamp-css: ${files.length} stylesheets, ${changed} changed (stamp ${CSS_STAMP}).`);
