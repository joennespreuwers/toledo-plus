'use strict';
// Bug bash, shell/navigation: state that matters lives in the URL (detail sheet, Courses › Bewerk, unknown routes),
// tab titles, ⌘K results as links, the way to classic Toledo and back, the deep bar's escape, the account menu's
// outside click, and the compact navigation on short screens / touch rails.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, inShadow, screenshot, waitFor, portalRoute } = require('../helpers/launch');
const { S, openPortal, strings, waitSettings } = require('../helpers/app');

const nl = strings('nl');
const hash = (page) => page.evaluate(() => location.hash);
const sheetOpen = (page) => inShadow(page, (sr) => !!sr.querySelector('dialog.tp-detail')?.open);

describe('routes and history', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('TP-199/TP-202: the deadline sheet has its own history entry (Back closes it, stays on Deadlines) and a "Kopieer link"', async () => {
    await openPortal(h, 'overview');
    await page.locator(S.navLink('deadlines')).click();
    await page.waitForFunction(() => location.hash === '#/home?tplus=deadlines');
    await page.waitForTimeout(300);
    const row = page.locator('#tplus-root .va-dl', { hasText: 'Productiedossier' }).first();
    const key = await row.getAttribute('data-key');
    await row.locator('.va-dl-open').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail')?.open);
    assert.equal(await hash(page), `#/home?tplus=deadlines&sheet=${encodeURIComponent(key)}`, 'the sheet is in the URL');
    // copy link: the Toledo URL of the item (works for a groupmate without Toledo+)
    const copy = await inShadow(page, (sr) => {
      const b = sr.querySelector('dialog.tp-detail [data-shell="detail-copy"]');
      const a = sr.querySelector('dialog.tp-detail a[target="_blank"]');
      return { shown: !!b && !b.hidden, link: b?.dataset.link, open: a?.href, label: b?.getAttribute('aria-label') };
    });
    assert.ok(copy.shown, 'copy-link button');
    assert.equal(copy.label, nl['shell.copyLink']);
    assert.equal(copy.link, copy.open, 'same URL as "Open in Toledo"');
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail').open, null, { timeout: 3000 });
    assert.equal(await hash(page), '#/home?tplus=deadlines', 'Back closed the sheet and stayed on Deadlines');
    assert.equal(await inShadow(page, (sr) => sr.querySelector('.tp-view')?.dataset.route), 'deadlines');
    // Esc closes the sheet and leaves its entry: the next Back goes to Overview, not to a dead sheet entry
    await row.locator('.va-dl-open').click();
    await page.waitForFunction(() => /&sheet=/.test(location.hash));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => location.hash === '#/home?tplus=deadlines', null, { timeout: 3000 });
    assert.equal(await sheetOpen(page), false);
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/home?tplus=overview', null, { timeout: 3000 });
    // Forward to a sheet entry with no sheet (or a reload of it): the URL drops the stale part
    await page.goto(portalRoute('deadlines') + '&sheet=zzz');
    await page.waitForFunction(() => location.hash === '#/home?tplus=deadlines', null, { timeout: 5000 });
    assert.deepEqual(h.errors, []);
  });

  it('TP-206: Courses › Bewerk is in the URL: reload keeps it, Back leaves it', async () => {
    await openPortal(h, 'courses');
    await page.locator('#tplus-root .tp-head-actions [data-id="edit"]').click();
    await page.waitForFunction(() => location.hash === '#/home?tplus=courses&id=edit');
    assert.ok(await page.locator('#tplus-root .cs-view.is-editing').isVisible());
    const label = (await page.locator('#tplus-root .tp-head-actions [data-id="edit"]').innerText()).trim();
    assert.equal(label, nl['courses.done'], `"${label}"`);
    await page.reload();
    await page.locator('#tplus-root .cs-view.is-editing').waitFor({ timeout: 8000 });
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/home?tplus=courses', null, { timeout: 5000 });
    await page.locator('#tplus-root .cs-view:not(.is-editing)').waitFor({ timeout: 5000 });
  });

  it('TP-037: an unknown route shows the start page and says so in the URL', async () => {
    await page.goto(portalRoute('nonsense'));
    await page.waitForFunction(() => location.hash === '#/home?tplus=overview', null, { timeout: 8000 });
  });

  it('TP-006/TP-204: tab titles name the page, sub-pages keep their parent', async () => {
    await openPortal(h, 'overview');
    assert.equal(await page.title(), `${nl['nav.overview']} · Toledo+`, 'not the greeting');
    await openPortal(h, 'settings', 'sections');
    assert.equal(await page.title(), `${nl['settings.sections.title']} · ${nl['nav.settings']} · Toledo+`);
    await openPortal(h, 'deadlines');
    assert.equal(await page.title(), `${nl['nav.deadlines']} · Toledo+`);
  });

  it('TP-201/TP-033: ⌘K results are links; the palette closes when the route changes (Back)', async () => {
    await openPortal(h, 'overview');
    await page.locator(S.navLink('deadlines')).click();
    await page.waitForFunction(() => location.hash === '#/home?tplus=deadlines');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette')?.open);
    const opts = await inShadow(page, (sr) => [...sr.querySelectorAll('.tp-pal-opt')].map((o) => ({ tag: o.tagName, href: o.getAttribute('href'), role: o.getAttribute('role') })));
    assert.ok(opts.length >= 5, `results: ${opts.length}`);
    assert.ok(opts.every((o) => o.tag === 'A' && o.role === 'option' && /^https:\/\//.test(o.href || '')), JSON.stringify(opts.slice(0, 3)));
    assert.ok(opts.some((o) => o.href === 'https://toledo.kuleuven.be/portal/#/home?tplus=agenda'), 'nav result → its route');
    // a plain click still navigates in place (no new tab)
    await page.locator('#tplus-root .tp-pal-opt[href$="tplus=agenda"]').click();
    await page.waitForFunction(() => location.hash === '#/home?tplus=agenda');
    assert.equal(h.ctx.pages().length, 1, 'no new tab');
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette')?.open);
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/home?tplus=deadlines', null, { timeout: 3000 });
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette')?.open, null, { timeout: 3000 });
  });

  it('TP-148: a press outside the account menu only closes it', async () => {
    await openPortal(h, 'deadlines');
    await page.locator(S.menuBtn).click();
    await page.locator('#tplus-root .tp-menu:not([hidden])').waitFor();
    await page.locator('#tplus-root .va-dl', { hasText: 'Productiedossier' }).first().locator('.va-dl-open').click();
    await page.waitForTimeout(400);
    assert.equal(await inShadow(page, (sr) => sr.querySelector('.tp-menu').hidden), true, 'menu closed');
    assert.equal(await sheetOpen(page), false, 'the row under the pointer did not open');
    // the next click works normally
    await page.locator('#tplus-root .va-dl', { hasText: 'Productiedossier' }).first().locator('.va-dl-open').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail')?.open, null, { timeout: 3000 });
    await page.keyboard.press('Escape');
  });

  it('TP-192/TP-193/TP-055: classic Toledo explains itself, the pill says where it goes and gets focus', async () => {
    await openPortal(h, 'overview');
    const foot = (await page.locator('#tplus-root .tp-sb-sig [data-shell="classic-sig"]').innerText()).trim();
    assert.equal(foot, nl['shell.classic'], 'footer and menu use one label');
    await page.locator(S.menuBtn).click();
    await page.locator(S.classicBtn).click();
    const pill = page.locator(S.pill);
    await pill.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await pill.getAttribute('aria-label'), nl['shell.pillTitle']);
    await page.waitForFunction((txt) => document.getElementById('tplus-switch-hint')?.textContent === txt, nl['shell.classicOn'], { timeout: 3000 });
    assert.equal(await page.locator('#tplus-switch-hint').getAttribute('role'), 'status');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'tplus-switch', 'focus on the way back');
    await screenshot(page, 'classic-explained');
    await pill.click();
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    assert.equal(await page.locator('#tplus-switch-hint').count(), 0, 'hint gone');
    await waitSettings(h, (x) => x.wrap && x.wrap.portal === true);
  });

  it('TP-194: the deep bar reaches Settings and can hide itself', async () => {
    await page.goto('https://toledo.kuleuven.be/portal/#/deep/some/page');
    await page.waitForFunction(() => !!document.querySelector('#tplus-deep')?.shadowRoot?.querySelector('nav'), null, { timeout: 8000 });
    const r = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-deep').shadowRoot;
      return { links: [...sr.querySelectorAll('nav a')].map((a) => a.getAttribute('href')), hide: sr.querySelector('[data-deep="hide"]')?.getAttribute('aria-label') };
    });
    assert.equal(new Set(r.links).size, r.links.length, `no two links to one place: ${r.links}`);
    assert.ok(r.links.some((x) => /tplus=settings$/.test(x)), 'Settings link');
    assert.equal(r.hide, nl['deep.hide']);
    await page.evaluate(() => document.querySelector('#tplus-deep').shadowRoot.querySelector('[data-deep="hide"]').click());
    const s = await waitSettings(h, (x) => x.wrap && x.wrap.deepBar === false);
    assert.equal(s?.wrap?.deepBar, false, 'the same switch as Settings › Advanced');
    await page.waitForFunction(() => !document.documentElement.classList.contains('tplus-deep'), null, { timeout: 5000 });
    await h.setSettings({ wrap: { deepBar: true } });
  });
});

