'use strict';
// Full-text search of course files (opt-in): course action "Doorzoek alle bestanden" with confirm + progress →
// ⌘K "In bestanden" finds a word inside a PDF with page number + highlighted snippet → Enter opens the PDF at
// that page; a download through Toledo+ is indexed without a second download; one index for both origins
// (extension-origin IndexedDB in the hidden host frame); Settings › Zoeken: status + "Wis bestandsindex".
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, inShadow, screenshot, waitFor, COURSE_URL } = require('../helpers/launch');
const { strings, openPortal } = require('../helpers/app');

const PAL = '#tplus-root dialog.tp-palette';
const INPUT = `${PAL} input.tp-pal-input`;
const nl = strings('nl');
const REGIE_URL = 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900662_1/outline';

const pal = (page) => inShadow(page, (sr) => {
  const d = sr.querySelector('dialog.tp-palette');
  const groups = d ? [...d.querySelectorAll('.tp-pal-group')].map((g) => ({
    title: g.querySelector('.tp-pal-head').textContent,
    options: [...g.querySelectorAll('[role="option"]')].map((o) => ({
      name: o.querySelector('.tp-pal-name').textContent,
      sub: (o.querySelector('.tp-pal-sub') || {}).textContent || '',
      snip: (o.querySelector('.tp-pal-snip') || {}).innerHTML || '',
      selected: o.getAttribute('aria-selected') === 'true',
    })),
  })) : [];
  return { open: !!(d && d.open), groups, status: d ? d.querySelector('.tp-pal-status').textContent : '' };
});
const filesGroup = (st) => st.groups.find((g) => g.title === nl['palette.group.files']);

async function openPalette(page) {
  await page.keyboard.press('Control+k');
  await page.locator(PAL).waitFor({ state: 'visible', timeout: 3000 });
}
async function search(page, q, pred, what, timeout = 8000) {
  const t0 = Date.now(); let st;
  await page.locator(INPUT).fill(q);
  while (Date.now() - t0 < timeout) { await page.waitForTimeout(120); st = await pal(page); if (pred(st)) return st; }
  assert.fail(`${what}: ${JSON.stringify(st)}`);
}
const ftBox = (page) => inShadow(page, (sr) => { const b = sr.querySelector('[data-ft-box]'); return b ? { text: b.innerText, buttons: [...b.querySelectorAll('button')].map((x) => x.dataset.action) } : null; });

