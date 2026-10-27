'use strict';
// Brand (v1.6): Inter declared in the document, brand accent by default, the logo instead of any "T+" text mark,
// the branded welcome card, Settings › Over, the footer signature, the first-boot splash (motion on), state colours
// that never look like the accent, and label-in-name on the course page (WCAG 2.5.3).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, inShadow, screenshot, waitFor, COURSE_URL, waitForShell, waitForIdle, waitForQuiet, PHONE } = require('../helpers/launch');
const { S, openPortal, strings } = require('../helpers/app');

const nl = strings('nl');

describe('brand: identity, type and colour', () => {
  let h;
  before(async () => { h = await launch(); });
  after(async () => { await h.close(); assert.deepEqual(h.errors, []); assert.deepEqual(h.rec.foreign, []); });

  it('Inter is declared once in the document (shadow roots ignore @font-face) and used by the shell', async () => {
    const page = await openPortal(h, 'overview');
    const r = await page.evaluate(async () => {
      const st = document.querySelectorAll('style#tp-fonts');
      await document.fonts.ready;
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const title = sr.querySelector('.tp-large-title');
      return {
        n: st.length, css: st[0] ? st[0].textContent : '',
        family: getComputedStyle(title).fontFamily,
        loaded: [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'TP Inter' && f.status === 'loaded'),
        weight: getComputedStyle(title).fontWeight,
      };
    });
    assert.equal(r.n, 1, 'one <style id="tp-fonts">');
    assert.match(r.css, /font-family:"TP Inter"/);
    assert.match(r.css, /chrome-extension:\/\/[^)]+\/fonts\/inter-latin-wght-normal\.woff2/);
    assert.match(r.css, /unicode-range:U\+0100-02BA/);
    assert.match(r.family, /^"TP Inter", Inter/);
    assert.ok(r.loaded, 'the Inter face actually loaded');
    assert.ok(Number(r.weight) >= 700, `large title weight ${r.weight}`);
  });

  it('default accent is the brand orange; links use #C2410C, filled buttons ink on orange', async () => {
    const page = h.page;
    const r = await inShadow(page, (sr) => {
      const app = sr.querySelector('.tp-app');
      const cs = getComputedStyle(app);
      return { tint: cs.getPropertyValue('--tint').trim(), text: cs.getPropertyValue('--tint-text-l').trim(), fill: cs.getPropertyValue('--tint-fill').trim(), on: cs.getPropertyValue('--on-tint').trim() };
    });
    assert.deepEqual(r, { tint: '#EE8B35', text: '#C2410C', fill: '#EE8B35', on: '#1F2430' });
    assert.equal((await h.getSettings())?.accent ?? 'brand', 'brand');
  });

  it('the logo replaces every "T+" text mark: sidebar lock-up, wordmark, footer signature; no "T+" anywhere', async () => {
    const page = h.page;
    const r = await inShadow(page, (sr) => ({
      sbLogo: !!sr.querySelector('.tp-sb-brand .tp-brand svg.tp-logo-tile'),
      word: sr.querySelector('.tp-sb-brand .tp-wordmark')?.textContent,
      label: sr.querySelector('.tp-sb-brand .tp-brand')?.getAttribute('aria-label'),
      marks: [...sr.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'T+').length,
      sig: sr.querySelector('.tp-sb-sig')?.textContent.replace(/\s+/g, ' ').trim(),
      sigBtn: sr.querySelector('.tp-sb-sig [data-shell="classic-sig"]')?.textContent,
    }));
    assert.ok(r.sbLogo, 'tile logo in the sidebar');
    assert.equal(r.word, 'Toledo+');
    assert.equal(r.label, nl['brand.home']);
    assert.equal(r.marks, 0, 'no "T+" text marks left');
    assert.match(r.sig, /^Toledo\+ \d+\.\d+\.\d+/);
    assert.equal(r.sigBtn, nl['brand.classicShort']);
  });

  it('the footer "Klassiek" link switches to classic Toledo, like the account menu', async () => {
    const page = h.page;
    await page.locator('#tplus-root .tp-sb-sig [data-shell="classic-sig"]').click();
    await page.waitForSelector(S.pill, { timeout: 4000 });
    const pill = await page.evaluate(() => { const b = document.getElementById('tplus-switch'); const cs = getComputedStyle(b, '::before'); return { bg: getComputedStyle(b).backgroundColor, logo: /data:image\/svg/.test(cs.backgroundImage) }; });
    assert.equal(pill.bg, 'rgb(31, 36, 48)', 'ink pill');
    assert.ok(pill.logo, 'tile logo in the pill');
    await page.locator(S.pill).click();
    await waitForShell(page);
  });

  it('Settings › Over shows the logo, name, "Onofficieel studentenproject" and the version', async () => {
    const page = await openPortal(h, 'settings');
    const r = await inShadow(page, (sr) => {
      const row = sr.querySelector('section[data-section="st-about"] .st-brand-row');
      return row ? { logo: !!row.querySelector('svg.tp-logo'), text: row.textContent.replace(/\s+/g, ' ').trim() } : null;
    });
    assert.ok(r && r.logo, 'brand row with logo');
    assert.ok(r.text.includes('Toledo+') && r.text.includes(nl['brand.unofficial']), r.text);
    await screenshot(page, 'brand-settings-about');
  });

  it('"binnenkort" an amber-tinted row, "te laat" a red-tinted row, both with the words and no icon', async () => {
    const page = await openPortal(h, 'overview');
    const r = await inShadow(page, (sr) => {
      const urg = sr.querySelector('.va-urg.is-urgent');
      const ovd = sr.querySelector('.va-urg.is-overdue');
      const row = ovd && ovd.closest('.va-dl');
      const urow = urg && urg.closest('.va-dl');
      const plain = sr.querySelector('.va-dl:not(.tone-overdue):not(.tone-urgent)');
      const tile = sr.querySelector('.tp-dt-urgent .tp-dt-d');
      // color-mix() comes back as "color(srgb r g b)" on a 0–1 scale; rgb() on 0–255
      const rgb = (c) => { const n = (c.match(/[\d.]+/g) || []).map(Number).slice(0, 3); return c.startsWith('color(') ? n.map((x) => Math.round(x * 255)) : n; };
      return {
        urg: urg ? { icon: !!urg.querySelector('svg'), text: urg.textContent.trim() } : null,
        urgBg: urow ? rgb(getComputedStyle(urow).backgroundColor) : null,
        tile: tile ? getComputedStyle(tile).color : null,
        ovd: ovd ? { color: getComputedStyle(ovd).color, icon: !!ovd.querySelector('svg'), text: ovd.textContent.trim() } : null,
        rowBg: row ? rgb(getComputedStyle(row).backgroundColor) : null,
        plainBg: plain ? getComputedStyle(plain).backgroundColor : null,
        plainTime: plain ? getComputedStyle(plain.querySelector('.va-urg:not(.is-urgent)') || plain).color : null,
      };
    });
    assert.ok(r.urg && r.urg.icon === false && r.urg.text.length > 2, `urgent: words, no icon (${JSON.stringify(r.urg)})`);
    assert.ok(r.urgBg && r.urgBg[0] > r.urgBg[2] + 10 && r.urgBg[1] > r.urgBg[2] + 5, `row tinted amber (${r.urgBg})`);
    assert.equal(r.tile, 'rgb(138, 83, 0)', 'urgent date tile in amber');
    assert.ok(r.ovd, 'an overdue deadline in the fixtures');
    assert.ok(r.rowBg && r.rowBg[0] > r.rowBg[1] + 10 && r.rowBg[0] > r.rowBg[2] + 10, `row tinted red (${r.rowBg})`);
    assert.notEqual(r.rowBg.join(','), (r.plainBg.match(/[\d.]+/g) || []).slice(0, 3).join(','), 'differs from a normal row');
    assert.equal(r.ovd.icon, false, 'no icon');
    assert.ok(r.ovd.text.length > 2, 'the words');
  });

  it('branded welcome card: ink card with the glyph, intro line, three tips, privacy and one primary button', async () => {
    await h.setState({ ui: { onboarded: false } });
    const page = await openPortal(h, 'overview');
    const r = await inShadow(page, (sr) => {
      const c = sr.querySelector('section.va-onboard');
      return c ? { bg: getComputedStyle(c).backgroundColor, glyph: !!c.querySelector('svg.tp-logo-glyph'), lead: c.querySelector('.va-onboard-lead')?.textContent,
        tips: c.querySelectorAll('li').length, ok: c.querySelectorAll('.va-onboard-ok').length, okBg: getComputedStyle(c.querySelector('.va-onboard-ok')).backgroundColor } : null;
    });
    assert.ok(r, 'welcome card shown');
    assert.equal(r.bg, 'rgb(31, 36, 48)');
    assert.ok(r.glyph);
    assert.equal(r.lead, nl['overview.onboard.lead']);
    assert.equal(r.tips, 3);
    assert.equal(r.ok, 1);
    assert.equal(r.okBg, 'rgb(238, 139, 53)');
    await screenshot(page, 'brand-welcome');
    await h.setState({ ui: { onboarded: true } });
  });

  it('course rows and teacher links: the accessible name starts with the visible text (no "Open …" aria-label)', async () => {
    const page = h.page;
    await page.goto(COURSE_URL);
    await waitForShell(page); await waitForIdle(page); await waitForQuiet(page);
    await waitFor(() => inShadow(page, (sr) => !!sr.querySelector("button.cv-row-main")), { timeout: 8000 });
    const r = await inShadow(page, (sr) => ({
      labelled: [...sr.querySelectorAll('button.cv-row-main, a.cv-row[href^="mailto:"], .cv-teachers a')].filter((e) => e.hasAttribute('aria-label')).length,
      first: (() => { const b = sr.querySelector('button.cv-row-main'); return b ? { text: b.querySelector('.cv-name')?.textContent.trim(), sr: b.querySelector('.cv-sr')?.textContent } : null; })(),
    }));
    assert.equal(r.labelled, 0);
    assert.ok(r.first && r.first.text);
    assert.equal(r.first.sr, ', ' + nl['course.openSuffix']);
  });
});

