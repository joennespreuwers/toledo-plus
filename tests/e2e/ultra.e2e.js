'use strict';
// Blackboard Ultra course page: tree, absolute URLs (<base href> trap), search, download, sanitizing,
// deep bar, classic mode.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, screenshot, waitFor, COURSE_URL } = require('../helpers/launch');
const { S, mainText, waitSettings } = require('../helpers/app');

const folder = (title) => `#tplus-root details.cv-folder:has(> summary :text-is("${title}"))`;

describe('ultra course page', () => {
  let h; let page; let tree;
  before(async () => {
    h = await launch(); page = h.page;
    tree = h.fx.ultra.trees._900661_1;
  });
  after(async () => { await h?.close(); });

  async function openCourse() {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitForIdle(page);
    await waitForQuiet(page);
  }

  it('renders the course view over Ultra (overflow:hidden + base href page)', async () => {
    await openCourse();
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('tplus-on')));
    assert.equal(await page.locator('#site-wrap').isVisible(), false, 'original Ultra page hidden');
    // the page itself must be scrollable despite html,body{overflow:hidden}
    const scrollable = await page.evaluate(() => {
      const before = window.scrollY; window.scrollTo(0, 400); const moved = window.scrollY !== before || document.documentElement.scrollHeight <= innerHeight; window.scrollTo(0, 0); return moved;
    });
    assert.ok(scrollable, 'page cannot scroll (host overflow:hidden not overridden)');
    const txt = await mainText(page);
    assert.ok(txt.includes('Filmtaal 1'), 'course name');
    assert.ok(txt.includes('Les 1 — Introductie') && txt.includes('Les 4 — Montage en ritme'), 'top-level folders');
    assert.ok(!txt.includes('Verborgen map'), 'unavailable item shown');
    assert.ok(txt.includes('Docent A'), 'instructor');
    assert.ok(txt.includes('Lokaalwijziging les 5'), 'announcement');
    assert.ok(txt.includes("Opdracht 'Onder de huid'"), 'course deadline');
    assert.equal(await page.locator(S.sidebar).count(), 1, 'shell sidebar on Ultra');
    // Header line: "13 items · 3 nieuw" in label-2, no coloured dot.
    const sub = page.locator('#tplus-root .cv-sub');
    assert.match(await sub.innerText(), /^\d+ items?( · \d+ nieuw)?$/);
    assert.equal(await sub.locator('.tp-dot').count(), 0, 'no coloured dot in the header line');
    await screenshot(page, 'ultra-course-light-desktop');
  });

  it('course header "Zet in zijbalk" adds the course to the sidebar (and "Uit zijbalk" removes it)', async () => {
    const btn = page.locator('#tplus-root .cv-actions [data-action="sidebar"]');
    assert.equal((await btn.innerText()).trim(), 'Zet in zijbalk');
    assert.equal(await page.locator('#tplus-root nav.tp-sidebar .tp-sb-course').count(), 0, 'nothing in the sidebar yet');
    await btn.click();
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('nav.tp-sidebar .tp-sb-course.active[aria-current="page"]'), null, { timeout: 4000 });
    assert.equal((await btn.innerText()).trim(), 'Uit zijbalk');
    const lu = await btn.getAttribute('data-lu');
    assert.ok(await waitSettings(h, (st) => st.courses?.items?.[lu]?.inSidebar === true), 'stored');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.activeElement?.dataset?.fk === 'sidebar', null, { timeout: 2000 }).catch(() => {});
    assert.equal(await btn.evaluate((b) => b.getRootNode().activeElement === b), true, 'focus stays on the button after the re-render');
  });

  it('header "n nieuw" uses the feed\'s source; blue dots; "Alleen nieuw" filter; teachers card instead of chips ≥1100', async () => {
    const info = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const active = sr.querySelector('nav.tp-sidebar .tp-sb-course.active .tp-sb-count [aria-hidden]');
      return {
        header: (sr.querySelector('.cv-sub-new')?.textContent || '').trim(),
        feed: active ? Number(active.textContent) : null,
        dots: sr.querySelectorAll('[data-sec="recent"] .cv-new-dot, [data-tree] .cv-new-dot').length,
        chips: getComputedStyle(sr.querySelector('.cv-teachers') || document.body).display,
        teachersCard: !!sr.querySelector('[data-sec="teachers"]'),
      };
    });
    assert.match(info.header, /^\d+ nieuw$/, `header: ${info.header}`);
    assert.equal(Number(info.header.split(' ')[0]), info.feed, 'same number as the Nieuw feed / sidebar for this course (B10)');
    assert.ok(info.dots >= 2, 'blue dots on new items in Recent and Inhoud');
    assert.equal(info.chips, 'none', 'teacher chips hidden ≥1100px');
    assert.ok(info.teachersCard, 'Docenten card kept');
    // "Alleen nieuw"
    const toggle = page.locator('#tplus-root [data-action="only-new"]');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('[data-action="only-new"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    const only = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const leaves = [...sr.querySelectorAll('[data-tree] .cv-leaf, [data-tree] details.cv-doc')];
      return { n: leaves.length, allNew: leaves.every((l) => !!l.querySelector('.cv-new-dot')) };
    });
    assert.ok(only.n >= 1 && only.allNew, `only new leaves left in Inhoud: ${JSON.stringify(only)}`);
    const txt = await mainText(page);
    assert.ok(!txt.includes('Les 1 — Introductie'), 'folders without new items are hidden');
    await screenshot(page, 'ultra-course-only-new');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('[data-action="only-new"]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
    assert.ok((await mainText(page)).includes('Les 1 — Introductie'));
  });

  it('course deadlines: "Te laat" wording; the row shows the assignment here, a small icon opens Toledo', async () => {
    const dl = page.locator('#tplus-root [data-sec="deadlines"]');
    const txt = await dl.innerText();
    assert.ok(!/Verlopen/.test(txt), 'no "Verlopen" (vocabulary is "Te laat")');
    const ext = dl.locator('a.cv-ext');
    if (await ext.count()) {
      assert.equal(await ext.first().getAttribute('target'), '_blank');
    }
    const focusBtn = dl.locator('[data-action="focus-item"]').first();
    assert.equal(await focusBtn.count(), 1, 'a course deadline that is in the content tree focuses it');
    {
      const id = await focusBtn.getAttribute('data-id');
      await focusBtn.click();
      await page.waitForFunction((x) => {
        const sr = document.querySelector('#tplus-root').shadowRoot;
        return !!sr.querySelector(`[data-tree] .cv-focus, [data-tree] [data-fk$="t:${x}"].cv-focus`) || sr.activeElement?.dataset?.fk?.endsWith('t:' + x);
      }, id, { timeout: 4000 });
    }
  });

  it('uses absolute URLs only (nothing hits the <base href> CDN)', async () => {
    assert.deepEqual(h.rec.cdn, [], 'requests resolved against <base href>');
    const bad = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      return [...sr.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((u) => !/^(https?:|mailto:|#|blob:)/.test(u));
    });
    assert.deepEqual(bad, [], 'relative hrefs in the course view');
    const api = h.rec.requests.filter((r) => r.url.includes('/learn/api/public/'));
    assert.ok(api.length > 0, 'Ultra API was called');
    assert.deepEqual(h.rec.foreign, []);
  });

  it('expands folders, including nested ones', async () => {
    const les4 = page.locator(folder('Les 4 — Montage en ritme')).first();
    if (!(await les4.evaluate((d) => d.open))) await les4.locator('> summary').click();
    const extra = page.locator(folder('Extra fragmenten')).first();
    await extra.waitFor({ state: 'attached', timeout: 5000 });
    await extra.locator('> summary').click();
    await page.locator(folder('Achtergrond')).first().locator('> summary').click();
    await page.locator('#tplus-root :text("Diepe_bron_Kwartel.pdf")').first().waitFor({ state: 'visible', timeout: 5000 });
    await screenshot(page, 'ultra-course-open');
  });

  it('search finds items inside nested folders', async () => {
    // collapse everything first so search has to open the path
    await page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('details.cv-folder').forEach((d) => { d.open = false; }));
    await page.locator(S.search).fill('kwartel');
    await page.waitForTimeout(400);
    const hit = page.locator('#tplus-root :text("Diepe_bron_Kwartel.pdf")').first();
    assert.ok(await hit.isVisible(), 'nested hit visible');
    const txt = await mainText(page);
    assert.ok(!txt.includes('filmtaal_les1.pdf'), 'non-matching file still visible');
    await page.locator(S.search).fill('');
    await page.waitForTimeout(300);
  });

  it('download saves the file with the right name (302 → signed storage URL)', async () => {
    const file = tree[0]._kids[0]; // filmtaal_les1.pdf
    const les1 = page.locator(folder('Les 1 — Introductie')).first();
    if (!(await les1.evaluate((d) => d.open))) await les1.locator('> summary').click();
    const btn = page.locator(`#tplus-root [data-action="download"][data-id="${file.id}"]`).first();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), btn.click()]);
    assert.equal(dl.suggestedFilename(), 'filmtaal_les1.pdf');
    const got = await waitFor(() => h.rec.downloads.find((d) => d.fileName === 'filmtaal_les1.pdf'));
    assert.ok(got, 'signed storage URL was fetched');
    assert.ok(!got.headers.cookie, 'S3 fetch must not send credentials');
    assert.ok(h.rec.requests.some((r) => r.url.includes(`/contents/${file.id}/attachments/`) && r.url.endsWith('/download')), 'download endpoint called with absolute URL');
  });

  it('document bodies are sanitized (no script, no inline handlers, no javascript: urls)', async () => {
    const doc = page.locator('#tplus-root details.cv-doc').filter({ hasText: 'Leeswijzer' }).first();
    await doc.locator('> summary').click();
    const prose = doc.locator('.cv-prose');
    await prose.waitFor();
    assert.ok((await prose.innerText()).includes('hoofdstuk 4 en 5'), 'document body rendered');
    const report = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const all = [...sr.querySelectorAll('*')];
      return {
        scripts: sr.querySelectorAll('script').length,
        handlers: all.filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).map((e) => e.outerHTML.slice(0, 80)),
        jsUrls: all.filter((e) => /^\s*javascript:/i.test(e.getAttribute('href') || e.getAttribute('src') || '')).length,
        external: [...sr.querySelectorAll('.cv-prose a[href^="http"]')].map((a) => [a.target, a.rel]),
      };
    });
    assert.equal(report.scripts, 0, '<script> in shadow DOM');
    assert.deepEqual(report.handlers, [], 'inline event handlers in shadow DOM');
    assert.equal(report.jsUrls, 0, 'javascript: URLs');
    for (const [target, rel] of report.external) { assert.equal(target, '_blank'); assert.match(rel, /noopener/); }
    assert.equal(await page.evaluate(() => window.__tplusXss), undefined, 'injected code ran');
  });

  it('external links point to the real URL', async () => {
    const ext = await page.locator('#tplus-root a[href="https://example.org/filmdatabank"]').count();
    assert.ok(ext >= 1, 'external link rendered with its url');
  });

  it('shows a deep bar with a back link on a non-outline Ultra page (SPA navigation)', async () => {
    await page.evaluate(() => history.pushState({}, '', location.origin + '/ultra/courses/_900661_1/outline/file/_5000_1'));
    await page.waitForFunction(() => !!document.querySelector('#tplus-deep')?.shadowRoot?.querySelector('nav'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tplus-on')), false, 'shell should step aside on item pages');
    assert.ok(await page.locator('#site-wrap').isVisible(), 'original Ultra page visible');
    const back = page.locator('#tplus-deep a.tp-deep-back');
    assert.equal(await back.getAttribute('href'), COURSE_URL);
    await page.waitForFunction(() => /Filmtaal 1/.test(document.querySelector('#tplus-deep').shadowRoot.textContent), null, { timeout: 5000 }).catch(() => {});
    assert.match(await page.locator('#tplus-deep').evaluate((e) => e.shadowRoot.textContent), /Filmtaal 1/, 'back link names the course');
    await screenshot(page, 'ultra-deepbar');
    await back.click();
    await waitForShell(page);
  });

  it('deep bar on a non-course Ultra page', async () => {
    await page.goto('https://ultra.edu.kuleuven.cloud/ultra/stream');
    await page.waitForFunction(() => !!document.querySelector('#tplus-deep')?.shadowRoot?.querySelector('nav'), null, { timeout: 8000 });
    assert.equal(await page.locator('#tplus-deep a.tp-deep-back').count(), 0, 'no course back link outside a course');
    assert.deepEqual(h.rec.cdn, []);
  });

  it('classic toggle on the course page, and the pill re-enables Toledo+', async () => {
    await openCourse();
    await page.locator('#tplus-root [data-action="classic"]').first().click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    assert.ok(await page.locator('#site-wrap').isVisible());
    await page.locator(S.pill).waitFor({ state: 'visible' });
    assert.equal((await waitSettings(h, (x) => x.wrap && x.wrap.courses === false))?.wrap.courses, false);
    await page.locator(S.pill).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    await waitForShell(page);
  });

  it('no console errors, unknown endpoints or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), []);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });
});

describe('portal → course navigation', () => {
  let h;
  before(async () => { h = await launch(); });
  after(async () => { await h?.close(); });

  it('opening a course from the courses view lands on the Ultra outline (journey redirect)', async () => {
    const { openPortal } = require('../helpers/app');
    await openPortal(h, 'courses');
    const link = h.page.locator('#tplus-root main a[href*="batchUid=ULTRA-B-LUCA-X10265-2627"]').first();
    assert.equal(await link.count(), 1, 'course link uses enrollment.link');
    await Promise.all([h.page.waitForURL(/\/ultra\/courses\/_900661_1\/outline/, { timeout: 10000 }), link.click()]);
    await waitForShell(h.page);
    assert.ok((await mainText(h.page)).includes('Filmtaal 1'));
    assert.deepEqual(h.errors, []);
  });
});

describe('ultra course page without portal data', () => {
  let h;
  before(async () => { h = await launch({ mock: { portalDown: true } }); });
  after(async () => { await h?.close(); });

  it('a failing portal relay stays silent when the course itself loads', async () => {
    const page = h.page;
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitFor(() => h.rec.find((r) => r.url.includes('/portal/api/events')).length > 0);
    await page.waitForTimeout(600); // let the failed refresh land + rerender
    const err = await page.evaluate(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      const up = sr.querySelector('.tp-updated');
      return { headErr: !!sr.querySelector('.tp-updated-err') && !up.hidden, toast: sr.querySelector('.tp-toast.show')?.textContent || '' };
    });
    assert.equal(err.headErr, false, 'no "could not load Toledo" row in the course header');
    assert.equal(err.toast, '', 'no error toast');
    assert.deepEqual(h.errors.filter((e) => /pageerror|Uncaught/.test(e)), []);
  });
});
