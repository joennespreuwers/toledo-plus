'use strict';
// Agenda (route 'agenda'): KU Loket timetable + exams + deadlines; week/day/month/list; popover; iCal fallback.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor, screenshot, inShadow, PHONE, portalRoute } = require('../helpers/launch');
const { S, openPortal, strings } = require('../helpers/app');

const nl = () => strings('nl');
const ROOT = '#tplus-root';
const ev = (title) => `${ROOT} .ag-ev:has(.ag-ev-title:text-is("${title}"))`;

async function openAgenda(h) {
  await openPortal(h, 'agenda');
  await h.page.locator(`${ROOT} .ag-view`).waitFor();
}
const rangeText = (page) => page.locator(`${ROOT} .ag-range`).innerText();
const localSet = (h, obj) => h.sw.evaluate((o) => chrome.storage.local.set(o), obj);
const localKeys = (h) => h.sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
const localRemove = (h, keys) => h.sw.evaluate((k) => chrome.storage.local.remove(k), keys);

function assertClean(h) {
  assert.deepEqual(h.rec.foreign, [], 'no requests to unexpected origins');
  assert.deepEqual(h.rec.cdn, [], 'no relative-URL bugs');
  const writes = h.rec.requests.filter((r) => /webwsp\.aps\.kuleuven\.be|cloud\.timeedit\.net/.test(r.url) && r.method !== 'GET');
  assert.deepEqual(writes, [], 'KU Loket is read-only');
}

