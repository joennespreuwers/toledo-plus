'use strict';
// One search matcher everywhere (bug bash, Search & ⌘K): the toolbar filter re-evaluates sections an earlier query hid
// (TP-168), accents / word order / course codes / dates / one typo, highlighted matches, and the ⌘K palette's
// KU Loket apps, settings sections, "+N more", prefill from the toolbar, closing on Back and a clipped echo.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForQuiet, screenshot, inShadow } = require('../helpers/launch');
const { S, strings, openPortal } = require('../helpers/app');

const nl = strings('nl');
const PAL = '#tplus-root dialog.tp-palette';
const INPUT = `${PAL} input.tp-pal-input`;

/** Visible deadline rows (titles) and the no-results state on the Deadlines view. */
const dlState = (page) => inShadow(page, (sr) => {
  const vis = (el) => !el.closest('[hidden]');
  const rows = [...sr.querySelectorAll('.va-deadlines .va-dl')].filter(vis);
  const nr = sr.querySelector('.va-deadlines .va-noresults');
  return {
    rows: rows.map((r) => r.querySelector('.tp-row-title').textContent),
    marks: [...sr.querySelectorAll('.va-deadlines mark.tp-hl')].filter(vis).map((m) => m.textContent),
    noResults: !!nr && !nr.hidden,
    noResultsText: nr ? nr.textContent : '',
  };
});
async function search(page, q) {
  await page.locator(S.search).fill(q);
  await page.waitForTimeout(350);
}

const palState = (page) => inShadow(page, (sr) => {
  const d = sr.querySelector('dialog.tp-palette');
  return {
    open: !!(d && d.open),
    value: d ? d.querySelector('input').value : '',
    groups: d ? [...d.querySelectorAll('.tp-pal-head')].map((h) => h.textContent) : [],
    options: d ? [...d.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.tp-pal-name').textContent) : [],
    subs: d ? [...d.querySelectorAll('[role="option"]')].map((o) => (o.querySelector('.tp-pal-sub') || {}).textContent || '') : [],
    marks: d ? [...d.querySelectorAll('.tp-pal-name mark.tp-hl')].map((m) => m.textContent) : [],
    note: d ? (d.querySelector('.tp-pal-note') || {}).textContent || '' : '',
    empty: d ? (d.querySelector('.tp-pal-empty') || {}).textContent || '' : '',
  };
});
async function openPalette(page) {
  await page.keyboard.press('Control+k');
  await page.locator(PAL).waitFor({ state: 'visible', timeout: 3000 });
}
async function type(page, q) {
  await page.locator(INPUT).fill(q);
  await page.waitForTimeout(250);
}
async function until(page, pred, what, timeout = 8000) {
  const t0 = Date.now(); let st;
  while (Date.now() - t0 < timeout) { st = await palState(page); if (pred(st)) return st; await page.waitForTimeout(100); }
  assert.fail(`${what}: ${JSON.stringify(st)}`);
}

describe('toolbar search: one matcher (Deadlines)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('TP-168: a later query finds rows in a section an earlier query hid', async () => {
    await openPortal(h, 'deadlines');
    await waitForQuiet(page);
    await search(page, 'montage');             // only the overdue one: every week section is hidden
    assert.deepEqual((await dlState(page)).rows, ['Montage-oefening 1']);
    await search(page, 'regieplan');           // in a week section the previous query hid
    let st = await dlState(page);
    assert.deepEqual(st.rows, ['Regieplan scène 1'], 'the row shows again');
    assert.equal(st.noResults, false);
    await search(page, 'zzqq');
    assert.equal((await dlState(page)).noResults, true, 'no results');
    await search(page, 'productiedossier');
    st = await dlState(page);
    assert.deepEqual(st.rows, ['Productiedossier'], 'zzqq → productiedossier');
    await search(page, 'montage');             // overdue (-2 d) again, after a week-section query
    assert.deepEqual((await dlState(page)).rows, ['Montage-oefening 1']);
    await search(page, '');
    assert.ok((await dlState(page)).rows.length >= 8, 'clearing restores everything');
  });

  it('accents, word order, course code, dates, one typo; the match is highlighted', async () => {
    await search(page, 'scene regieplan');
    let st = await dlState(page);
    assert.deepEqual(st.rows, ['Regieplan scène 1'], 'any order + accent-insensitive');
    assert.deepEqual(st.marks.map((m) => m.toLowerCase()).sort(), ['regieplan', 'scène'], `highlighted: ${st.marks}`);
    await screenshot(page, 'search-highlight-light-desktop');
    await search(page, 'x10300');
    assert.deepEqual((await dlState(page)).rows, ['Shotlist korte film', 'Regieplan scène 1'], 'course code (Regie 1 [X10300])');
    await search(page, 'X 10300 regieplan');
    assert.deepEqual((await dlState(page)).rows, ['Regieplan scène 1'], 'code with a space + a title word');
    await search(page, 'morgen');
    assert.deepEqual((await dlState(page)).rows, ["Opdracht 'Onder de huid'"], '"morgen" = due tomorrow');
    const tomorrow = new Date(Date.now() + 864e5);
    await search(page, new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short' }).format(tomorrow));
    assert.deepEqual((await dlState(page)).rows, ["Opdracht 'Onder de huid'"], 'day + month as shown in the rows');
    await search(page, 'productiedosier');
    assert.deepEqual((await dlState(page)).rows, ['Productiedossier'], 'one typo');
    await search(page, 'ZZQQ');
    st = await dlState(page);
    assert.ok(st.noResultsText.includes('ZZQQ'), `the query is echoed as typed: ${st.noResultsText}`);
    await search(page, '');
  });

  it('the palette starts with the toolbar text (TP-174) and closes on Back (TP-033)', async () => {
    await search(page, 'regieplan');
    await page.locator(S.search).focus();
    await openPalette(page);
    const st = await palState(page);
    assert.equal(st.value, 'regieplan');
    assert.ok(st.options.includes('Regieplan scène 1'), `deadline in the palette: ${st.options}`);
    await page.keyboard.press('Escape');
    await search(page, '');
    await openPortal(h, 'announcements');
    await openPalette(page);
    await page.goBack();
    await page.waitForTimeout(400);
    assert.equal((await palState(page)).open, false, 'Back closes the palette');
  });

  it('no console errors', () => { assert.deepEqual(h.errors, []); });
});

