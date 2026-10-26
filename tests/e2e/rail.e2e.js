'use strict';
// Collapsed sidebar = icon rail (⌘\ / toolbar button, persisted), rail by default at 700–899px,
// tab bar on phones, and a sticky full-height sidebar + toolbar while the content scrolls
// (portal, Ultra course page, and after leaving an Ultra deep-bar page).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, screenshot, waitFor, inShadow, COURSE_URL } = require('../helpers/launch');
const { S, openPortal } = require('../helpers/app');

const sidebar = (page) => inShadow(page, (sr) => {
  const nav = sr.querySelector('nav.tp-sidebar');
  const r = nav.getBoundingClientRect();
  const app = sr.querySelector('.tp-app');
  const items = [...nav.querySelectorAll('a.tp-sb-item')];
  const label = nav.querySelector('a.tp-sb-item[data-route="overview"] .tp-sb-label').getBoundingClientRect();
  return {
    width: Math.round(r.width), top: Math.round(r.top), height: Math.round(r.height), visible: getComputedStyle(nav).display !== 'none' && r.width > 0,
    rail: app.classList.contains('sb-rail'),
    labelWidth: Math.round(label.width),
    titles: items.filter((a) => a.dataset.route).map((a) => a.getAttribute('title')),
    names: items.filter((a) => a.dataset.route).map((a) => a.textContent.trim()),
    current: nav.querySelector('[aria-current="page"]')?.dataset.route || null,
    initials: [...nav.querySelectorAll('.tp-sb-initials')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent),
    expanded: sr.querySelector('.tp-sb-toggle').getAttribute('aria-expanded'),
    iconsCentered: items.every((a) => { const ic = a.querySelector('svg, .tp-sb-initials:not([style*="display: none"])'); if (!ic) return true; const b = a.getBoundingClientRect(); const c = ic.getBoundingClientRect(); return !c.width || Math.abs((c.left + c.width / 2) - (b.left + b.width / 2)) < 3; }),
  };
});
const settle = (page) => page.waitForTimeout(400); // width transition (.25s)

async function assertSticky(page, label) {
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(150);
  const r = await inShadow(page, (sr) => {
    const nav = sr.querySelector('nav.tp-sidebar').getBoundingClientRect();
    const tb = sr.querySelector('header.tp-toolbar').getBoundingClientRect();
    return { y: window.scrollY, sbTop: nav.top, sbBottom: nav.bottom, tbTop: tb.top, tbBottom: tb.bottom, vh: innerHeight };
  });
  assert.ok(r.y > 100, `${label}: page must scroll for this check (scrollY ${r.y})`);
  assert.ok(Math.abs(r.sbTop) < 1, `${label}: sidebar top after scrolling (${JSON.stringify(r)})`);
  assert.ok(Math.round(r.sbBottom) >= r.vh - 1, `${label}: sidebar full height`);
  assert.ok(Math.abs(r.tbTop) < 1, `${label}: toolbar stays at the top (${JSON.stringify(r)})`);
  assert.ok(r.tbBottom > 0, `${label}: toolbar visible`);
  await page.evaluate(() => window.scrollTo(0, 0));
}

