#!/usr/bin/env node
// Maps each department of the financial-system export to an organization in marin-data, and writes data/accounting/organization-map.json.
//
//   node scripts/map-accounting-organizations.js
//
// Reads marin-data (next to this repo): output/organizations.jsonld, output/external-organizations.jsonld, organizations/aliases.json.
// It changes nothing in marin-data. For each export department (code and name) it says one of:
//   code        the organization already carries the department's code (local:marin-budget-department-code in organizations.jsonld)
//   name        the export's name, written the same way, is the organization's name, one of its other names, or an alias for it
//   candidate   the names share most of their words; a person confirms it (never used as a match)
//   none        nothing in marin-data is close
// A match by code or name is one organization for one department. An organization that has a code match is not offered as a candidate
// for another department.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, '..', 'marin-data');
const OUT = path.join(ROOT, 'data', 'accounting', 'organization-map.json');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Words the export cuts short, written in full so that names can be compared; the short and the long form count as the same word.
const WORDS = { svc: 'services', auth: 'authority', comm: 'commission', commiss: 'commission', dist: 'district', co: 'county', agcy: 'agency', mngment: 'management', conser: 'conservation', vly: 'valley', ross: 'ross' };
const NOISE = new Set(['of', 'the', 'and', 'marin', 'county', 'department']);
const words = (name) => String(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map((w) => WORDS[w] || w);
const exact = (name) => words(name).join(' ');
const core = (name) => new Set(words(name).filter((w) => !NOISE.has(w)));
const overlap = (a, b) => { const inter = [...a].filter((w) => b.has(w)).length; return a.size && b.size ? inter / Math.max(a.size, b.size) : 0; };

function build() {
  const dims = readJson(path.join(ROOT, 'data', 'accounting', 'dimensions.json'));
  const county = readJson(path.join(DATA, 'output', 'organizations.jsonld'))['@graph'];
  const external = readJson(path.join(DATA, 'output', 'external-organizations.jsonld'))['@graph'];
  const aliases = readJson(path.join(DATA, 'organizations', 'aliases.json')).aliases;
  const pool = [...county.map((o) => ({ o, source: 'organizations.jsonld' })), ...external.map((o) => ({ o, source: 'external-organizations.jsonld' }))];
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const codeOf = (o) => list(o.identifier).filter((i) => i && i.propertyID === 'local:marin-budget-department-code').map((i) => i.value);
  const info = (p) => ({ organization: p.o['@id'], organizationName: p.o.name, organizationType: p.o.organizationClassification || null, source: p.source });

  const byCode = new Map();
  for (const p of pool) for (const c of codeOf(p.o)) { if (byCode.has(c)) throw new Error(`code ${c} is on two organizations`); byCode.set(c, p); }
  // Every name an organization is known by, written the same way, and the aliases that point at it.
  const names = new Map();
  const addName = (n, p) => { const k = exact(n); if (!names.has(k)) names.set(k, new Set()); names.get(k).add(p); };
  for (const p of pool) { addName(p.o.name, p); list(p.o.alternateName).forEach((n) => addName(n, p)); }
  const official = new Map(pool.map((p) => [exact(p.o.name), p]));
  for (const [alias, target] of Object.entries(aliases)) if (official.has(exact(target))) addName(alias, official.get(exact(target)));
  const coded = new Set([...byCode.values()]);

  const rows = dims.departments.map((d) => {
    const name = d.name.trim();
    const row = { code: d.code, name };
    if (byCode.has(d.code)) {
      const p = byCode.get(d.code);
      const agree = overlap(core(name), core(p.o.name)) >= 0.5 || [...list(p.o.alternateName)].some((n) => overlap(core(name), core(n)) >= 0.5);
      return { ...row, match: 'code', ...info(p), namesAgree: agree };
    }
    const hit = [...(names.get(exact(name)) || [])].filter((p) => !coded.has(p));
    if (hit.length === 1) return { ...row, match: 'name', ...info(hit[0]) };
    if (hit.length > 1) return { ...row, match: 'candidate', reason: 'the name fits more than one organization', candidates: hit.map((p) => info(p)) };
    // A looser match is only offered: most of the words are shared, and the organization has no department code of its own.
    let best = null;
    for (const p of pool) {
      if (coded.has(p)) continue;
      const score = Math.max(overlap(core(name), core(p.o.name)), ...list(p.o.alternateName).map((n) => overlap(core(name), core(n))));
      if (score >= 0.6 && (!best || score > best.score)) best = { score: Math.round(score * 100) / 100, ...info(p) };
    }
    return best ? { ...row, match: 'candidate', reason: `the names share ${Math.round(best.score * 100)}% of their words`, candidates: [best] } : { ...row, match: 'none' };
  });
  const used = new Map();
  for (const r of rows) if (r.organization) used.set(r.organization, [...(used.get(r.organization) || []), r.code]);
  const twice = [...used].filter(([, codes]) => codes.length > 1);
  if (twice.length) throw new Error(`an organization is matched to two departments: ${JSON.stringify(twice)}`);
  const countOf = (m) => rows.filter((r) => r.match === m).length;
  return { rows, counts: { departments: rows.length, code: countOf('code'), name: countOf('name'), candidate: countOf('candidate'), none: countOf('none') }, codeLinksNotInExport: [...byCode.keys()].filter((c) => !dims.departments.some((d) => d.code === c)) };
}

function main() {
  const { rows, counts, codeLinksNotInExport } = build();
  const doc = {
    source: 'The departments of data/accounting/dimensions.json against marin-data organizations.jsonld, external-organizations.jsonld and aliases.json',
    note: 'A match by code or name is one organization for one department. A candidate is only offered: the names share most of their words, and a person confirms it. marin-data was not changed.',
    counts,
    departments: rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`Wrote data/accounting/organization-map.json: ${counts.departments} departments: ${counts.code} by code, ${counts.name} by name, ${counts.candidate} candidates, ${counts.none} with none.`);
  const bad = rows.filter((r) => r.match === 'code' && !r.namesAgree);
  if (bad.length) console.log(`Code links whose names do not share half their words (check): ${bad.map((r) => `${r.code} ${r.name} -> ${r.organizationName}`).join('; ')}`);
  if (codeLinksNotInExport.length) console.log(`Codes in marin-data that are not in the export: ${codeLinksNotInExport.join(', ')}`);
  for (const r of rows.filter((x) => x.match === 'name' || x.match === 'candidate')) {
    console.log(`  ${r.match.padEnd(9)} ${r.code} ${r.name} -> ${(r.candidates ? r.candidates.map((c) => c.organizationName) : [r.organizationName]).join(' | ')}${r.reason ? ` (${r.reason})` : ''}`);
  }
}

if (require.main === module) main();
module.exports = { build };
