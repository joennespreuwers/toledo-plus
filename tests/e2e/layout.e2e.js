'use strict';
// Responsive layout + the screenshot matrix (light/dark × desktop/phone × overview/course/settings).
// Screenshots go to tests/artifacts/ (git-ignored; uploaded by CI).
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, screenshot, PHONE, DESKTOP, COURSE_URL, portalRoute } = require('../helpers/launch');
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
      await screenshot(h.page, `more-sheet-${scheme}-phone`);
      assert.deepEqual(h.errors, []);
    });
  });
}
