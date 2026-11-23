// How a name from the accounting export is shown. The export writes names in capitals and in shorthand, so a name is made readable in this order:
//   1. a name the County has given for that code (names), if there is one;
//   2. the shorthand the County has approved written out (the glossary's "certain" entries: whole words and phrases, and a prefix that is dropped);
//   3. a capital on each word, the short words in lower case, and a few acronyms kept.
// Shorthand that is not approved is left as the export has it. `use()` is given the approved parts (the page builder and the page both call it),
// so a name reads the same everywhere. Without it, only step 3 applies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.marinDisplayName = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var KEEP = { HHS: 1, IHSS: 1, CSA: 1, FCZ: 1, PRD: 1, CSD: 1, FPD: 1, JPA: 1, SMD: 1, PUD: 1, DPW: 1, MCERA: 1, MCOE: 1, UC: 1, II: 1, COP: 1, HVAC: 1, MCAL: 1, LLC: 1, LLP: 1, LP: 1, PLLC: 1, PC: 1, USA: 1, US: 1, IT: 1, ADA: 1, CDA: 1, EMS: 1, MCFD: 1, VMA: 1, GIS: 1 };
  var SMALL = { and: 1, of: 1, the: 1, for: 1, in: 1, to: 1, on: 1, at: 1, by: 1, a: 1, an: 1 };
  var approved = { tokens: {}, phrases: {}, prefixes: {}, names: {}, acronyms: {} };
  var MARK = '\u0001';

  function display(name, key) {
    if (key && approved.names[key.kind + ':' + key.code]) return approved.names[key.kind + ':' + key.code];
    var s = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    // A prefix the data shows to repeat what the row already says (GF on an organization in the General Fund).
    var first = s.split(/[\s-]/)[0];
    if (key && approved.prefixes[first] && approved.prefixes[first].kind === key.kind && s.length > first.length) s = s.slice(first.length).replace(/^[\s-]+/, '');
    Object.keys(approved.phrases).forEach(function (phrase) {
      s = s.replace(new RegExp('(^|[^a-z0-9])' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'g'), function (m, lead) { return lead + MARK + approved.phrases[phrase] + MARK; });
    });
    return s.split(/(\s+|-)/).map(function (w, i) {
      if (w.charAt(0) === MARK) return w.replace(/\u0001/g, '');
      if (!/[a-z]/.test(w)) return w;
      if (approved.tokens[w]) return approved.tokens[w];
      if (approved.acronyms[w]) return w.toUpperCase();
      if (/[0-9]/.test(w)) return w.toUpperCase(); // PR3, SB1020, 2A: letters with numbers are a code
      if (KEEP[w.toUpperCase()]) return w.toUpperCase();
      if (SMALL[w] && i > 0) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('').replace(/\u0001/g, '').replace(/\s+/g, ' ').trim();
  }

  // The approved parts: { tokens: { admn: 'Administration' }, phrases: { 'san dist': 'Sanitary District' }, prefixes: { gf: { kind: 'organization' } }, names: { 'department:260': 'Sheriff' }, acronyms: { cda: 1 } } (acronyms the County has not yet expanded: shown in capitals as they are).
  display.use = function (parts) {
    approved = { tokens: {}, phrases: {}, prefixes: {}, names: {}, acronyms: {} };
    if (parts) Object.keys(approved).forEach(function (k) { approved[k] = parts[k] || {}; });
  };
  return display;
}));
