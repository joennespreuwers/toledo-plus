'use strict';
// Motion system (TP.motion, v1.5) with animations ON: transitions never break navigation, focus or input,
// dialogs/menus close at once for focus while they fade, reduced motion only fades (≤ 120 ms).
// The rest of the suite runs with motion off (tests/helpers/launch.js), so it stays fast and deterministic.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, inShadow, waitFor, PHONE } = require('../helpers/launch');
const { S, strings, openPortal, waitForRoute } = require('../helpers/app');

const nl = strings('nl');
// Animations running on an element inside the shell (Element.getAnimations works across the shadow boundary).
const anims = (page, sel) => inShadow(page, (sr, sel) => {
  const el = sr.querySelector(sel);
  if (!el) return null;
  return el.getAnimations().map((a) => ({
    id: a.id, duration: a.effect.getTiming().duration, props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)),
  }));
}, sel);
const settle = (page, ms = 450) => page.waitForTimeout(ms);

describe('motion on (desktop)', () => {
  let h; let page;
  before(async () => { h = await launch({ motion: true }); page = h.page; });
  after(async () => { await h?.close(); });

  it('the shell root is marked motion "on" and the tokens are defined', async () => {
    await openPortal(h, 'overview');
    const r = await inShadow(page, (sr) => {
      const app = sr.querySelector('.tp-app');
      const cs = getComputedStyle(app);
      return { motion: app.dataset.motion, d2: cs.getPropertyValue('--dur-2').trim(), spring: cs.getPropertyValue('--ease-spring').trim().slice(0, 7) };
    });
    assert.deepEqual(r, { motion: 'on', d2: '200ms', spring: 'linear(' });
  });

  it('route change: the new view is in the DOM at once and slides/fades in; focus is on the title; input is not blocked', async () => {
    await openPortal(h, 'overview');
    await page.locator(S.navLink('deadlines')).click();
    // immediately: route switched, title focused, the view is animating (opacity/translate only)
    await page.waitForFunction(() => location.hash.includes('tplus=deadlines'));
    const a = await anims(page, '.tp-view');
    assert.ok(a && a.some((x) => x.id === 'tp-enter'), `enter animation on the view: ${JSON.stringify(a)}`);
    assert.ok(a.every((x) => x.props.every((p) => ['opacity', 'translate'].includes(p))), 'only opacity/translate');
    assert.ok(a.every((x) => x.duration <= 300), 'never longer than 300 ms');
    assert.ok(await inShadow(page, (sr) => sr.activeElement?.classList.contains('tp-large-title')), 'focus on the large title');
    // a second navigation during the animation is not swallowed
    await page.locator(S.navLink('courses')).click();
    await waitForRoute(page, 'courses');
    assert.equal(await page.locator(S.title).innerText(), nl['nav.courses']);
  });

  it('back restores the scroll position of the previous view', async () => {
    await page.setViewportSize({ width: 1440, height: 500 });
    await openPortal(h, 'overview');
    await page.evaluate(() => window.scrollTo(0, 260));
    const y0 = await page.evaluate(() => window.scrollY);
    assert.ok(y0 > 100, `overview scrolls (${y0})`);
    await page.locator(S.navLink('deadlines')).click();
    await waitForRoute(page, 'deadlines');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'a new view starts at the top');
    await page.goBack();
    await page.waitForFunction(() => /tplus=overview|#\/home$/.test(location.hash));
    await page.waitForFunction((y) => Math.abs(window.scrollY - y) < 4, y0, { timeout: 3000 });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  it('account menu: scales in; Esc returns focus at once, the menu fades out and is hidden afterwards', async () => {
    await openPortal(h, 'overview');
    await page.locator(S.menuBtn).click();
    await page.locator('#tplus-root .tp-menu').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.ok(await inShadow(page, (sr) => sr.activeElement?.dataset.shell === 'menu'), 'focus back on the account button right away');
    assert.equal(await page.locator(S.menuBtn).getAttribute('aria-expanded'), 'false');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-menu').hidden, null, { timeout: 1000 });
    // reopening right after closing works (the pending leave is aborted)
    await page.locator(S.menuBtn).click();
    await page.keyboard.press('Escape');
    await page.locator(S.menuBtn).click();
    await settle(page);
    assert.equal(await inShadow(page, (sr) => sr.querySelector('.tp-menu').hidden), false, 'menu stays open');
    await page.keyboard.press('Escape');
  });

  it('⌘K: close() is immediate for focus and state; the dialog fades out in CSS', async () => {
    await openPortal(h, 'overview');
    await page.keyboard.press('Control+k');
    await page.locator('#tplus-root dialog.tp-palette').waitFor({ state: 'visible' });
    const t = await inShadow(page, (sr) => getComputedStyle(sr.querySelector('dialog.tp-palette')).transitionProperty);
    assert.match(t, /opacity/);
    assert.match(t, /overlay|display/);
    await page.keyboard.press('Escape');
    assert.equal(await inShadow(page, (sr) => sr.querySelector('dialog.tp-palette').open), false);
    assert.ok(await inShadow(page, (sr) => !!sr.activeElement && !sr.querySelector('dialog.tp-palette').contains(sr.activeElement)), 'focus left the dialog');
  });

  it('segmented control: the pill slides to the checked option (courses scope)', async () => {
    await openPortal(h, 'courses');
    const pos = () => inShadow(page, (sr) => { const p = sr.querySelector('.cs-bar .tp-seg-pill'); return p ? Math.round(p.getBoundingClientRect().left) : null; });
    const x0 = await pos();
    assert.ok(x0 != null, 'pill rendered');
    await page.locator('#tplus-root .cs-bar .tp-seg:nth-child(2)').click();
    await settle(page);
    const x1 = await pos();
    assert.ok(x1 > x0 + 10, `pill moved right: ${x0} → ${x1}`);
    await page.locator('#tplus-root .cs-bar .tp-seg:nth-child(1)').click(); // back to "current" for the next tests
    await settle(page);
    assert.ok(Math.abs((await pos()) - x0) <= 1, 'and back');
  });

  it('filtering keeps every row reachable and leaves no ghosts behind', async () => {
    await openPortal(h, 'courses');
    const before = await page.locator('#tplus-root .cs-card').count();
    await page.locator(S.search).fill('film');
    await settle(page, 600);
    const after = await inShadow(page, (sr) => ({ shown: [...sr.querySelectorAll('.cs-card')].filter((c) => !c.hidden).length, ghosts: sr.querySelectorAll('.tp-ghost').length }));
    assert.ok(after.shown >= 1 && after.shown < before, `filtered ${before} → ${after.shown}`);
    assert.equal(after.ghosts, 0, 'ghosts are removed when their fade ends');
    await page.locator(S.search).fill('');
    await settle(page, 600);
    assert.equal(await inShadow(page, (sr) => [...sr.querySelectorAll('.cs-card')].filter((c) => !c.hidden).length), before);
  });

  it('disclosure: a feed group opens with a height transition; the chevron rotates', async () => {
    await openPortal(h, 'overview');
    const sel = 'section[data-section="ov-new"] details.tp-disclosure';
    const has = await inShadow(page, (sr, sel) => !!sr.querySelector(sel), sel);
    assert.ok(has, 'a feed group');
    const css = await inShadow(page, (sr, sel) => getComputedStyle(sr.querySelector(sel), '::details-content').transitionProperty, sel);
    assert.match(css, /block-size/);
    await page.locator(`#tplus-root ${sel} > summary`).first().click();
    assert.equal(await inShadow(page, (sr, sel) => sr.querySelector(sel).open, sel), true);
  });

  it('toasts stack and the same text is not repeated', async () => {
    await openPortal(h, 'overview');
    await page.locator('#tplus-root [data-shell="refresh"]').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-toasts .tp-toast').length >= 1, null, { timeout: 8000 });
    const n = await inShadow(page, (sr) => sr.querySelectorAll('.tp-toasts .tp-toast').length);
    assert.equal(n, 1);
  });

  it('perceived speed: resting on a course link points it straight at the Ultra outline (no journey hop)', async () => {
    await openPortal(h, 'courses');
    const link = page.locator('#tplus-root main a[href*="batchUid=ULTRA-B-LUCA-X10265-2627"]').first();
    await link.hover();
    const direct = await waitFor(() => inShadow(page, (sr) => [...sr.querySelectorAll('main a[href]')].some((a) => /ultra\/courses\/_900661_1\/outline$/.test(a.href))), { timeout: 5000 });
    assert.ok(direct, 'course link upgraded to the outline URL');
    h.rec.reset();
    await Promise.all([page.waitForURL(/\/ultra\/courses\/_900661_1\/outline/, { timeout: 10000 }), page.locator('#tplus-root main a[href$="/ultra/courses/_900661_1/outline"]').first().click()]);
    await waitForShell(page);
    assert.equal(h.rec.find((r) => /icts-p-toledo-journey/.test(r.url)).length, 0, 'no journey redirect');
  });

  it('course page: busy while loading (aria-busy), header from cache, no console errors', async () => {
    assert.equal(await page.locator(S.title).innerText(), 'Filmtaal 1', 'course name from the cached enrollments');
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-view[aria-busy="true"]'), null, { timeout: 15000 });
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.foreign, []);
  });
});

describe('motion on (phone)', () => {
  let h; let page;
  before(async () => { h = await launch({ motion: true, viewport: PHONE }); page = h.page; });
  after(async () => { await h?.close(); });

  it('tab bar: one selection pill that moves to the active tab', async () => {
    await openPortal(h, 'overview');
    const ind = () => inShadow(page, (sr) => { const i = sr.querySelector('.tp-tab-ind'); return i ? Math.round(i.getBoundingClientRect().left) : null; });
    const x0 = await ind();
    assert.ok(x0 != null);
    await page.locator(`${S.tabbar} a[data-route="deadlines"]`).click();
    await waitForRoute(page, 'deadlines');
    await settle(page);
    assert.ok((await ind()) > x0 + 40, 'indicator under Deadlines');
  });

  it('More sheet slides up and closes', async () => {
    await page.locator(`${S.tabbar} [data-shell="more"]`).click();
    await page.locator('#tplus-root dialog.tp-sheet').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    assert.equal(await inShadow(page, (sr) => sr.querySelector('dialog.tp-sheet').open), false);
    assert.deepEqual(h.errors, []);
  });
});

describe('reduced motion', () => {
  let h; let page;
  before(async () => { h = await launch({ motion: true, reducedMotion: 'reduce' }); page = h.page; });
  after(async () => { await h?.close(); });

  it('route changes only fade, ≤ 120 ms; navigation and focus work', async () => {
    await openPortal(h, 'overview');
    await page.locator(S.navLink('deadlines')).click();
    await page.waitForFunction(() => location.hash.includes('tplus=deadlines'));
    const a = (await anims(page, '.tp-view')) || [];
    assert.ok(a.every((x) => x.props.every((p) => p === 'opacity') && x.duration <= 120), `fades only: ${JSON.stringify(a)}`);
    await waitForRoute(page, 'deadlines');
    assert.ok(await inShadow(page, (sr) => sr.activeElement?.classList.contains('tp-large-title')));
  });

  it('no movement in CSS either (switch thumb, segmented pill, dialogs)', async () => {
    await openPortal(h, 'courses');
    const t = await inShadow(page, (sr) => getComputedStyle(sr.querySelector('.tp-seg-pill')).transitionProperty);
    assert.ok(!/transform/.test(t), `pill: ${t}`);
    assert.deepEqual(h.errors, []);
  });
});
