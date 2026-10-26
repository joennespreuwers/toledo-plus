'use strict';
// Portal (toledo.kuleuven.be/portal): shell, overview, navigation, search, read-sync, deep bar, classic mode.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitFor, screenshot } = require('../helpers/launch');
const { S, strings, openPortal, waitForRoute, mainText, waitSettings } = require('../helpers/app');

const ROUTES = ['courses', 'deadlines', 'agenda', 'announcements', 'kuloket', 'settings', 'overview'];
const NAV = ['overview', 'courses', 'deadlines', 'agenda', 'announcements', 'kuloket', 'settings'];
const DAY = 864e5;
// course ids from the fixtures (codes are synthetic and may change: never hard-code them)
const ENR = require('../helpers/fixtures').load().portal.enrollments;
const enr = (name) => ENR.find((e) => e.title === name || e.title.startsWith(name + ' ['));
const lu = (name) => enr(name).learningUnitId;
const sr = (page, fn, arg) => page.evaluate(([src, a]) => new Function('sr', 'arg', `return (${src})(sr, arg);`)(document.querySelector('#tplus-root').shadowRoot, a), [fn.toString(), arg]);

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
    for (const r of NAV) {
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

  it('routes survive the portal\'s AngularJS router (no bounce to #/home, no fight)', async () => {
    const view = () => page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-view')?.dataset.route);
    await openPortal(h);
    await page.evaluate(() => { window.__tpRouterBounces = 0; });
    for (const r of ['deadlines', 'courses', 'settings']) {
      await page.locator(S.navLink(r)).first().click();
      await waitForRoute(page, r);
      await page.waitForTimeout(300); // longer than the mock router's 50 ms bounce
      assert.equal(await page.evaluate(() => location.hash), `#/home?tplus=${r}`, `${r}: hash kept`);
      assert.equal(await view(), r, `${r}: view kept`);
    }
    assert.equal(await page.evaluate(() => window.__tpRouterBounces), 0, 'our hashes never trigger the portal router redirect');
    // Back/forward still route.
    await page.goBack();
    await waitForRoute(page, 'courses');
    assert.equal(await view(), 'courses');
    // Old '#/tplus/<route>' bookmarks are upgraded in place and land on the right view.
    await page.goto('https://toledo.kuleuven.be/portal/#/tplus/deadlines');
    await waitForRoute(page, 'deadlines');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => location.hash), '#/home?tplus=deadlines');
    assert.equal(await view(), 'deadlines');
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

  it('old "planning" links render the agenda (ROUTE_ALIASES)', async () => {
    await page.goto('https://toledo.kuleuven.be/portal/#/home?tplus=planning');
    await waitForShell(page);
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-view')?.dataset.route === 'agenda', null, { timeout: 8000 });
    assert.equal(await page.locator(S.navLink('agenda')).first().getAttribute('aria-current'), 'page', 'Agenda is the current nav item');
    assert.equal(await page.locator(S.navLink('planning')).count(), 0, 'no separate planning item');
    // the overview schedule links to the agenda
    await openPortal(h);
    const link = page.locator(`${S.section('schedule')} a[data-route="agenda"]`);
    assert.equal(await link.count(), 1, '"Agenda ›" link under the timetable');
    assert.match(await link.getAttribute('href'), /#\/home\?tplus=agenda$/);
    const txt = await page.locator(S.section('schedule')).innerText();
    assert.ok(txt.includes('Filmtaal 1'), 'today\'s lessons (Toledo fallback without KU Loket data)');
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
    assert.ok(!/\[[A-Z]\d{4,}\]/.test(txt), 'course names are shown without the [code] suffix');
  });

  it('sidebar "Vakken" (v1.5): only courses added with "Zet in zijbalk"; empty → no group; course order; collapsible; no pin UI', async () => {
    const GELUID = lu('Geluid 1');
    const FILM = lu('Filmtaal 1');
    await h.setSettings({ courses: { sort: 'name' } });
    await openPortal(h, 'courses');
    const group = () => sr(page, (r) => {
      const ul = r.querySelector('nav.tp-sidebar #tp-sb-courses');
      return ul ? { hidden: ul.hidden, names: [...ul.querySelectorAll('.tp-sb-label')].map((x) => x.textContent), dots: ul.querySelectorAll('.tp-dot').length,
        counts: [...ul.querySelectorAll('.tp-sb-count .tp-sr')].map((x) => x.textContent), btn: r.querySelector('[data-shell="sb-courses"]')?.getAttribute('aria-expanded') } : null;
    });
    // existing users (v3 settings) start clean: no group at all
    assert.equal(await group(), null, 'no "Vakken" group while nothing is added');
    assert.equal(await page.locator('#tplus-root [data-shell="sb-courses"]').count(), 0, 'no heading either');
    // the trailing toggle on the course cards adds courses
    const toggle = (luId) => page.locator(`#tplus-root .cs-card [data-action="sidebar"][data-lu="${luId}"]`);
    assert.equal(await toggle(GELUID).getAttribute('aria-pressed'), 'false');
    await toggle(GELUID).click();
    await toggle(FILM).click();
    assert.ok(await waitSettings(h, (st) => st.courses?.items?.[GELUID]?.inSidebar === true && st.courses?.items?.[FILM]?.inSidebar === true), 'inSidebar stored per course');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('#tp-sb-courses .tp-sb-label').length === 2, null, { timeout: 4000 });
    assert.equal(await toggle(GELUID).getAttribute('aria-pressed'), 'true');
    let g = await group();
    assert.deepEqual(g.names, ['Filmtaal 1', 'Geluid 1'], 'only the added courses, in the courses sort (name)');
    assert.equal(g.dots, 2, 'colour dot per course');
    assert.ok(g.counts.length >= 1, 'unread count on courses with news');
    assert.equal(g.btn, 'true');
    // hide a course → it leaves the group
    await h.setSettings({ courses: { items: { [GELUID]: { hidden: true } } } });
    await openPortal(h, 'courses');
    g = await group();
    assert.deepEqual(g.names, ['Filmtaal 1'], 'hidden course not in the sidebar');
    await h.setSettings({ courses: { items: { [GELUID]: { hidden: false } }, sort: 'activity' } });
    await openPortal(h, 'courses');
    // collapse
    await page.locator('#tplus-root [data-shell="sb-courses"]').click();
    g = await group();
    assert.equal(g.hidden, true, 'collapsed');
    assert.equal(g.btn, 'false');
    assert.ok(await waitFor(async () => (await h.getState())?.ui?.sbCoursesClosed === true), 'collapse state persisted');
    await page.locator('#tplus-root [data-shell="sb-courses"]').click();
    // Vakken › Bewerk: a labelled "In zijbalk" switch per row removes it again
    await page.locator('#tplus-root [data-shell="view-action"][data-id="edit"]').click();
    const sw = page.locator(`#tplus-root input[name="sidebar__${FILM}"]`);
    assert.equal(await sw.isChecked(), true);
    await sw.click({ force: true });
    assert.ok(await waitSettings(h, (st) => !st.courses?.items?.[FILM]?.inSidebar), 'switch removes it');
    await page.waitForFunction(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('#tp-sb-courses .tp-sb-label')].map((x) => x.textContent).join() === 'Geluid 1', null, { timeout: 4000 });
    // no pin controls / labels anywhere (views + edit mode + settings)
    for (const route of [null, 'settings']) {
      if (route) await openPortal(h, route);
      const pins = await sr(page, (r) => r.querySelectorAll('[name^="pin__"], [data-action="pin"], [aria-labelledby="tp-sb-pinned"]').length);
      assert.equal(pins, 0, `no pin UI (${route || 'courses edit'})`);
      const txt = await mainText(page);
      assert.ok(!/Vastzet|Vastgezet/.test(txt), 'no pin wording');
    }
    // the palette is unaffected: it still searches every course
    await h.setSettings({ courses: { items: { [GELUID]: { inSidebar: false } } } });
    assert.deepEqual(h.errors, []);
  });

  it('sidebar badges: none on Overzicht, Deadlines = open count (red only when overdue), KU Loket without badge', async () => {
    await openPortal(h);
    const badges = () => sr(page, (r) => {
      const item = (route) => r.querySelector(`nav.tp-sidebar a[data-route="${route}"]`);
      const d = item('deadlines');
      return {
        overview: !!item('overview').querySelector('.tp-sb-count, .tp-badge'),
        kuloket: !!item('kuloket')?.querySelector('.tp-badge-red'),
        dlCount: d.querySelector('.tp-sb-count [aria-hidden]')?.textContent || null,
        dlRed: d.querySelector('.tp-badge-red')?.textContent || null,
      };
    });
    let b = await badges();
    assert.equal(b.overview, false, 'no count on Overzicht (it duplicated "Nieuw")');
    assert.equal(b.kuloket, false);
    // fixtures: "Montage-oefening 1" is 2 days overdue → red badge with the overdue count (not the open count)
    assert.equal(b.dlRed, '1', `red badge = overdue count: ${JSON.stringify(b)}`);
    assert.equal(b.dlCount, null, 'no second count next to the red badge');
    // mark it done → a plain open count in label-2
    await openPortal(h, 'deadlines');
    const row = page.locator('#tplus-root .va-dl', { hasText: 'Montage-oefening 1' }).first();
    await row.locator('[data-action="dl-done"]').click();
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('nav.tp-sidebar a[data-route="deadlines"] .tp-badge-red'), null, { timeout: 5000 });
    b = await badges();
    assert.ok(b.dlCount && Number(b.dlCount) >= 4 && !b.dlRed, `open deadlines as a plain count: ${JSON.stringify(b)}`);
    await page.locator('#tplus-root .va-dl', { hasText: 'Montage-oefening 1' }).first().locator('[data-action="dl-done"]').click();
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('nav.tp-sidebar a[data-route="deadlines"] .tp-badge-red'), null, { timeout: 5000 });
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
    const nl = strings('nl');
    const state = page.locator('#tplus-root .tp-noresults-state:visible');
    assert.equal(await state.count(), 1, 'exactly one empty state');
    assert.equal(await state.locator('.tp-nr-title').innerText(), nl['common.noResults.title']);
    assert.equal(await state.locator('.tp-nr-sub').innerText(), nl['common.noResults.for'].replace('{q}', 'zzqqxx'));
    assert.equal(await state.locator('svg').count(), 1, 'magnifier icon');
    await screenshot(page, 'search-empty-light-desktop');
    await input.fill('');
    await page.waitForTimeout(300);
    txt = await mainText(page);
    assert.ok(txt.includes('Productie 1'), 'clearing search restores content');
    // A view with its own onSearch (courses) shows the same single empty state.
    await openPortal(h, 'courses');
    await page.locator(S.search).fill('zzqqxx');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#tplus-root .tp-noresults-state:visible').count(), 1, 'one empty state on courses');
    await page.locator(S.search).fill('');
    await openPortal(h);
    // keyboard: "/" opens the ⌘K palette (the toolbar field keeps filtering the current view)
    await page.locator(S.title).click();
    await page.keyboard.press('/');
    assert.ok(await page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.activeElement?.classList.contains('tp-pal-input')), '"/" focuses the palette input');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette').open), false);
  });

  it('consistent unread style; "Ad Valvas" segment; new badges are tint-soft (never solid like overdue)', async () => {
    await openPortal(h, 'announcements');
    const nl = strings('nl');
    const r = await sr(page, (root) => {
      const rows = [...root.querySelectorAll('.va-ann-list > *')];
      const bad = rows.filter((el) => {
        const unread = !!el.querySelector('.va-unread:not(.va-unread-off)');
        const title = el.querySelector('.tp-row-title');
        return unread !== !!(title && title.classList.contains('strong'));
      }).length;
      return { rows: rows.length, bad };
    });
    assert.ok(r.rows >= 3 && r.bad === 0, `every unread row = dot + 600 (${JSON.stringify(r)})`);
    const segs = await page.locator('#tplus-root input[name="an-filter"] + span').allInnerTexts();
    assert.ok(segs.includes('Ad Valvas') && !segs.includes('School'), `segments: ${segs}`);
    assert.equal(nl['announcements.filter.school'], 'Ad Valvas');
    await openPortal(h);
    const badge = await sr(page, (root) => {
      const b = root.querySelector('.va-feed .tp-badge-tint');
      const red = root.querySelector('nav .tp-badge-red');
      return b && red ? { tint: getComputedStyle(b).backgroundColor, red: getComputedStyle(red).backgroundColor } : null;
    });
    assert.ok(badge && badge.tint !== badge.red, 'new badge differs from the overdue badge');
    let [rr, gg, bb] = badge.tint.match(/[\d.]+/g).map(Number).slice(-3);
    if (/^color\(/.test(badge.tint)) [rr, gg, bb] = [rr, gg, bb].map((x) => x * 255);
    assert.ok(rr > 200 && gg > 200 && bb > 200, `new badge is a soft tint, not a solid fill: ${badge.tint}`);
  });

  it('search on the overview filters the "Nieuw" count and hides empty day headers (B11)', async () => {
    await openPortal(h);
    const count = () => sr(page, (root) => root.querySelector('section[data-section="ov-new"] .tp-sec-title .tp-count')?.textContent || '');
    const before = Number(await count());
    await page.locator(S.search).fill('geluid');
    await page.waitForTimeout(400);
    const after = Number(await count());
    const visible = await sr(page, (root) => [...root.querySelectorAll('.va-feed .va-feed-item:not(.is-read)')].filter((x) => !x.hidden && !x.closest('[hidden]')).length);
    assert.ok(after < before && after === visible, `count follows the filter: ${before} → ${after} (visible ${visible})`);
    const heads = await sr(page, (root) => [...root.querySelectorAll('[data-va-day]')].filter((d) => !d.hidden).map((d) => d.querySelectorAll('[data-q]:not([hidden])').length));
    assert.ok(heads.every((n) => n > 0), `no empty day headers while searching: ${heads}`);
    await page.locator(S.search).fill('');
    await page.waitForTimeout(300);
    assert.equal(Number(await count()), before, 'count restored');
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
    await page.goto('https://toledo.kuleuven.be/portal/#/deep/some/page');
    await page.waitForFunction(() => !!document.querySelector('#tplus-deep')?.shadowRoot?.querySelector('nav'), null, { timeout: 8000 });
    assert.ok(await page.locator('#classic-portal').isVisible(), 'original page stays visible under the deep bar');
    const link = page.locator('#tplus-deep a.tp-deep-mark');
    assert.match(await link.getAttribute('href'), /^https:\/\/toledo\.kuleuven\.be\/portal\/#\/home\?tplus=overview$/);
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

  it('account menu: no second "Instellingen", neutral mail badge, clearer Toledo notification settings', async () => {
    await openPortal(h);
    const nl = strings('nl');
    await page.locator(S.menuBtn).click();
    const menu = page.locator('#tplus-root .tp-menu');
    await menu.waitFor({ state: 'visible' });
    assert.equal(await menu.locator('[data-route="settings"]').count(), 0, 'Instellingen only in the sidebar/More');
    assert.equal(await menu.locator('.tp-badge-red').count(), 0, 'mail badge is not red');
    assert.equal(await menu.locator('.tp-badge-gray').count(), 1, 'gray mail badge');
    assert.ok((await menu.innerText()).includes(nl['shell.notifSettings']));
    assert.equal(nl['shell.notifSettings'], 'Meldingsinstellingen in Toledo');
    await page.keyboard.press('Escape');
  });

  it('default course colours are unique among the current courses', async () => {
    await h.setSettings({ courses: { items: {} } });
    await openPortal(h, 'courses');
    const colors = await sr(page, (root) => [...root.querySelectorAll('.cs-grid .cs-swatch')].map((e) => getComputedStyle(e).backgroundColor));
    assert.ok(colors.length >= 10, `cards: ${colors.length}`);
    assert.equal(new Set(colors).size, colors.length, `duplicate default colours: ${colors}`);
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

const PROD_CID = Object.entries(require('../helpers/fixtures').load().ultra.courses).find(([, c]) => c.courseId === lu('Productie 1'))[0];

describe('deadlines: overdue, detail sheet, onboarding (v1.4)', () => {
  let h; let page;
  before(async () => {
    h = await launch();
    page = h.page;
    // B2: a deadline 10 days overdue (outside the old now−7d window) must stay visible until it is marked done.
    h.fx.portal.events.push({ id: 'ev-old-late', type: 'notifications', subType: 'due', eventType: 'update', date: Date.now() - 10 * DAY,
      sourceId: lu('Productie 1'), source: enr('Productie 1').title, title: 'Oude vergeten opdracht', read: false, seen: false, dismissed: false,
      url: `https://ultra.edu.kuleuven.cloud/ultra/redirect?redirectType=nautilus&courseId=${PROD_CID}&contentId=_9100_1` });
  });
  after(async () => { await h?.close(); });

  it('onboarding card shows once on the overview and stays dismissed', async () => {
    await openPortal(h);
    const nl = strings('nl');
    const card = page.locator('#tplus-root section.va-onboard');
    assert.equal(await card.count(), 1, 'onboarding card on first use');
    const txt = await card.innerText();
    for (const k of ['overview.onboard.what', 'overview.onboard.classic', 'overview.onboard.read']) assert.ok(txt.includes(nl[k].slice(0, 30)), k);
    await screenshot(page, 'overview-onboarding');
    await card.locator('[data-action="ov-onboard-close"]').first().click();
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('section.va-onboard'), null, { timeout: 4000 });
    assert.ok(await waitFor(async () => (await h.getState())?.ui?.onboarded === true), 'state.ui.onboarded');
    await page.reload();
    await openPortal(h);
    assert.equal(await page.locator('#tplus-root section.va-onboard').count(), 0, 'not shown again');
  });

  it('overdue deadlines older than a week stay visible ("Te laat" › "Ouder dan een week")', async () => {
    const nl = strings('nl');
    const ov = await page.locator(S.section('deadlines')).innerText();
    assert.ok(ov.includes('Oude vergeten opdracht'), 'overview shows the 10-day-old overdue deadline');
    await openPortal(h, 'deadlines');
    const late = page.locator('#tplus-root section[data-section="dl-g-overdue"]');
    assert.equal(await late.count(), 1, '"Te laat" group');
    assert.ok((await late.locator('.tp-sec-title').innerText()).includes(nl['deadlines.group.overdue']));
    const old = late.locator('details[data-dl-old]');
    assert.equal(await old.count(), 1, '"Ouder dan een week" disclosure');
    assert.equal(await old.evaluate((d) => d.open), false, 'collapsed by default');
    assert.ok((await old.locator('summary').innerText()).includes(nl['deadlines.group.older'].replace('{n}', '1')));
    assert.ok(await old.locator('.va-dl', { hasText: 'Oude vergeten opdracht' }).count() === 1);
    const sub = await page.locator('#tplus-root .tp-subtitle').innerText();
    assert.match(sub, /\d+ open · 2 te laat/, `subtitle "n open · m te laat": ${sub}`);
    // vocabulary: "Te laat" on the rows, "Zet in agenda" as the action
    assert.ok((await late.innerText()).includes('Te laat'));
    assert.equal(await page.locator('#tplus-root [data-shell="view-action"]').first().innerText(), nl['deadlines.export']);
    assert.equal(nl['deadlines.export'], 'Zet in agenda');
    // search opens the collapsed group and counts follow the filter (B11)
    await page.locator(S.search).fill('vergeten');
    await page.waitForTimeout(400);
    assert.equal(await old.evaluate((d) => d.open), true, 'search opens the disclosure with the hit');
    assert.equal((await late.locator('.tp-sec-title .tp-count').innerText()).trim(), '1', 'section count follows the search');
    assert.equal(await page.locator('#tplus-root section[data-section="dl-g-w0"]:visible, #tplus-root section[data-section="dl-g-w1"]:visible').count(), 0, 'empty group headers hidden');
    await page.locator(S.search).fill('');
  });

  it('a deadline row opens the detail sheet: course, due, source, actions; "Zet in agenda" downloads one event', async () => {
    await openPortal(h, 'deadlines');
    const nl = strings('nl');
    const row = page.locator('#tplus-root .va-dl', { hasText: 'Productiedossier' }).first();
    await row.locator('.va-dl-open').click();
    const dlg = page.locator('#tplus-root dialog.tp-detail');
    await dlg.waitFor({ state: 'visible', timeout: 4000 });
    assert.equal(await dlg.evaluate((d) => d.open), true);
    assert.equal((await dlg.locator('#tp-detail-title').innerText()).trim(), 'Productiedossier');
    const txt = await dlg.innerText();
    for (const want of ['Productie 1', nl['va.sheet.due'], nl['va.sheet.source'], nl['va.sheet.openCourse'], nl['va.addToCalendar'], nl['va.sheet.markDone']]) {
      assert.ok(txt.includes(want), `sheet shows "${want}"`);
    }
    await dlg.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
    await screenshot(page, 'deadline-sheet-light-desktop');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 5000 }),
      dlg.locator('[data-detail-action="ics"]').click(),
    ]);
    assert.match(dl.suggestedFilename(), /\.ics$/);
    const ics = await (async () => { const p = await dl.path(); return require('fs').readFileSync(p, 'utf8'); })();
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1, 'single event');
    assert.ok(ics.includes('Productiedossier'));
    // mark done from the sheet
    await dlg.locator('[data-detail-action="done"]').click();
    const key = await row.getAttribute('data-key');
    assert.ok(await waitFor(async () => !!(await h.getState())?.done?.[key]), 'marked done in state');
    assert.ok((await dlg.innerText()).includes(nl['va.sheet.markOpen']), 'sheet updates to "niet klaar"');
    await dlg.locator('[data-detail-action="done"]').click();
    // Esc closes and returns focus to the row
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-detail').open, null, { timeout: 3000 });
    const focused = await page.waitForFunction(() => {
      const a = document.querySelector('#tplus-root').shadowRoot.activeElement;
      return a && a.classList.contains('va-dl-open') && a.isConnected ? a.dataset.key : false;
    }, null, { timeout: 3000 }).then((x) => x.jsonValue()).catch(() => null);
    assert.ok(focused, 'focus back on the row');
  });

  it('"Open in vak" lands on the course with the assignment focused (state.focus)', async () => {
    await openPortal(h, 'deadlines');
    await page.locator('#tplus-root .va-dl', { hasText: 'Oude vergeten opdracht' }).first().evaluate((el) => { const d = el.closest('details'); if (d) d.open = true; });
    await page.locator('#tplus-root .va-dl', { hasText: 'Oude vergeten opdracht' }).first().locator('.va-dl-open').click();
    await page.locator('#tplus-root dialog.tp-detail [data-detail-action="course"]').click();
    await page.waitForURL(/ultra\.edu\.kuleuven\.cloud\/ultra\/courses\//, { timeout: 15000 });
    const st = await h.getState();
    assert.ok(st && (st.focus === null || st.focus === undefined || st.focus.id === '_9100_1'), `focus hand-off: ${JSON.stringify(st && st.focus)}`);
    assert.deepEqual(h.errors.filter((e) => /pageerror/.test(e)), []);
  });
});

describe('error states (portal API down)', () => {
  let h; let page;
  before(async () => { h = await launch({ mock: { portalDown: true } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('no infinite skeletons and no false empty states; inline error rows with "Opnieuw"', async () => {
    await page.goto('https://toledo.kuleuven.be/portal/#/home');
    await waitForShell(page);
    const nl = strings('nl');
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-error-row').length >= 2, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    const state = await sr(page, (r) => ({
      skel: [...r.querySelectorAll('main .tp-skeleton')].length,
      errors: r.querySelectorAll('main .tp-error-row').length,
      retry: r.querySelectorAll('main .tp-error-row [data-action="va-retry"]').length,
      text: r.querySelector('main').innerText,
    }));
    assert.equal(state.skel, 0, 'no skeleton left after the load failed');
    assert.ok(state.errors >= 2 && state.retry >= 2, `per-section error rows with retry: ${JSON.stringify({ e: state.errors, r: state.retry })}`);
    for (const k of ['overview.new.empty', 'overview.schedule.none', 'overview.ann.empty', 'overview.courses.empty']) {
      assert.ok(!state.text.includes(nl[k]), `false empty state "${nl[k]}"`);
    }
    await screenshot(page, 'overview-error');
    // retry asks Toledo again
    h.rec.reset();
    await page.locator('#tplus-root main [data-action="va-retry"]').first().click();
    assert.ok(await waitFor(() => h.rec.requests.some((r) => /\/portal\/api\//.test(r.url)), { timeout: 5000 }), 'retry re-requests the portal API');
    for (const route of ['announcements', 'courses', 'deadlines']) {
      await page.goto(`https://toledo.kuleuven.be/portal/#/home?tplus=${route}`);
      await waitForShell(page);
      await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('main .tp-error-row'), null, { timeout: 15000 });
      const t2 = await mainText(page);
      assert.ok(!t2.includes(nl['announcements.empty.all']) && !t2.includes(nl['courses.empty']) && !t2.includes(nl['deadlines.empty.open']), `${route}: no false empty`);
      assert.equal(await page.locator('#tplus-root main .tp-skeleton').count(), 0, `${route}: no skeleton`);
    }
  });
});

describe('session expired (portal API answers with the HTML login page)', () => {
  let h; let page;
  const LOGIN = '<!doctype html><html><head><title>KU Leuven Login</title></head><body><form action="/idp/profile/SAML2">login</form></body></html>';
  const handler = (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LOGIN });
  before(async () => {
    h = await launch();
    page = h.page;
    await h.ctx.route('https://toledo.kuleuven.be/portal/api/**', handler);
  });
  after(async () => { await h?.close(); });

  it('shows a non-blocking "Log opnieuw in" banner; it goes away once Toledo answers again', async () => {
    const nl = strings('nl');
    await page.goto('https://toledo.kuleuven.be/portal/#/home');
    await waitForShell(page);
    const banner = page.locator('#tplus-root [data-banner="auth"]');
    await banner.waitFor({ state: 'visible', timeout: 15000 });
    const txt = await banner.innerText();
    assert.ok(txt.includes(nl['shell.authTitle']) && txt.includes(nl['shell.login']), txt);
    assert.match(await banner.locator('a').getAttribute('href'), /^https:\/\/toledo\.kuleuven\.be\//);
    assert.ok(await page.locator(S.sidebar).isVisible(), 'the app stays usable');
    await screenshot(page, 'banner-auth');
    await h.ctx.unroute('https://toledo.kuleuven.be/portal/api/**', handler);
    await page.locator('#tplus-root [data-shell="refresh"]').first().click();
    await banner.waitFor({ state: 'detached', timeout: 15000 });
  });
});

describe('greeting with first name + mail button (v1.5)', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });
  const GREET = /^(Goedemorgen|Goedemiddag|Goedenavond|Goedenacht)/;

  it('"Goedenavond, Alex": first name from Ultra users/me (via the relay), cached locally, never sent anywhere', async () => {
    await openPortal(h, 'overview');
    await page.waitForFunction(() => /, Alex$/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-large-title')?.textContent || ''), null, { timeout: 8000 });
    const title = await page.locator(S.title).innerText();
    assert.match(title, GREET, `Dutch greeting spelling: ${title}`);
    assert.match(title, /^Goede(morgen|middag|navond|nacht), Alex$/, 'only the first given name');
    assert.ok(h.rec.find((r) => /\/learn\/api\/public\/v1\/users\/me$/.test(r.url)).length >= 1, 'users/me asked');
    const st = await h.getState();
    assert.equal(st.me?.given, 'Alex', 'cached in state (chrome.storage.local)');
    const sync = await h.getSettings();
    assert.ok(!JSON.stringify(sync).includes('Alex'), 'never in synced settings');
    assert.ok(!h.rec.requests.some((r) => (r.body || '').includes('Alex') || /Alex/.test(r.url)), 'never sent in any request');
    // cached: a reload shows it without asking again
    const n = h.rec.find((r) => /users\/me$/.test(r.url)).length;
    await openPortal(h, 'overview');
    assert.match(await page.locator(S.title).innerText(), /, Alex$/);
    assert.equal(h.rec.find((r) => /users\/me$/.test(r.url)).length, n, 'not fetched again within a week');
    assert.deepEqual(h.errors, []);
  });

  it('toolbar mail button: envelope, ≥ 24px, grey unread badge, opens Outlook in a new tab; also in the account menu; More sheet on phones', async () => {
    await openPortal(h, 'overview');
    const mail = page.locator('#tplus-root .tp-toolbar a.tp-mail');
    assert.ok(await mail.isVisible(), 'visible on desktop');
    assert.equal(await mail.getAttribute('href'), 'https://outlook.office.com/mail/');
    assert.equal(await mail.getAttribute('target'), '_blank');
    assert.match(await mail.getAttribute('rel'), /noopener/);
    const b = await mail.boundingBox();
    assert.ok(b.width >= 24 && b.height >= 24, `target ${b.width}×${b.height}`);
    const n = Number(h.fx.portal.mail.value);
    const badge = mail.locator('.tp-mail-badge');
    if (n) {
      assert.equal((await badge.innerText()).trim(), n > 99 ? '99+' : String(n));
      assert.match(await mail.getAttribute('aria-label'), new RegExp(`${n} ongelezen`));
      assert.equal(await page.locator('#tplus-root .tp-avatar-dot').isVisible(), false, 'no second mail dot on the avatar ≥ 700px');
    }
    assert.equal(await mail.getAttribute('title').then((x) => x.startsWith('Mail')), true, 'tooltip');
    // still in the account menu
    await page.locator(S.menuBtn).click();
    assert.equal(await page.locator('#tplus-root .tp-menu a[href="https://outlook.office.com/mail/"]').count(), 1);
    await page.keyboard.press('Escape');
    // phones: not in the crowded toolbar, but in the More sheet
    await page.setViewportSize({ width: 390, height: 844 });
    await openPortal(h, 'overview');
    assert.equal(await mail.isVisible(), false, 'hidden in the phone toolbar');
    await page.locator(`${S.tabbar} [data-shell="more"]`).click();
    const row = page.locator('#tplus-root dialog.tp-sheet a[href="https://outlook.office.com/mail/"]');
    await row.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await row.getAttribute('target'), '_blank');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(h.errors, []);
  });
});

describe('greeting without a known name', () => {
  let h;
  before(async () => { h = await launch({ mock: { noUser: true } }); });
  after(async () => { await h?.close(); });
  it('keeps the plain greeting (no comma, no placeholder)', async () => {
    await openPortal(h, 'overview');
    await h.page.waitForTimeout(800);
    assert.match(await h.page.locator(S.title).innerText(), /^Goede(morgen|middag|navond|nacht)$/);
    assert.equal((await h.getState())?.me?.given, undefined);
  });
});
