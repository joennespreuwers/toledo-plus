'use strict';
// Accessibility + design-consistency + print (bug bash: TP-040–047, TP-042, TP-044, TP-045, TP-110, TP-128–131,
// TP-151, TP-163, TP-223, TP-226, TP-233). One shared focus helper (TP.shell.focus) keeps focus on the same control
// across re-renders, or on the next row / the section heading when the control is gone — never on <body>.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, inShadow, waitFor, screenshot } = require('../helpers/launch');
const { S, strings, openPortal, pick, waitSettings } = require('../helpers/app');

/** What has focus inside the shadow root (null = <body>, i.e. lost). */
const active = (page) => inShadow(page, (sr) => {
  const a = sr.activeElement;
  if (!a) return null;
  return {
    tag: a.tagName, name: a.getAttribute('name'), value: a.value, checked: a.checked, action: a.dataset.action || null, fk: a.dataset.fk || null,
    day: a.dataset.day || null, cls: a.className && String(a.className), text: (a.textContent || '').trim().slice(0, 60),
    section: a.closest('[data-section]')?.dataset.section || null, tabindex: a.getAttribute('tabindex'),
  };
});
const untilActive = (page, pred, label) => waitFor(async () => { const a = await active(page); return pred(a) ? a : null; }, { timeout: 4000 })
  .then(async (r) => { if (!r) assert.fail(`${label}: focus is ${JSON.stringify(await active(page))}`); return r; });

