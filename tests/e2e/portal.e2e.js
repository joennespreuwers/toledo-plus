'use strict';
// Portal (toledo.kuleuven.be/portal): shell, overview, navigation, search, read-sync, deep bar, classic mode.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitFor, screenshot } = require('../helpers/launch');
const { S, strings, openPortal, waitForRoute, mainText, waitSettings } = require('../helpers/app');

const ROUTES = ['courses', 'deadlines', 'planning', 'announcements', 'settings', 'overview'];

describe('portal shell', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('renders the shell on the portal home without errors', async () => {
    await openPortal(h);
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('tplus-on')), 'html.tplus-on missing');
    assert.equal(await page.locator('#classic-portal').isVisible(), false, 'original portal should be hidden');
    await page.locator(S.sidebar).waitFor();
    const nl = strings('nl');
    for (const r of ['overview', 'courses', 'deadlines', 'planning', 'announcements', 'settings']) {
      assert.equal(await page.locator(S.navLink(r)).count() >= 1, true, `sidebar link ${r}`);
    }
    assert.equal(await page.locator(S.navLink('overview')).first().getAttribute('aria-current'), 'page');
    assert.equal(await page.locator(S.app).getAttribute('lang'), 'nl');
    const text = await page.locator(S.sidebar).innerText();
    assert.ok(text.includes(nl['nav.overview']), 'sidebar is in Dutch');
    // skip link + landmarks
    assert.equal(await page.locator('#tplus-root a.tp-skip').count(), 1);
    assert.equal(await page.locator('#tplus-root main').count(), 1);
    await page.waitForTimeout(500); // let background refresh settle
    assert.deepEqual(h.errors, [], 'console/page errors');
    await screenshot(page, 'portal-overview');
  });

  it('overview shows the enabled default sections', async () => {
    for (const id of ['deadlines', 'new', 'recent', 'courses', 'schedule', 'announcements']) {
      // "recent" may be legitimately empty-and-hidden for a fresh profile; others must exist
      if (id === 'recent') continue;
      assert.equal(await page.locator(S.section(id)).count(), 1, `section ${id}`);
    }
    assert.equal(await page.locator(S.section('links')).count(), 0, 'links section is off by default');
  });

  it('compact feed shows at most feed.maxCourses rows and a "show all" toggle', async () => {
    const feed = page.locator(`${S.section('new')} .va-feed`);
    await feed.waitFor();
    const visible = await feed.locator('details[data-lu]:visible').count();
    const total = await feed.locator('details[data-lu]').count();
    assert.ok(visible > 0, 'feed has rows');
    assert.ok(visible <= 5, `visible feed rows ${visible} > maxCourses 5`);
    assert.ok(total > 5, `fixtures produce > 5 feed groups (got ${total})`);
    // 'course' and 'due' subtypes never appear in the feed
    const txt = await feed.innerText();
    assert.ok(!txt.includes('Ver weg deadline'), 'due events must not be in the feed');
    await feed.locator('[data-action="ov-showall"]').click();
    await page.waitForFunction(() => {
      const sr = document.querySelector('#tplus-root').shadowRoot;
      return [...sr.querySelectorAll('.va-feed details[data-lu]')].every((d) => !d.hidden);
    }, null, { timeout: 3000 });
    // groups are collapsed by default and expand to ≤ 3 items
    const first = feed.locator('details[data-lu]').first();
    assert.equal(await first.evaluate((d) => d.open), false, 'feed groups collapsed by default');
    await first.locator('summary').click();
    const items = await first.locator('.va-feed-item:visible').count();
    assert.ok(items >= 1 && items <= 3, `expanded group shows 1..3 items (got ${items})`);
  });

  it('feed excludes dismissed events', async () => {
    const txt = await page.locator(S.section('new')).innerText();
    assert.ok(!txt.includes('Kleurenleer_deel2.png'), 'dismissed event shown');
  });

  it('navigates to every route via the sidebar', async () => {
    for (const r of ROUTES) {
      await page.locator(S.navLink(r)).first().click();
      await waitForRoute(page, r);
      assert.equal(await page.locator(S.navLink(r)).first().getAttribute('aria-current'), 'page', `${r} aria-current`);
      const title = (await page.locator(S.title).innerText()).trim();
      assert.ok(title.length > 0, `${r} has a large title`);
      const body = (await page.locator(S.view).innerText()).trim();
      assert.ok(body.length > 0, `${r} renders content`);
      await screenshot(page, `portal-${r}`);
    }
    assert.deepEqual(h.errors, []);
  });

  it('deadlines view merges Toledo + Ultra calendar deadlines within the horizon', async () => {
    await openPortal(h, 'deadlines');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('main').innerText.includes('Shotlist korte film'), null, { timeout: 8000 })
      .catch(() => {});
    const txt = await mainText(page);
    assert.ok(txt.includes("Opdracht 'Onder de huid'"), 'Toledo due event');
    assert.ok(txt.includes('Productiedossier'), 'Toledo due event (12 d)');
    assert.ok(txt.includes('Shotlist korte film'), 'Ultra calendar item (via relay) missing');
    // the Deadlines view may list everything; the overview respects deadlines.horizonDays (42)
    await openPortal(h);
    const ov = await page.locator(S.section('deadlines')).innerText();
    assert.ok(!ov.includes('Ver weg deadline'), 'overview shows a deadline beyond horizonDays (42)');
    await openPortal(h, 'deadlines');
    const dupes = txt.split("Opdracht 'Onder de huid'").length - 1;
    assert.ok(dupes <= 1, `Toledo + Ultra duplicate not deduped (${dupes}×)`);
  });

  it('planning view shows today/tomorrow and links to the KU Loket timetable', async () => {
    await openPortal(h, 'planning');
    const txt = await mainText(page);
    assert.ok(txt.includes('Filmtaal 1') && txt.includes('Geluid 1'), 'upcoming lessons');
    assert.equal(await page.locator('#tplus-root a[href="https://kuloket.example.edu/uurrooster"]').count() >= 1, true, 'KULOKET-UURROOSTER link');
  });

  it('announcements view shows course announcements and Ad Valvas', async () => {
    await openPortal(h, 'announcements');
    const txt = await mainText(page);
    assert.ok(txt.includes('Lokaalwijziging les 5'), 'course announcement');
    assert.ok(txt.includes('Stel je kandidaat voor de commissie duurzaamheid'), 'Ad Valvas');
  });

  it('courses view lists current courses, not the older year / unavailable by default', async () => {
    await openPortal(h, 'courses');
    const txt = await mainText(page);
    for (const c of ['Filmtaal 1', 'Regie 1', 'Geluid 1']) assert.ok(txt.includes(c), c);
    assert.ok(!txt.includes('Wiskunde 1'), 'older academic year should be in the (collapsed) archive');
    assert.ok(!txt.includes('[N50265]'), 'course names are shown without the [code] suffix');
  });

  it('search filters the overview and shows an empty state', async () => {
    await openPortal(h);
    const input = page.locator(S.search);
    await input.fill('geluid');
    await page.waitForTimeout(400);
    let txt = await mainText(page);
    assert.ok(/Geluid/.test(txt), 'hit visible');
    assert.ok(!txt.includes('Productie 1'), 'non-matching course still visible');
    await input.fill('zzqqxx');
    await page.waitForTimeout(400);
    txt = await mainText(page);
    assert.ok(txt.includes('zzqqxx'), 'no-results message mentions the query');
    await input.fill('');
    await page.waitForTimeout(300);
    txt = await mainText(page);
    assert.ok(txt.includes('Productie 1'), 'clearing search restores content');
    // keyboard: "/" focuses search
    await page.locator(S.title).click();
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.activeElement?.dataset?.shell), 'search');
    await page.keyboard.press('Escape');
  });

  it('"mark all read" sends PATCH /portal/api/batch/events with the right body', async () => {
    await openPortal(h);
    h.rec.reset();
    const btn = page.locator(`${S.section('new')} [data-action="ov-readall"]`);
    await btn.click();
    const patch = await waitFor(() => h.rec.patches.find((p) => p.path === '/portal/api/batch/events'), { timeout: 5000 });
    assert.ok(patch, 'no PATCH batch/events sent');
    assert.ok(Array.isArray(patch.body) && patch.body.length > 0, 'body is a non-empty array');
    const unreadFeed = new Set(h.fx.portal.events.filter((e) => e.type === 'notifications').map((e) => e.id));
    for (const b of patch.body) {
      assert.deepEqual(Object.keys(b).sort(), ['id', 'read', 'subType', 'type'].sort(), `body item keys ${JSON.stringify(b)}`);
      assert.equal(b.read, true);
      assert.ok(unreadFeed.has(b.id) || b.type === 'advalvas', `unexpected id ${b.id}`);
      const ev = h.fx.portal.events.find((e) => e.id === b.id);
      assert.equal(b.type, ev.type); assert.equal(b.subType, ev.subType);
      assert.notEqual(b.subType, 'due'); assert.notEqual(b.subType, 'course');
    }
    assert.ok(patch.body.some((b) => b.id === 'ev-1'), 'newest Filmtaal item included');
    // After navigation the feed is empty (rows stay stable while reading, per DESIGN.md)
    await openPortal(h, 'courses');
    await openPortal(h, 'overview');
    assert.equal(await page.locator(`${S.section('new')} details[data-lu]`).count(), 0, 'feed should be empty after "mark all read" + navigation');
  });

  it('never talks to third parties or the <base href> CDN', async () => {
    assert.deepEqual(h.rec.foreign, [], 'requests to foreign domains');
    assert.deepEqual(h.rec.cdn, [], 'relative URL requests');
  });

  it('shows the deep bar on portal pages it does not replace', async () => {
    await page.goto('https://toledo.kuleuven.be/portal/#/some/deep/page');
    await page.waitForFunction(() => !!document.querySelector('#tplus-deep')?.shadowRoot?.querySelector('nav'), null, { timeout: 8000 });
    assert.ok(await page.locator('#classic-portal').isVisible(), 'original page stays visible under the deep bar');
    const link = page.locator('#tplus-deep a.tp-deep-mark');
    assert.match(await link.getAttribute('href'), /^https:\/\/toledo\.kuleuven\.be\/portal\/#\/tplus\/overview/);
  });

  it('classic toggle shows the original portal and the pill re-enables Toledo+', async () => {
    await openPortal(h);
    await page.locator(S.menuBtn).click();
    await page.locator(S.classicBtn).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    assert.ok(await page.locator('#classic-portal').isVisible(), 'classic portal visible');
    const pill = page.locator(S.pill);
    await pill.waitFor({ state: 'visible', timeout: 5000 });
    await screenshot(page, 'portal-classic');
    const s = await waitSettings(h, (x) => x.wrap && x.wrap.portal === false);
    assert.equal(s && s.wrap.portal, false, 'settings.wrap.portal persisted');
    await pill.click();
    await page.waitForFunction(() => document.documentElement.classList.contains('tplus-on'), null, { timeout: 5000 });
    await waitForShell(page);
    assert.equal(await page.locator('#classic-portal').isVisible(), false);
    assert.equal((await waitSettings(h, (x) => x.wrap && x.wrap.portal === true))?.wrap.portal, true);
  });

  it('no console errors or page errors overall', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.unknown.map((e) => `${e.method} ${e.url}`), [], 'calls to endpoints that are not in the contract/mocks');
  });
});

describe('portal degrades gracefully', () => {
  let h;
  before(async () => { h = await launch({ mock: { ultraDown: true } }); });
  after(async () => { await h?.close(); });

  it('Ultra relay failing (no Ultra session) does not break the portal', async () => {
    await openPortal(h, 'deadlines');
    const txt = await mainText(h.page);
    assert.ok(txt.includes("Opdracht 'Onder de huid'"), 'portal deadlines still shown');
    assert.deepEqual(h.errors.filter((e) => /pageerror|Uncaught/.test(e)), [], 'no uncaught errors');
  });
});