describe('compact navigation', () => {
  let h; let page;
  before(async () => { h = await launch({ viewport: { width: 844, height: 390 } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('TP-035: a landscape phone (844×390) gets the slim tab bar, not a rail that runs off the screen', async () => {
    await openPortal(h, 'overview');
    const r = await inShadow(page, (sr) => {
      const sb = sr.querySelector('nav.tp-sidebar');
      const tb = sr.querySelector('nav.tp-tabbar').getBoundingClientRect();
      return { sidebar: getComputedStyle(sb).display, tabH: Math.round(tb.height), tabBottom: Math.round(tb.bottom), vh: innerHeight };
    });
    assert.equal(r.sidebar, 'none');
    assert.ok(r.tabH > 0 && r.tabH <= 48, `slim tab bar: ${r.tabH}px`);
    assert.ok(r.tabBottom <= r.vh, 'on screen');
    await screenshot(page, 'landscape-844x390');
  });

  it('TP-038: "Meer" carries a dot when announcements are unread', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPortal(h, 'overview');
    const unread = await inShadow(page, (sr) => {
      const more = sr.querySelector('[data-shell="more"]');
      return { dot: !!more.querySelector('.tp-tab-dot.is-unread'), sr: more.querySelector('.tp-sr')?.textContent || '' };
    });
    assert.ok(unread.dot, 'dot on Meer');
    assert.ok(unread.sr.includes(nl['nav.announcements']), unread.sr);
  });
});

describe('touch rail', () => {
  let h; let page;
  before(async () => {
    h = await launch({ viewport: { width: 1366, height: 768 } });
    page = h.page;
    const cdp = await h.ctx.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  });
  after(async () => { await h?.close(); });

  it('TP-186: on a touch screen the collapsed rail shows captions under its icons', async () => {
    await openPortal(h, 'courses');
    const hoverNone = await page.evaluate(() => matchMedia('(hover: none)').matches);
    await page.keyboard.press('Control+Backslash');
    await page.waitForTimeout(400);
    const r = await inShadow(page, (sr) => {
      const nav = sr.querySelector('nav.tp-sidebar').getBoundingClientRect();
      return [...sr.querySelectorAll('nav.tp-sidebar a.tp-sb-item[data-route]')].map((a) => {
        const l = a.querySelector('.tp-sb-label').getBoundingClientRect();
        return { w: Math.round(l.width), inside: l.left >= nav.left - 0.5 && l.right <= nav.right + 0.5 };
      });
    });
    if (!hoverNone) { console.log('# touch emulation does not switch (hover: none) here; skipped'); return; }
    assert.ok(r.every((x) => x.w > 10 && x.inside), JSON.stringify(r));
    await screenshot(page, 'rail-touch');
  });
});