describe('⌘K palette: KU Loket apps, settings sections, "+N more", typos, long queries', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('finds KU Loket apps (TP-031) and settings by their labels in any language (TP-173, TP-032)', async () => {
    await openPortal(h);
    await openPalette(page);
    await type(page, 'MOBIB');
    let st = await palState(page);
    assert.ok(st.groups.includes(nl['nav.kuloket']) && st.options.includes('MOBIB'), `KU Loket: ${JSON.stringify(st)}`);
    await type(page, 'isp');
    assert.ok((await palState(page)).options.some((o) => /ISP/.test(o)), 'ISP');
    await type(page, 'exemption');
    assert.ok((await palState(page)).options.includes('Vrijstellingen'), 'English description finds the Dutch app');
    await type(page, 'instellingen');
    assert.ok((await palState(page)).options.includes(nl['nav.settings']));
    await type(page, 'ical');
    st = await palState(page);
    assert.ok(st.groups.includes(nl['palette.group.settings']) && st.options.includes(nl['settings.agenda']), `iCal → Agenda: ${JSON.stringify(st)}`);
    await type(page, 'full text');
    assert.ok((await palState(page)).options.includes(nl['settings.search']), 'full text → Zoeken');
    await type(page, 'reset');
    st = await palState(page);
    const i = st.options.indexOf(nl['settings.advanced']);
    assert.ok(i >= 0, `reset → Geavanceerd: ${st.options}`);
    // Enter opens Settings at that section, its heading focused
    for (let k = 0; k < 20 && (await inShadow(page, (sr) => sr.querySelector('dialog.tp-palette [aria-selected="true"] .tp-pal-name')?.textContent)) !== nl['settings.advanced']; k++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.activeElement?.closest?.('[data-section="st-advanced"]'), null, { timeout: 5000 });
  });

  it('a group with more than 8 hits ends in "+N more" that shows the rest (TP-112); a course name alone does not list its files (TP-113)', async () => {
    await openPalette(page);
    await page.waitForFunction(() => /\d+ bestanden/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette .tp-pal-status')?.textContent || '')
      && !/wordt bijgewerkt/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette .tp-pal-status').textContent), null, { timeout: 20000, polling: 200 });
    await type(page, 'syllabus');
    const st = await until(page, (s) => s.options.some((o) => /^Nog \d+ resultaten tonen$/.test(o)), '"+N more" row');
    const more = st.options.find((o) => /^Nog/.test(o));
    const n = Number(/\d+/.exec(more)[0]);
    const before = st.options.filter((o) => o === 'Syllabus.pdf').length;
    assert.equal(before, 8, 'capped at 8');
    await page.locator(`${PAL} [role="option"]`, { hasText: more }).click();
    const after = await palState(page);
    assert.equal(after.options.filter((o) => o === 'Syllabus.pdf').length, 8 + n, 'all shown');
    assert.ok(!after.options.some((o) => /^Nog/.test(o)), 'no more row');
    assert.ok(after.marks.includes('Syllabus'), 'title highlighted');
    await type(page, 'regie');
    const r = await palState(page);
    assert.ok(r.options.includes('Regie 1'), 'the course');
    assert.ok(!r.options.includes('Syllabus.pdf'), `no files that only match via the course name: ${r.options}`);
  });

  it('typos: near matches with a note (TP-175); a pasted essay is clipped (TP-082)', async () => {
    await type(page, 'regienoat');
    let st = await palState(page);
    assert.ok(st.options.includes('Regienota Ooievaar'), `near match: ${st.options}`);
    assert.equal(st.note, nl['palette.approx']);
    await type(page, 'x'.repeat(500));
    assert.equal((await page.locator(INPUT).inputValue()).length, 200, 'maxlength');
    st = await palState(page);
    assert.ok(st.empty.length < 400 && st.empty.includes('…'), `clipped echo: ${st.empty.length}`);
    assert.ok(st.empty.includes(nl['palette.empty.hint']), 'a next step');
    await page.keyboard.press('Escape');
  });

  it('no console errors', () => { assert.deepEqual(h.errors, []); });
});