describe('sidebar icon rail', () => {
  let h; let page;
  before(async () => { h = await launch({ viewport: { width: 1440, height: 560 } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('expanded by default; ⌘\\ collapses to a 64px icon rail with tooltips, dots and course initials', async () => {
    await openPortal(h, 'deadlines');
    let s = await sidebar(page);
    assert.equal(s.width, 240);
    assert.equal(s.rail, false);
    assert.equal(s.expanded, 'true');
    await page.keyboard.press('Control+Backslash');
    await settle(page);
    s = await sidebar(page);
    assert.ok(s.visible && s.rail, 'rail visible');
    assert.ok(s.width >= 60 && s.width <= 72, `rail width ${s.width}`);
    assert.ok(s.labelWidth <= 1, 'labels visually hidden');
    assert.ok(s.names.every(Boolean), 'labels kept for assistive tech');
    assert.deepEqual(s.titles, ['Overzicht', 'Vakken', 'Deadlines', 'Planning', 'Mededelingen', 'Instellingen'], 'tooltips');
    assert.equal(s.current, 'deadlines', 'aria-current kept');
    assert.equal(s.expanded, 'false');
    assert.ok(s.iconsCentered, 'icons centred');
    assert.ok(s.initials.includes('F1') || s.initials.length >= 1, `pinned course initials: ${s.initials}`);
    assert.ok(s.initials.every((x) => x.length === 2), 'two-letter initials');
    // counts become a dot (number hidden, text for screen readers kept)
    const dot = await inShadow(page, (sr) => {
      const c = sr.querySelector('nav.tp-sidebar a[data-route="overview"] .tp-sb-count');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), sr: c.querySelector('.tp-sr')?.textContent };
    });
    if (dot) { assert.ok(dot.w <= 10, 'count shown as a dot'); assert.ok(dot.sr, 'count announced'); }
    await screenshot(page, 'rail-light-desktop');
    const st = await waitFor(async () => (await h.getState())?.ui?.sidebarCollapsed === true);
    assert.ok(st, 'state.ui.sidebarCollapsed persisted');
    // keyboard focus order: brand, nav items, pinned, settings — all reachable
    const order = await inShadow(page, (sr) => [...sr.querySelectorAll('nav.tp-sidebar a')].map((a) => a.tabIndex));
    assert.ok(order.every((x) => x === 0));
  });

  it('the rail survives a reload; the toolbar button expands it again', async () => {
    await openPortal(h, 'overview');
    let s = await sidebar(page);
    assert.ok(s.rail && s.width <= 72, 'still a rail after reload');
    await assertSticky(page, 'portal rail');
    await page.locator('#tplus-root [data-shell="sidebar"]').click();
    await settle(page);
    s = await sidebar(page);
    assert.equal(s.width, 240);
    assert.equal(s.rail, false);
    assert.equal(s.titles.filter(Boolean).length, 0, 'no tooltips when labels are visible');
    await assertSticky(page, 'portal expanded');
  });

  it('sticky on the Ultra course page, also after leaving a deep-bar page', async () => {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitForIdle(page); await waitForQuiet(page);
    // open folders so the page is long enough to scroll
    await inShadow(page, (sr) => sr.querySelectorAll('details.cv-folder').forEach((d) => { d.open = true; }));
    await assertSticky(page, 'ultra expanded');
    await page.keyboard.press('Control+Backslash');
    await settle(page);
    await assertSticky(page, 'ultra rail');
    // SPA → item page (deep bar, transformed body) → back to the outline
    await page.evaluate(() => history.pushState({}, '', location.origin + '/ultra/courses/_200661_1/outline/file/_5000_1'));
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-deep'), null, { timeout: 5000 });
    await page.evaluate(() => history.pushState({}, '', location.origin + '/ultra/courses/_200661_1/outline'));
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-on') && !document.documentElement.classList.contains('tplus-deep'), null, { timeout: 5000 });
    await waitForShell(page);
    await inShadow(page, (sr) => sr.querySelectorAll('details.cv-folder').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(200);
    await assertSticky(page, 'ultra after deep bar');
    await page.keyboard.press('Control+Backslash'); // back to expanded for the next tests
    await settle(page);
  });

  it('700–899px: the rail by default; expanding shows an overlay that Esc closes', async () => {
    await page.setViewportSize({ width: 800, height: 700 });
    await openPortal(h, 'overview');
    let s = await sidebar(page);
    assert.ok(s.rail && s.width <= 72, `rail at 800px (width ${s.width})`);
    assert.equal(await page.locator(S.tabbar).isVisible(), false);
    const main = await inShadow(page, (sr) => Math.round(sr.querySelector('.tp-body').getBoundingClientRect().left));
    assert.ok(main >= 60 && main <= 72, 'content starts after the rail');
    await page.locator('#tplus-root [data-shell="sidebar"]').click();
    await settle(page);
    s = await sidebar(page);
    assert.equal(s.width, 240, 'overlay expanded');
    assert.equal(s.rail, false);
    const main2 = await inShadow(page, (sr) => Math.round(sr.querySelector('.tp-body').getBoundingClientRect().left));
    assert.equal(main2, main, 'content does not jump under the overlay');
    await screenshot(page, 'rail-overlay-tablet');
    await page.keyboard.press('Escape');
    await settle(page);
    s = await sidebar(page);
    assert.ok(s.rail && s.width <= 72, 'Esc returns to the rail');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll');
  });

  it('phone keeps the tab bar', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPortal(h, 'overview');
    assert.ok(await page.locator(S.tabbar).isVisible());
    assert.equal(await page.locator(S.sidebar).isVisible(), false);
  });

  it('dark rail screenshot + no errors', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPortal(h, 'courses');
    await page.keyboard.press('Control+Backslash');
    await settle(page);
    await screenshot(page, 'rail-dark-desktop');
    await page.keyboard.press('Control+Backslash');
    await settle(page);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), []);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });
});
