// Reports: the report model and the tables built from lines (the Budget tool's Reports tab and the Reports page use this one file). No DOM access, so it runs in the
// browser (window.BudgetReports) and in Node tests. A division is part of its department, so it is added into a total
// only when no department-level line is counted with it (the same rule the tool's Stats use).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetReports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SORTS = ['name', 'amount'];
  const LIMITS = [0, 5, 10, 25];

  const sumOf = (lines, k) => {
    const top = lines.some((l) => !l.nested);
    const used = lines.filter((l) => !top || !l.nested);
    const known = used.filter((l) => l.values[k] != null);
    return known.length ? known.reduce((n, l) => n + l.values[k], 0) : null;
  };
  const byName = (a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true });

  // input: { lines: [{ title, nested, facets: {}, values: [n | null] }], years: [column numbers, in order], groupBy: '' or a facet
  //          name, change, percent, total, sort: 'name' | 'amount', limit: 0 for all }
  // Returns { years, rows: [{ label, values, change, percent }], other, total }; change and percent compare the last two years.
  function build(input) {
    const years = (input.years || []).slice().sort((a, b) => a - b);
    const sort = SORTS.includes(input.sort) ? input.sort : 'name';
    const limit = LIMITS.includes(input.limit) ? input.limit : 0;
    const lines = input.lines || [];
    let groups;
    if (input.groupBy) {
      const map = new Map();
      lines.forEach((l) => { const key = l.facets[input.groupBy] || 'Other'; (map.get(key) || map.set(key, []).get(key)).push(l); });
      groups = [...map].map(([label, list]) => ({ label, list }));
    } else groups = lines.map((l) => ({ label: l.title, list: [l] }));
    const measure = (list) => {
      const values = years.map((k) => sumOf(list, k));
      const n = values.length;
      const a = n > 1 ? values[n - 2] : null;
      const b = n > 1 ? values[n - 1] : null;
      return { values, change: a != null && b != null ? b - a : null, percent: a != null && b != null && a !== 0 ? Math.round(((b - a) / a) * 1000) / 10 : null };
    };
    let rows = groups.map((g) => ({ label: g.label, ...measure(g.list) }));
    const last = years.length - 1;
    rows.sort(sort === 'amount' ? (a, b) => (b.values[last] || 0) - (a.values[last] || 0) || byName(a, b) : byName);
    const total = measure(lines);
    let other = null;
    if (limit && rows.length > limit) {
      rows = rows.slice(0, limit);
      const values = years.map((k, i) => (total.values[i] == null ? null : total.values[i] - rows.reduce((n, r) => n + (r.values[i] || 0), 0)));
      const n = values.length;
      other = { label: 'All others', values, change: n > 1 && values[n - 1] != null && values[n - 2] != null ? values[n - 1] - values[n - 2] : null, percent: null };
    }
    return { years, rows, other, total: input.total === false ? null : { label: 'Total', ...total } };
  }


  // ---- The report: plain data, drawn as a document ----------------------------------------------------------------
  // { schema: '1.0', title, prepared: 'YYYY-MM-DD' or '', filters, sections: [{ type: 'table', title, head, rows, values? }],
  //   sources: [{ label, url }] }. Everything shown, copied or saved is made from this one object. The model is written up in
  // marin-app-shell/docs/reports-plan.md so other apps can use the same core.
  const SCHEMA = '1.0';
  const MAX = { title: 200, text: 300, columns: 12, rows: 500, sections: 10, sources: 10, json: 4000000, chartLabels: 30, chartSeries: 4, image: 400000 };
  const IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max || MAX.text);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Only web and email links are kept; anything else (javascript:, data:, file:) becomes empty.
  const safeUrl = (v) => {
    const text = clean(v, 2000);
    if (!text) return '';
    try { return ['http:', 'https:', 'mailto:'].indexOf(new URL(text).protocol) >= 0 ? text : ''; } catch (e) { return ''; }
  };
  const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
  const formatDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : ''; };

  // Today in Pacific time, as YYYY-MM-DD.
  const pacificToday = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date || new Date());

  function normalizeSection(raw, index, errors) {
    if (!raw || typeof raw !== 'object' || raw.type !== 'table') { errors.push('Section ' + (index + 1) + ' is not a table.'); return null; }
    const head = Array.isArray(raw.head) ? raw.head.slice(0, MAX.columns).map((h) => clean(h)) : [];
    if (!head.length) { errors.push('Section ' + (index + 1) + ' has no columns.'); return null; }
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, MAX.rows).map((r) => head.map((_, i) => clean(Array.isArray(r) ? r[i] : '')));
    const section = { type: 'table', title: clean(raw.title, MAX.title), head, rows };
    if (Array.isArray(raw.values)) section.values = raw.values.slice(0, MAX.rows).map((r) => head.map((_, i) => { const v = Array.isArray(r) ? r[i] : ''; return typeof v === 'number' && Number.isFinite(v) ? v : clean(v); }));
    const chart = normalizeChart(raw.chart);
    if (chart) section.chart = chart;
    return section;
  }

  // A chart is part of a table's section: its numbers, a sentence saying what it shows, and the picture the app drew (a PNG).
  // The picture is what the preview, Copy and Download hold; the numbers and the sentence are kept for text and for reading the file.
  function normalizeChart(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, MAX.chartLabels).map((l) => clean(l));
    const series = (Array.isArray(raw.series) ? raw.series : []).slice(0, MAX.chartSeries).map((s) => ({
      name: clean(s && s.name), values: labels.map((_, i) => { const v = s && Array.isArray(s.values) ? s.values[i] : 0; return typeof v === 'number' && Number.isFinite(v) ? v : 0; }),
    }));
    if (!labels.length || !series.length) return null;
    const size = (n) => (Number.isInteger(n) && n > 0 && n <= 2000 ? n : 0);
    const image = typeof raw.image === 'string' && raw.image.length <= MAX.image && IMAGE.test(raw.image) ? raw.image : '';
    return { kind: raw.kind === 'columns' ? 'columns' : 'bars', title: clean(raw.title, MAX.title), summary: clean(raw.summary, MAX.text), labels, series, image, width: size(raw.width), height: size(raw.height) };
  }

  // Makes a clean report from any object, or says why it cannot. { report, errors }.
  function create(input) {
    const errors = [];
    const raw = input && typeof input === 'object' ? input : {};
    const sections = (Array.isArray(raw.sections) ? raw.sections : []).slice(0, MAX.sections).map((s, i) => normalizeSection(s, i, errors)).filter(Boolean);
    if (!sections.length) errors.push('The report has no table.');
    const prepared = isIsoDate(clean(raw.prepared, 10)) ? clean(raw.prepared, 10) : '';
    const sources = (Array.isArray(raw.sources) ? raw.sources : []).slice(0, MAX.sources).map((s) => ({ label: clean(s && s.label, MAX.text), url: safeUrl(s && s.url) })).filter((s) => s.label);
    const report = { schema: SCHEMA, title: clean(raw.title, MAX.title) || 'Report', prepared, filters: clean(raw.filters, MAX.text), sections, sources };
    return { report, errors };
  }

  const tableHtml = (s) => '<table border="1" cellpadding="6" cellspacing="0"' + (s.title ? ' aria-label="' + esc(s.title) + '"' : '') + '><thead><tr>' +
    s.head.map((h, i) => '<th scope="col"' + (i ? ' style="text-align:right"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    s.rows.map((r) => '<tr>' + r.map((c, i) => (i ? '<td style="text-align:right">' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>')).join('') + '</tr>').join('') + '</tbody></table>';
  const chartHtml = (s) => {
    const c = s.chart;
    if (!c) return '';
    if (c.image) return '<figure style="margin:1rem 0"><img src="' + esc(c.image) + '" alt="' + esc(c.title + '. ' + c.summary) + '"' + (c.width ? ' width="' + c.width + '" height="' + c.height + '"' : '') + ' style="max-width:100%;height:auto">' + (c.summary ? '<figcaption>' + esc(c.summary) + '</figcaption>' : '') + '</figure>';
    return c.summary ? '<p>' + esc(c.summary) + '</p>' : '';
  };
  const sourceHtml = (r) => (r.sources.length ? '<p>Source: ' + r.sources.map((s) => (s.url ? '<a href="' + esc(s.url) + '">' + esc(s.label) + '</a>' : esc(s.label))).join('; ') + '</p>' : '');

  // The document. Copy, Download and the preview all read this one string. `titleLevel` is the heading level of the title (2 by default).
  function renderHtml(report, options) {
    const h = 'h' + ((options && options.titleLevel) || 2);
    return '<' + h + '>' + esc(report.title) + '</' + h + '>' +
      (report.prepared ? '<p>Prepared ' + esc(formatDate(report.prepared)) + '</p>' : '') +
      (report.filters ? '<p>' + esc(report.filters) + '</p>' : '') +
      report.sections.map((s) => (s.title ? '<h' + (((options && options.titleLevel) || 2) + 1) + '>' + esc(s.title) + '</h' + (((options && options.titleLevel) || 2) + 1) + '>' : '') + chartHtml(s) + tableHtml(s)).join('') + sourceHtml(report);
  }

  function toText(report) {
    const out = [report.title];
    if (report.prepared) out.push('Prepared ' + formatDate(report.prepared));
    if (report.filters) out.push(report.filters);
    report.sections.forEach((s) => { out.push(''); if (s.title) out.push(s.title); if (s.chart && s.chart.summary) out.push('Chart: ' + s.chart.summary); out.push(s.head.join(' | ')); s.rows.forEach((r) => out.push(r.join(' | '))); });
    if (report.sources.length) out.push('', 'Source: ' + report.sources.map((s) => s.label + (s.url ? ' (' + s.url + ')' : '')).join('; '));
    return out.join('\n');
  }

  function toMarkdown(report) {
    const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const out = ['# ' + report.title];
    if (report.prepared) out.push('', 'Prepared ' + formatDate(report.prepared));
    if (report.filters) out.push('', report.filters);
    report.sections.forEach((s) => {
      out.push('');
      if (s.title) out.push('## ' + s.title, '');
      if (s.chart && s.chart.summary) out.push('Chart: ' + s.chart.summary, '');
      out.push('| ' + s.head.map(cell).join(' | ') + ' |', '| ' + s.head.map((_, i) => (i ? '---:' : '---')).join(' | ') + ' |');
      s.rows.forEach((r) => out.push('| ' + r.map(cell).join(' | ') + ' |'));
    });
    if (report.sources.length) out.push('', 'Source: ' + report.sources.map((s) => (s.url ? '[' + s.label + '](' + s.url + ')' : s.label)).join('; '));
    return out.join('\n') + '\n';
  }

  const STANDALONE_CSS = 'body{font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.5;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1f1f1f}' +
    'table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #767676;padding:.4rem .6rem;vertical-align:top}thead th{background:#f0f0f0;text-align:left}' +
    'a{color:#0b4d8a}h1{font-size:1.6rem}h2{font-size:1.25rem}img{max-width:100%;height:auto}figcaption{font-size:.9rem;color:#555}';
  // A page of its own (no scripts, no outside files), for saving or sending.
  function standaloneHtml(report) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(report.title) + '</title><style>' + STANDALONE_CSS + '</style></head><body>' +
      renderHtml(report, { titleLevel: 1 }) + '</body></html>\n';
  }

  // The tables as rows for a CSV: raw numbers when a table has them, otherwise the text. With more than one table, each
  // starts with its title on a row of its own and a blank row separates them.
  function csvRows(report) {
    const out = [];
    report.sections.forEach((s, i) => {
      if (report.sections.length > 1) { if (i) out.push([]); out.push([s.title || 'Table ' + (i + 1)]); }
      out.push(s.head, ...(s.values || s.rows));
    });
    return out;
  }

  // Keeps the lines whose `facet` is `value` (all of them when either is empty).
  const filterLines = (lines, facet, value) => (facet && value ? lines.filter((l) => l.facets[facet] === value) : lines);

  const toJson = (report) => JSON.stringify(report, null, 2) + '\n';
  function parseJson(text) {
    if (typeof text !== 'string' || !text.trim()) return { report: null, errors: ['The file is empty.'] };
    if (text.length > MAX.json) return { report: null, errors: ['The file is too large.'] };
    let data;
    try { data = JSON.parse(text); } catch (e) { return { report: null, errors: ['The file is not a report file.'] }; }
    if (!data || typeof data !== 'object' || data.schema !== SCHEMA) return { report: null, errors: ['The file is not a report file this version can open.'] };
    const made = create(data);
    return made.errors.length ? { report: null, errors: made.errors } : made;
  }

  return { build, create, renderHtml, toText, toMarkdown, standaloneHtml, csvRows, filterLines, toJson, parseJson, formatDate, pacificToday, SCHEMA, LIMITS, SORTS };
});
