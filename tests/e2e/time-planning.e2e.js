'use strict';
// Bug bash — time, planning & export: exams as first-class items (filter, sheet, export, Overview), own deadlines
// (edit, delete with Undo), the deadline sheet at short viewports, KU Loket unreachable, the Agenda date in the URL,
// "Go to date" errors, Deadlines at 320 px.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { launch, waitFor, screenshot } = require('../helpers/launch');
const { S, strings, openPortal } = require('../helpers/app');

const ROOT = '#tplus-root';
const nl = () => strings('nl');
const DAY = 864e5;
const sr = (page, fn, arg) => page.evaluate(([src, a]) => new Function('sr', 'arg', `return (${src})(sr, arg);`)(document.querySelector('#tplus-root').shadowRoot, a), [fn.toString(), arg]);
const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const read = async (dl) => fs.readFileSync(await dl.path(), 'utf8');
const unfold = (s) => s.replace(/\r\n /g, '');
// own deadlines live under their own sync key 'custom' (settings.js)
const customOf = (h) => h.sw.evaluate(async () => { const v = await chrome.storage.sync.get('custom'); return Array.isArray(v.custom) ? v.custom : []; });
const dialog = (page) => page.locator(`${ROOT} dialog.tp-detail`);
async function sheetSettled(page) {
  await dialog(page).waitFor({ state: 'visible', timeout: 4000 });
  await dialog(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
}

describe('exams as first-class items, export, own deadlines (desktop)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('Overview shows upcoming exams only when within 14 days; Deadlines › Vak keeps that course’s exam (TP-101, TP-102)', async () => {
    await openPortal(h, 'deadlines');
    const exams = page.locator(`${ROOT} section[data-section="dl-g-exams"]`);
    await exams.locator('.va-exam', { hasText: 'Filmtaal 1' }).waitFor({ timeout: 10000 });
    assert.equal(await exams.locator('.va-exam').count(), 2);
    const opt = await page.locator(`${ROOT} select[name="dl-course"] option`, { hasText: 'Filmtaal 1' }).first().getAttribute('value');
    await page.locator(`${ROOT} select[name="dl-course"]`).selectOption(opt);
    await exams.waitFor();
    assert.equal(await exams.locator('.va-exam').count(), 1, 'only the exam of the chosen course');
    assert.ok((await exams.innerText()).includes('Filmtaal 1'));
    await page.locator(`${ROOT} select[name="dl-course"]`).selectOption('all');
    // the fixtures put the exams 30+ days out: not on the Overview card (≤ 14 days)
    await openPortal(h);
    assert.equal(await page.locator(`${S.section('deadlines')} .va-exam`).count(), 0);
  });

  it('an exam row opens an exam sheet with room, teacher and "Zet in agenda" ("Examen: …" + reminder) (TP-018, TP-105)', async () => {
    await openPortal(h, 'deadlines');
    await page.locator(`${ROOT} .va-exam`, { hasText: 'Filmgeschiedenis 1' }).locator('[data-action="va-exam-open"]').click();
    await sheetSettled(page);
    const txt = await dialog(page).innerText();
    assert.ok(txt.includes(`${nl()['agenda.exam']}: Filmgeschiedenis 1`), 'title says exam');
    assert.ok(txt.includes('A101') && txt.includes('Docent G'), 'room and teacher');
    assert.match(txt, /09:00–12:00/);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), dialog(page).locator('[data-detail-action="ics"]').click()]);
    assert.match(dl.suggestedFilename(), /^examen-filmgeschiedenis-1-\d{4}-\d\d-\d\d\.ics$/);
    const ics = unfold(await read(dl));
    assert.ok(ics.includes('SUMMARY:Examen: Filmgeschiedenis 1'));
    assert.ok(/BEGIN:VALARM[\s\S]*TRIGGER:-P1D/.test(ics), 'exam reminder (default 1 day)');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail').open);
  });

  it('"Zet in agenda" puts open deadlines and exams in one file, the same set as the Agenda (TP-104, TP-107)', async () => {
    await openPortal(h, 'deadlines');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator(`${ROOT} [data-shell="view-action"]`).first().click()]);
    assert.equal(dl.suggestedFilename(), 'toledo-deadlines.ics');
    const ics = unfold(await read(dl));
    const n = (ics.match(/BEGIN:VEVENT/g) || []).length;
    assert.ok(ics.includes('SUMMARY:Examen: Filmgeschiedenis 1') && ics.includes('SUMMARY:Examen: Filmtaal 1'), 'exams included');
    assert.ok(ics.includes('TRIGGER;RELATED=END:-P1D'), 'deadline reminder counts back from the due time');
    await openPortal(h, 'agenda');
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator(`${ROOT} [data-shell="view-action"]`).first().click()]);
    const ics2 = unfold(await read(dl2));
    assert.equal((ics2.match(/BEGIN:VEVENT/g) || []).length, n, 'Agenda exports the same set');
  });

  it('own deadline: add, edit it in the sheet, delete it and Undo (TP-207, TP-208)', async () => {
    await openPortal(h, 'deadlines');
    await page.locator(`${ROOT} [data-dl-add] summary`).click();
    const form = page.locator(`${ROOT} form[data-form="dl-add"]`);
    await form.locator('input[name="title"]').fill('Hoofdstuk 4 lezen');
    await form.locator('input[name="date"]').fill(ymd(Date.now() + 5 * DAY));
    await form.locator('input[name="time"]').fill('17:00');
    await form.locator('button[type="submit"]').click();
    const row = page.locator(`${ROOT} .va-dl`, { hasText: 'Hoofdstuk 4 lezen' });
    await row.waitFor();
    const key = await row.getAttribute('data-key');
    // edit in the sheet
    await row.locator('.va-dl-open').click();
    await sheetSettled(page);
    await dialog(page).locator('[data-detail-action="edit"]').click();
    const title = dialog(page).locator('input[name="title"]');
    await title.waitFor();
    assert.equal(await title.inputValue(), 'Hoofdstuk 4 lezen');
    assert.equal(await dialog(page).locator('input[name="time"]').inputValue(), '17:00');
    await title.fill('Hoofdstuk 4 en 5 lezen');
    await dialog(page).locator('input[name="time"]').fill('09:30');
    await dialog(page).locator('[data-detail-action="edit-save"]').click();
    await dialog(page).locator('[data-detail-action="edit"]').waitFor();
    assert.equal((await dialog(page).locator('#tp-detail-title').innerText()).trim(), 'Hoofdstuk 4 en 5 lezen');
    assert.match(await dialog(page).innerText(), /09:30/);
    assert.ok(await waitFor(async () => (await customOf(h)).some((c) => c.title === 'Hoofdstuk 4 en 5 lezen')), 'edit saved (settings writes are throttled)');
    let custom = await customOf(h);
    assert.equal(custom.length, 1);
    assert.equal(custom[0].title, 'Hoofdstuk 4 en 5 lezen');
    assert.equal(new Date(custom[0].due).getHours(), 9);
    // delete from the sheet → toast with Undo
    await dialog(page).locator('[data-detail-action="remove"]').click();
    const undo = page.locator(`${ROOT} .tp-toast.has-action .tp-toast-btn`);
    await undo.waitFor({ timeout: 4000 });
    assert.equal((await undo.innerText()).trim(), nl()['common.undo']);
    assert.ok(await waitFor(async () => (await customOf(h)).length === 0), 'removed');
    await page.waitForFunction(() => ![...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.va-dl')].some((r) => r.textContent.includes('Hoofdstuk 4 en 5')));
    await undo.click();
    await page.locator(`${ROOT} .va-dl`, { hasText: 'Hoofdstuk 4 en 5 lezen' }).waitFor({ timeout: 4000 });
    assert.ok(await waitFor(async () => (await customOf(h)).length === 1), 'restored in storage');
    custom = await customOf(h);
    assert.equal(custom.length, 1, 'restored');
    assert.equal(await page.locator(`${ROOT} .va-dl`, { hasText: 'Hoofdstuk 4 en 5 lezen' }).getAttribute('data-key'), key, 'same key (done marks and calendar UID survive)');
    // the row's X offers Undo too
    await page.locator(`${ROOT} .va-dl`, { hasText: 'Hoofdstuk 4 en 5 lezen' }).locator('[data-action="dl-remove"]').click();
    await page.locator(`${ROOT} .tp-toast.has-action`).last().waitFor();
    assert.ok(await waitFor(async () => (await customOf(h)).length === 0));
    assert.deepEqual(h.errors, []);
  });
});