describe('full-text search of course files', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('is off by default: no "In bestanden" group, no host frame', async () => {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await openPalette(page);
    const st = await search(page, 'kwartelkoning', () => true, 'search');
    assert.equal(filesGroup(st), undefined);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('iframe[data-tplus-fulltext]').count(), 0, 'nothing loaded while off');
    assert.equal((await h.getSettings())?.search?.fullText, undefined);
  });

  it('"Doorzoek alle bestanden": confirm line with the download volume → progress → done; turns the setting on', async () => {
    await waitForIdle(page); await waitForQuiet(page);
    let box = await ftBox(page);
    assert.deepEqual(box.buttons, ['ft-run']);
    assert.match(box.text, new RegExp(nl['fulltext.course.run']));
    await page.locator('#tplus-root [data-action="ft-run"]').click();
    box = await ftBox(page);
    assert.match(box.text, /downloadt 5 bestanden van dit vak/, box.text);
    assert.deepEqual(box.buttons, ['ft-go', 'ft-dismiss']);
    await screenshot(page, 'fulltext-confirm-light-desktop');
    h.rec.reset();
    await page.locator('#tplus-root [data-action="ft-go"]').click();
    assert.ok(await waitFor(async () => (await inShadow(page, (sr) => sr.activeElement?.dataset?.action)) === 'ft-cancel' || /doorzoekbaar/.test((await ftBox(page)).text)), 'focus moves to Stop');
    const s = await waitFor(async () => (await h.getSettings())?.search?.fullText === true);
    assert.ok(s, 'setting turned on');
    const done = await waitFor(async () => { const b = await ftBox(page); return b && /doorzoekbaar in (⌘|Ctrl\+)K/.test(b.text) && b; }, { timeout: 30000 });
    assert.ok(done, `finished: ${JSON.stringify(await ftBox(page))}`);
    assert.match(done.text, /1 bestand doorzoekbaar in (⌘|Ctrl\+)K · 4 overgeslagen/, 'the placeholder files are skipped, the real PDF indexed');
    assert.deepEqual(done.buttons, ['ft-run']);
    await screenshot(page, 'fulltext-done-light-desktop');
    // one at a time, only supported files, absolute URLs, nothing foreign
    const dl = h.rec.downloads.map((d) => d.fileName).sort();
    assert.deepEqual(dl, ['Diepe_bron_Kwartel.pdf', 'filmtaal_les1.pdf', 'filmtaal_les2.pdf', 'filmtaal_les4.pdf', 'oud_programma.pdf']);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });

  it('⌘K finds a word inside the PDF: page number, highlighted snippet, footer count; Enter opens the PDF at that page', async () => {
    await openPalette(page);
    const st = await search(page, 'kwartelkoning', (x) => !!filesGroup(x), '"In bestanden" group');
    const g = filesGroup(st);
    assert.equal(g.options[0].name, 'filmtaal_les2.pdf');
    assert.match(g.options[0].sub, /^Filmtaal 1 · p\. 3$/);
    assert.match(g.options[0].snip, /<mark>kwartelkoning<\/mark>/);
    assert.ok(g.options[0].snip.length < 260, 'short snippet');
    assert.match(st.status, /Doorzoekt ook de inhoud van 1 bestand$/);
    // order: below Documenten
    const titles = st.groups.map((x) => x.title);
    if (titles.includes(nl['palette.group.docs'])) assert.ok(titles.indexOf(nl['palette.group.files']) > titles.indexOf(nl['palette.group.docs']));
    // prefix + accents + several words
    const st2 = await search(page, 'REGEL derd', (x) => !!filesGroup(x), 'prefix search');
    assert.equal(filesGroup(st2).options[0].name, 'filmtaal_les2.pdf');
    await screenshot(page, 'fulltext-palette-light-desktop');
    await page.locator(INPUT).fill('kwartelkoning');
    await search(page, 'kwartelkoning', (x) => !!filesGroup(x) && x.groups.flatMap((gg) => gg.options).find((o) => o.selected)?.name === 'filmtaal_les2.pdf'
      || (!!filesGroup(x) && x.groups[0].title === nl['palette.group.files']), 'file result first or reachable');
    // move the active option to the file result
    for (let i = 0; i < 8; i++) {
      const cur = await pal(page);
      const act = cur.groups.find((gg) => gg.options.some((o) => o.selected));
      if (act && act.title === nl['palette.group.files']) break;
      await page.keyboard.press('ArrowDown');
    }
    const [popup] = await Promise.all([h.ctx.waitForEvent('page', { timeout: 10000 }), page.keyboard.press('Enter')]);
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const url = popup.url();
    assert.match(url, /#page=3$/, url);
    assert.match(url, /attachments\/_att_5003_1\/download|files\.mock-storage\.test\/bucket\/_900661_1\/_att_5003_1\//, url);
    await popup.close();
    assert.equal((await pal(page)).open, false);
  });

  it('a file downloaded through Toledo+ is indexed without downloading it again', async () => {
    await page.goto(REGIE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('[data-fk="dt:_6015_1"]'), null, { timeout: 15000 });
    h.rec.reset();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('#tplus-root [data-fk="dt:_6015_1"]').click()]);
    assert.equal(dl.suggestedFilename(), 'Regie_reader.pdf');
    await openPalette(page);
    const st = await search(page, 'zonnewijzer', (x) => !!filesGroup(x), 'downloaded file indexed', 15000);
    assert.equal(filesGroup(st).options[0].name, 'Regie_reader.pdf');
    assert.match(filesGroup(st).options[0].sub, /Regie 1 · p\. 2/);
    assert.match(filesGroup(st).options[0].snip, /<mark>zonnewijzer<\/mark>/);
    assert.equal(h.rec.downloads.filter((d) => d.fileName === 'Regie_reader.pdf').length, 1, 'no second download');
    // ⌘↵ downloads
    await search(page, 'zonnewijzer', (x) => x.groups[0] && x.groups[0].title === nl['palette.group.files'], 'files group first');
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.keyboard.press('Control+Enter')]);
    assert.equal(dl2.suggestedFilename(), 'Regie_reader.pdf');
  });

  it('the portal searches the same index (extension origin)', async () => {
    await openPortal(h);
    await openPalette(page);
    const st = await search(page, 'kwartelkoning', (x) => !!filesGroup(x), 'found on the portal', 10000);
    assert.equal(filesGroup(st).options[0].name, 'filmtaal_les2.pdf');
    assert.match(st.status, /Doorzoekt ook de inhoud van 2 bestanden$/);
    await page.keyboard.press('Escape');
  });

  it('Settings › Zoeken: switch, status, "Wis bestandsindex"; off → no results', async () => {
    await openPortal(h, 'settings');
    const sec = page.locator('#tplus-root section[data-section="st-search"]');
    await sec.waitFor();
    assert.equal(await sec.locator('input[name="s:search.fullText"][role="switch"]').isChecked(), true);
    await page.waitForFunction(() => /2 bestanden doorzoekbaar/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('[data-ft-status]')?.textContent || ''), null, { timeout: 5000 });
    assert.match(await sec.innerText(), /2 bestanden doorzoekbaar \(\d+,\d MB\) · 4 overgeslagen/);
    await screenshot(page, 'fulltext-settings-light-desktop');
    await sec.locator('[data-action="ft-wipe"]').click();
    await page.waitForFunction(() => /Nog geen bestanden doorzocht/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('[data-ft-status]')?.textContent || ''), null, { timeout: 5000 });
    await openPalette(page);
    let st = await search(page, 'kwartelkoning', () => true, 'search');
    await page.waitForTimeout(300);
    st = await pal(page);
    assert.equal(filesGroup(st), undefined, 'wiped');
    assert.doesNotMatch(st.status, /inhoud van/);
    await page.keyboard.press('Escape');
    await sec.locator('input[name="s:search.fullText"]').click({ force: true });
    await waitFor(async () => (await h.getSettings())?.search?.fullText === false);
    assert.equal((await h.getSettings()).search.fullText, false);
  });

  it('no console errors, unknown endpoints or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), []);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });
});
