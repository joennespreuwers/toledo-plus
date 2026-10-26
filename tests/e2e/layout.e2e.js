'use strict';
// Responsive layout + the screenshot matrix (light/dark × desktop/phone × overview/course/settings).
// Screenshots go to tests/artifacts/ (git-ignored; uploaded by CI).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, screenshot, PHONE, DESKTOP, COURSE_URL, portalRoute } = require('../helpers/launch');
const { S } = require('../helpers/app');

const PAGES = [
  ['overview', portalRoute('overview')],
  ['course', COURSE_URL],
  ['settings', portalRoute('settings')],
];

for (const scheme of ['light', 'dark']) {
  describe(`layout (${scheme})`, () => {
    let h;
    after(async () => { await h?.close(); });

    it('desktop: sidebar visible, no tab bar, no horizontal scroll', async () => {
      h = await launch({ colorScheme: scheme, viewport: DESKTOP });
      for (const [name, url] of PAGES) {
        await h.page.goto(url);
        await waitForShell(h.page);
        await waitForIdle(h.page);
        await waitForQuiet(h.page);
        await h.page.waitForTimeout(300);
        assert.ok(await h.page.locator(S.sidebar).isVisible(), `${name}: sidebar`);
        assert.equal(await h.page.locator(S.tabbar).isVisible(), false, `${name}: tab bar hidden on desktop`);
        assert.ok(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal scroll`);
        await screenshot(h.page, `${name}-${scheme}-desktop`);
      }
    });

    it('390px: tab bar instead of sidebar, More sheet, no horizontal scroll', async () => {
      await h.page.setViewportSize(PHONE);
      for (const [name, url] of PAGES) {
        await h.page.goto(url);
        await waitForShell(h.page);
        await waitForIdle(h.page);
        await waitForQuiet(h.page);
        await h.page.waitForTimeout(300);
        assert.ok(await h.page.locator(S.tabbar).isVisible(), `${name}: tab bar visible at 390px`);
        assert.equal(await h.page.locator(S.sidebar).isVisible(), false, `${name}: sidebar hidden at 390px`);
        const tabs = await h.page.locator(`${S.tabbar} a[data-route], ${S.tabbar} [data-shell="more"]`).count();
        assert.equal(tabs, 5, `${name}: 5 tab bar items`);
        assert.ok(await h.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal scroll at 390px`);
        // touch targets ≥ 44px
        const small = await h.page.evaluate((sel) => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll(sel.replace('#tplus-root ', '') + ' a, ' + sel.replace('#tplus-root ', '') + ' button')]
          .map((e) => e.getBoundingClientRect()).filter((r) => r.width && (r.width < 44 || r.height < 44)).length, S.tabbar);
        assert.equal(small, 0, `${name}: tab bar targets < 44px`);
        await screenshot(h.page, `${name}-${scheme}-phone`);
      }
      // More → sheet with Announcements + Settings
      await h.page.goto(portalRoute('overview'));
      await waitForShell(h.page);
      await h.page.locator(`${S.tabbar} [data-shell="more"]`).click();
      const sheet = h.page.locator('#tplus-root dialog.tp-sheet');
      await sheet.waitFor({ state: 'visible', timeout: 3000 });
      assert.ok(await sheet.locator('a[data-route="announcements"]').count() >= 1);
      assert.ok(await sheet.locator('a[data-route="settings"]').count() >= 1);
      assert.ok(await sheet.locator('a[data-route="kuloket"]').count() >= 1, 'KU Loket in Meer');
      assert.deepEqual(await h.page.locator(`${S.tabbar} a[data-route]`).evaluateAll((l) => l.map((a) => a.dataset.route)), ['overview', 'courses', 'deadlines', 'agenda']);
      // Let the opening animation (tp-sheet-in, 250ms) finish so the capture isn't mid-slide.
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
      await h.page.waitForTimeout(350);
      await screenshot(h.page, `more-sheet-${scheme}-phone`);
      assert.deepEqual(h.errors, []);
    });
  });
}

// Device table (REVIEW §4): wide screens, list widths, 320–430 px phones, touch metadata, back button.
const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector('#tplus-root').shadowRoot.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
}, sel);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
async function go(h, url) {
  await h.page.goto(url);
  await waitForShell(h.page);
  await waitForIdle(h.page);
  await waitForQuiet(h.page);
}