describe('deadline sheet at short viewports (TP-016)', () => {
  for (const vp of [{ width: 910, height: 512 }, { width: 640, height: 360 }]) {
    it(`${vp.width}×${vp.height}: the sheet body scrolls; "Markeer als klaar" and "Zet in agenda" are reachable`, async () => {
      const h = await launch({ viewport: vp });
      try {
        const page = h.page;
        await openPortal(h, 'deadlines');
        await page.locator(`${ROOT} .va-dl .va-dl-open`).first().click();
        await sheetSettled(page);
        const m = await sr(page, (r) => {
          const body = r.querySelector('.tp-detail-body');
          const groups = [...body.querySelectorAll(':scope > .tp-group')].map((g) => g.scrollHeight - g.clientHeight);
          return { scroll: body.scrollHeight - body.clientHeight, clipped: Math.max(...groups) };
        });
        assert.ok(m.clipped <= 1, `no group is squeezed (${m.clipped}px clipped)`);
        assert.ok(m.scroll > 0, 'the body scrolls');
        await page.mouse.move(vp.width / 2, vp.height - 40);
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(250);
        for (const a of ['done', 'ics']) {
          const btn = dialog(page).locator(`[data-detail-action="${a}"]`);
          await btn.scrollIntoViewIfNeeded();
          const hit = await btn.evaluate((el) => {
            const b = el.getBoundingClientRect();
            const top = el.getRootNode().elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!top && (top === el || el.contains(top));
          });
          assert.ok(hit, `"${a}" can be clicked (not covered or clipped)`);
        }
        await screenshot(page, `deadline-sheet-${vp.width}x${vp.height}`);
      } finally { await h.close(); }
    });
  }
});

