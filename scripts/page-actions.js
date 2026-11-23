// Copy, Link and Download for the content of a page. The shell wires Text, HTML and Markdown (marin-app-shell
// docs/components.md, "Copy and Download"); shared/page-data.js wires JSON and CSV, and, on a page with tabs,
// points the buttons at the tab that is open and shows only what that tab has.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const CARET = '<svg class="menu-toggle__caret" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>';
const FORMATS = [['text', 'Text'], ['html', 'HTML'], ['markdown', 'Markdown']];

// `scope` is the selector of the content (null when the page builds its own strings and calls marinFormatMenus) the buttons copy and download; on a page with tabs it is replaced by the open tab.
// `json` is whether the page carries its data as JSON-LD; `csvs` is [{ id, label, tab }], one for each table.
// `tabs` is { content: [tabs with text to copy], json: [tabs with JSON] }. Without it every button is always shown.
const MAXIMIZE = '<svg class="copy-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
// The button that opens a table (with its buttons above it) at the size of the screen. `target` is a selector for what opens: the button's own ancestor that matches, or the one on the page.
// shared/table-fullscreen.js does the rest.
const fullscreenButton = (target) => `<button type="button" class="action-button" data-fullscreen-target="${esc(target)}" aria-label="Fullscreen" title="Fullscreen">${MAXIMIZE}</button>`;
const actions = (fileName, scope = 'article.content', json = false, csvs = [], tabs = null, link = true, extraDownload = '', fullscreen = '', share = link) => {
  const panel = (kind) => (link ? `${kind}-panel` : `${kind}-panel-${fileName}`);
  const only = (names) => (tabs ? ` data-for-tabs="${esc(names.join(' '))}"` : '');
  const menu = (kind, title, extra = '') => `<div class="menu"${only(tabs ? tabs.content : [])}><button type="button" class="action-button menu-toggle" data-icon="${kind}" aria-expanded="false" aria-controls="${panel(kind)}" aria-label="${title}, choose a format" title="${title}">${CARET}</button>` +
    `<div id="${panel(kind)}" class="menu-panel" hidden>${FORMATS.map(([f, label]) => `<button type="button" data-button-kind="menu-item" data-${kind}-format="${f}">${label}</button>`).join('')}` +
    `${json ? `<button type="button" data-button-kind="menu-item" data-${kind}-json${only(tabs ? tabs.json : [])}>JSON</button>` : ''}${extra}</div></div>`;
  const csvItems = csvs.map((c) => `<button type="button" data-button-kind="menu-item" data-download-csv="${esc(c.id)}"${c.file ? ` data-file-name="${esc(c.file)}"` : ''}${only([c.tab || ''])}>${csvs.length === 1 ? 'CSV' : esc('CSV, ' + c.label)}</button>`).join('');
  return `<div class="doc-actions"${tabs ? ' data-tabs' : ''} ${scope ? ` data-formats-for="${esc(scope)}"` : ''} data-file-name="${esc(fileName)}">${menu('copy', 'Copy')}` +
    `${share ? '<button type="button" class="action-button" data-action="share" data-icon="link" aria-label="Copy link" title="Copy link"></button>' : ''}${menu('download', 'Download', csvItems + extraDownload)}${fullscreen ? fullscreenButton(fullscreen) : ''}` +
    `<span class="doc-action-status" role="status" aria-live="polite"></span></div>`;
};

// A chart's own bar, shown like a table's: Copy and Download menus above it. Copy as an image or as text; Download as a PNG.
// shared/page-data.js does the copying and saving from the chart in the same .chart-block.
const chartActions = (id) => {
  const item = (attribute, label) => `<button type="button" data-button-kind="menu-item" ${attribute}>${label}</button>`;
  const menu = (kind, title, items) => `<div class="menu"><button type="button" class="action-button menu-toggle" data-icon="${kind}" aria-expanded="false" aria-controls="${kind}-panel-${esc(id)}" aria-label="${title}, choose a format" title="${title}">${CARET}</button>` +
    `<div id="${kind}-panel-${esc(id)}" class="menu-panel" hidden>${items}</div></div>`;
  // The same four buttons as a table, in the same order: Copy, Copy link, Download, Fullscreen (the chart and its buttons open together).
  return `<div class="doc-actions chart-actions">${menu('copy', 'Copy', item('data-chart-copy="image"', 'Image') + item('data-chart-copy="text"', 'Text'))}` +
    `<button type="button" class="action-button" data-action="share" data-icon="link" aria-label="Copy link" title="Copy link"></button>` +
    `${menu('download', 'Download', item('data-chart-png', 'PNG'))}${fullscreenButton('.chart-block')}<span class="doc-action-status" role="status" aria-live="polite"></span></div>`;
};

