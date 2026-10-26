'use strict';
// KU Loket hub (route 'kuloket'): next exams, today's lessons, grouped KU Loket apps, read-only note, search.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, screenshot, PHONE } = require('../helpers/launch');
const { S, openPortal, strings } = require('../helpers/app');

const ROOT = '#tplus-root';
const nl = () => strings('nl');

function assertClean(h) {
  assert.deepEqual(h.rec.foreign, [], 'no requests to unexpected origins');
  const writes = h.rec.requests.filter((r) => /webwsp\.aps\.kuleuven\.be|cloud\.timeedit\.net/.test(r.url) && r.method !== 'GET');
  assert.deepEqual(writes, [], 'KU Loket is read-only');
}

describe('KU Loket hub (desktop, light)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('shows next exams, today’s lessons and all app groups', async () => {
    await openPortal(h, 'kuloket');
    await page.locator(`${ROOT} .kl-view`).waitFor();
    assert.equal(await page.locator(S.title).innerText(), nl()['nav.kuloket']);
    const exams = page.locator(`${ROOT} section[data-section="kl-exams"]`);
    await exams.locator('.tp-row', { hasText: 'Filmgeschiedenis 1' }).waitFor({ timeout: 10000 });
    assert.equal(await exams.locator('.tp-row').count(), 2);
    assert.ok((await exams.innerText()).includes(nl()['agenda.exam']), 'labelled as exam');
    assert.ok((await exams.innerText()).includes('A101'), 'room from $expand=toLocation');
    const today = page.locator(`${ROOT} section[data-section="kl-today"]`);
    await today.locator('.kl-lesson', { hasText: 'Filmtaal 1' }).waitFor();
    assert.equal(await today.locator('.kl-lesson').count(), 3);
    assert.match(await today.locator('a.tp-btn').getAttribute('href'), /tplus=agenda/);
    for (const g of ['study', 'enrol', 'agenda', 'survey', 'safety', 'support']) {
      const sec = page.locator(`${ROOT} section[data-section="kl-${g}"]`);
      assert.equal(await sec.count(), 1, `group ${g}`);
      assert.ok((await sec.innerText()).includes(nl()['kuloket.group.' + g]));
    }
    const apps = page.locator(`${ROOT} a.kl-app`);
    assert.equal(await apps.count(), 28);
    for (const a of await apps.all()) {
      assert.equal(await a.getAttribute('target'), '_blank');
      assert.match(await a.getAttribute('href'), /^https:\/\/webwsp\.aps\.kuleuven\.be\/sap\/bc\/ui2\/flp\?sap-language=NL#zr_\d{4}-display$/);
    }
    assert.ok((await page.locator(`${ROOT} .kl-readonly`).innerText()).includes('alleen'), 'read-only note');
    await page.waitForTimeout(300);
    assertClean(h);
    assert.deepEqual(h.errors, []);
    await screenshot(page, 'kuloket-light-desktop');
  });

  it('search filters the apps and shows one empty state', async () => {
    await page.locator(S.search).fill('attest');
    await page.waitForFunction(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('a.kl-app')].filter((a) => !a.hidden).length === 2);
    const visible = await page.locator(`${ROOT} a.kl-app:visible`).allInnerTexts();
    assert.ok(visible.some((x) => x.includes('Selfservice attesten')));
    assert.ok(visible.some((x) => x.includes('Attest medisch onderzoek')));
    assert.equal(await page.locator(`${ROOT} section[data-section="kl-support"]`).isHidden(), true);
    await page.locator(S.search).fill('zzzgeenmatch');
    await page.locator(`${ROOT} .kl-noresults:not([hidden]) .tp-noresults-state`).waitFor();
    await page.locator(S.search).fill('');
    await page.waitForFunction(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('a.kl-app')].every((a) => !a.hidden));
  });
});

describe('KU Loket hub — no exams yet (phone, dark)', () => {
  let h; let page;
  before(async () => { h = await launch({ viewport: PHONE, colorScheme: 'dark', mock: { kuloket: { examsEmpty: true, noExpand: true } } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('says the exam timetable is not published yet', async () => {
    await openPortal(h, 'kuloket');
    const exams = page.locator(`${ROOT} section[data-section="kl-exams"]`);
    await exams.filter({ hasText: nl()['kuloket.exams.none'] }).waitFor({ timeout: 10000 });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 391, `no horizontal scroll (scrollWidth ${sw})`);
    assert.ok(h.rec.kuloket.calls.filter((c) => c.path === 'ZC_IER_SRV/EvaluationSet').length >= 2, 'retried without $expand');
    assertClean(h);
    assert.deepEqual(h.errors, []);
    await screenshot(page, 'kuloket-dark-phone');
    await page.emulateMedia({ colorScheme: 'light' });
    await screenshot(page, 'kuloket-light-phone');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await screenshot(page, 'kuloket-dark-desktop');
  });
});

describe('KU Loket hub — not signed in', () => {
  let h; let page;
  before(async () => { h = await launch({ mock: { kuloket: { loggedOut: true } } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('asks to sign in for exams and lessons, links still work', async () => {
    await openPortal(h, 'kuloket');
    const exams = page.locator(`${ROOT} section[data-section="kl-exams"]`);
    await exams.filter({ hasText: nl()['kuloket.exams.login'] }).waitFor({ timeout: 10000 });
    await page.locator(`${ROOT} section[data-section="kl-today"]`).filter({ hasText: nl()['agenda.status.login'] }).waitFor();
    assert.equal(await page.locator(`${ROOT} a.kl-app`).count(), 28);
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});