describe('brand: first-boot splash and dark mode on ink', () => {
  it('without cached data a branded splash shows briefly (motion on) and removes itself', async () => {
    const h = await launch({ motion: true });
    try {
      const page = h.page;
      // The shell marks <html data-tp-splash="shown|done"> (attributes cross the content-script world boundary).
      const marks = [];
      page.on('console', () => {});
      await page.exposeFunction('__tpMark', (v, t) => marks.push([v, t]));
      await page.addInitScript(() => {
        const mo = new MutationObserver(() => { const v = document.documentElement.dataset.tpSplash; if (v) window.__tpMark(v, performance.now()); });
        const go = () => mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tp-splash'] });
        if (document.documentElement) go(); else document.addEventListener('readystatechange', go, { once: true });
      });
      await page.goto('https://toledo.kuleuven.be/portal/#/home?tplus=overview');
      await page.waitForFunction(() => document.documentElement.dataset.tpSplash === 'done', null, { timeout: 8000 });
      assert.deepEqual(marks.map((m) => m[0]), ['shown', 'done']);
      const dur = marks[1][1] - marks[0][1];
      // The splash is planned at ~380 ms (260 ms + a 120 ms fade, see TP.shell splash()). Timers and animations run late on a
      // busy machine (CI, first paint), so assert what matters: it never waits for data or hangs — gone well within 1 s.
      assert.ok(dur <= 1000, `splash visible for ${Math.round(dur)} ms (planned ~380 ms; must never wait for data or hang)`);
      assert.equal(await inShadow(page, (sr) => !!sr.querySelector('.tp-splash')), false, 'removed from the DOM');
      assert.deepEqual(h.errors, []);
    } finally { await h.close(); }
  });

  it('with motion off (tests) or cached data there is no splash; dark mode sits on ink', async () => {
    const h = await launch({ colorScheme: 'dark', viewport: PHONE });
    try {
      const page = await openPortal(h, 'overview');
      const r = await inShadow(page, (sr) => {
        const app = sr.querySelector('.tp-app');
        return { splash: !!sr.querySelector('.tp-splash'), bg: getComputedStyle(app).backgroundColor, card: getComputedStyle(sr.querySelector('.tp-group')).backgroundColor,
          tbBrand: (() => { const a = sr.querySelector('.tp-tb-brand'); return a && getComputedStyle(a).display !== 'none' && !!a.querySelector('svg.tp-logo-tile'); })() };
      });
      assert.equal(r.splash, false);
      assert.equal(r.bg, 'rgb(18, 21, 28)');
      assert.equal(r.card, 'rgb(31, 36, 48)');
      assert.ok(r.tbBrand, 'phones: tile logo leads the toolbar');
      const html = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
      assert.equal(html, 'rgb(18, 21, 28)', 'page.css: html background matches --bg');
      await screenshot(page, 'brand-overview-dark-phone');
      assert.deepEqual(h.errors, []);
    } finally { await h.close(); }
  });
});