describe('KU Loket unreachable (TP-137)', () => {
  let h; let page;
  before(async () => {
    h = await launch();
    page = h.page;
    await h.ctx.route(/webwsp\.aps\.kuleuven\.be|cloud\.timeedit\.net/, (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'down' }));
  });
  after(async () => { await h?.close(); });

  it('says KU Loket can’t be reached (not "no exams"/"no classes") and "Opnieuw" asks again', async () => {
    await openPortal(h, 'kuloket');
    const exams = page.locator(`${ROOT} section[data-section="kl-exams"]`);
    await exams.locator('.kl-error').waitFor({ timeout: 10000 });
    const txt = await page.locator(`${ROOT} .kl-view`).innerText();
    assert.ok(txt.includes(nl()['kuloket.exams.error']));
    assert.ok(txt.includes(nl()['kuloket.today.error']));
    assert.ok(!txt.includes(nl()['kuloket.exams.none']), 'no false "no exams"');
    assert.ok(!txt.includes(nl()['kuloket.today.none']), 'no false "no classes"');
    await screenshot(page, 'kuloket-unreachable');
    const before = h.rec.requests.filter((r) => /webwsp/.test(r.url)).length;
    await h.ctx.unroute(/webwsp\.aps\.kuleuven\.be|cloud\.timeedit\.net/);
    await exams.locator('[data-action="kl-retry"]').click();
    await exams.locator('.va-exam', { hasText: 'Filmgeschiedenis 1' }).waitFor({ timeout: 10000 });
    assert.ok(h.rec.requests.filter((r) => /webwsp/.test(r.url)).length > before, 'asked KU Loket again');
  });
});