// The page's data for the buttons: JSON-LD (the JSON items) and its tables as rows (the CSV items).
//   graph   an array (one JSON for the page), an object { tab: array } (one for each tab), or null (tables only).
//   csvs    [{ id, label, rows }].
// `scriptPath` is how the page reaches page-data.js.
const ld = (id, graph) => `<script type="application/ld+json" id="${id}">${JSON.stringify({ '@context': 'https://schema.govfresh.com/v1/context.jsonld', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;
// The script's address changes when the script does, so a page never runs an older cached copy of it.
const stamp = (scriptPath) => {
  const file = path.join(__dirname, '..', 'shared', 'page-data.js');
  return /shared\/page-data\.js$/.test(scriptPath) && fs.existsSync(file) ? `?v=${crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8)}` : '';
};
const jsonBlock = (graph, scriptPath, csvs = []) =>
  (Array.isArray(graph) ? ld('page-data', graph) : graph ? Object.entries(graph).filter(([, g]) => g && g.length).map(([tab, g]) => ld(`page-data-${tab}`, g)).join('') : '') +
  csvs.map((c) => `<script type="application/json" id="csv-${esc(c.id)}">${JSON.stringify(c.rows).replace(/</g, '\\u003c')}</script>`).join('') +
  `<script src="${esc(scriptPath)}${stamp(scriptPath)}" defer></script>`;

// A Download menu of the page's own choices, for a page that builds the file in the browser: `items` is [[attribute, label]].
const downloadMenu = (id, items) => `<div class="menu"><button type="button" class="action-button menu-toggle" data-icon="download" aria-expanded="false" aria-controls="download-panel-${esc(id)}" aria-label="Download, choose a format" title="Download">${CARET}</button>` +
  `<div id="download-panel-${esc(id)}" class="menu-panel" hidden>${items.map(([attribute, label]) => `<button type="button" data-button-kind="menu-item" ${attribute}>${esc(label)}</button>`).join('')}</div></div>`;

// A Copy menu of the page's own choices, for a page that builds the text in the browser: `items` is [[attribute, label]].
const copyMenu = (id, items) => `<div class="menu"><button type="button" class="action-button menu-toggle" data-icon="copy" aria-expanded="false" aria-controls="copy-panel-${esc(id)}" aria-label="Copy, choose a format" title="Copy">${CARET}</button>` +
  `<div id="copy-panel-${esc(id)}" class="menu-panel" hidden>${items.map(([attribute, label]) => `<button type="button" data-button-kind="menu-item" ${attribute}>${esc(label)}</button>`).join('')}</div></div>`;

// The tables of a Stats tab change with the filters, so their file is read from the table as it is. Each one is a block with the buttons every table has
// (Copy, Copy link, Download, Fullscreen) above it: this wraps the `<div class="table-scroll">` of each table in an HTML string.
const statTables = (html) => html.replace(/<div class="table-scroll" role="region" tabindex="0" aria-label="([^"]*)">(<table[^>]*>\s*<caption>([^<]*)<\/caption>[\s\S]*?<\/table>)<\/div>/g, (whole, label, table, caption) => {
  const id = `stats-${caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  return `<div class="table-block" id="${id}">${actions(id, `#${id} .table-scroll`, false, [{ id, file: id }], null, false, '', `#${id}`, true)}<div class="table-scroll" role="region" tabindex="0" aria-label="${label}">${table}</div></div>`;
});
// The two tables of the Stats tab of the budget and capital tools sit in one box (`capital-stats__tables`); this wraps those and no other table.
const statTablesIn = (html) => html.replace(/(<div class="capital-stats__tables">)([\s\S]*?<\/table><\/div>[\s\S]*?<\/table><\/div>)(<\/div>)/, (m, open, tables, close) => open + statTables(tables) + close);

module.exports = { actions, chartActions, downloadMenu, copyMenu, fullscreenButton, statTables, statTablesIn, jsonBlock };
