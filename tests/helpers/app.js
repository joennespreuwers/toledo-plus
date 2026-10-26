'use strict';
// App-level helpers shared by the e2e tests (selectors follow src/core/shell.js + src/core/ui.js).
const { sandbox, list } = require('./sandbox');
const { waitForShell, waitForIdle, portalRoute, PORTAL_HOME } = require('./launch');

let table = null;
/** The registered UI strings, loaded in Node so tests can assert translated text. */
function strings(lang) {
  if (!table) {
    const s = sandbox();
    s.load('src/core/util.js'); s.load('src/core/i18n.js');
    for (const f of list('src/i18n', /\.js$/)) s.load(f);
    for (const f of list('src/views', /\.js$/)) { try { s.load(f); } catch (_) { /* views need the DOM; strings in src/i18n suffice */ } }
    table = s.TP.i18n._table;
  }
  return table[lang];
}

const S = {
  app: '#tplus-root .tp-app',
  main: '#tplus-root main#tp-main',
  title: '#tplus-root .tp-large-title',
  view: '#tplus-root .tp-view-wrap',
  sidebar: '#tplus-root nav.tp-sidebar',
  tabbar: '#tplus-root nav.tp-tabbar',
  search: '#tplus-root input[data-shell="search"]',
  section: (id) => `#tplus-root section[data-section="ov-${id}"]`,
  navLink: (route) => `#tplus-root nav.tp-sidebar a[data-route="${route}"]`,
  menuBtn: '#tplus-root [data-shell="menu"]',
  classicBtn: '#tplus-root [data-shell="classic"]',
  pill: '#tplus-switch',
  deep: '#tplus-deep',
};

/** Open a portal route (or home) and wait for the shell. */
async function openPortal(h, route, param) {
  const page = h.page;
  const url = route ? portalRoute(route, param) : PORTAL_HOME;
  await page.goto(url);
  await waitForShell(page);
  await waitForIdle(page);
  return page;
}

/** Wait until the large title / view reflects a route change. */
async function waitForRoute(page, route) {
  await page.waitForFunction((r) => location.hash.startsWith(`#/tplus/${r}`), route, { timeout: 8000 });
  await waitForShell(page);
  await waitForIdle(page);
}

/** Visible text of the main view (innerText skips hidden elements). */
const mainText = (page) => page.locator(S.main).innerText();

/** Check a (possibly visually hidden) radio/checkbox. */
async function pick(locator) {
  try { await locator.check({ timeout: 2000 }); } catch (_) { await locator.check({ force: true }); }
}

/** Wait until settings in storage satisfy pred. */
async function waitSettings(h, pred, timeout = 4000) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < timeout) { s = await h.getSettings(); if (s && pred(s)) return s; await new Promise((r) => setTimeout(r, 50)); }
  return s;
}

/** Overview section ids in DOM order, per layout column. */
function sectionOrder(page) {
  return page.evaluate(() => {
    const sr = document.querySelector('#tplus-root').shadowRoot;
    const secs = [...sr.querySelectorAll('section[data-section^="ov-"]')];
    const cols = new Map();
    for (const s of secs) {
      const col = s.parentElement; const k = cols.get(col) || []; k.push(s.dataset.section.slice(3)); cols.set(col, k);
    }
    return { all: secs.map((s) => s.dataset.section.slice(3)), cols: [...cols.values()] };
  });
}

module.exports = { strings, S, openPortal, waitForRoute, mainText, pick, waitSettings, sectionOrder };
