'use strict';
// Settings view: language, appearance, density, overview sections, per-course customization.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, screenshot } = require('../helpers/launch');
const { S, strings, openPortal, pick, waitSettings, sectionOrder, mainText } = require('../helpers/app');

const ENR = require('../helpers/fixtures').load().portal.enrollments;
const lu = (name) => ENR.find((e) => e.title.startsWith(name + ' [')).learningUnitId;
const FILMTAAL = lu('Filmtaal 1');
const REGIE = lu('Regie 1');
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
    // One "Overzicht" group with start page, "Secties aanpassen…" and the feed options; no "Bijgewerkt" line here.
    const ov = page.locator('#tplus-root section[data-section="st-overview"]');
    assert.equal(await ov.count(), 1, 'Overzicht group');
    for (const sel of ['select[name="s:startPage"]', '[data-fk="open-sections"]', 'input[name="s:feed.includeAnnouncements"]', 'select[name="n:feed.maxCourses"]']) {
      assert.equal(await ov.locator(sel).count() >= 1, true, `${sel} in Overzicht`);
    }
    assert.deepEqual(await ov.locator('select[name="s:startPage"] option').evaluateAll((o) => o.map((x) => x.value)), ['overview', 'courses', 'deadlines', 'agenda']);
    assert.equal(await page.locator('#tplus-root .tp-updated:visible').count(), 0, '"Bijgewerkt" hidden on settings');
    await screenshot(page, 'settings-light-desktop');
  });

  it('at most 10 groups; no pin/favourite rows; courses live in Vakken › Bewerk; no red/pink accent', async () => {
    const nl = strings('nl');
    const groups = await page.locator('#tplus-root .st-view > section.tp-section').evaluateAll((l) => l.map((x) => x.dataset.section));
    assert.ok(groups.length <= 10, `≤ 10 groups (${groups.length}: ${groups})`);
    assert.deepEqual(groups, ['st-lang', 'st-look', 'st-overview', 'st-dl', 'st-courses', 'st-agenda', 'st-search', 'st-sync', 'st-advanced', 'st-about']);
    const titles = await page.locator('#tplus-root .st-view > section.tp-section .tp-sec-title').allInnerTexts();
    assert.deepEqual(titles.map((x) => x.trim()), ['settings.lang', 'settings.look', 'settings.overview', 'settings.dl', 'settings.courses', 'settings.agenda', 'settings.search', 'settings.sync', 'settings.advanced', 'settings.about'].map((k) => nl[k]));
    assert.equal(await page.locator('#tplus-root input[name="s:sync.favoritesToToledo"], #tplus-root [name^="pin__"], #tplus-root [name^="nick__"]').count(), 0, 'no pin/favourite rows, no second place for course settings');
    const courses = page.locator('#tplus-root section[data-section="st-courses"] a[data-fk="open-courses"]');
    assert.match(await courses.getAttribute('href'), /#\/home\?tplus=courses&id=edit$/);
    const accents = await page.locator('#tplus-root input[name="s:accent"]').evaluateAll((l) => l.map((x) => x.value));
    assert.ok(!accents.includes('red') && !accents.includes('pink'), `accents: ${accents}`);
    // Geavanceerd: Toledo-page wrappers + data export/import/reset
    const adv = page.locator('#tplus-root section[data-section="st-advanced"]');
    for (const sel of ['input[name="s:wrap.portal"]', 'input[name="s:wrap.courses"]', 'input[name="s:wrap.deepBar"]', '[data-action="export"]', 'input[name="st-import"]', '[data-action="reset"]']) {
      assert.equal(await adv.locator(sel).count(), 1, `${sel} in Geavanceerd`);
    }
    // a stored red/pink accent is migrated to blue
    await h.setSettings({ accent: 'pink' });
    await page.reload();
    await openPortal(h, 'settings');
    assert.equal((await waitSettings(h, (x) => x.accent === 'blue'))?.accent, 'blue', 'pink accent migrated to blue');
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

  it('overview section toggle hides the section ("Secties aanpassen…" subpage)', async () => {
    await openPortal(h, 'settings');
    await page.locator('#tplus-root [data-fk="open-sections"]').click();
    await page.waitForFunction(() => location.hash === '#/home?tplus=settings&id=sections', null, { timeout: 5000 });
    await page.locator('#tplus-root .st-sec-list').waitFor();
    assert.equal(await page.locator('#tplus-root .st-sec-row [data-grip]').count() >= 6, true, 'drag handles');
    await screenshot(page, 'settings-sections');
    const sw = page.locator('#tplus-root input[name="sec__schedule"]');
    assert.equal(await sw.count(), 1, 'switch for section "schedule"');
    await sw.uncheck({ force: true });
    await waitSettings(h, (s) => s.overview.sections.find((x) => x.id === 'schedule')?.on === false);
    await openPortal(h, 'overview');
    assert.equal(await page.locator(S.section('schedule')).count(), 0, 'schedule section still shown');
    assert.equal(await page.locator(S.section('deadlines')).count(), 1);
  });

  it('overview section reorder is reflected', async () => {
    await openPortal(h, 'settings', 'sections');
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

  it('course nickname, color and hide (Vakken › Bewerk) are reflected in the app', async () => {
    await openPortal(h, 'courses', 'edit');
    assert.equal(await page.locator('#tplus-root .cs-edit-list').count(), 1, 'opens in edit mode from the settings link');
    const nick = page.locator(`#tplus-root input[name="nick__${FILMTAAL}"]`);
    assert.equal(await nick.count(), 1, 'nickname field for Filmtaal 1');
    await nick.fill('Taal van film');
    await nick.press('Tab');
    await waitSettings(h, (s) => s.courses?.items?.[FILMTAAL]?.nickname === 'Taal van film');
    await page.waitForTimeout(200); // the nickname repaint runs after blur

    // colour: a popover of swatches behind the colour dot
    await page.locator(`#tplus-root [data-fk="color:${FILMTAAL}"]`).click();
    // the popover re-renders on change, so click (not check) the swatch
    await page.locator(`#tplus-root input[name="color__${FILMTAAL}"][value="purple"]`).click({ force: true });
    await waitSettings(h, (s) => s.courses?.items?.[FILMTAAL]?.color === 'purple');

    const hide = page.locator(`#tplus-root input[name="hide__${REGIE}"]`);
    await hide.check({ force: true });
    await waitSettings(h, (s) => s.courses?.items?.[REGIE]?.hidden === true);
    await page.locator('#tplus-root [data-shell="view-action"][data-id="edit"]').click();

    await openPortal(h, 'courses');
    const txt = await mainText(page);
    assert.ok(txt.includes('Taal van film'), 'nickname shown in courses view');
    const hasColor = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const el = [...sr.querySelectorAll('main *')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Taal van film');
      const row = el && (el.closest('a,button,li,.tp-row,details') || el.parentElement);
      if (!row) return false;
      return [...row.querySelectorAll('*'), row].some((e) => {
        const cs = getComputedStyle(e);
        return [cs.backgroundColor, cs.color, cs.borderColor, e.getAttribute('style') || ''].some((v) => /175, 82, 222|#AF52DE/i.test(v));
      });
    });
    assert.ok(hasColor, 'course color (purple #AF52DE) applied to the course row');

    await openPortal(h, 'overview');
    const coursesSec = await page.locator(S.section('courses')).innerText();
    assert.ok(coursesSec.includes('Taal van film'), 'nickname on overview');
    assert.ok(!coursesSec.includes('Regie 1'), 'hidden course still on overview');
  });

  it('Agenda group: KU Loket status and a masked iCal link (paste / remove)', async () => {
    await openPortal(h, 'settings');
    const ag = page.locator('#tplus-root section[data-section="st-agenda"]');
    assert.equal(await ag.count(), 1);
    assert.ok((await ag.innerText()).includes('KU Loket'));
    const input = ag.locator('input[name="st-ics"]');
    if (await input.count()) { // TP.kuloket.setIcsUrl available
      await input.fill('https://example.com/not-ical');
      await input.press('Enter');
      await ag.locator('.st-form-error:visible').waitFor({ timeout: 3000 });
      await input.fill('https://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=7&type=student&field=student.schedule.id&value=SECRET123');
      await input.press('Enter');
      const masked = ag.locator('[data-ics-masked]');
      await masked.waitFor({ timeout: 4000 });
      const shown = await masked.innerText();
      assert.ok(!shown.includes('SECRET123') && shown.includes('cloud.timeedit.net'), `masked: ${shown}`);
      await ag.locator('[data-action="ics-remove"]').click();
      await ag.locator('input[name="st-ics"]').waitFor({ timeout: 4000 });
    }
  });

  it('settings persist across reloads', async () => {
    await page.reload();
    await openPortal(h, 'overview');
    assert.ok((await page.locator(S.section('courses')).innerText()).includes('Taal van film'));
    assert.deepEqual(h.errors, []);
  });
});
