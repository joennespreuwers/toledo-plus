'use strict';
// Announcement sheet (TP.annSheet) + Ad Valvas messages read into Toledo+ (TP.data.advalvasMessage).
//  - parser: TP.data._test.parseAdvalvas on a synthetic page (needs a real DOMParser → Chromium, no extension)
//  - flows: Mededelingen / overview / course page / ⌘K open the sheet; full body; ↑/↓ j/k + buttons; Esc returns focus;
//    Ad Valvas success, needs-login → "open" (new tab) → retry when the tab is visible again; no console errors or foreign requests.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../helpers/pw');
const { launch, waitForShell, waitForIdle, waitForQuiet, screenshot, waitFor, ROOT, COURSE_URL, PHONE, DESKTOP } = require('../helpers/launch');
const { strings, openPortal } = require('../helpers/app');
const { VALVAS } = require('../helpers/mock');

const FIXTURE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/advalvas-message.html'), 'utf8');
const DLG = '#tplus-root dialog.tp-detail';
const sr = (page, fn, arg) => page.evaluate(([src, a]) => new Function('sr', 'arg', `return (${src})(sr, arg);`)(document.querySelector('#tplus-root').shadowRoot, a), [fn.toString(), arg]);
const sheet = (page) => sr(page, (root) => {
  const d = root.querySelector('dialog.tp-detail');
  const a = root.activeElement;
  return {
    open: !!(d && d.open), kind: d && d.getAttribute('data-sheet'),
    title: d ? d.querySelector('#tp-detail-title').textContent : '',
    text: d ? d.querySelector('.tp-detail-body').innerText : '',
    body: d && d.querySelector('.an-body') ? d.querySelector('.an-body').innerHTML : null,
    pos: d && d.querySelector('.an-pos') ? d.querySelector('.an-pos').textContent : '',
    state: d && d.querySelector('.an-state') ? d.querySelector('.an-state').innerText : '',
    loading: !!(d && d.querySelector('.an-loading')),
    atts: d ? [...d.querySelectorAll('.an-atts a')].map((x) => ({ href: x.href, text: x.textContent.trim(), target: x.target })) : [],
    active: a ? { eid: a.getAttribute('data-eid'), id: a.getAttribute('data-id'), action: a.getAttribute('data-detail-action') || a.getAttribute('data-action'), inSheet: !!a.closest('dialog.tp-detail') } : null,
  };
});
async function untilSheet(page, pred, what, timeout = 6000) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < timeout) { s = await sheet(page); if (pred(s)) return s; await page.waitForTimeout(80); }
  assert.fail(`${what}: ${JSON.stringify(s)}`);
}

