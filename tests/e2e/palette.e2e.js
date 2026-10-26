'use strict';
// ⌘K palette: dialog semantics, keyboard, groups, document search across all courses via TP.index
// (background crawl through the relay on the portal, same-origin on Ultra), "show in course" focus,
// ⌘↵ download, Recent, the Settings "Zoeken" group.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, screenshot, waitFor, inShadow, COURSE_URL } = require('../helpers/launch');
const { S, strings, openPortal } = require('../helpers/app');

const PAL = '#tplus-root dialog.tp-palette';
const INPUT = `${PAL} input.tp-pal-input`;
const nl = strings('nl');

const palState = (page) => inShadow(page, (sr) => {
  const d = sr.querySelector('dialog.tp-palette');
  const input = d && d.querySelector('input');
  const act = input && input.getAttribute('aria-activedescendant');
  const opt = act ? sr.getElementById(act) : null;
  return {
    open: !!(d && d.open),
    focused: sr.activeElement === input,
    role: input && input.getAttribute('role'),
    modal: d && d.getAttribute('aria-modal'),
    listbox: !!(d && d.querySelector('[role="listbox"]#tp-pal-list')),
    groups: d ? [...d.querySelectorAll('.tp-pal-head')].map((h) => h.textContent) : [],
    options: d ? [...d.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.tp-pal-name').textContent) : [],
    active: opt ? opt.querySelector('.tp-pal-name').textContent : null,
    activeSub: opt ? (opt.querySelector('.tp-pal-sub') || {}).textContent : null,
    selected: d ? d.querySelectorAll('[aria-selected="true"]').length : 0,
    status: d ? d.querySelector('.tp-pal-status').textContent : '',
  };
});

async function openPalette(page, how = 'Control+k') {
  await page.keyboard.press(how);
  await page.locator(PAL).waitFor({ state: 'visible', timeout: 3000 });
}
async function type(page, q) {
  await page.locator(INPUT).fill(q);
  await page.waitForTimeout(250);
}
/** Poll the palette until pred(state) holds (the index may still be filling in the background): no fixed sleeps. */
async function until(page, pred, what, timeout = 8000) {
  const t0 = Date.now(); let st;
  while (Date.now() - t0 < timeout) { st = await palState(page); if (pred(st)) return st; await page.waitForTimeout(100); }
  assert.fail(`${what}: ${JSON.stringify(st)}`);
}
async function waitIndexed(page, min = 10) {
  await page.waitForFunction((min) => {
    const sr = document.querySelector('#tplus-root').shadowRoot;
    const m = /(\d+) documenten/.exec(sr.querySelector('dialog.tp-palette .tp-pal-status')?.textContent || '');
    return m && Number(m[1]) >= min && !/wordt bijgewerkt/.test(sr.querySelector('dialog.tp-palette .tp-pal-status').textContent);
  }, min, { timeout: 20000, polling: 200 });
}

describe('⌘K palette on the portal', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('⌘K opens a modal dialog with a combobox; empty query shows navigation; Esc closes and returns focus', async () => {
    await openPortal(h);
    await page.locator(S.title).click();
    const btn = page.locator('#tplus-root [data-shell="refresh"]').first();
    await btn.focus();
    await openPalette(page);
    const s = await palState(page);
    assert.ok(s.open && s.focused, 'open with focus in the input');
    assert.equal(s.role, 'combobox');
    assert.equal(s.modal, 'true');
    assert.ok(s.listbox, 'listbox');
    assert.ok(s.groups.includes(nl['palette.group.nav']), `navigation group: ${s.groups}`);
    assert.ok(s.options.includes(nl['nav.deadlines']) && s.options.includes(nl['nav.settings']));
    assert.equal(s.selected, 1, 'first option active');
    await screenshot(page, 'palette-empty-light-desktop');
    // focus trap: Tab stays inside the dialog
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    assert.ok(await inShadow(page, (sr) => sr.querySelector('dialog.tp-palette').contains(sr.activeElement)), 'focus stays in the dialog');
    await page.locator(INPUT).focus();
    await page.keyboard.press('Escape');
    assert.equal((await palState(page)).open, false, 'Esc closes');
    assert.equal(await inShadow(page, (sr) => sr.activeElement?.dataset?.shell), 'refresh', 'focus returned to the opener');
  });

  it('"/" and the ⌘K button in the toolbar field open the palette; the field still filters the view', async () => {
    await page.locator(S.title).click();
    await page.keyboard.press('/');
    assert.ok((await palState(page)).open, '"/" opens the palette');
    await page.keyboard.press('Escape');
    await page.locator('#tplus-root .tp-search [data-shell="palette"]').click();
    assert.ok((await palState(page)).open, 'toolbar ⌘K button opens the palette');
    await page.keyboard.press('Escape');
    await page.locator(S.search).fill('geluid');
    await page.waitForTimeout(300);
    assert.equal((await palState(page)).open, false, 'typing in the toolbar field does not open the palette');
    await page.locator(S.search).fill('');
  });

  it('indexes documents of all current courses in the background (relay) and finds them', async () => {
    await openPalette(page);
    await waitIndexed(page);
    const st = await palState(page);
    assert.match(st.status, /^Doorzoekt \d+ documenten in 12 vakken · bijgewerkt \d\d:\d\d$/);
    await type(page, 'ooievaar');
    const s = await palState(page);
    assert.ok(s.groups.includes(nl['palette.group.docs']), `documents group: ${s.groups}`);
    assert.ok(s.options.includes('Draaiboek_sjabloon_Ooievaar.docx'), `file found: ${s.options}`);
    assert.ok(s.options.includes('Regienota Ooievaar'), 'page found');
    assert.match(s.activeSub, /Regie 1/, 'course name in the subtitle');
    // ranked: title prefix first
    await type(page, 'regienota');
    assert.equal((await palState(page)).active, 'Regienota Ooievaar');
    // case + diacritics, all words, any order
    await type(page, 'SCENEANALYSE opdracht');
    assert.ok((await palState(page)).options.includes('Opdracht Scèneanalyse'));
    // folder path counts as a match
    await type(page, 'mise-en-scene draaiboek');
    assert.ok((await palState(page)).options.includes('Draaiboek_sjabloon_Ooievaar.docx'), 'word matched via folder path');
    // courses + navigation groups
    await type(page, 'regie');
    const g = await palState(page);
    assert.ok(g.groups.includes(nl['palette.group.courses']) && g.options.includes('Regie 1'), 'course result');
    await screenshot(page, 'palette-results-light-desktop');
    // ↑/↓ move the active option (aria-activedescendant)
    const first = g.active;
    await page.keyboard.press('ArrowDown');
    const second = (await palState(page)).active;
    assert.notEqual(second, first);
    await page.keyboard.press('ArrowUp');
    assert.equal((await palState(page)).active, first);
    // stored compactly in chrome.storage.local 'index'
    const idx = await h.sw.evaluate(async () => (await chrome.storage.local.get('index')).index);
    const regie = idx && idx._900662_1;
    assert.ok(regie && Array.isArray(regie.items) && Array.isArray(regie.items[0]), 'compact rows');
    assert.equal(regie.luId, 'ULTRA-B-LUCA-X10300-2627');
    assert.deepEqual(regie.items.find((r) => r[0] === '_6013_1'), ['_6013_1', 'Draaiboek_sjabloon_Ooievaar.docx', 'file', 'Week 3 — Mise-en-scène › Opdrachten', '_6011_1']);
    await page.keyboard.press('Escape');
  });

  it('Enter on an assignment opens the course with its folders unfolded and the row highlighted', async () => {
    await openPalette(page);
    await type(page, 'sceneanalyse');
    assert.equal((await palState(page)).active, 'Opdracht Scèneanalyse');
    await Promise.all([page.waitForURL(/\/ultra\/courses\/_900662_1\/outline/, { timeout: 10000 }), page.keyboard.press('Enter')]);
    await waitForShell(page);
    await page.waitForFunction(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const el = sr.querySelector('[data-tree] [data-fk="at:_6012_1"]');
      return el && sr.activeElement === el;
    }, null, { timeout: 15000 });
    const r = await inShadow(page, (sr) => ({
      open: ['_6010_1', '_6011_1'].map((id) => sr.querySelector(`details.cv-folder[data-id="${id}"]`).open),
      hl: sr.querySelector('[data-tree] [data-fk="at:_6012_1"]').classList.contains('cv-focus'),
      inView: (() => { const b = sr.querySelector('[data-tree] [data-fk="at:_6012_1"]').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })(),
    }));
    assert.deepEqual(r.open, [true, true], 'containing folders opened');
    assert.ok(r.hl, 'row highlighted');
    assert.ok(r.inView, 'row scrolled into view');
    const st = await waitFor(async () => { const x = await h.getState(); return x && !x.focus && x; });
    assert.ok(st && !st.focus, 'pending focus consumed');
    assert.equal(st.recent[0].title, 'Opdracht Scèneanalyse', 'added to Recent');
    await screenshot(page, 'palette-focus-in-course');
  });

  it('empty query shows Recent first', async () => {
    await openPalette(page);
    const s = await palState(page);
    assert.equal(s.groups[0], nl['palette.group.recent']);
    assert.equal(s.options[0], 'Opdracht Scèneanalyse');
    await page.keyboard.press('Escape');
  });

  it('settings: "Zoeken" group with switch, status and rebuild', async () => {
    await openPortal(h, 'settings');
    const sec = page.locator('#tplus-root section[data-section="st-search"]');
    await sec.waitFor();
    await page.waitForFunction(() => /Doorzoekt/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('[data-index-status]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const txt = await sec.innerText();
    assert.ok(txt.includes(nl['settings.search.index']), 'switch label');
    assert.match(txt, /Doorzoekt \d+ documenten in 12 vakken/);
    assert.equal(await sec.locator('input[name="s:search.indexAll"][role="switch"]').isChecked(), true, 'on by default');
    h.rec.reset();
    await sec.locator('[data-action="reindex"]').click();
    await waitFor(() => h.rec.find((r) => /\/contents\?limit=200/.test(r.url)).length >= 12, { timeout: 15000 });
    await page.waitForFunction(() => /Doorzoekt \d+ documenten in 12 vakken · bijgewerkt/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('[data-index-status]')?.textContent || ''), null, { timeout: 15000 });
    await sec.locator('input[name="s:search.indexAll"]').click({ force: true });
    await waitFor(async () => (await h.getSettings())?.search?.indexAll === false);
    assert.equal((await h.getSettings()).search.indexAll, false);
  });

  it('no console errors, unknown endpoints or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), []);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });
});

describe('⌘K palette on Ultra', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('the course view indexes its course; ⌘↵ downloads a file from another course', async () => {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitForIdle(page); await waitForQuiet(page);
    await openPalette(page);
    // the open course is indexed when its tree has loaded ('course' event) — re-type until the result shows
    const t0 = Date.now();
    let st;
    do { await type(page, 'kwartel'); st = await palState(page); } while (!st.options.includes('Diepe_bron_Kwartel.pdf') && Date.now() - t0 < 8000);
    assert.ok(st.options.includes('Diepe_bron_Kwartel.pdf'), `item of the open course is indexed (nested): ${JSON.stringify(st.options)}`);
    await waitIndexed(page, 20);
    await type(page, 'regie reader');
    await until(page, (x) => x.active === 'Regie_reader.pdf', 'Regie_reader.pdf is the active result');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.keyboard.press('Control+Enter')]);
    assert.equal(dl.suggestedFilename(), 'Regie_reader.pdf');
    assert.equal((await palState(page)).open, false);
    assert.deepEqual(h.rec.cdn, [], 'absolute URLs only');
  });

  it('phone: the palette is a full-screen sheet, reachable from the More sheet', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.locator(`${S.tabbar} [data-shell="more"]`).click();
    await page.locator('#tplus-root dialog.tp-sheet [data-shell="palette"]').click();
    await page.locator(PAL).waitFor({ state: 'visible' });
    await page.locator(PAL).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
    const box = await page.locator(PAL).boundingBox();
    assert.ok(box.width >= 389 && box.height >= 840, `full screen: ${JSON.stringify(box)}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal scroll');
    await screenshot(page, 'palette-light-phone');
    await page.locator(`${PAL} [data-pal="close"]`).click();
    assert.equal((await palState(page)).open, false);
  });

  it('no console errors, unknown endpoints or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), []);
    assert.deepEqual(h.rec.foreign, []);
  });
});

describe('⌘K palette without an Ultra session', () => {
  let h;
  before(async () => { h = await launch({ mock: { ultraDown: true }, colorScheme: 'dark' }); });
  after(async () => { await h?.close(); });

  it('crawl fails silently and the footer says to open a course', async () => {
    const page = h.page;
    await openPortal(h);
    await openPalette(page);
    await page.waitForFunction((txt) => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette .tp-pal-status')?.textContent === txt,
      nl['palette.status.openCourse'], { timeout: 15000 });
    await type(page, 'filmtaal');
    assert.ok((await palState(page)).options.includes('Filmtaal 1'), 'courses still searchable');
    await screenshot(page, 'palette-results-dark-desktop');
    assert.deepEqual(h.errors.filter((e) => /pageerror|Uncaught/.test(e)), []);
  });
});
