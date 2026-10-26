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

  it('1280–2560: one centred content column (≤ 1240px) right of the sidebar; the toolbar lines up with it', async () => {
    for (const width of [1280, 1440, 1920, 2560]) {
      await h.page.setViewportSize({ width, height: 1000 });
      await go(h, portalRoute('overview'));
      const sb = await box(h.page, 'nav.tp-sidebar');
      const main = await box(h.page, 'main#tp-main');
      const area = width - sb.right;
      assert.ok(main.width <= 1241, `${width}: content column ≤ 1240 (${main.width})`);
      const gapL = main.left - sb.right, gapR = width - main.right;
      assert.ok(Math.abs(gapL - gapR) <= 2, `${width}: centred in the area right of the sidebar (${gapL} vs ${gapR})`);
      if (area <= 1240) assert.ok(gapL <= 1, `${width}: fills the area when it is narrower`);
      // overview uses the side column (schedule / announcements)
      const side = await box(h.page, '.tp-col-side');
      assert.ok(side && side.width >= 280 && side.width <= 341, `${width}: side column ${side && side.width}`);
      const content = await box(h.page, '.tp-view-wrap');
      const avatar = await box(h.page, '.tp-toolbar .tp-avatar');
      assert.ok(Math.abs(avatar.right - content.right) <= 12, `${width}: toolbar controls end at the content edge (${avatar.right} vs ${content.right})`);
      const title = await box(h.page, '.tp-large-title');
      assert.ok(Math.abs(title.left - content.left) <= 1, `${width}: large title aligned with the content`);
      await screenshot(h.page, `wide-${width}`);
    }
    // every view uses the same content column: switching tabs never moves the title or the edges
    await h.page.setViewportSize({ width: 1920, height: 1000 });
    await go(h, portalRoute('overview'));
    const ref = await box(h.page, '.tp-view-wrap');
    for (const route of ['deadlines', 'announcements', 'settings', 'kuloket', 'courses', 'agenda']) {
      await go(h, portalRoute(route));
      const content = await box(h.page, '.tp-view-wrap');
      assert.ok(Math.abs(content.left - ref.left) <= 1 && Math.abs(content.width - ref.width) <= 1, `${route}: same column as overview (${content.left}/${content.width} vs ${ref.left}/${ref.width})`);
      const title = await box(h.page, '.tp-large-title');
      assert.ok(Math.abs(title.left - ref.left) <= 1, `${route}: title at the same x`);
      const avatar = await box(h.page, '.tp-toolbar .tp-avatar');
      assert.ok(Math.abs(avatar.right - content.right) <= 12, `${route}: toolbar lines up (${avatar.right} vs ${content.right})`);
    }
  });

  it('sidebar, icon rail and tab bar never scroll horizontally (long course names, badges)', async () => {
    const fx = h.fx.portal;
    const LONG = 'Interdisciplinair Onderzoeksseminarie Audiovisuele Kunsten en Mediatheorie in de Hedendaagse Praktijk';
    const NOSPACE = 'Supercalifragilisticexpialidocious_Kalibratieonderzoeksmethodologie_X';
    const e1 = fx.enrollments.find((e) => e.type === 'course');
    const e2 = fx.enrollments.filter((e) => e.type === 'course')[1];
    const old = [e1.title, e2.title];
    e1.title = `${LONG} [X99901]`; e2.title = `${NOSPACE} [X99902]`;
    const items = Object.fromEntries(fx.enrollments.filter((e) => e.type === 'course').map((e) => [e.learningUnitId, { inSidebar: true }]));
    await h.setSettings({ courses: { items } });
    const reload = async () => { // the enrollments are cached: fetch the renamed fixtures now
      await go(h, portalRoute('courses'));
      await h.page.locator('#tplus-root [data-shell="refresh"]').click();
      await waitForQuiet(h.page);
    };
    await reload();
    try {
      const measure = () => h.page.evaluate(() => {
        const sr = document.querySelector('#tplus-root').shadowRoot;
        const out = {};
        for (const sel of ['nav.tp-sidebar', '.tp-sb-scroll', '.tp-sb-foot', '.tp-sb-brand', 'nav.tp-tabbar', '.tp-tabs']) {
          const el = sr.querySelector(sel);
          if (!el || !el.getClientRects().length) continue;
          out[sel] = { sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX };
        }
        const nav = sr.querySelector('nav.tp-sidebar');
        const nr = nav.getBoundingClientRect();
        out.wider = nr.width ? [...nav.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width && !x.closest('.tp-sr') && (r.right > nr.right + 0.5 || r.left < nr.left - 0.5); }).map((x) => x.className.baseVal ?? x.className) : [];
        return out;
      });
      for (const width of [320, 390, 700, 820, 1100, 1440, 2560]) {
        await h.page.setViewportSize({ width, height: 700 });
        await go(h, portalRoute('courses'));
        for (const collapsed of width >= 900 ? [false, true] : [false]) {
          await h.setState({ ui: { sidebarCollapsed: collapsed } });
          await go(h, portalRoute('courses'));
          const m = await measure();
          for (const [sel, v] of Object.entries(m)) {
            if (sel === 'wider') continue;
            assert.ok(v.sw <= v.cw, `${width}${collapsed ? ' rail' : ''}: ${sel} scrolls horizontally (${v.sw} > ${v.cw})`);
          }
          assert.deepEqual(m.wider, [], `${width}${collapsed ? ' rail' : ''}: nothing wider than the sidebar`);
          assert.ok(await noHScroll(h.page), `${width}: page horizontal scroll`);
        }
        if (width === 1440) {
          const lbl = await h.page.evaluate(() => { const l = [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-sb-course .tp-sb-label')].find((x) => x.textContent.startsWith('Interdisciplinair')); return l && { ov: getComputedStyle(l).textOverflow, clipped: l.scrollWidth > l.clientWidth }; });
          assert.ok(lbl && lbl.ov === 'ellipsis' && lbl.clipped, 'long names ellipsize');
          await screenshot(h.page, 'sidebar-long-names');
        }
      }
    } finally {
      [e1.title, e2.title] = old;
      await h.page.setViewportSize({ width: 1440, height: 800 });
      await reload();
      await h.setState({ ui: { sidebarCollapsed: false } });
      await h.setSettings({ courses: { items: Object.fromEntries(Object.keys(items).map((k) => [k, { inSidebar: false }])) } });
    }
  });

  it('200% zoom (640px CSS width) and 320px: no horizontal scroll in any view', async () => {
    for (const width of [320, 640]) {
      await h.page.setViewportSize({ width, height: 700 });
      for (const r of ['overview', 'courses', 'deadlines', 'announcements', 'kuloket', 'settings']) {
        await go(h, portalRoute(r));
        assert.ok(await noHScroll(h.page), `${r} @${width}: horizontal scroll`);
      }
      await go(h, COURSE_URL);
      assert.ok(await noHScroll(h.page), `course @${width}: horizontal scroll`);
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
