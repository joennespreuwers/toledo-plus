'use strict';
// Bug bash 2026-10 (content & reading): one "mark as read" with a scope + Undo (Overzicht, Mededelingen, course page),
// failure states that don't claim success, the course page's reading pieces and Vakken › Bewerk in the URL.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell, waitForIdle, waitForQuiet, waitFor, screenshot, COURSE_URL } = require('../helpers/launch');
const { S, strings, openPortal } = require('../helpers/app');

const sr = (page, fn, arg) => page.evaluate(([src, a]) => new Function('sr', 'arg', `return (${src})(sr, arg);`)(document.querySelector('#tplus-root').shadowRoot, a), [fn.toString(), arg]);
const ENR = require('../helpers/fixtures').load().portal.enrollments;
const lu = (name) => ENR.find((e) => e.title.startsWith(name + ' [')).learningUnitId;
const toastTexts = (page) => sr(page, (r) => [...r.querySelectorAll('.tp-toasts .tp-toast')].map((x) => x.textContent.trim()));
const nl = strings('nl');

describe('Overzicht › Nieuw: mark as read covers what is in view, with Undo', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('the tab title names the page, the greeting stays the large title (TP-006)', async () => {
    await openPortal(h);
    assert.equal(await page.title(), `${nl['nav.overview']} · Toledo+`);
    assert.match(await page.locator(S.title).innerText(), /^Goede(morgen|middag|navond|nacht)/);
  });

  it('"Nieuw" says what it counts; the announcements link carries the unread count; rows name the sender (TP-005, TP-156, TP-198)', async () => {
    const info = await sr(page, (r) => ({
      note: r.querySelector('section[data-section="ov-new"] .va-sec-note')?.textContent || '',
      annLink: r.querySelector('section[data-section="ov-announcements"] .tp-sec-actions')?.textContent.trim() || '',
      author: r.querySelector('section[data-section="ov-announcements"] .va-author')?.textContent || '',
      pill: (() => { const b = r.querySelector('section[data-section="ov-announcements"] .tp-badge[role="img"]'); return b ? [b.getAttribute('aria-label'), b.textContent] : null; })(),
    }));
    assert.equal(info.note, nl['overview.new.note']);
    assert.match(info.annLink, /^Alle mededelingen \(\d+ ongelezen\)$/, info.annLink);
    assert.ok(info.author.length > 0, 'sender shown');
    if (info.pill) assert.equal(info.pill[0], info.pill[1], 'the pill is announced as what it shows (WCAG 2.5.3)');
  });

  it('with a search active only the found items are marked (TP-153); Undo restores them; focus lands on the heading (TP-044)', async () => {
    h.rec.reset();
    await page.locator(S.search).fill('geluid');
    await page.waitForTimeout(400);
    const btn = page.locator(`${S.section('new')} [data-action="ov-readall"]`);
    assert.match((await btn.innerText()).trim(), /^Markeer \d+ gevonden als gelezen$/);
    await btn.click();
    const patch = await waitFor(() => h.rec.patches.find((p) => p.path === '/portal/api/batch/events'), { timeout: 5000 });
    const geluid = lu('Geluid 1');
    const ids = patch.body.map((b) => b.id);
    assert.ok(ids.length > 0);
    for (const id of ids) assert.equal(h.fx.portal.events.find((e) => e.id === id).sourceId, geluid, `only Geluid 1 items: ${ids}`);
    // the button is gone: focus goes to the Nieuw heading (or, when the search now hides Nieuw, the page title), never <body>
    await page.waitForFunction(() => { const a = document.querySelector('#tplus-root').shadowRoot.activeElement; return !!a && (a.matches('.tp-sec-title, .tp-large-title')); }, null, { timeout: 4000 });
    const undo = page.locator('#tplus-root .tp-toast-undo button');
    await undo.waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await page.locator('#tplus-root .tp-toast-undo').innerText(), /gemarkeerd als gelezen/);
    await screenshot(page, 'overview-undo-toast');
    await undo.click();
    const back = await waitFor(() => h.rec.patches.find((p) => Array.isArray(p.body) && p.body.some((b) => b.read === false)), { timeout: 5000 });
    assert.deepEqual(back.body.map((b) => b.id).sort(), ids.slice().sort(), 'the same items go back to unread');
    await page.locator(S.search).fill('');
    await page.waitForTimeout(300);
    const left = await sr(page, (r, g) => !!r.querySelector(`section[data-section="ov-new"] details[data-lu="${g}"]`), geluid);
    assert.ok(left, 'Geluid 1 is back in Nieuw');
    // other courses were never touched
    const film = h.fx.portal.events.find((e) => e.id === 'ev-1');
    assert.equal(film.read, false);
  });

  it('a course group has its own "mark as read" (TP-158)', async () => {
    h.rec.reset();
    const film = lu('Filmtaal 1');
    const group = page.locator(`#tplus-root details[data-lu="${film}"]`);
    if (!(await group.evaluate((d) => d.open))) await group.locator('> summary').click();
    await group.locator('[data-action="ov-readgroup"]').click();
    const patch = await waitFor(() => h.rec.patches.find((p) => p.path === '/portal/api/batch/events'), { timeout: 5000 });
    for (const b of patch.body) assert.equal(h.fx.portal.events.find((e) => e.id === b.id).sourceId, film);
    await page.waitForFunction((g) => !document.querySelector('#tplus-root').shadowRoot.querySelector(`section[data-section="ov-new"] details[data-lu="${g}"] [data-action="ov-readgroup"]`), film, { timeout: 4000 });
  });
});