describe('agenda: date in the URL, Go to date, weekend in a work week', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });
  const range = () => page.locator(`${ROOT} .ag-range`).innerText();

  it('agenda&id=YYYY-MM-DD opens that week; a step is a history entry; Back returns (TP-200)', async () => {
    const target = Date.now() + 21 * DAY;
    await openPortal(h, 'agenda', ymd(target));
    await page.locator(`${ROOT} .ag-view .ag-timegrid`).waitFor();
    const first = await range();
    const weekDays = await sr(page, (r) => [...r.querySelectorAll('.ag-col')].map((c) => Number(c.dataset.day)));
    const t0 = new Date(target); t0.setHours(0, 0, 0, 0);
    assert.ok(weekDays.includes(t0.getTime()), 'the week of the linked date is shown');
    await page.locator(`${ROOT} [data-action="ag-next"]`).click();
    await page.waitForFunction((want) => location.hash.includes('id=' + want), ymd(t0.getTime() + 7 * DAY + 2 * 36e5));
    const second = await range();
    assert.notEqual(second, first);
    await page.goBack();
    await page.waitForFunction((want) => location.hash.includes('id=' + want), ymd(target));
    await page.waitForFunction((t) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-range')?.innerText === t, first, { timeout: 5000 });
    assert.equal(await page.evaluate(() => location.hash.startsWith('#/home?tplus=agenda')), true, 'Back stays in Toledo+');
  });

  it('Go to date: an impossible or far date says so inline (TP-026, TP-080)', async () => {
    await page.keyboard.press('g');
    const input = page.locator(`${ROOT} #ag-goto-in`);
    await input.waitFor();
    await input.evaluate((el) => { el.value = ''; });
    await page.locator(`${ROOT} form[data-form="ag-goto"] button[type="submit"]`).click();
    const err = page.locator(`${ROOT} .ag-goto-err`);
    await err.waitFor();
    assert.equal((await err.innerText()).trim(), nl()['agenda.goto.invalid']);
    await input.fill('2031-10-01');
    await page.locator(`${ROOT} form[data-form="ag-goto"] button[type="submit"]`).click();
    await page.waitForFunction((t) => document.querySelector('#tplus-root').shadowRoot.querySelector('.ag-goto-err')?.textContent === t, nl()['agenda.goto.range']);
    await page.keyboard.press('Escape');
  });

  it('chips have a tooltip, a deadline chip says "tot hh:mm" (TP-019, TP-022)', async () => {
    await openPortal(h, 'agenda');
    await page.locator(`${ROOT} .ag-view .ag-timegrid`).waitFor();
    const chips = await sr(page, (r) => [...r.querySelectorAll('.ag-chip-deadline')].map((c) => ({ title: c.title, t: c.querySelector('.ag-chip-t')?.textContent || '' })));
    if (chips.length) {
      for (const c of chips) {
        assert.ok(c.title.startsWith(nl()['agenda.deadline']), c.title);
        if (c.t) assert.match(c.t, /^tot \d\d:\d\d$/);
      }
    }
    assert.deepEqual(h.errors, []);
  });
});

describe('Deadlines at 320 px (TP-014)', () => {
  it('no horizontal page scroll', async () => {
    const h = await launch({ viewport: { width: 320, height: 640 } });
    try {
      await openPortal(h, 'deadlines');
      await h.page.locator(`${ROOT} select[name="dl-course"]`).waitFor();
      const sw = await h.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 321, `scrollWidth ${sw}`);
      await screenshot(h.page, 'deadlines-320');
    } finally { await h.close(); }
  });
});

describe('a device on another time zone (TP-217, TP-221)', () => {
  it('Deadlines, the sheet, the add form and the Agenda say which clock the times are on', async () => {
    const h = await launch({ timezoneId: 'Asia/Tokyo' });
    try {
      const page = h.page;
      await openPortal(h, 'deadlines');
      const note = page.locator(`${ROOT} .va-zone-note`);
      await note.waitFor();
      assert.match(await note.innerText(), /GMT\+9/);
      await page.locator(`${ROOT} [data-dl-add] summary`).click();
      assert.match(await page.locator(`${ROOT} #va-zone-note`).innerText(), /GMT\+9/, 'the add form names the zone');
      await page.locator(`${ROOT} .va-dl .va-dl-open`).first().click();
      await sheetSettled(page);
      assert.match(await dialog(page).innerText(), /\(GMT\+9\)/, 'the due time carries the zone');
      await page.keyboard.press('Escape');
      await openPortal(h, 'agenda');
      await page.locator(`${ROOT} .ag-view .va-zone-note`).waitFor();
      assert.deepEqual(h.errors, []);
    } finally { await h.close(); }
  });

  it('on Belgian time there is no zone note', async () => {
    const h = await launch();
    try {
      await openPortal(h, 'deadlines');
      await h.page.locator(`${ROOT} select[name="dl-course"]`).waitFor();
      assert.equal(await h.page.locator(`${ROOT} .va-zone-note`).count(), 0);
    } finally { await h.close(); }
  });
});