// Real-shaped events (verified live): Ad Valvas 'tol-valven~N' → valvas page; course announcement 'ultra~_N_1' → announcement-detail url.
function addEvents(fx) {
  const now = Date.now();
  const base = { eventType: 'message', seen: false, dismissed: false, color: 7 };
  fx.portal.events.push(
    { ...base, id: 'tol-valven~775906', title: 'Nieuwe openingsuren van het studentensecretariaat', source: 'Ad Valvas', sourceId: 'advalvas', type: 'advalvas', subType: 'advalvas', read: false, date: now - 0.05 * 864e5, url: `${VALVAS}/student/messages/775906/external`, author: 'Studentenadministratie' },
    { ...base, id: 'tol-valven~775907', title: 'Campus gesloten op vrijdag', source: 'Ad Valvas', sourceId: 'advalvas', type: 'advalvas', subType: 'advalvas', read: false, date: now - 0.06 * 864e5, url: `${VALVAS}/student/messages/775907/external`, author: 'Studentenadministratie' },
    { ...base, id: 'ultra~_970001_1', title: 'Extra oefensessie montage', source: 'Filmtaal 1 [X10265]', sourceId: fx.portal.enrollments[0].learningUnitId, type: 'notifications', subType: 'announcement', read: false, date: now - 0.04 * 864e5, url: 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900661_1/announcements/announcement-detail?courseId=_900661_1', author: 'Docent A', color: 5 },
  );
  fx.ultra.announcements._900661_1.unshift({ id: '_970001_1', title: 'Extra oefensessie montage', body: '<p>Donderdag om <strong>14 uur</strong> in de montagezaal.</p><ol><li>Breng je harde schijf mee</li></ol>', created: new Date(now - 0.04 * 864e5).toISOString(), draft: false });
}

describe('Ad Valvas parser (TP.data._test.parseAdvalvas)', () => {
  let browser; let page;
  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const f of ['src/core/util.js', 'src/core/data.js']) await page.addScriptTag({ path: path.join(ROOT, f) });
  });
  after(async () => { await browser?.close(); });
  const parse = (html, url = `${VALVAS}/student/messages/775906/external`) => page.evaluate(([h, u]) => {
    try { return { ok: window.TP.data._test.parseAdvalvas(h, u) }; } catch (e) { return { err: { message: e.message, needsLogin: !!e.needsLogin, parse: !!e.parse } }; }
  }, [html, url]);

  it('reads title, from, to, date and attachments', async () => {
    const { ok: m } = await parse(FIXTURE);
    assert.equal(m.title, 'Nieuwe openingsuren van het studentensecretariaat');
    assert.equal(m.from, 'Docent A (docent.a@example.edu)', '&nbsp; becomes a space');
    assert.equal(m.to, 'Opleiding Voorbeeldkunde & Media');
    assert.equal(m.dateText, '26/10/2026 13:23');
    const d = new Date(m.date);
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 26, 13, 23]);
    assert.deepEqual(m.attachments, [
      { name: 'Openingsuren 2026.pdf', url: `${VALVAS}/student/messages/775906/attachments/1` },
      { name: 'Plattegrond.png', url: `${VALVAS}/student/messages/775906/attachments/2` },
    ]);
  });

  it('body: unescaped from the textarea, sanitized, no styles/fonts/images, links absolute to the valvas host', async () => {
    const { ok: m } = await parse(FIXTURE);
    const h = m.html;
    assert.match(h, /<p>Beste studenten,<\/p>/);
    assert.match(h, /<b>maandag<\/b>/);
    assert.match(h, /<ul><li>Lokaal A\.01<\/li>/);
    assert.match(h, /Tot dan!/);
    assert.ok(!/style=|face=|color=|bgcolor=|<font|<img|<script|onclick|javascript:/i.test(h), h);
    assert.ok(!h.includes('tracker.example.org'), 'remote images dropped');
    assert.match(h, new RegExp(`href="${VALVAS.replace(/\./g, '\\.')}/student/info"`), 'relative link → valvas host (not Toledo/Ultra)');
    assert.match(h, /href="mailto:secretariaat@example\.edu"/);
    assert.match(h, /target="_blank"/);
    assert.equal(await page.evaluate(() => window.__valvasXss || window.__valvasPageScript), undefined, 'nothing from the page ran');
  });

  it('no attachment: "(Geen bijlage)" → []; missing optional fields → empty strings', async () => {
    const html = FIXTURE.replace(/<a href="\/student\/messages\/775906\/attachments\/1"[\s\S]*?Plattegrond\.png<\/a>/, '<input type="text" class="form-control" id="attachmentMissing" value="(Geen bijlage)" readonly>');
    const { ok: m } = await parse(html);
    assert.deepEqual(m.attachments, []);
    const { ok: bare } = await parse('<div id="messageModalExternal"><h1 class="modal-title">Kort</h1><textarea id="message">&lt;p&gt;Hoi&lt;/p&gt;</textarea></div>');
    assert.equal(bare.title, 'Kort');
    assert.equal(bare.from, '');
    assert.equal(bare.date, 0);
    assert.equal(bare.html, '<p>Hoi</p>');
  });

  it('login/SAML page → needsLogin; any other page → parse error', async () => {
    const login = await parse('<html><head><title>KU Leuven Login</title></head><body><form method="post" action="https://idp.kuleuven.be/idp/profile/SAML2/POST/SSO"><input type="hidden" name="SAMLRequest" value="x"></form></body></html>');
    assert.equal(login.err.needsLogin, true);
    const other = await parse('<html><body><h1>Onderhoud</h1></body></html>');
    assert.equal(other.err.needsLogin, false);
    assert.equal(other.err.parse, true);
  });
});