describe('Mededelingen: mark as read follows the filter, with Undo', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('the filter list comes before the rows and uses aria-pressed (TP-028)', async () => {
    await openPortal(h, 'announcements');
    const order = await sr(page, (r) => {
      const side = r.querySelector('.va-an-cols > .tp-col-side'); const main = r.querySelector('.va-an-cols > .tp-col-main');
      return { sideFirst: !!(side && main && (side.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING)), pressed: [...r.querySelectorAll('.va-src-row')].map((x) => x.getAttribute('aria-pressed')), current: r.querySelectorAll('.va-src-row[aria-current]').length };
    });
    assert.ok(order.sideFirst, 'filters first in DOM order');
    assert.ok(order.pressed.includes('true') && order.pressed.every((x) => x === 'true' || x === 'false'));
    assert.equal(order.current, 0);
    const box = await sr(page, (r) => { const s = r.querySelector('.va-an-cols > .tp-col-side').getBoundingClientRect(); const m = r.querySelector('.va-an-cols > .tp-col-main').getBoundingClientRect(); return { side: s.left, main: m.left }; });
    assert.ok(box.side > box.main, 'still shown on the right at 1440px');
  });

  it('with a course picked, only that course is marked (TP-152); the button says how many', async () => {
    h.rec.reset();
    const prod = lu('Productie 1');
    await page.locator(`#tplus-root .va-src-row[data-key="${prod}"]`).click();
    const btn = page.locator('#tplus-root [data-action="an-readall"]');
    assert.equal((await btn.innerText()).trim(), 'Markeer 1 als gelezen');
    await btn.click();
    const patch = await waitFor(() => h.rec.patches.find((p) => p.path === '/portal/api/batch/events'), { timeout: 5000 });
    assert.deepEqual(patch.body.map((b) => b.id), ['ev-23']);
    const stillUnread = h.fx.portal.events.filter((e) => (e.subType === 'announcement' || e.subType === 'advalvas') && !e.read).length;
    assert.ok(stillUnread > 3, 'the other courses and Ad Valvas stay unread');
  });

  it('under "Ongelezen" the list clears and the count follows; Undo brings the rows back (TP-027)', async () => {
    await page.locator('#tplus-root .va-src-row[data-key=":unread"]').click();
    const n0 = await sr(page, (r) => r.querySelectorAll('.va-ann-list [data-eid]').length);
    assert.ok(n0 > 1);
    await page.locator('#tplus-root [data-action="an-readall"]').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.va-ann-list [data-eid]').length === 0, null, { timeout: 4000 });
    assert.equal(await sr(page, (r) => !!r.activeElement && r.activeElement !== r.host && r.activeElement.tagName !== 'BODY'), true, 'focus kept inside the view');
    await page.locator('#tplus-root .tp-toast-undo button').click();
    await page.waitForFunction((n) => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.va-ann-list [data-eid]').length === n, n0, { timeout: 4000 });
    const head = await sr(page, (r) => r.querySelector('[data-va-sec="list"] .tp-sec-title .tp-count')?.textContent);
    assert.equal(Number(head), n0, 'heading counts the unread rows');
  });

  it('when Toledo cannot be told, it says so instead of a silent queue (TP-149)', async () => {
    const fail = (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback());
    await h.ctx.route('https://toledo.kuleuven.be/portal/api/batch/events', fail);
    try {
      await page.locator('#tplus-root [data-action="an-readall"]').click();
      await page.waitForFunction((t) => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-toasts .tp-toast')].some((x) => x.textContent.includes(t)), nl['announcements.syncPending'].slice(0, 20), { timeout: 6000 });
    } finally { await h.ctx.unroute('https://toledo.kuleuven.be/portal/api/batch/events', fail); }
  });
});

describe('failure states', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('a failed refresh does not toast "Bijgewerkt" (TP-136)', async () => {
    await openPortal(h);
    const down = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    await h.ctx.route('https://toledo.kuleuven.be/portal/api/**', down);
    try {
      await page.locator('#tplus-root [data-shell="refresh"]').first().click();
      await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-toasts .tp-toast').length > 0, null, { timeout: 15000 });
      const t = await toastTexts(page);
      assert.ok(!t.some((x) => x.startsWith(nl['shell.refreshed'] + ' ')), `no success toast: ${t}`);
      assert.ok(t.some((x) => x.startsWith('Kon Toledo niet bereiken')), `says it failed: ${t}`);
      // one "Bijgewerkt" on the page, not two (TP-146)
      const stamps = await sr(page, (r) => (r.querySelector('.tp-subtitle')?.textContent.match(/Bijgewerkt/g) || []).length + (r.querySelector('.tp-updated:not([hidden])')?.textContent.match(/Bijgewerkt/g) || []).length);
      assert.equal(stamps, 1);
      assert.equal(await page.locator('#tplus-root section[data-section="ov-deadlines"] .va-error').count(), 0, 'no second error card over cached deadlines');
    } finally { await h.ctx.unroute('https://toledo.kuleuven.be/portal/api/**', down); }
  });
});

