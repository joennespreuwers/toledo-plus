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
  // (the shared mock answers the anonymous ping/update check, so nothing needs to be ignored here)
  assert.deepEqual(h.rec.foreign, [], `no requests to unexpected origins: ${JSON.stringify(h.rec.foreign)}`);
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
    await page.locator(`${ROOT} .ag-status.is-ics`).waitFor({ timeout: 10000 });
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

// ---------------------------------------------------------------- v1.4: Google-Calendar-like agenda
const shadowCount = (page, sel) => inShadow(page, (sr, s) => sr.querySelectorAll(s).length, sel);
const activeInfo = (page) => inShadow(page, (sr) => {
  const a = sr.activeElement;
  return a ? { cls: a.className || '', key: a.dataset ? a.dataset.key || '' : '', title: a.querySelector?.('.ag-ev-title, .ag-chip-x')?.textContent || a.textContent.trim().slice(0, 40) } : null;
});
const modeIs = (page, m) => page.waitForFunction((v) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-view')?.dataset.mode === v, m, { timeout: 5000 });
const rangeChanged = (page, r) => page.waitForFunction((x) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range')?.innerText !== x, r, { timeout: 5000 });
const stateUi = (h) => h.sw.evaluate(async () => (await chrome.storage.local.get('state:ui'))['state:ui'] || {});
async function focusInView(page) { await page.locator(`${ROOT} [data-action="ag-today"]`).focus(); }
async function noHScroll(page, label) {
  const { sw, w } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  assert.ok(sw <= w + 1, `${label}: no horizontal page scroll (scrollWidth ${sw} > ${w})`);
}

describe('agenda — views, keyboard, layout, filters (desktop 1440)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('week grid: scrollable 00–24 inside its own container, scrolled to the morning, deadlines as chips + markers', async () => {
    await openAgenda(h);
    await page.locator(ev('Filmtaal 1')).first().waitFor({ timeout: 10000 });
    assert.equal(await shadowCount(page, '.ag-hour'), 24, 'all 24 hours');
    const sc = await inShadow(page, (sr) => {
      const s = sr.querySelector('.ag-scroll'); const r = s.getBoundingClientRect();
      const inView = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); return b.top >= r.top - 1 && b.top <= r.bottom; };
      const first = [...sr.querySelectorAll('.ag-col.is-today .ag-ev')].sort((a, b) => a.offsetTop - b.offsetTop)[0];
      return { top: s.scrollTop, h: s.clientHeight, sh: s.scrollHeight, hh: sr.querySelector('.ag-hour').offsetHeight, first: inView(first), now: inView(sr.querySelector('.ag-now')) };
    });
    assert.ok(sc.sh > sc.h + 100, 'the grid scrolls inside its container');
    assert.ok(sc.h >= 11 * sc.hh - 2 && sc.h <= 24 * sc.hh + 2, `at least 11 hours visible, more on a tall window (TP-021) (${sc.h}px)`);
    const nowH = new Date().getHours();
    if (nowH >= 7 && nowH <= 18) assert.ok(Math.abs(sc.top / sc.hh - 8) < 0.1, `scrolled to 08:00, 1 h before the first lesson (${sc.top / sc.hh} h)`);
    assert.ok(sc.now, 'the current time is in view');
    assert.ok(sc.first || nowH > 18, 'the first lesson is in view (unless it is evening)');
    const dl = await shadowCount(page, '.ag-allday .ag-chip-deadline');
    if (dl) assert.ok(await shadowCount(page, '.ag-dlmark') >= 1, 'deadline marker at its time');
    const aria = await page.locator(ev('Filmtaal 1')).first().getAttribute('aria-label');
    assert.match(aria, /Filmtaal 1/); assert.match(aria, /09:00/); assert.match(aria, /11:00/); assert.match(aria, /C207/);
    await screenshot(page, 'agenda-week-light-1440');
  });

  it('keyboard: d/w/m/a/l switch views, j/k/n/p/←/→ page, t = today; typing in search is left alone', async () => {
    await focusInView(page);
    const r0 = await rangeText(page);
    await page.keyboard.press('m'); await modeIs(page, 'month');
    assert.equal(await shadowCount(page, '.ag-mcell'), 42);
    await page.keyboard.press('d'); await modeIs(page, 'day');
    await page.keyboard.press('a'); await modeIs(page, 'list');
    await page.keyboard.press('w'); await modeIs(page, 'week');
    await page.keyboard.press('l'); await modeIs(page, 'list');
    await page.keyboard.press('w'); await modeIs(page, 'week');
    await page.keyboard.press('j'); await rangeChanged(page, r0);
    const r1 = await rangeText(page);
    await page.keyboard.press('n'); await rangeChanged(page, r1);
    await page.keyboard.press('p'); await page.waitForFunction((x) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText === x, r1);
    await page.keyboard.press('k'); await page.waitForFunction((x) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText === x, r0);
    await page.keyboard.press('ArrowRight'); await rangeChanged(page, r0);
    await page.keyboard.press('t'); await page.waitForFunction((x) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText === x, r0);
    // remembered per device
    assert.ok(await waitFor(async () => (await stateUi(h)).agenda?.mode === 'week'));
    // typing in the toolbar search never triggers shortcuts
    await page.locator(S.search).fill('');
    await page.locator(S.search).type('mdw');
    await page.waitForTimeout(200);
    assert.equal(await page.locator(`${ROOT} .ag-view`).getAttribute('data-mode'), 'week');
    await page.locator(S.search).fill('');
  });

  it('?, g and Esc: shortcut sheet, go-to-date popover; the shell keeps ⌘K', async () => {
    await focusInView(page);
    await page.keyboard.press('Shift+Slash');
    const sheet = page.locator(`${ROOT} dialog.ag-pop-keys[open]`);
    await sheet.waitFor();
    for (const k of ['agenda.keys.today', 'agenda.keys.goto', 'agenda.keys.move', 'agenda.keys.palette']) assert.ok((await sheet.innerText()).includes(nl()[k]), k);
    await screenshot(page, 'agenda-shortcuts-light-1440');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.equal(await page.locator(`${ROOT} dialog.ag-pop[open]`).count(), 0);
    // g → date popover → jump
    await focusInView(page);
    await page.keyboard.press('g');
    const go = page.locator(`${ROOT} dialog.ag-pop-goto[open]`);
    await go.waitFor();
    await go.locator('input[type="date"]').fill('2027-03-10');
    await go.locator('input[type="date"]').press('Enter');
    await go.waitFor({ state: 'detached' });
    await page.waitForFunction(() => /mrt.*2027/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range').innerText));
    assert.match(await rangeText(page), /8 – 14 mrt 2027/);
    await page.keyboard.press('t');
    // ⌘K / Ctrl+K and / are the shell's
    await focusInView(page);
    await page.keyboard.press('Control+k');
    await page.locator(`${ROOT} dialog.tp-palette[open]`).waitFor({ timeout: 3000 });
    await page.keyboard.press('Escape');
    await page.locator(`${ROOT} dialog.tp-palette[open]`).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    assert.equal(await page.locator(`${ROOT} .ag-view`).getAttribute('data-mode'), 'week');
  });

  it('arrow keys move between events of the grid; Enter opens', async () => {
    await page.locator(ev('Filmtaal 1')).first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal((await activeInfo(page)).title, 'Regie 1');
    await page.keyboard.press('ArrowDown');
    assert.equal((await activeInfo(page)).title, 'Geluid 1');
    await page.keyboard.press('ArrowUp');
    assert.equal((await activeInfo(page)).title, 'Regie 1');
    const r0 = await rangeText(page);
    if (await page.locator(ev('Storytelling')).count()) {
      await page.keyboard.press('ArrowRight');
      assert.match((await activeInfo(page)).title, /Storytelling|Opdracht/, 'next day');
    }
    assert.equal(await rangeText(page), r0, 'arrows on an event do not page');
    await page.keyboard.press('Enter');
    await page.locator(`${ROOT} dialog.ag-pop[open], ${ROOT} dialog.tp-detail[open]`).first().waitFor();
    await page.keyboard.press('Escape');
  });

  it('overlapping lessons: Google-style columns that widen when free (busy day)', async () => {
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
    await page.locator(`${ROOT} [data-action="ag-next"]`).click();
    await page.locator(`${ROOT} [data-action="ag-next"]`).click();
    await page.locator(ev('Productie 1')).first().waitFor({ timeout: 8000 });
    const box = async (t) => page.locator(ev(t)).first().boundingBox();
    const [p, m, e, s, b, f] = await Promise.all(['Productie 1', 'Montage Technieken 1', 'Engels voor film', 'Scenario 2', 'Beeldtechnologie 1', 'Filmgeschiedenis 1'].map(box));
    assert.ok(p.x < m.x && m.x < e.x, 'three columns side by side');
    assert.ok(Math.abs(s.x - m.x) < 2, 'Scenario reuses column 2');
    assert.ok(Math.abs(p.width - m.width) < 3 && Math.abs(m.width - e.width) < 3, 'equal widths');
    assert.ok(Math.abs(b.width - (2 * m.width + 3)) < 5, `Beeldtechnologie widens over the free third column (${b.width} vs ${m.width})`);
    assert.ok(f.width > 2.5 * m.width, 'a lesson without overlap uses the full column');
    for (const [a, c] of [[p, m], [m, e], [p, b]]) assert.ok(a.x + a.width <= c.x + 1 || c.y >= a.y + a.height - 1 || a.y >= c.y + c.height - 1, 'no overlap');
    await screenshot(page, 'agenda-week-busy-light-1440');
  });

  it('month: 6 weeks, ≤ 3 per day, "+n meer" opens the day, weekend dimmed, optional week numbers', async () => {
    await page.locator(`${ROOT} .tp-seg:has(input[value="month"])`).click();
    await page.locator(`${ROOT} .ag-month`).waitFor();
    let more = page.locator(`${ROOT} .ag-mcell:has(.ag-more)`);
    if (!(await more.count())) { await page.locator(`${ROOT} [data-action="ag-next"]`).click(); await page.waitForTimeout(400); more = page.locator(`${ROOT} .ag-mcell:has(.ag-more)`); }
    await more.first().waitFor({ timeout: 8000 });
    const cell = more.first();
    assert.ok(await cell.locator('.ag-chip').count() <= 3);
    assert.equal(await cell.locator('.ag-more').innerText(), '+4 meer');
    assert.equal(await shadowCount(page, '.ag-mcell.is-weekend'), 12);
    // week numbers (side panel, ≥ 1100)
    await page.locator(`${ROOT} .ag-side input[name="ag-opt"][value="weekNums"]`).check();
    await page.locator(`${ROOT} .ag-month.has-wk`).waitFor();
    assert.equal(await shadowCount(page, '.ag-mgrid .ag-mwk'), 6);
    await page.locator(`${ROOT} .ag-side input[name="ag-opt"][value="weekNums"]`).uncheck();
    await cell.locator('.ag-more').click();
    await modeIs(page, 'day');
    assert.equal(await shadowCount(page, '.ag-ev'), 6, 'all six lessons of that day');
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    await modeIs(page, 'week');
  });

  it('detail popover: course, time, place, teachers, group, Open vak, single-event .ics', async () => {
    await page.locator(ev('Filmtaal 1')).first().click();
    const pop = page.locator(`${ROOT} dialog.ag-pop-ev[open]`);
    await pop.waitFor();
    const txt = await pop.innerText();
    for (const s of ['Hoorcollege', 'X10265', '09:00–11:00', 'Voorbeeldstraat 1', 'Leuven', 'Docent A', 'Groep A1']) assert.ok(txt.includes(s), `popover shows ${s}`);
    assert.equal(await pop.getAttribute('aria-labelledby'), 'ag-pop-title');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), pop.locator('[data-action="ag-ics-one"]').click()]);
    assert.match(dl.suggestedFilename(), /^filmtaal-1-\d{4}-\d\d-\d\d\.ics$/);
    const body = require('fs').readFileSync(await dl.path(), 'utf8');
    assert.match(body, /BEGIN:VEVENT/); assert.match(body, /SUMMARY:Filmtaal 1/); assert.match(body, /LOCATION:C207/);
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
  });

  it('a deadline opens the shared deadline sheet', async () => {
    const chip = page.locator(`${ROOT} .ag-allday .ag-chip-deadline`).first();
    if (!(await chip.count())) return;
    const title = await chip.locator('.ag-chip-x').innerText();
    await chip.click();
    const sheet = page.locator(`${ROOT} dialog.tp-detail[open]`);
    await sheet.waitFor();
    assert.equal(await sheet.locator('#tp-detail-title').innerText(), title);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
  });

  it('filters: type toggles and per-course, remembered; "Toon alles" resets', async () => {
    const side = page.locator(`${ROOT} .ag-side`);
    await side.locator('input[name="ag-show"][value="lesson"]').uncheck();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-ev-lesson').length === 0);
    assert.ok(await page.locator(`${ROOT} .ag-filter-btn.is-active`).count() === 1);
    await side.locator('input[name="ag-show"][value="lesson"]').check();
    await page.locator(ev('Regie 1')).first().waitFor();
    const regie = side.locator('label.ag-copt', { hasText: 'Regie 1' }).locator('input');
    await regie.uncheck();
    await page.waitForFunction(() => ![...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-ev-title')].some((e) => e.textContent === 'Regie 1'));
    assert.ok(await page.locator(ev('Filmtaal 1')).count() >= 1, 'other courses stay');
    assert.ok(await waitFor(async () => ((await stateUi(h)).agenda?.hidden || []).length === 1), 'hidden course remembered');
    await screenshot(page, 'agenda-filtered-light-1440');
    await side.locator('[data-action="ag-reset"]').click();
    await page.locator(ev('Regie 1')).first().waitFor();
    assert.ok(await waitFor(async () => ((await stateUi(h)).agenda?.hidden || []).length === 0));
  });

  it('mini month in the side column jumps to a date', async () => {
    const r0 = await rangeText(page);
    await page.locator(`${ROOT} .ag-mini [data-action="ag-mini-next"]`).click();
    const d = page.locator(`${ROOT} .ag-mini-d:not(.is-out)`).nth(14);
    const label = await d.getAttribute('aria-label');
    await d.click();
    await rangeChanged(page, r0);
    assert.equal(await page.locator(`${ROOT} .ag-mini-d.is-sel`).getAttribute('aria-label'), label);
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
  });

  it('work week shows Mon–Fri; the view choice survives a reload', async () => {
    await page.locator(`${ROOT} .ag-side input[name="ag-opt"][value="workweek"]`).check();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-col').length === 5);
    await page.locator(`${ROOT} .tp-seg:has(input[value="month"])`).click();
    await modeIs(page, 'month');
    assert.ok(await waitFor(async () => (await stateUi(h)).agenda?.mode === 'month' && (await stateUi(h)).agenda?.workweek === true));
    await page.reload();
    await page.locator(`${ROOT} .ag-month`).waitFor({ timeout: 10000 });
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-col').length === 5);
    await page.locator(`${ROOT} .ag-side input[name="ag-opt"][value="workweek"]`).uncheck();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-col').length === 7);
  });

  it('below 1100 px the filters live in a popover', async () => {
    await page.setViewportSize({ width: 1000, height: 800 });
    assert.equal(await page.locator(`${ROOT} .ag-side`).isVisible(), false);
    await page.locator(`${ROOT} [data-action="ag-filter"]`).click();
    const pop = page.locator(`${ROOT} dialog.ag-pop-filter[open]`);
    await pop.waitFor();
    await pop.locator('input[name="ag-show"][value="deadline"]').uncheck();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.ag-main .ag-chip-deadline').length === 0);
    assert.equal(await pop.isVisible(), true, 'popover stays open while filtering');
    await screenshot(page, 'agenda-filter-popover-light-1000');
    await pop.locator('input[name="ag-show"][value="deadline"]').check();
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
    assert.ok(await waitFor(async () => (await inShadow(page, (sr) => sr.activeElement?.dataset.action)) === 'ag-filter', { timeout: 1500 }), 'focus returns to the filter button');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  it('no horizontal page scroll from 320 to 2560 px in every view', async () => {
    for (const m of ['week', 'day', 'month', 'list']) {
      await page.locator(`${ROOT} .tp-seg:has(input[value="${m}"])`).click();
      await modeIs(page, m);
      for (const w of [320, 390, 700, 1100, 2560]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(60);
        await noHScroll(page, `${m} @ ${w}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});

describe('agenda — dark month + phone day view', () => {
  let h; let page;
  before(async () => { h = await launch({ colorScheme: 'dark' }); page = h.page; });
  after(async () => { await h?.close(); });

  it('month in dark mode', async () => {
    await openAgenda(h);
    await page.locator(ev('Filmtaal 1')).first().waitFor({ timeout: 10000 });
    await page.locator(`${ROOT} .tp-seg:has(input[value="month"])`).click();
    await page.locator(`${ROOT} .ag-mcell.is-today .ag-chip`).first().waitFor();
    await screenshot(page, 'agenda-month-dark-1440');
    await page.locator(`${ROOT} .tp-seg:has(input[value="week"])`).click();
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    await screenshot(page, 'agenda-week-dark-1440');
  });

  it('phone: list with day chips, day view, swipe to page', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator(`${ROOT} .tp-seg:has(input[value="list"])`).click();
    await modeIs(page, 'list');
    assert.equal(await shadowCount(page, '.ag-strip-day'), 7);
    const chip = page.locator(`${ROOT} .ag-strip-day:not(.is-today)`).last();
    const day = await chip.getAttribute('data-day');
    await chip.click();
    assert.equal(await inShadow(page, (sr) => sr.activeElement?.id), `ag-lh-${day}`, 'jumps to that day');
    await page.locator(`${ROOT} .tp-seg:has(input[value="day"])`).click();
    await modeIs(page, 'day');
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
    await page.locator(ev('Filmtaal 1')).first().waitFor();
    assert.equal(await shadowCount(page, '.ag-col'), 1);
    const meta = await page.locator(ev('Filmtaal 1')).first().innerText();
    assert.match(meta, /C207/, 'room visible in the phone day view');
    await noHScroll(page, 'day @ 390');
    await screenshot(page, 'agenda-day-390');
    const r0 = await rangeText(page);
    const cal = page.locator(`${ROOT} .ag-scroll`);
    const b = await cal.boundingBox();
    const y = b.y + 80;
    await cal.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, clientX: b.x + b.width - 30, clientY: y, bubbles: true });
    await cal.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, clientX: b.x + 30, clientY: y + 6, bubbles: true });
    await rangeChanged(page, r0);
    assert.ok(await shadowCount(page, '.ag-col'), 'still day view after the swipe');
    await page.locator(`${ROOT} [data-action="ag-today"]`).click();
    await page.locator(ev('Filmtaal 1')).first().click();
    await page.locator(`${ROOT} dialog.ag-pop.is-sheet[open]`).waitFor();
    await screenshot(page, 'agenda-day-sheet-390');
    await page.keyboard.press('Escape');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator(`${ROOT} .tp-seg:has(input[value="list"])`).click();
    await screenshot(page, 'agenda-list-dark-390');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});

describe('agenda — signed out later: iCal feed keeps the details', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('falls back to the feed automatically, enriched from the cached KU Loket week, and says so subtly', async () => {
    await openAgenda(h);
    await page.locator(ev('Filmtaal 1')).first().waitFor({ timeout: 10000 });
    await waitFor(async () => (await localKeys(h)).includes('kuloket:icsUrl'), { timeout: 5000 });
    // the SSO session expires; cached weeks become stale
    h.rec.kuloket.loggedOut = true;
    await h.sw.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      const patch = {};
      for (const [k, v] of Object.entries(all)) if (k.startsWith('kuloket:lessons:')) patch[k] = { ...v, t: 1 };
      await chrome.storage.local.set(patch);
    });
    await page.reload();
    const st = page.locator(`${ROOT} .ag-status.is-ics`);
    await st.waitFor({ timeout: 10000 });
    assert.ok((await st.innerText()).includes(nl()['agenda.status.icsLogin']));
    assert.match(await st.locator('a').getAttribute('href'), /^https:\/\/webwsp\.aps\.kuleuven\.be\//);
    assert.equal(await page.locator(`${ROOT} .ag-status.is-warn`).count(), 0, 'no alarm: the timetable works');
    await waitFor(async () => h.rec.kuloket.ics >= 1, { timeout: 5000 });
    await page.locator(ev('Filmtaal 1')).first().click();
    const pop = page.locator(`${ROOT} dialog.ag-pop[open]`);
    await pop.waitFor();
    const txt = await pop.innerText();
    assert.ok(txt.includes('Voorbeeldstraat 1') && txt.includes('Groep A1'), 'details kept from KU Loket');
    assert.ok(txt.includes(nl()['agenda.pop.source.icsKuloket']), txt);
    await screenshot(page, 'agenda-ics-fallback-light-1440');
    await page.keyboard.press('Escape');
    assertClean(h);
    assert.deepEqual(h.errors, []);
  });
});