describe('announcement sheet', () => {
  let h; let page; let nl;
  before(async () => {
    h = await launch();
    page = h.page;
    addEvents(h.fx);
    nl = strings('nl');
  });
  after(async () => { await h?.close(); });

  it('Mededelingen: a row opens the sheet with the full body (no inline expansion) and marks it read', async () => {
    await openPortal(h, 'announcements');
    assert.equal(await page.locator('#tplus-root .va-ann-list details').count(), 0, 'no inline disclosures any more');
    const row = page.locator('#tplus-root .va-ann-list [data-eid="ev-7"]');
    assert.equal(await row.getAttribute('aria-haspopup'), 'dialog');
    await row.click();
    const s = await untilSheet(page, (x) => x.open && x.body, 'course announcement body');
    assert.equal(s.kind, 'announcement');
    assert.equal(s.title, 'Lokaalwijziging les 5');
    assert.match(s.body, /lokaal C207/);
    assert.ok(!/<script/i.test(s.body));
    assert.match(s.text, /Filmtaal 1/);
    assert.match(s.text, new RegExp(nl['annsheet.openUltra']));
    assert.match(s.text, new RegExp(nl['annsheet.markUnread']));
    assert.equal(await page.evaluate(() => window.__tplusXss), undefined);
    await waitFor(() => h.rec.patches.some((p) => Array.isArray(p.body) && p.body.some((b) => b.id === 'ev-7' && b.read === true)));
    assert.ok(h.rec.patches.some((p) => Array.isArray(p.body) && p.body.some((b) => b.id === 'ev-7' && b.read === true)), 'marked read in Toledo');
  });

  it('↓/j, ↑/k and the buttons step through the filtered list; Esc returns focus to the row', async () => {
    let s = await sheet(page);
    const m = /^(\d+) van (\d+)$/.exec(s.pos);
    assert.ok(m, `position "${s.pos}"`);
    const start = Number(m[1]);
    await page.keyboard.press('j');
    s = await untilSheet(page, (x) => x.pos.startsWith(`${start + 1} van`), 'j → next');
    const second = s.title;
    assert.notEqual(second, 'Lokaalwijziging les 5');
    await page.keyboard.press('ArrowUp');
    s = await untilSheet(page, (x) => x.title === 'Lokaalwijziging les 5', '↑ → previous');
    await page.keyboard.press('ArrowDown');
    await untilSheet(page, (x) => x.title === second, '↓ → next');
    await page.locator(`${DLG} [data-detail-action="an-prev"]`).click();
    await untilSheet(page, (x) => x.title === 'Lokaalwijziging les 5', 'prev button');
    await page.locator(`${DLG} [data-detail-action="an-next"]`).click();
    s = await untilSheet(page, (x) => x.title === second && x.active && x.active.action === 'an-next', 'next button keeps focus');
    await page.keyboard.press('Escape');
    s = await untilSheet(page, (x) => !x.open, 'closed');
    const want = await sr(page, (root, t) => [...root.querySelectorAll('.va-ann-list [data-eid]')].find((r) => r.querySelector('.tp-row-title').textContent === t)?.getAttribute('data-eid'), second);
    await page.waitForTimeout(250);
    s = await sheet(page);
    assert.equal(s.active && s.active.eid, want, 'focus is back on the row of the announcement shown last');
  });

  it('the search filter limits prev/next to the visible rows', async () => {
    await page.locator('#tplus-root input[data-shell="search"]').fill('lokaalwijziging');
    await page.waitForTimeout(300);
    await page.locator('#tplus-root .va-ann-list [data-eid="ev-7"]').click();
    const s = await untilSheet(page, (x) => x.open && x.title === 'Lokaalwijziging les 5', 'open');
    assert.equal(s.pos, '', 'one result → no prev/next bar');
    await page.keyboard.press('Escape');
    await untilSheet(page, (x) => !x.open && x.active && x.active.eid === 'ev-7', 'closed, focus back on the row');
    // clear the search (retry: a data re-render may hand focus back to the row while we type)
    const row = page.locator('#tplus-root .va-ann-list [data-eid="tol-valven~775906"]');
    for (let k = 0; k < 6 && !(await row.isVisible()); k++) {
      await page.locator('#tplus-root input[data-shell="search"]').fill('');
      await row.waitFor({ state: 'visible', timeout: 600 }).catch(() => {});
    }
    assert.ok(await row.isVisible(), 'search cleared');
  });

  it('Ad Valvas: the message is read in through the relay and shown with sender, recipients and attachments', async () => {
    h.rec.valvas.mode = 'ok';
    await page.locator('#tplus-root .va-ann-list [data-eid="tol-valven~775906"]').click();
    const s = await untilSheet(page, (x) => x.open && x.body, 'valvas body');
    assert.equal(s.title, 'Nieuwe openingsuren van het studentensecretariaat');
    assert.match(s.body, /Beste studenten/);
    assert.ok(!/style=|<img|<font/i.test(s.body));
    assert.match(s.text, /Docent A \(docent\.a@example\.edu\)/);
    assert.match(s.text, /Opleiding Voorbeeldkunde & Media/);
    assert.match(s.text, new RegExp(nl['annsheet.openValvas']));
    assert.deepEqual(s.atts.map((a) => a.href), [`${VALVAS}/student/messages/775906/attachments/1`, `${VALVAS}/student/messages/775906/attachments/2`]);
    assert.ok(s.atts.every((a) => a.target === '_blank'));
    const hits = h.rec.valvas.hits.filter((x) => x.path === '/student/messages/775906/external');
    assert.equal(hits.length, 1);
    assert.ok(hits[0].sw, 'fetched by the background relay, not the page');
    await screenshot(page, 'announcements-sheet-valvas-light-desktop');
    await page.keyboard.press('Escape');
    // cached: opening again needs no request
    await page.locator('#tplus-root .va-ann-list [data-eid="tol-valven~775906"]').click();
    await untilSheet(page, (x) => x.open && x.body, 'cached');
    assert.equal(h.rec.valvas.hits.filter((x) => x.path === '/student/messages/775906/external').length, 1);
    await page.keyboard.press('Escape');
  });

  it('Ad Valvas without a session: sign-in state → "open" in a new tab → retried when the tab is visible again', async () => {
    h.rec.valvas.mode = 'login';
    await page.locator('#tplus-root .va-ann-list [data-eid="tol-valven~775907"]').click();
    let s = await untilSheet(page, (x) => x.open && x.state, 'login state');
    assert.match(s.state, new RegExp(nl['annsheet.login.title']));
    const link = page.locator(`${DLG} a[data-detail-action="an-login"]`);
    assert.equal(await link.getAttribute('href'), `${VALVAS}/student/messages/775907/external`);
    assert.equal(await link.getAttribute('target'), '_blank');
    await screenshot(page, 'announcements-sheet-login-light-desktop');
    const [popup] = await Promise.all([h.ctx.waitForEvent('page'), link.click()]);
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    assert.equal(popup.url(), `${VALVAS}/student/messages/775907/external`, 'top-level visit (SSO completes there)');
    h.rec.valvas.mode = 'ok'; // the IdP set the valvas session in that tab
    await popup.close();
    await page.bringToFront();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    s = await untilSheet(page, (x) => x.open && x.body, 'retried after coming back');
    assert.match(s.body, /Beste studenten/);
    await page.keyboard.press('Escape');
  });

  it('a course announcement with a real-shaped id ("ultra~_N_1") loads by id', async () => {
    await page.locator('#tplus-root .va-ann-list [data-eid="ultra~_970001_1"]').click();
    const s = await untilSheet(page, (x) => x.open && x.body, 'ultra body');
    assert.match(s.body, /<strong>14 uur<\/strong>/);
    assert.ok(h.rec.requests.some((r) => /\/learn\/api\/public\/v1\/courses\/_900661_1\/announcements\/_970001_1$/.test(r.url)));
    await page.keyboard.press('Escape');
  });

  it('"Markeer als ongelezen" puts it back under Ongelezen', async () => {
    await page.locator('#tplus-root .va-ann-list [data-eid="ultra~_970001_1"]').click();
    await untilSheet(page, (x) => x.open && x.body, 'open');
    await page.locator(`${DLG} [data-detail-action="an-unread"]`).click();
    await untilSheet(page, (x) => new RegExp(nl['annsheet.markRead']).test(x.text), 'toggle label');
    await waitFor(() => h.rec.patches.some((p) => Array.isArray(p.body) && p.body.some((b) => b.id === 'ultra~_970001_1' && b.read === false)));
    assert.ok(h.rec.patches.some((p) => Array.isArray(p.body) && p.body.some((b) => b.id === 'ultra~_970001_1' && b.read === false)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const unread = await sr(page, (root) => root.querySelector('.va-ann-list [data-eid="ultra~_970001_1"]')?.getAttribute('data-unread') === '1');
    assert.ok(unread, 'row is unread again (Nieuw)');
  });

  it('overview: the Mededelingen section opens the sheet', async () => {
    await openPortal(h, 'overview');
    const row = page.locator('#tplus-root section[data-section="ov-announcements"] [data-action="ov-ann"]').first();
    const title = (await row.locator('.tp-row-title').textContent()).trim();
    await row.click();
    const s = await untilSheet(page, (x) => x.open && (x.body || x.state), 'overview sheet');
    assert.equal(s.title, title);
    assert.ok(s.pos, 'steps through the section');
    await page.keyboard.press('Escape');
    await untilSheet(page, (x) => !x.open && x.active && x.active.action === 'ov-ann', 'focus back on the overview row');
  });

  it('⌘K: an announcement result opens the sheet instead of leaving the page', async () => {
    const url = page.url();
    await page.keyboard.press('Control+k');
    await page.locator('#tplus-root dialog.tp-palette').waitFor({ state: 'visible' });
    await page.locator('#tplus-root dialog.tp-palette input.tp-pal-input').fill('oefensessie');
    // the first ⌘K also starts the index crawl, which re-renders the results: wait until our result is the active option
    await page.waitForFunction(() => {
      const d = document.querySelector('#tplus-root').shadowRoot.querySelector('dialog.tp-palette');
      const o = d && d.querySelector('.tp-pal-opt[aria-selected="true"]');
      return o && /Extra oefensessie montage/.test(o.textContent);
    }, null, { timeout: 8000, polling: 100 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    const s = await untilSheet(page, (x) => x.open && x.body, 'palette sheet');
    assert.equal(s.title, 'Extra oefensessie montage');
    // same page; only the sheet's own history entry is added (Back closes it), and Esc removes it again
    assert.equal(page.url().replace(/&sheet=[^&]*/, ''), url);
    assert.match(page.url(), /&sheet=/);
    await page.keyboard.press('Escape');
    await untilSheet(page, (x) => !x.open, 'closed');
    await page.waitForFunction((u) => location.href === u, url, { timeout: 3000 });
  });

  it('screenshots: light/dark × desktop/phone', async () => {
    await openPortal(h, 'announcements');
    for (const scheme of ['light', 'dark']) {
      for (const [vp, size] of [['desktop', DESKTOP], ['phone', PHONE]]) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(size);
        await page.waitForTimeout(150);
        await untilSheet(page, (x) => !x.open, `nothing open before ${scheme}/${vp}`);
        await page.locator('#tplus-root .va-ann-list [data-eid="tol-valven~775906"]').click({ timeout: 8000 });
        await untilSheet(page, (x) => x.open && x.body, 'sheet');
        await page.waitForTimeout(100);
        const box = await page.locator(DLG).boundingBox();
        assert.ok(box && box.width <= size.width && box.x >= 0, 'sheet fits the viewport');
        if (vp === 'phone') assert.ok(Math.abs(box.y + box.height - size.height) < 2, 'phone: bottom sheet');
        await screenshot(page, `announcements-${scheme}-${vp}`);
        await page.keyboard.press('Escape');
        await untilSheet(page, (x) => !x.open, 'closed');
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize(DESKTOP);
  });

  it('no console errors, CDN hits or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.rec.cdn, []);
  });
});

describe('announcement sheet on the Ultra course page', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; addEvents(h.fx); });
  after(async () => { await h?.close(); });

  it('a course announcement row opens the sheet (no inline expansion); prev/next; absolute links only', async () => {
    await page.goto(COURSE_URL);
    await waitForShell(page);
    await waitForIdle(page);
    await waitForQuiet(page);
    const rows = page.locator('#tplus-root .cv-view [data-action="ann"]');
    await rows.first().waitFor();
    assert.equal(await page.locator('#tplus-root .cv-view details.cv-ann').count(), 0);
    assert.equal(await rows.count(), 3, 'drafts are not listed');
    await page.locator('#tplus-root .cv-view [data-action="ann"][data-id="_ann1_1"]').click();
    let s = await untilSheet(page, (x) => x.open && x.body, 'body');
    assert.equal(s.title, 'Lokaalwijziging les 5');
    assert.match(s.body, /lokaal C207/);
    assert.ok(/^\d van 3$/.test(s.pos), s.pos);
    await page.keyboard.press('k');
    s = await untilSheet(page, (x) => x.title === 'Extra oefensessie montage', 'k → previous (newest first)');
    const ext = await page.locator(`${DLG} a[data-detail-action="an-ext"]`).getAttribute('href');
    assert.ok(/^https:\/\/ultra\.edu\.kuleuven\.cloud\//.test(ext), ext);
    await page.keyboard.press('Escape');
    s = await untilSheet(page, (x) => !x.open, 'closed');
    await page.waitForTimeout(250);
    s = await sheet(page);
    assert.equal(s.active && s.active.id, '_970001_1', 'focus back on the row');
    assert.deepEqual(h.rec.cdn, [], 'no relative URLs');
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.errors, []);
  });
});