describe('Deadlines with Toledo unreachable', () => {
  let h; let page;
  before(async () => { h = await launch({ mock: { portalDown: true } }); page = h.page; });
  after(async () => { await h?.close(); });

  it('no "0 open" above "Kon deadlines niet laden" (TP-147)', async () => {
    await page.goto('https://toledo.kuleuven.be/portal/#/home?tplus=deadlines');
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('.va-error, .tp-error-row'), null, { timeout: 15000 });
    const sub = await sr(page, (r) => r.querySelector('.tp-subtitle')?.textContent || '');
    assert.ok(!/\b0 open\b/.test(sub), `subtitle: "${sub}"`);
  });
});

describe('Vakken', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('"Bewerk" is in the URL and survives a reload (TP-206)', async () => {
    await openPortal(h, 'courses');
    await page.locator('#tplus-root [data-shell="view-action"][data-id="edit"]').click();
    await page.waitForFunction(() => /[?&]id=edit\b/.test(location.hash), null, { timeout: 3000 });
    await page.reload();
    await waitForShell(page); await waitForIdle(page); await waitForQuiet(page);
    assert.equal(await page.locator('#tplus-root .cs-view.is-editing').count(), 1, 'still editing after reload');
    const meta = await sr(page, (r) => r.querySelector('.cs-erow .cs-erow-meta')?.textContent || '');
    assert.ok(meta.includes(' · '), `code and official name: ${meta}`);
    await page.locator('#tplus-root [data-shell="view-action"][data-id="edit"]').click();
    await page.waitForFunction(() => !/[?&]id=edit\b/.test(location.hash), null, { timeout: 3000 });
  });

  it('hiding every course shows a way back (TP-011)', async () => {
    const items = Object.fromEntries(ENR.filter((e) => e.type === 'course' && e.academicYear === 2627).map((e) => [e.learningUnitId, { hidden: true }]));
    await h.setSettings({ courses: { items } });
    await openPortal(h, 'courses');
    assert.ok((await page.locator(S.main).innerText()).includes(nl['courses.allHidden']));
    await page.locator('#tplus-root [data-action="unhide-all"]').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.cs-grid .cs-card').length > 3, null, { timeout: 4000 });
  });
});