describe('device compatibility', () => {
  let h;
  before(async () => { h = await launch({ viewport: { width: 2560, height: 1300 } }); });
  after(async () => { await h?.close(); });

  it('1920–2560: content sits next to the sidebar and the toolbar lines up with it', async () => {
    for (const width of [1920, 2560]) {
      await h.page.setViewportSize({ width, height: 1200 });
      await go(h, portalRoute('overview'));
      const sb = await box(h.page, 'nav.tp-sidebar');
      const main = await box(h.page, 'main#tp-main');
      assert.ok(main.left - sb.right <= 1, `${width}: main starts at the sidebar (gap ${main.left - sb.right}px)`);
      const content = await box(h.page, '.tp-view-wrap');
      const refresh = await box(h.page, '.tp-toolbar .tp-avatar');
      assert.ok(Math.abs(refresh.right - content.right) <= 12, `${width}: toolbar controls end at the content edge (${refresh.right} vs ${content.right})`);
      await screenshot(h.page, `wide-${width}`);
    }
  });

  it('≥1100: list views are at most ~760px wide', async () => {
    await h.page.setViewportSize({ width: 1440, height: 900 });
    for (const [route, sel] of [['deadlines', '.va-deadlines'], ['announcements', '.va-announcements'], ['settings', '.st-view']]) {
      await go(h, portalRoute(route));
      const b = await box(h.page, sel);
      assert.ok(b && b.width <= 770, `${route}: width ${b && b.width}`);
    }
  });

  it('700–899: the icon rail is the default navigation', async () => {
    for (const width of [700, 820, 899]) {
      await h.page.setViewportSize({ width, height: 800 });
      await go(h, portalRoute('overview'));
      const rail = await h.page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app').classList.contains('sb-rail'));
      const sb = await box(h.page, 'nav.tp-sidebar');
      assert.ok(rail && sb.width >= 60 && sb.width <= 72, `${width}: rail (${sb.width}px)`);
      assert.equal(await h.page.locator(S.tabbar).isVisible(), false);
      assert.ok(await noHScroll(h.page));
    }
  });

  it('320px: courses filter fits, deadline titles wrap to two lines with the urgency under the meta, no horizontal scroll', async () => {
    await h.page.setViewportSize({ width: 320, height: 720 });
    await go(h, portalRoute('courses'));
    const bar = await box(h.page, '.cs-bar');
    const segs = await h.page.evaluate(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.cs-bar .tp-seg, .cs-bar select')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    assert.ok(segs.length >= 4 && segs.every(([l, r]) => l >= 0 && r <= 320), `filter controls inside 320px: ${JSON.stringify(segs)} (bar ${JSON.stringify(bar)})`);
    assert.equal(await h.page.locator('#tplus-root input[name="cs-scope"]').count(), 3, 'max 3 segments');
    assert.ok(await noHScroll(h.page), 'courses: horizontal scroll');
    await screenshot(h.page, 'courses-320');
    await go(h, portalRoute('deadlines'));
    const dl = await h.page.evaluate(() => {
      const row = [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.va-dl')].find((r) => r.textContent.includes('Geluidsdagboek'));
      const title = row.querySelector('.tp-row-title');
      const under = row.querySelector('.va-urg-under');
      const sub = row.querySelector('.tp-row-sub');
      const cs = getComputedStyle(title);
      return { clamp: cs.webkitLineClamp, ws: cs.whiteSpace, underShown: getComputedStyle(under).display !== 'none', underBelow: under.getBoundingClientRect().top >= sub.getBoundingClientRect().bottom - 1, trailHidden: getComputedStyle(row.querySelector('.va-urg-wrap')).display === 'none' };
    });
    assert.equal(dl.clamp, '2', 'title clamps at 2 lines');
    assert.equal(dl.ws, 'normal', 'title wraps');
    assert.ok(dl.underShown && dl.underBelow && dl.trailHidden, `urgency pill under the meta: ${JSON.stringify(dl)}`);
    assert.ok(await noHScroll(h.page), 'deadlines: horizontal scroll');
    await screenshot(h.page, 'deadlines-320');
  });

  it('touch (<700): metadata wraps instead of hover-only titles; inline text links ≥ 24px', async () => {
    await h.page.setViewportSize({ width: 390, height: 844 });
    await go(h, portalRoute('overview'));
    const ws = await h.page.evaluate(() => getComputedStyle(document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-row-sub')).whiteSpace);
    assert.equal(ws, 'normal');
    const links = await h.page.evaluate(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-sec-foot a, .va-foot a')].map((a) => Math.round(a.getBoundingClientRect().height)));
    assert.ok(links.length >= 1 && links.every((x) => x >= 24), `inline link heights: ${links}`);
  });

  it('course page below 1100px: "‹ Vakken" back button in the toolbar', async () => {
    for (const [width, shown] of [[390, true], [1000, true], [1440, false]]) {
      await h.page.setViewportSize({ width, height: 800 });
      await go(h, COURSE_URL);
      const back = h.page.locator('#tplus-root .tp-toolbar a.tp-tb-back');
      assert.equal(await back.isVisible(), shown, `${width}: back button ${shown ? 'shown' : 'hidden'}`);
      if (shown) assert.match(await back.getAttribute('href'), /#\/home\?tplus=courses$/);
    }
    await go(h, portalRoute('overview'));
    assert.equal(await h.page.locator('#tplus-root .tp-toolbar a.tp-tb-back').isVisible(), false, 'only on the course page');
    assert.deepEqual(h.errors, []);
  });
});