describe('agenda — KU Loket signed in (desktop)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('renders the week grid from KU Loket with course colours and a status line', async () => {
    await openAgenda(h);
    await page.locator(ev('Filmtaal 1')).first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator(S.title).innerText(), nl()['nav.agenda']);
    assert.equal(await page.locator(`${ROOT} input[name="ag-mode"][value="week"]`).isChecked(), true, 'week is the desktop default');
    await page.locator(`${ROOT} .ag-status`).filter({ hasText: 'KU Loket' }).waitFor();
    assert.equal(await page.locator(`${ROOT} .ag-col`).count(), 7);
    assert.equal(await page.locator(`${ROOT} .ag-dayhead.is-today`).count(), 1, 'today highlighted');
    assert.equal(await page.locator(`${ROOT} .ag-col.is-today .ag-now`).count(), 1, 'current-time line in today column');
    const text = await page.locator(ev('Filmtaal 1')).first().innerText();
    assert.match(text, /09:00/); assert.match(text, /C207/);
    // course colour = the course's Toledo colour (matched by ECTS code)
    const c = await inShadow(page, (sr) => sr.querySelector('.ag-ev').style.getPropertyValue('--c'));
    assert.match(c, /^#[0-9A-F]{6}$/i);
    const kul = h.rec.kuloket.calls.filter((x) => x.path === 'ZC_EP_SCHEDULE_SRV/Events');
    assert.ok(kul.length >= 1, 'Events requested');
    assert.equal(kul[0].query['sap-client'], '200');
    assert.match(kul[0].query.$filter, /date ge datetime'\d{4}-\d\d-\d\dT00:00:00' and date le datetime'/);
    await page.waitForTimeout(300);
    assert.deepEqual(h.errors, [], 'console/page errors');
    await screenshot(page, 'agenda-week-light-desktop');
  });

  it('lays out overlapping lessons side by side', async () => {
    const box = async (t) => page.locator(ev(t)).first().boundingBox();
    const a = await box('Regie 1'); const b = await box('Geluid 1'); const f = await box('Filmtaal 1');
    assert.ok(a.width < f.width * 0.7 && b.width < f.width * 0.7, 'overlapping events are narrower');
    assert.ok(Math.abs(a.x - b.x) > 10, 'and placed next to each other');
    assert.ok(a.x + a.width <= b.x + 2 || b.x + b.width <= a.x + 2, 'no overlap');
  });

  it('opens a lesson popover with room, teachers, group and a course link; Esc closes it', async () => {
    await page.locator(ev('Filmtaal 1')).first().click();
    const pop = page.locator(`${ROOT} dialog.ag-pop[open]`);
    await pop.waitFor();
    const txt = await pop.innerText();
    for (const s of ['Filmtaal 1', 'C207 (2.07 - leslokaal)', 'Docent A', 'Groep A1', 'Hoorcollege', nl()['agenda.pop.source.kuloket']]) assert.ok(txt.includes(s), `popover shows ${s}`);
    const href = await pop.locator('a', { hasText: nl()['agenda.pop.openCourse'] }).getAttribute('href');
    const enr = h.fx.portal.enrollments.find((e) => /^Filmtaal 1 \[/.test(e.title));
    assert.equal(href, enr.link, 'links to the matched Toledo course');
    assert.equal(await pop.locator('a[href="https://example.edu/rooms/c207"][target="_blank"]').count(), 1, 'room link');
    await screenshot(page, 'agenda-popover-light-desktop');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.ag-pop'));
    const focused = await inShadow(page, (sr) => sr.activeElement && sr.activeElement.querySelector('.ag-ev-title')?.textContent);
    assert.equal(focused, 'Filmtaal 1', 'focus returns to the event');
  });

  it('a lesson without a matching Toledo course has no course link', async () => {
    const w = page.locator(ev('Workshop Lichtontwerp'));
    if (!(await w.count())) return; // today is Sat/Sun: day+2 is next week
    await w.first().click();
    const pop = page.locator(`${ROOT} dialog.ag-pop[open]`);
    await pop.waitFor();
    assert.equal(await pop.locator('a', { hasText: nl()['agenda.pop.openCourse'] }).count(), 0);
    await page.keyboard.press('Escape');
  });

  it('navigates weeks with the buttons and the keyboard (← → T)', async () => {
    const r0 = await rangeText(page);
    await page.locator(`${ROOT} [data-action="ag-next"]`).click();
    await page.waitForFunction((r) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText !== r, r0);
    await page.locator(ev('Camera 1')).first().waitFor({ timeout: 8000 });
    assert.equal(await page.locator(`${ROOT} .ag-dayhead.is-today`).count(), 0);
    await page.locator(`${ROOT} .ag-cal`).focus();
    await page.keyboard.press('ArrowLeft');
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    assert.equal(await rangeText(page), r0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((r) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText !== r, r0);
    await page.keyboard.press('t');
    await page.waitForFunction((r) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText === r, r0);
  });

  it('shows exams with a distinct style and label', async () => {
    let found = false;
    for (let i = 0; i < 7 && !found; i++) {
      await page.locator(`${ROOT} [data-action="ag-next"]`).click();
      found = await waitFor(async () => (await page.locator(`${ROOT} .ag-ev-exam`).count()) > 0, { timeout: 1500 });
    }
    assert.ok(found, 'exam block found within 7 weeks');
    const exam = page.locator(`${ROOT} .ag-ev-exam`).first();
    assert.match(await exam.innerText(), new RegExp(nl()['agenda.exam'], 'i'));
    await exam.click();
    const pop = page.locator(`${ROOT} dialog.ag-pop[open]`);
    await pop.waitFor();
    assert.ok((await pop.innerText()).includes('Docent G') || (await pop.innerText()).includes('Docent A'));
    await page.keyboard.press('Escape');
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
  });

  it('switches to day and month views; month day opens day view', async () => {
    await page.locator(`${ROOT} .tp-seg:has(input[value="day"])`).click();
    await page.locator(`${ROOT} .ag-dayview`).waitFor();
    assert.equal(await page.locator(`${ROOT} .ag-col`).count(), 1);
    await page.locator(`${ROOT} .tp-seg:has(input[value="month"])`).click();
    await page.locator(`${ROOT} .ag-month`).waitFor();
    assert.equal(await page.locator(`${ROOT} .ag-mcell`).count(), 42);
    assert.equal(await page.locator(`${ROOT} .ag-mcell.is-today`).count(), 1);
    assert.ok(await page.locator(`${ROOT} .ag-mcell.is-today .ag-chip`).count() >= 1, 'today has chips');
    await screenshot(page, 'agenda-month-light-desktop');
    await page.locator(`${ROOT} .ag-mcell.is-today .ag-mnum`).click();
    await page.locator(`${ROOT} .ag-dayview`).waitFor();
    assert.equal(await page.locator(`${ROOT} input[name="ag-mode"][value="day"]`).isChecked(), true);
    await page.locator(`${ROOT} .tp-seg:has(input[value="list"])`).click();
    await page.locator(`${ROOT} .ag-list`).waitFor();
    assert.ok(await page.locator(`${ROOT} .ag-lrow`).count() >= 3);
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
  });

  it('filters events with the toolbar search', async () => {
    await page.locator(S.search).fill('regie');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-ev.ag-dim').length > 0);
    assert.equal(await page.locator(`${ROOT} .ag-ev:not(.ag-dim) .ag-ev-title`).first().innerText(), 'Regie 1');
    await page.locator(S.search).fill('zzzgeenmatch');
    await page.locator(`${ROOT} .ag-noresults:not([hidden])`).waitFor();
    await page.locator(S.search).fill('');
  });

  it('"Zet in agenda" downloads the deadlines as .ics', async () => {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      page.locator(`${ROOT} [data-shell="view-action"][data-id="ag-ics"]`).click(),
    ]);
    assert.equal(dl.suggestedFilename(), 'toledo-deadlines.ics');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });

  it('the old planning route lands on the agenda', async () => {
    await page.goto(portalRoute('planning'));
    await page.locator(`${ROOT} .ag-view`).waitFor({ timeout: 10000 });
  });
});

