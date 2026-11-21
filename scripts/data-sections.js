// Each tool writes what it says about its data (sources, files, pages) here, and the Data page (build-data.js) puts them together.
// `base` is the folder the tool's links are relative to, seen from the Data page.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'data', 'sections');

function writeSection(id, title, html, base) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, id + '.json'), JSON.stringify({ id, title, html: html.replace(/href="\.\//g, `href="${base}`) }));
}
function readSections(order) {
  return order.map((id) => JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')));
}
module.exports = { writeSection, readSections };