describe('accessibility', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('forced colours (Windows High Contrast): switches, segmented selection and swatches stay visible', async () => {
    await openPortal(h, 'settings');
    await page.emulateMedia({ forcedColors: 'active' });
    try {
      const r = await inShadow(page, (sr) => {
        const cs = (el) => getComputedStyle(el);
        const on = sr.querySelector('input.tp-switch:checked'), off = sr.querySelector('input.tp-switch:not(:checked)');
        const segOn = sr.querySelector('.tp-seg input:checked + span'), segOff = sr.querySelector('.tp-seg input:not(:checked) + span');
        const sw = sr.querySelector('.tp-swatch-c');
        return {
          border: cs(off).borderTopWidth, onBg: cs(on).backgroundColor, offBg: cs(off).backgroundColor,
          segOn: cs(segOn).backgroundColor, segOff: cs(segOff).backgroundColor,
          swatch: cs(sw).backgroundColor, swatchFca: cs(sw).forcedColorAdjust, segBorder: cs(sr.querySelector('.tp-segmented')).borderTopWidth,
          search: cs(sr.querySelector('.tp-search-field')).borderTopWidth,
        };
      });
      assert.notEqual(r.border, '0px', 'switch has a border');
      assert.notEqual(r.onBg, r.offBg, `on/off switch differ (${r.onBg} vs ${r.offBg})`);
      assert.notEqual(r.segOn, r.segOff, 'checked segment is highlighted');
      assert.notEqual(r.segBorder, '0px', 'segmented control has an outline');
      assert.equal(r.swatchFca, 'none', 'swatches keep their colour');
      assert.notEqual(r.search, '0px', 'toolbar search has a border');
      await screenshot(page, 'a11y-forced-colors-settings');
    } finally {
      await page.emulateMedia({ forcedColors: 'none' });
    }
  });

  it('switch names are the title only; the help text is the description (TP-043)', async () => {
    await openPortal(h, 'settings');
    const r = await inShadow(page, (sr) => {
      const sw = sr.querySelector('input.tp-switch[name="s:privacy.telemetry"]');
      const ids = (a) => (sw.getAttribute(a) || '').split(/\s+/).filter(Boolean).map((id) => sr.getElementById(id)?.textContent.trim()).join(' ');
      return { name: ids('aria-labelledby'), desc: ids('aria-describedby') };
    });
    const nl = strings('nl');
    assert.equal(r.name, nl['telemetry.setting.label']);
    assert.equal(r.desc, nl['telemetry.setting.desc']);
  });

  it('changing the language with the keyboard keeps focus on the language radio (TP-041)', async () => {
    await openPortal(h, 'settings');
    await page.locator('#tplus-root input[name="s:language"]:checked').focus();
    const before = await active(page);
    assert.equal(before?.name, 's:language');
    await page.keyboard.press('ArrowRight');
    const s = await waitSettings(h, (x) => x.language && x.language !== before.value);
    assert.ok(s && s.language !== before.value, 'language changed');
    await page.waitForTimeout(300); // chrome rebuild + re-render
    const a = await untilActive(page, (x) => x && x.name === 's:language' && x.checked, 'language radio');
    assert.equal(a.value, s.language, 'focus on the newly checked option');
    await pick(page.locator('#tplus-root input[name="s:language"][value="nl"]'));
    await waitSettings(h, (x) => x.language === 'nl');
  });

  it('iCal "Verwijderen" moves focus to the paste field, not <body> (TP-110)', async () => {
    await openPortal(h, 'settings');
    await page.locator('#tplus-root input[name="st-ics"]').fill('https://cloud.timeedit.net/kuleuven/web/a/ri0000000.ics');
    await page.locator('#tplus-root input[name="st-ics"]').press('Enter');
    const rm = page.locator('#tplus-root [data-action="ics-remove"]');
    await rm.waitFor({ timeout: 4000 });
    await rm.focus();
    await page.keyboard.press('Enter');
    await untilActive(page, (x) => x && (x.name === 'st-ics' || x.action === 'ics-edit'), 'paste field');
  });

  it('"Alles gelezen" on Overzicht › Nieuw moves focus to the section heading, not <body> (TP-044)', async () => {
    await openPortal(h, 'overview');
    const btn = page.locator('#tplus-root [data-action="ov-readall"]');
    assert.ok(await btn.count(), 'Mark all read is there');
    await btn.focus();
    await page.keyboard.press('Enter');
    const a = await untilActive(page, (x) => x && x.action !== 'ov-readall', 'after Mark all read');
    assert.ok(a.tag === 'H2' || a.tag === 'H1' || a.section === 'ov-new', `focus near the list: ${JSON.stringify(a)}`);
  });

  it('Courses › Bewerk: focus follows the moved course (TP-045); "Bewerk" has the pencil icon (TP-229)', async () => {
    await openPortal(h, 'courses');
    const edit = page.locator('#tplus-root .tp-head-actions [data-id="edit"]');
    assert.equal(await edit.locator('svg').count(), 1, 'Bewerk has an icon like every page action');
    await edit.click();
    const first = page.locator('#tplus-root [data-action="move-down"]').first();
    await first.waitFor({ timeout: 4000 });
    const fk = await first.getAttribute('data-fk');
    await first.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    let a = await untilActive(page, (x) => x && x.fk, 'after move');
    assert.equal(a.fk, fk, 'still on the same course\'s button');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    a = await active(page);
    assert.equal(a?.fk, fk, 'a second Enter moves the same course again');
    // put the order back (sort by activity)
    await h.setSettings({ courses: { sort: 'activity', order: [] } });
    await page.locator('#tplus-root .tp-head-actions [data-id="edit"]').click();
  });

  it('Agenda mini calendar: one tab stop, arrows move between days (TP-040)', async () => {
    await openPortal(h, 'agenda');
    const r = await inShadow(page, (sr) => {
      const days = [...sr.querySelectorAll('.ag-side .ag-mini-d')];
      return { n: days.length, stops: days.filter((b) => b.tabIndex === 0).length };
    });
    assert.equal(r.n, 42);
    assert.equal(r.stops, 1, 'exactly one day is in the tab order');
    const range0 = await page.locator('#tplus-root .ag-range').innerText();
    await page.locator('#tplus-root .ag-side .ag-mini-d[tabindex="0"]').focus();
    const d0 = Number((await active(page)).day);
    await page.keyboard.press('ArrowRight');
    let a = await untilActive(page, (x) => x && x.day && Number(x.day) !== d0, 'ArrowRight');
    assert.ok(Number(a.day) > d0 && Number(a.day) - d0 < 26 * 3600e3, 'next day');
    assert.equal(a.tabindex, '0', 'the focused day is the tab stop');
    await page.keyboard.press('ArrowDown');
    a = await untilActive(page, (x) => x && x.day && Number(x.day) - d0 > 6 * 864e5, 'ArrowDown');
    assert.equal(await page.locator('#tplus-root .ag-range').innerText(), range0, 'arrows in the mini calendar do not page the agenda');
    const stops = await inShadow(page, (sr) => [...sr.querySelectorAll('.ag-side .ag-mini-d')].filter((b) => b.tabIndex === 0).length);
    assert.equal(stops, 1);
  });

  it('"Klaar" in the deadline sheet, then Esc: focus on the list, not <body> (TP-051)', async () => {
    await openPortal(h, 'deadlines');
    const open = page.locator('#tplus-root .va-dl:not(.tone-overdue) .va-dl-open').last();
    const key = await open.getAttribute('data-key');
    await open.focus();
    await page.keyboard.press('Enter');
    const dlg = page.locator('#tplus-root dialog.tp-detail');
    await dlg.waitFor({ state: 'visible', timeout: 4000 });
    await dlg.locator('[data-detail-action="done"]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail').open, null, { timeout: 3000 });
    await page.waitForTimeout(300);
    const a = await untilActive(page, (x) => !!x, 'after Esc');
    assert.ok(/va-dl-open|va-check/.test(a.cls || '') || /^H[12]$/.test(a.tag), `focus in the list: ${JSON.stringify(a)}`);
    await h.setState({ done: { [key]: null } });
  });

  it('"Klassiek" moves focus to the "Toledo+" pill, named "Terug naar Toledo+" (TP-192)', async () => {
    await openPortal(h);
    await page.locator(S.menuBtn).click();
    await page.locator(S.classicBtn).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    const r = await waitFor(() => page.evaluate(() => (document.activeElement?.id === 'tplus-switch' ? document.activeElement.getAttribute('aria-label') : null)), { timeout: 4000 });
    assert.equal(r, strings('nl')['shell.pillTitle']);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    await waitSettings(h, (x) => x.wrap && x.wrap.portal === true);
  });

  it('section counts are not part of the heading name (TP-047); button weights follow .tp-btn (TP-223)', async () => {
    await openPortal(h, 'deadlines');
    const r = await inShadow(page, (sr) => {
      const c = sr.querySelector('.tp-sec-title .tp-count');
      const sec = sr.querySelector('.tp-sec-actions button.tp-btn') || sr.querySelector('button.tp-btn');
      const tinted = sr.querySelector('.tp-head-actions .tp-btn-tinted');
      return { hidden: c?.getAttribute('aria-hidden'), sr: c?.nextElementSibling?.classList.contains('tp-sr'), srText: c?.nextElementSibling?.textContent,
        w: sec && getComputedStyle(sec).fontWeight, tw: tinted && getComputedStyle(tinted).fontWeight };
    });
    assert.equal(r.hidden, 'true');
    assert.ok(r.sr && /^, \d+ /.test(r.srText), `sr count: ${r.srText}`);
    if (r.w) assert.ok(Number(r.w) >= 500, `button weight ${r.w}`);
    if (r.tw) assert.equal(r.tw, '600', 'tinted page action 600');
  });

  it('overdue / soon status words carry colour, weight and a glyph (TP-163)', async () => {
    await openPortal(h, 'deadlines');
    const r = await inShadow(page, (sr) => {
      const o = sr.querySelector('.va-dl .va-urg.is-overdue');
      if (!o) return null;
      const cs = getComputedStyle(o); const b = getComputedStyle(o, '::before');
      return { w: cs.fontWeight, color: cs.color, label2: getComputedStyle(sr.querySelector('.tp-row-sub')).color, glyph: b.content !== 'none' && b.width };
    });
    assert.ok(r, 'an overdue row in the fixture');
    assert.equal(r.w, '600');
    assert.notEqual(r.color, r.label2, 'not the label-2 of every relative time');
    assert.equal(r.glyph, '12px');
  });

  it('KU Loket tiles are tint tiles, never the status red (TP-226); no typed "›" in "Agenda" (TP-233)', async () => {
    await openPortal(h, 'kuloket');
    const r = await inShadow(page, (sr) => ({
      bgs: [...new Set([...sr.querySelectorAll('.kl-tile')].map((t) => getComputedStyle(t).backgroundColor))],
      action: sr.querySelector('section[data-section="kl-today"] .tp-sec-actions')?.textContent.trim(),
    }));
    assert.equal(r.bgs.length, 1, `one tile colour: ${r.bgs}`);
    assert.ok(!r.bgs.includes('rgb(255, 59, 48)'), 'no status red');
    if (r.action) assert.ok(!r.action.includes('›'), r.action);
  });
});