describe('course page: reading', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('an unread announcement gets a dot from its read state, also on a first visit (TP-089); rich bodies keep their lists (TP-090)', async () => {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await page.waitForFunction(() => !!document.querySelector('#tplus-root').shadowRoot.querySelector('details.cv-folder'), null, { timeout: 15000 });
    await waitForIdle(page); await waitForQuiet(page);
    const ann = await sr(page, (r) => [...r.querySelectorAll('[data-sec="announcements"] .cv-ann')].map((b) => ({ t: b.querySelector('.cv-name').textContent, dot: !!b.querySelector('.cv-new-dot') })));
    assert.deepEqual(ann.find((a) => a.t === 'Lokaalwijziging les 5'), { t: 'Lokaalwijziging les 5', dot: true }, JSON.stringify(ann));
    assert.equal(ann.find((a) => a.t === 'Welkom bij Filmtaal 1')?.dot, false, 'a read/older one has none');
    // prose styles: a list inside .cv-prose keeps its marker and indent
    const li = await sr(page, (r) => {
      const box = document.createElement('div'); box.className = 'cv-prose tp-prose';
      box.innerHTML = '<ul><li>een<ul><li>twee</li></ul></li></ul><pre>' + 'zeer lange lijn '.repeat(40) + '</pre>';
      r.querySelector('.cv-view').appendChild(box);
      const ul = box.querySelector('ul'); const pre = box.querySelector('pre');
      const out = { list: getComputedStyle(ul).listStyleType, pad: parseFloat(getComputedStyle(ul).paddingLeft), nested: getComputedStyle(box.querySelector('ul ul')).listStyleType, pre: getComputedStyle(pre).overflowX };
      box.remove();
      return out;
    });
    assert.equal(li.list, 'disc'); assert.ok(li.pad > 8); assert.equal(li.nested, 'circle');
    assert.equal(li.pre, 'auto', 'long <pre> lines scroll (TP-091)');
  });

  it('"Markeer nieuw als gelezen" clears the dots of this course; Undo brings them back (TP-158)', async () => {
    const dots = () => sr(page, (r) => r.querySelectorAll('[data-tree] .cv-new-dot, [data-sec="announcements"] .cv-new-dot').length);
    const n0 = await dots();
    assert.ok(n0 > 0);
    await page.locator('#tplus-root [data-action="read-new"]').click();
    await page.waitForFunction(() => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('[data-tree] .cv-new-dot, [data-sec="announcements"] .cv-new-dot').length === 0, null, { timeout: 5000 });
    await page.locator('#tplus-root .tp-toast-undo button').click();
    await page.waitForFunction((n) => document.querySelector('#tplus-root').shadowRoot.querySelectorAll('[data-tree] .cv-new-dot, [data-sec="announcements"] .cv-new-dot').length === n, n0, { timeout: 5000 });
  });

  it('file rows have one clean accessible name (TP-013); the per-page link says "Open in Toledo" (TP-098)', async () => {
    // what a screen reader reads: the button's text without aria-hidden parts
    const name = await sr(page, (r) => {
      const b = r.querySelector('[data-tree] .cv-leaf [data-action="open"]');
      const c = b.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
      return { text: c.textContent.replace(/\s+/g, ' ').trim(), title: b.querySelector('.cv-name').textContent, label: b.getAttribute('aria-label') };
    });
    assert.equal(name.label, null, 'no aria-label: the name is the visible text');
    assert.ok(name.text.startsWith(name.title + ', '), name.text);
    assert.ok(!/[·—]/.test(name.text), `no visual separators read out: ${name.text}`);
    const link = await sr(page, (r) => [...r.querySelectorAll('.cv-doc-link')].map((a) => a.textContent));
    for (const x of link) assert.equal(x, nl['course.openToledo']);
    assert.deepEqual(h.errors, []);
  });
});
