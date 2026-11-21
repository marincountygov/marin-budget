// The Budget tool shared by every budget book's home page: a filter column drawn by the shell from filters.json (filtersFor), and the tabs
// Budget | Stats | Data | Notes. The page's script is budget/tool.js; what differs between books (columns, filters,
// lines, the overview under Stats, the Data and Notes tabs) is given to toolHtml() and to the script as JSON.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bd = require('./budget-data');
const ALPHABETICAL = ['area', 'department', 'unit'];
// A budget unit's title starts with its three-digit code; A to Z goes by the name.
const byTitle = (a, b) => bd.byName(String(a).replace(/^\d{3}\s+/, ''), String(b).replace(/^\d{3}\s+/, ''));
const { actions, chartActions } = require('./page-actions');
const { filterColumn, choiceGroup } = require('./filter-column');
const { money, num, kpi, millions, esc } = bd;

const ROOT = path.join(__dirname, '..');
const stampOf = (file) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
const ico = (d) => `<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  book: ico('<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>'),
  amount: ico('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>'),
  name: ico('<path d="m3 16 4 4 4-4"/><path d="M7 4v16"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 18h-5"/>'),
  table: ico('<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'),
  cards: ico('<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>'),
};
const tbtn = (attr, value, label, icon, pressed) => `<button type="button" class="action-button" ${attr}="${value}" aria-pressed="${pressed}" aria-label="${label}" title="${label}">${icon}</button>`;
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The filter column, as the shell draws it from filters.json (vendor/marinos/filter-panel.schema.json): the page holds only the element
// (filterColumn), and the choices are listed here from the same config the page is built from.
function filtersFor(cfg) {
  const { columns, facets } = cfg;
  const multi = Boolean(cfg.measures);
  const years = multi ? [...new Set(columns.map((c) => c.label))] : columns.map((c) => c.label);
  const defMeasure = multi ? columns[cfg.defaultColumn].measure : '';
  const defYear = years.indexOf(columns[cfg.defaultColumn].label);
  // Service areas, departments and budget units run A to Z everywhere; other facets keep the book's order.
  const valuesOf = (f) => { const list = [...new Set(cfg.lines.map((l) => l.facets[f.name]).filter(Boolean))]; return ALPHABETICAL.includes(f.name) ? list.sort(byTitle) : list; };
  const groups = [choiceGroup('book', 'Budget books', cfg.books.map((o) => ({ value: o.href, label: o.label })), cfg.currentBook, 'book')];
  // What to show: open checkbox lists for the measures and the years, and a switch for comparing years. Old links wrote each list as one parameter (measure=exp,rev).
  if (multi) {
    groups.push(
      { type: 'checkbox', id: 'measure', label: 'Show', collapsed: false, default: [defMeasure], options: { values: cfg.measures.map((m) => ({ value: m.id, label: m.label })) }, param: 'measure', separator: ',' },
      { type: 'checkbox', id: 'year', label: 'Years', collapsed: false, default: [String(defYear)], options: { values: years.map((label, y) => ({ value: String(y), label })) }, param: 'year', separator: ',' },
      { type: 'checkbox', id: 'change', label: 'Compare', collapsed: false, default: [], options: { values: [{ value: '1', label: 'Show the change between years' }] }, param: 'change', separator: ',' });
  } else groups.push(choiceGroup('year', 'Years', columns.map((c, k) => ({ value: String(k), label: c.label })), String(cfg.defaultColumn), 'show'));
  facets.forEach((f) => groups.push({ type: 'checkbox', id: f.name, label: f.label, allLabel: f.all, options: { values: valuesOf(f).map((v) => ({ value: v, label: v })) }, param: f.name, field: f.name }));
  return { $schema: `${cfg.up}vendor/marinos/filter-panel.schema.json`, schemaVersion: '1.0.0', search: { id: 'line-search', fields: ['title', ...facets.map((f) => f.name)], match: 'phrase' }, groups };
}

// cfg: { title, titleLabel, columns: [{label}], defaultColumn, facets: [{name, label, all}], chartFacets: [name],
//        countFacet: name, countLabel, lines: [{slug, ref, title, href, values, facets, badges, page, order?}],
//        statsExtra, dataHtml, notesHtml, id, exportCaption, noun }
function toolHtml(cfg) {
  const { columns, facets } = cfg;
  // With measures, a column is one measure in one year, and is named for both ("Total expenditures, FY 2026-27 Proposed").
  // What is shown is chosen with checkboxes (the measures, the years, and whether to compare years); without measures, a column is a year, chosen from a list.
  const multi = Boolean(cfg.measures);
  const measureName = Object.fromEntries((cfg.measures || []).map((m) => [m.id, m.label]));
  const colName = (c) => (multi ? `${measureName[c.measure]}, ${c.label}` : c.label);
  const years = multi ? [...new Set(columns.map((c) => c.label))] : columns.map((c) => c.label);
  const colFor = (m, y) => columns.findIndex((c) => (multi ? c.measure === m : true) && c.label === years[y]);
  const defMeasure = multi ? columns[cfg.defaultColumn].measure : '';
  const defYear = years.indexOf(columns[cfg.defaultColumn].label);
  // The lines run A to Z; `order` keeps the book's own order for the Book order sort (the line's place in cfg.lines unless given).
  const lines = cfg.lines.map((l, i) => ({ order: i, ...l })).sort((a, b) => byTitle(a.title, b.title));
  const attrs = (l, i) => `data-line="${l.slug}" data-ref="${esc(l.ref || '')}" data-order="${l.order}" data-title="${esc(l.title)}" data-name="${esc(l.title.replace(/^\d{3}\s+/, '').toLowerCase())}" ` +
    `data-search-text="${esc((l.title + ' ' + facets.map((f) => l.facets[f.name]).join(' ')).toLowerCase())}" ` +
    facets.map((f) => `data-facet-${f.name}="${esc(l.facets[f.name] || '')}"`).join(' ') + ` data-page="${l.page || ''}"${l.nested ? ' data-nested="1"' : ''} ` + l.values.map((v, k) => `data-v${k}="${v == null ? '' : v}"`).join(' ');
  const shown = (l) => l.values[cfg.defaultColumn];
  // A line's title applies that line as a filter and opens Stats, so it stays in the tool.
  const toolHref = (l) => `?${cfg.countFacet}=${encodeURIComponent(l.title)}&tab=stats`;
  const pick = (l) => `<span class="mm-card__select"><label class="visually-hidden" for="pick-${l.slug}">Select: ${esc(l.title)}</label><input type="checkbox" id="pick-${l.slug}" data-select="${l.slug}"></span>`;
  const badge = (value) => `<span class="mm-term">${esc(value)}</span>`;
  // Each level is opened from the one above: a department lists its divisions and programs, a division lists its programs.
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const figure = (values) => `<dl class="capital-figures"><div><dt data-column-label>${esc(colName(columns[cfg.defaultColumn]))}</dt><dd data-column-value>${values[cfg.defaultColumn] == null ? '–' : money(values[cfg.defaultColumn])}</dd></div></dl>`;
  const drillBlock = (kids, title) => {
    const d = kids.filter((c) => c.kind === 'Division').length;
    const p = kids.filter((c) => c.kind === 'Program').length;
    return `<details class="drill"><summary>${title || [d ? plural(d, 'division') : '', p ? plural(p, 'program') : ''].filter(Boolean).join(', ')}</summary><ul class="drill-list">${kids.map(drillItem).join('')}</ul></details>`;
  };
  const drillItem = (c) => `<li class="drill-row"${c.values ? ' ' + c.values.map((v, k) => `data-v${k}="${v == null ? '' : v}"`).join(' ') : ' data-none="1"'}><span class="drill-name">${c.href ? `<a href="${esc(c.href)}">${esc(c.title)}</a>` : esc(c.title)}</span> ${badge(c.kind)}` +
    `${c.values ? figure(c.values) : '<p class="app-help-text">No amounts in the budget book</p>'}${c.children && c.children.length ? drillBlock(c.children) : ''}</li>`;
  // The book's own words about a reorganization, with its pages.
  const reorgBlock = (r) => `<details class="drill"><summary>Reorganization</summary>${r.paragraphs.map((p) => `<blockquote class="reorg-quote">${esc(p)}</blockquote>`).join('')}<p class="app-help-text">Budget book, ${r.pages}</p></details>`;
  const card = (l, i) => `<li class="app-card mm-card" ${attrs(l, i)}>${pick(l)}<div class="mm-card__body">` +
    `<h3 class="mm-card__title">${`<a href="${esc(toolHref(l))}">${esc(l.title)}</a>`}</h3>` +
    `<dl class="capital-figures"><div><dt data-column-label>${esc(colName(columns[cfg.defaultColumn]))}</dt><dd data-column-value>${shown(l) == null ? '–' : money(shown(l))}</dd></div></dl>` +
    `<div class="mm-terms">${(l.badges || []).map((n) => (l.facets[n] ? badge(l.facets[n]) : '')).join('')}</div>${l.children ? drillBlock(l.children) : ''}${l.funds ? drillBlock(l.funds, 'By fund group') : ''}${l.reorg ? reorgBlock(l.reorg) : ''}</div></li>`;
  const row = (l, i) => `<tr ${attrs(l, i)}><td class="mm-card__select"><label class="visually-hidden" for="pick-row-${l.slug}">Select: ${esc(l.title)}</label><input type="checkbox" id="pick-row-${l.slug}" data-select="${l.slug}"></td>` +
    `<th scope="row">${`<a href="${esc(toolHref(l))}">${esc(l.title)}</a>`}</th>${facets.map((f) => `<td>${esc(l.facets[f.name] || '')}</td>`).join('')}${l.values.map((v) => num(v, money(v))).join('')}</tr>`;
  const count = (f, v) => lines.filter((l) => l.facets[f.name] === v).length;
  // Service areas, departments and budget units run A to Z everywhere; other facets keep the book's order.
  const values = (f) => { const list = [...new Set(lines.map((l) => l.facets[f.name]).filter(Boolean))]; return ALPHABETICAL.includes(f.name) ? list.sort(byTitle) : list; };
  const sumK = (k, list = lines) => list.reduce((n, l) => n + (l.values[k] || 0), 0);
  const chartCard = (id, title) => `<div class="chart-block">${chartActions('budget-' + cfg.id + '-' + id)}<section class="app-card" data-chart-card="${id}"><h3>${esc(title)}</h3><div class="capital-chart"><canvas role="img" aria-label="${esc(title)}" hidden></canvas></div></section></div>`;
  const first = facets.find((f) => f.name === cfg.chartFacets[0]);
  const withStat = (html, name) => html.replace('class="mm-stats-kpi__value"', `class="mm-stats-kpi__value" data-stat="${name}"`);
  const stats = `<div id="line-stats" aria-label="Stats" hidden><div class="mm-stats-kpis" id="selection-kpis">` +
    `${withStat(kpi(colName(columns[cfg.defaultColumn]), millions(sumK(cfg.defaultColumn))), 'total').replace('<p class="app-help-text">', '<p class="app-help-text" data-column-label>')}${withStat(kpi(cfg.noun.Many, String(lines.length)), 'n')}` +
    `${withStat(kpi(cfg.countLabel, String(values(facets.find((f) => f.name === cfg.countFacet)).length)), 'count')}</div>` +
    `<div class="mm-stats-grid" id="selection-charts" data-chart-lib="${cfg.lib}">${chartCard('years', 'Expenditures by year')}${cfg.chartFacets.map((n) => chartCard(n, `${facets.find((f) => f.name === n).label}`)).join('')}</div>` +
    `<div class="capital-stats__tables"><div class="table-scroll" role="region" tabindex="0" aria-label="Expenditures by year for the selection"><table class="budget-table"><caption>Expenditures by year, for the selection</caption><thead><tr><th scope="col">Year</th><th scope="col" class="budget-table__num">Expenditures</th></tr></thead><tbody id="selection-years">` +
    `${years.map((label, y) => { const k = colFor(defMeasure, y); return `<tr data-year="${y}"><th scope="row">${esc(label)}</th>${k < 0 ? '<td class="budget-table__num">–</td>' : num(sumK(k), money(sumK(k)))}</tr>`; }).join('')}</tbody></table></div>` +
    `<div class="table-scroll" role="region" tabindex="0" aria-label="${esc(first.label)} in the selection"><table class="budget-table"><caption>${esc(first.label)}, for the selection</caption><thead><tr><th scope="col">${esc(first.label.replace(/s$/, ''))}</th><th scope="col" class="budget-table__num">${esc(cfg.noun.Many)}</th><th scope="col" class="budget-table__num" data-column-label>${esc(columns[cfg.defaultColumn].label)}</th></tr></thead><tbody id="selection-facet">` +
    `${values(first).map((v) => { const m = lines.filter((l) => l.facets[first.name] === v); return `<tr data-value="${esc(v)}"><th scope="row">${esc(v)}</th>${num(m.length, String(m.length))}${num(sumK(cfg.defaultColumn, m), money(sumK(cfg.defaultColumn, m)))}</tr>`; }).join('')}</tbody></table></div></div>${cfg.statsExtra ? `<div id="stats-overview" data-whole-only>${cfg.statsExtra}</div>` : ''}</div>`;
  const toolbar = `<div class="action-toolbar"><div class="action-group" role="group" aria-label="Sort" id="sort-group">${tbtn('data-sort', 'book', 'Book order', ICONS.book, 'false')}${tbtn('data-sort', 'amount', 'Amount, high to low', ICONS.amount, 'false')}${tbtn('data-sort', 'name', 'Name, A to Z', ICONS.name, 'true')}</div>` +
    `<div class="action-group" role="group" aria-label="View" id="view-group">${tbtn('data-view', 'cards', 'Cards', ICONS.cards, 'true')}${tbtn('data-view', 'table', 'Table', ICONS.table, 'false')}</div>` +
    `<div class="action-group" role="group" aria-label="Chart actions" id="chart-actions" hidden><button type="button" class="action-button" id="copy-charts-button" data-icon="copy" aria-label="Copy charts" title="Copy charts"></button><button type="button" class="action-button" id="download-all-png-button" data-icon="download" aria-label="Download all charts as PNG" title="Download all charts as PNG"></button></div>` +
    `${actions(`budget-${cfg.id}`, '#line-cards', true, [{ id: 'table', label: cfg.noun.many }], null, true)}</div>`;
  // Which year's amount the cards, stats and charts show: a choice of one, in the filter column with the other filters.
  // Compare: pick two to four lines and read them side by side, as charts and as a table. `cfg.compare` gives the rows
  // ({ label, kind: money | change | percent | fte, chart: { group: 'year' | 'latest', name } }), each line's numbers in
  // the same order (lines: { slug: [...] }) and the chart titles; without it the rows are the book's own columns.
  const withCompare = cfg.compare !== false;
  const compare = cfg.compare || { rows: columns.map((c, k) => ({ label: c.label, kind: 'money', chart: { group: 'year', name: c.label } })), lines: Object.fromEntries(cfg.lines.map((l) => [l.slug, l.values])), titles: { year: 'Expenditures by year' } };
  const compareNoun = cfg.compareNoun || cfg.noun.many;
  const chartTitles = compare.titles || {};
  const compareCharts = ['year', 'latest'].filter((g) => compare.rows.some((r) => r.chart && r.chart.group === g)).map((g) => chartCard('cmp-' + g, chartTitles[g] || g)).join('');
  const comparePanel = `<div id="line-compare" aria-label="Compare" hidden><fieldset class="compare-picker"><legend>${esc(cfg.compareLabel || cfg.noun.Many)}</legend><ul class="compare-list" id="compare-list"></ul></fieldset>` +
    `<div class="compare-result"><p class="app-empty" id="compare-empty">Choose two to four ${esc(compareNoun)}.</p><div id="compare-body" hidden>` +
    `<div class="mm-stats-grid" id="compare-charts" data-chart-lib="${cfg.lib}">${compareCharts}</div>${bd.table(`${cfg.compareCaption || 'Side by side'}`, ['Measure'], [])}</div></div></div>`;
  // The filter column: the shell draws it from filters.json, written beside the page (see filtersFor).
  const filterPanel = filterColumn('budget');
  const tabRow = `<div id="content-tab-row" class="tab-list"><div role="tablist" aria-label="Budget" id="content-tabs"><button type="button" role="tab" aria-selected="true" id="lines-tab" aria-controls="line-list" class="tab-button">Budget</button></div>` +
    `<button type="button" id="stats-toggle" class="tab-button" aria-pressed="false" aria-controls="line-stats">Stats</button>${withCompare ? '<button type="button" id="compare-toggle" class="tab-button" aria-pressed="false" aria-controls="line-compare">Compare</button>' : ''}</div>`;
  // The "Showing:" line as the script writes it for the whole list: each filter in order (the choice of one first, then the
  // others' "All" words), then the count in brackets with a breakdown that lists every value, zeros too (as Marin Mentions does).
  const breakdownFacet = facets.find((f) => f.name === cfg.breakdownFacet);
  const breakdown = values(breakdownFacet).map((v) => `${v} ${count(breakdownFacet, v)}`).join(', ');
  const showingText = `Showing: ${[...(multi ? [measureName[defMeasure]] : []), columns[cfg.defaultColumn].label, ...facets.map((f) => f.all)].join(' · ')} (${lines.length} ${cfg.noun.many} — ${breakdown})`;
  const results = `<div class="search-results"><h2 class="selection-title" id="selection-title" hidden></h2>${tabRow}<div class="mm-results-summary"><p class="app-help-text" id="active-filters" data-filter-results tabindex="-1">${esc(showingText)}</p></div>${toolbar}` +
    `<div id="line-list"><div class="mm-select-all" id="select-all-field"><label><input type="checkbox" id="select-all-checkbox"> Select all</label><span class="app-help-text" id="selection-count" role="status" aria-live="polite"></span></div>` +
    `<ul class="search-results-list" id="line-cards" aria-label="${esc(cfg.noun.Many)}">${lines.map(card).join('')}</ul>` +
    `<div id="line-table-wrap" hidden><div class="table-scroll" role="region" tabindex="0" aria-label="${esc(cfg.noun.Many)}"><table class="budget-table" id="line-table"><caption>${esc(cfg.noun.Many)}</caption><thead><tr><th scope="col"><span class="visually-hidden">Select</span></th><th scope="col">${esc(cfg.titleLabel)}</th>${facets.map((f) => `<th scope="col">${esc(f.label.replace(/s$/, ''))}</th>`).join('')}${columns.map((c) => `<th scope="col" class="budget-table__num">${esc(colName(c))}</th>`).join('')}</tr></thead><tbody>${lines.map(row).join('')}</tbody></table></div></div></div>` +
    `${stats}${withCompare ? comparePanel : ''}<div id="line-export" class="visually-hidden" aria-hidden="true"></div></div>`;
  const config = { measures: cfg.measures || null, alphabeticalFacets: ALPHABETICAL, columns, defaultColumn: cfg.defaultColumn, facets: facets.map((f) => ({ name: f.name, label: f.label, all: f.all })), chartFacets: cfg.chartFacets, breakdownFacet: cfg.breakdownFacet, latestBook: cfg.books[0].href, currentBook: cfg.currentBook, countFacet: cfg.countFacet, titleLabel: cfg.titleLabel, noun: cfg.noun, exportCaption: cfg.exportCaption, statsTitle: cfg.statsTitle, compare: withCompare ? { rows: compare.rows, lines: compare.lines, titles: chartTitles, noun: compareNoun, caption: cfg.compareCaption || 'Side by side', max: 4 } : null };
  return `<div class="search-layout" id="budget-tool">${filterPanel}${results}</div><script type="application/json" id="tool-config">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`;
}

// Script tags for a page at `up` levels below the repository root ('../../' for budget/fy2025-26/).
const toolScripts = (up) => `<script src="${up}budget/tool.js?v=${stampOf('budget/tool.js')}"></script>`;

module.exports = { toolHtml, toolScripts, filtersFor, slug };