describe('update banner', () => {
  let h; let page;
  before(async () => {
    h = await launch(); page = h.page;
    await h.ctx.route('https://api.toledoplus.be/**', (route) => (route.request().url().endsWith('/v1/latest')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"99.0.0","url":"https://github.com/joennespreuwers/toledo-plus/releases/latest","notes":""}' })
      : route.fulfill({ status: 204 })));
  });
  after(async () => { await h?.close(); });

  it('"Later" moves focus to the page, not <body> (TP-151); "Download" says it opens a new tab (TP-150)', async () => {
    await openPortal(h, 'overview');
    const later = page.locator('#tplus-root [data-shell="update-dismiss"]');
    await later.waitFor({ timeout: 20000 }); // the update check runs once the page is idle (~8 s)
    assert.ok(await page.locator('#tplus-root [data-banner="update"] a[target="_blank"][aria-description]').count(), 'new-tab hint');
    await later.focus();
    await page.keyboard.press('Enter');
    await untilActive(page, (x) => !!x && x.tag !== 'BUTTON', 'after Later');
  });
});

describe('print stylesheet', () => {
  let h; let page;
  before(async () => { h = await launch({ settings: { appearance: 'dark' } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('prints in the light palette without the app chrome or the view controls (TP-129, TP-130, TP-131)', async () => {
    await openPortal(h, 'deadlines');
    await page.emulateMedia({ media: 'print' });
    try {
      const r = await inShadow(page, (sr) => {
        const vis = (sel) => { const el = sr.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none'; };
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
        const row = sr.querySelector('.va-dl .tp-row-title');
        return {
          sidebar: vis('.tp-sidebar'), toolbar: vis('.tp-toolbar'), filters: vis('.va-filters'), add: vis('.va-dl-add'), check: vis('.va-check'),
          title: lum(getComputedStyle(row).color), bg: getComputedStyle(sr.querySelector('.tp-app')).backgroundColor,
          rowBreak: getComputedStyle(sr.querySelector('.tp-row')).breakInside, headBreak: getComputedStyle(sr.querySelector('.tp-sec-head')).breakAfter,
        };
      });
      assert.deepEqual([r.sidebar, r.toolbar, r.filters, r.add, r.check], [false, false, false, false, false], JSON.stringify(r));
      assert.ok(r.title < 0.3, `dark text on paper (luminance ${r.title})`);
      assert.equal(r.bg, 'rgb(255, 255, 255)');
      assert.equal(r.rowBreak, 'avoid');
      assert.equal(r.headBreak, 'avoid');
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });

  it('prints the whole Agenda day, without the side column (TP-128)', async () => {
    await openPortal(h, 'agenda');
    await page.emulateMedia({ media: 'print' });
    try {
      const r = await inShadow(page, (sr) => {
        const sc = sr.querySelector('.ag-scroll');
        return { side: getComputedStyle(sr.querySelector('.ag-side')).display, max: sc && getComputedStyle(sc).maxHeight, ov: sc && getComputedStyle(sc).overflowY };
      });
      assert.equal(r.side, 'none');
      if (r.max != null) { assert.equal(r.max, 'none'); assert.equal(r.ov, 'visible'); }
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });
});
