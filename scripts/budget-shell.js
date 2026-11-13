// The page shell shared by the generated Budget pages (build-budget.js and build-budget-2025.js).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const { ICON_BANKNOTE } = require('./icons');
const ICON = ICON_BANKNOTE; // Lucide banknote
const FAVICON = "<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect width='48' height='48' rx='10' fill='%23000'/%3E%3Cg fill='none' stroke='%23e5b53b' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round' transform='translate(9,9) scale(1.25)'%3E" + ICON.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'") + "%3C/g%3E%3C/svg%3E\">";

const { testBanner } = require('./test-banner');

// The tabs of the app, on every page. The first crumb is the Dashboard; the current tab follows the second crumb.
function tabNav(crumbs) {
  const root = (crumbs[0][1] || '').replace(/index\.html$/, '');
  const here = (crumbs[1] && crumbs[1][0]) || '';
  const tab = (label, href, current) => `<a href="${href}"${current ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="org-tabs" aria-label="Sections">${tab('Dashboard', root + 'index.html', !crumbs[1])}${tab('Budget', root + 'budget/', here === 'Budget')}${tab('Capital improvement plan', root + 'capital/projects.html', here === 'Capital improvement plan')}</nav>`;
}

// Every page uses the MarinOS app shell: header, About / Security / Accessibility / Updates, footer and feedback, as in
// Marin Mentions. The tabs are in the page; there is no breadcrumb (`crumbs` only says which tab is current). `up` is 'root' for the home page, else '' for a page one
// folder down and '../' for two.
const DESCRIPTION = 'County of Marin budget and Capital Improvement Plan.';
const ABOUT = '<p>Marin Budget shows the County of Marin budget and its Capital Improvement Plan. The figures come from the County\'s budget books and the Capital Improvement Plan book, read by Marin Data, and every page cites the book pages it comes from.</p>';
function shell(title, description, crumbs, body, up = '') {
  const root = up === 'root' ? './' : up + '../';
  const banner = testBanner(crumbs[1] && crumbs[1][0] === 'Capital improvement plan' ? 'capital/' : 'budget/');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Marin Budget</title>${FAVICON}<meta name="description" content="${esc(description)}"><link rel="stylesheet" href="${up === 'root' ? './' : ''}styles.css"><script src="${root}shared/gate.js"></script><script src="${root}vendor/marinos/marinos.js" defer></script><script src="${root}shared/app-home.js" defer></script></head>` +
    `<body data-app-id="marin-budget" data-app-root="${root}"><a class="skip-link" href="#main">Skip to main content</a><marin-os-banner></marin-os-banner>` +
    `<marin-app-header app-name="Marin Budget" app-description="${esc(DESCRIPTION)}"><template data-icon><svg viewBox="0 0 24 24">${ICON}</svg></template></marin-app-header>${banner}` +
    `<main id="main" class="page" tabindex="-1"><div id="app-status-message" class="visually-hidden" role="status" aria-live="polite"></div>${body.includes('data-tab-section=') ? tabNav(crumbs) + body : `<div id="start" data-tab-section="start">${tabNav(crumbs)}${body}</div>`}` +
    `<marin-app-info app-name="Marin Budget" repo="marin-budget" security-src="${root}security.json"><template data-about>${ABOUT}</template></marin-app-info></main>` +
    `<marin-app-footer app-name="Marin Budget"></marin-app-footer><marin-app-feedback></marin-app-feedback></body></html>\n`;
}

module.exports = { tabNav, ICON, FAVICON, shell, esc };
