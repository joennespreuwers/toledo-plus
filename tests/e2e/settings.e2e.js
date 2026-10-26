'use strict';
// Settings view: language, appearance, density, overview sections, per-course customization.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, screenshot } = require('../helpers/launch');
const { S, strings, openPortal, pick, waitSettings, sectionOrder, mainText } = require('../helpers/app');

const FILMTAAL = 'ULTRA-B-LUCA-N50265-2627';
const REGIE = 'ULTRA-B-LUCA-N50300-2627';
const radio = (name, value) => `#tplus-root input[type="radio"][name="${name}"][value="${value}"]`;

/** Open the <details> (course drill-in etc.) that contains the element, if any. */
async function reveal(locator) {
  await locator.evaluate((el) => { for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; });
}

describe('settings', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('settings view renders the main groups', async () => {
    await openPortal(h, 'settings');
    for (const n of ['s:language', 's:appearance', 's:density']) {
      assert.ok(await page.locator(`#tplus-root input[name="${n}"]`).count() >= 3, `${n} control`);
    }
    await screenshot(page, 'settings-light-desktop');
  });

  it('language → English changes UI text and lang', async () => {
    await pick(page.locator(radio('s:language', 'en')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.getAttribute('lang') === 'en', null, { timeout: 5000 });
    const en = strings('en');
    const side = await page.locator(S.sidebar).innerText();
    assert.ok(side.includes(en['nav.overview']) && side.includes(en['nav.courses']), `sidebar in English: ${side.slice(0, 120)}`);
    assert.equal((await waitSettings(h, (s) => s.language === 'en'))?.language, 'en', 'language persisted');
    // other views follow
    await openPortal(h, 'overview');
    assert.equal(await page.locator(S.app).getAttribute('lang'), 'en');
    assert.ok((await page.locator(S.sidebar).innerText()).includes(en['nav.settings']));
  });

  it('language → French changes UI text and lang', async () => {
    await openPortal(h, 'settings');
    await pick(page.locator(radio('s:language', 'fr')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.getAttribute('lang') === 'fr', null, { timeout: 5000 });
    const fr = strings('fr');
    const side = await page.locator(S.sidebar).innerText();
    assert.ok(side.includes(fr['nav.overview']), `sidebar in French: ${side.slice(0, 120)}`);
    await screenshot(page, 'settings-fr');
    await pick(page.locator(radio('s:language', 'nl')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.getAttribute('lang') === 'nl', null, { timeout: 5000 });
  });

  it('appearance → dark', async () => {
    await pick(page.locator(radio('s:appearance', 'dark')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.dataset.appearance === 'dark', null, { timeout: 5000 });
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('tplus-dark')));
    const bg = await page.locator(S.main).evaluate((el) => {
      // walk up to the first element with a non-transparent background
      for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; }
      return getComputedStyle(document.body).backgroundColor;
    });
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    assert.ok(r + g + b < 120, `dark background expected, got ${bg}`);
    await screenshot(page, 'settings-dark-desktop');
    await pick(page.locator(radio('s:appearance', 'light')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.dataset.appearance === 'light', null, { timeout: 5000 });
  });

  it('density → compact makes the large title smaller', async () => {
    const before = await page.locator(S.title).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await pick(page.locator(radio('s:density', 'compact')));
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-app')?.dataset.density === 'compact', null, { timeout: 5000 });
    const after = await page.locator(S.title).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(after < before, `compact title ${after}px should be < standard ${before}px`);
    await pick(page.locator(radio('s:density', 'standard')));
  });

  it('overview section toggle hides the section', async () => {
    const sw = page.locator('#tplus-root input[name="sec__schedule"]');
    assert.equal(await sw.count(), 1, 'switch for section "schedule"');
    await sw.uncheck({ force: true });
    await waitSettings(h, (s) => s.overview.sections.find((x) => x.id === 'schedule')?.on === false);
    await openPortal(h, 'overview');
    assert.equal(await page.locator(S.section('schedule')).count(), 0, 'schedule section still shown');
    assert.equal(await page.locator(S.section('deadlines')).count(), 1);
  });

  it('overview section reorder is reflected', async () => {
    await openPortal(h, 'settings');
    // move "courses" up twice → before "new"
    for (let i = 0; i < 2; i++) {
      await page.locator('#tplus-root [data-action="sec-up"][data-id="courses"]').click();
      await page.waitForTimeout(150);
    }
    const s = await waitSettings(h, (x) => {
      const ids = x.overview.sections.map((y) => y.id);
      return ids.indexOf('courses') < ids.indexOf('new');
    });
    const order = s.overview.sections.filter((x) => x.on).map((x) => x.id);
    await openPortal(h, 'overview');
    const dom = await sectionOrder(page);
    for (const col of dom.cols) {
      const idx = col.map((id) => order.indexOf(id));
      assert.deepEqual([...idx].sort((a, b) => a - b), idx, `column order ${col} does not follow settings ${order}`);
    }
    assert.ok(dom.all.indexOf('courses') < dom.all.indexOf('new') || !dom.cols.some((c) => c.includes('courses') && c.includes('new')),
      'courses should now be above new');
  });

  it('course nickname, color and hide are reflected in the app', async () => {
    await openPortal(h, 'settings');
    const nick = page.locator(`#tplus-root input[name="nick__${FILMTAAL}"]`);
    assert.equal(await nick.count(), 1, 'nickname field for Filmtaal 1');
    await reveal(nick);
    await nick.fill('Taal van film');
    await nick.press('Tab');
    await waitSettings(h, (s) => s.courses?.items?.[FILMTAAL]?.nickname === 'Taal van film');

    const pink = page.locator(`#tplus-root input[name="color__${FILMTAAL}"][value="pink"]`);
    await reveal(pink);
    await pick(pink);
    await waitSettings(h, (s) => s.courses?.items?.[FILMTAAL]?.color === 'pink');

    const hide = page.locator(`#tplus-root input[name="hide__${REGIE}"]`);
    await reveal(hide);
    await hide.check({ force: true });
    await waitSettings(h, (s) => s.courses?.items?.[REGIE]?.hidden === true);

    await openPortal(h, 'courses');
    const txt = await mainText(page);
    assert.ok(txt.includes('Taal van film'), 'nickname shown in courses view');
    const hasPink = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const el = [...sr.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Taal van film');
      const row = el && (el.closest('a,button,li,.tp-row,details') || el.parentElement);
      if (!row) return false;
      return [...row.querySelectorAll('*'), row].some((e) => {
        const cs = getComputedStyle(e);
        return [cs.backgroundColor, cs.color, cs.borderColor, e.getAttribute('style') || ''].some((v) => /255, 45, 85|#FF2D55/i.test(v));
      });
    });
    assert.ok(hasPink, 'course color (pink #FF2D55) applied to the course row');

    await openPortal(h, 'overview');
    const coursesSec = await page.locator(S.section('courses')).innerText();
    assert.ok(coursesSec.includes('Taal van film'), 'nickname on overview');
    assert.ok(!coursesSec.includes('Regie 1'), 'hidden course still on overview');
  });

  it('settings persist across reloads', async () => {
    await page.reload();
    await openPortal(h, 'overview');
    assert.ok((await page.locator(S.section('courses')).innerText()).includes('Taal van film'));
    assert.deepEqual(h.errors, []);
  });
});