describe('agenda — phone (390) and dark', () => {
  let h; let page;
  before(async () => { h = await launch({ viewport: PHONE, colorScheme: 'dark' }); page = h.page; });
  after(async () => { await h?.close(); });

  it('defaults to the list view on phones and fits without horizontal scroll', async () => {
    await openAgenda(h);
    await page.locator(`${ROOT} .ag-lrow`).first().waitFor({ timeout: 10000 });
    assert.equal(await page.locator(`${ROOT} input[name="ag-mode"][value="list"]`).isChecked(), true);
    assert.ok(await page.locator(`${ROOT} .ag-lday.is-today .ag-lrow`).count() >= 3);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 391, `no horizontal scroll (scrollWidth ${sw})`);
    await screenshot(page, 'agenda-list-dark-phone');
    await page.locator(`${ROOT} .ag-lday.is-today .ag-lrow-lesson`).first().click();
    await page.locator(`${ROOT} dialog.ag-pop.is-sheet[open]`).waitFor();
    await screenshot(page, 'agenda-sheet-dark-phone');
    await page.locator(`${ROOT} dialog.ag-pop [data-action="ag-close"]`).click();
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    await page.locator(`${ROOT} .ag-timegrid`).waitFor();
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw2 <= 391, `week grid fits (scrollWidth ${sw2})`);
    await screenshot(page, 'agenda-week-dark-phone');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });

  it('light phone screenshot', async () => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator(`${ROOT} .tp-seg:has(input[value="list"])`).click();
    await screenshot(page, 'agenda-list-light-phone');
  });

  it('dark desktop screenshot', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    await screenshot(page, 'agenda-week-dark-desktop');
  });
});

describe('agenda — not signed in to KU Loket', () => {
  let h; let page;
  before(async () => { h = await launch({ mock: { kuloket: { loggedOut: true } } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('says so honestly, links to KU Loket and Settings, and falls back to Toledo’s today/tomorrow', async () => {
    await openAgenda(h);
    const status = page.locator(`${ROOT} .ag-status.is-warn`);
    await status.waitFor({ timeout: 10000 });
    const txt = await status.innerText();
    assert.ok(txt.includes(nl()['agenda.status.login']), txt);
    assert.ok(txt.includes(nl()['agenda.status.orIcs']));
    assert.match(await status.locator('a[target="_blank"]').getAttribute('href'), /^https:\/\/webwsp\.aps\.kuleuven\.be\/sap\/bc\/ui2\/flp\?sap-language=NL#zr_0367-display$/);
    // portal 'upcoming' fixture: Filmtaal 1 today 09:00
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    assert.equal(h.rec.kuloket.ics, 0, 'no iCal link known yet');
    await screenshot(page, 'agenda-loggedout-light-desktop');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });

  it('uses a pasted iCal link (TimeEdit) as the source', async () => {
    await localSet(h, { 'kuloket:icsUrl': 'https://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=7&value=pasted' });
    await page.reload();
    await page.locator(`${ROOT} .ag-status`).filter({ hasText: 'iCal' }).waitFor({ timeout: 10000 });
    assert.ok(h.rec.kuloket.ics >= 1, 'feed downloaded');
    await page.locator(ev('Regie 1')).first().waitFor();
    await page.locator(ev('Regie 1')).first().click();
    const pop = page.locator(`${ROOT} dialog.ag-pop[open]`);
    await pop.waitFor();
    const txt = await pop.innerText();
    assert.ok(txt.includes('Docent B') && txt.includes(nl()['agenda.pop.source.ics']), txt);
    await page.keyboard.press('Escape');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});

describe('agenda — session expires after the iCal link was learned', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('remembers the iCal link while signed in and falls back to it later', async () => {
    await openAgenda(h);
    await page.locator(ev('Filmtaal 1')).first().waitFor({ timeout: 10000 });
    await waitFor(async () => (await localKeys(h)).includes('kuloket:icsUrl'), { timeout: 5000 });
    assert.ok(h.rec.kuloket.calls.some((c) => c.path === 'ZC_EP_ICAL_SRV/StudentSet'));
    h.rec.kuloket.loggedOut = true;
    await localRemove(h, (await localKeys(h)).filter((k) => k.startsWith('kuloket:lessons:') || k === 'kuloket:meta'));
    await page.reload();
    await page.locator(`${ROOT} .ag-status`).filter({ hasText: 'iCal' }).waitFor({ timeout: 10000 });
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    assert.ok(h.rec.kuloket.ics >= 1);
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});
