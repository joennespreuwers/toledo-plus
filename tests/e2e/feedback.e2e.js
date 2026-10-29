'use strict';
// Feedback sheet + usage ping + relay allowlist for https://api.toledoplus.be, end to end in Chromium.
// Until the maintainer wires telemetry/feedback into manifest.json, background.js and shell.js, this test builds a
// temporary copy of the extension with exactly the integration edits proposed for v1.4 (manifest order + host
// permission, relay allowlist with exact API paths) plus a test-only hook script, and runs against that copy
// via EXT_DIR. Once integrated, the same edits are detected and not applied twice.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const API = 'https://api.toledoplus.be';

// ---------------------------------------------------------------- temp build with the integration edits
function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-fb-ext-'));
  const copy = (rel) => { const to = path.join(dir, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), to); };
  for (const d of ['src', 'icons', 'fonts', 'rules']) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  for (const f of ['manifest.json', 'background.js', 'page.css', 'ui.css']) copy(f);

  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (!m.host_permissions.includes(`${API}/*`)) m.host_permissions.push(`${API}/*`);
  for (const cs of m.content_scripts) {
    const js = cs.js;
    const insertAfter = (after, file) => { if (!js.includes(file)) js.splice(js.indexOf(after) + 1, 0, file); };
    insertAfter('src/i18n/palette.js', 'src/i18n/feedback.js');
    insertAfter(js.includes('src/core/kuloket.js') ? 'src/core/kuloket.js' : 'src/core/data.js', 'src/core/telemetry.js');
    insertAfter('src/core/palette.js', 'src/core/feedback.js');
    js.splice(js.indexOf('src/boot.js'), 0, 'e2e-feedback-hook.js');
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));

  let bg = fs.readFileSync(path.join(dir, 'background.js'), 'utf8');
  if (!bg.includes(API)) {
    bg = bg.replace(/(const TP_ALLOWED = \{[\s\S]*?)(\n\};)/, `$1\n  '${API}': ['GET', 'POST'],                     // Toledo+ API (exact paths: TP_API_PATHS)$2\n` +
      `const TP_API = '${API}';\nconst TP_API_PATHS = ['POST /v1/ping', 'POST /v1/forget', 'POST /v1/feedback', 'GET /v1/latest'];`);
    bg = bg.replace(
      "  if (!(TP_ALLOWED[tpOrigin(url)] || []).includes(method)) return { ok: false, status: 0, data: null, error: 'blocked-method' };",
      "  if (!(TP_ALLOWED[tpOrigin(url)] || []).includes(method)) return { ok: false, status: 0, data: null, error: 'blocked-method' };\n" +
      "  if (tpOrigin(url) === TP_API) {\n    const u = new URL(url);\n" +
      "    if (u.search || u.hash || !TP_API_PATHS.includes(`${method} ${u.pathname}`)) return { ok: false, status: 0, data: null, error: 'blocked-url' };\n  }");
    bg = bg.replace("const init = { method, credentials: 'include',", "const init = { method, credentials: tpOrigin(url) === TP_API ? 'omit' : 'include',");
    assert.ok(bg.includes('TP_API_PATHS.includes') && bg.includes("? 'omit' :"), 'background.js patch did not apply');
  }
  fs.writeFileSync(path.join(dir, 'background.js'), bg);

  // Test-only bridge: DOM events cross from the page's main world into the content script's isolated world.
  fs.writeFileSync(path.join(dir, 'e2e-feedback-hook.js'), `(() => {
    const TP = globalThis.TP;
    window.addEventListener('tplus-e2e', (ev) => {
      const a = ev.detail && ev.detail.action;
      if (a === 'feedback') TP.feedback.open({ page: 'overview' });
      if (a === 'ping') { TP.telemetry._cfg.idleDelay = 0; TP.telemetry.ping({ force: true }).then((r) => document.documentElement.dataset.tpPing = r); }
      if (a === 'relay') TP.net.json(ev.detail.url, { method: ev.detail.method, body: {} }).then(
        () => { document.documentElement.dataset.tpRelay = 'ok'; },
        (e) => { document.documentElement.dataset.tpRelay = e.blocked ? 'blocked' : 'status:' + e.status; });
    });
  })();`);
  return dir;
}

const EXT_DIR = build();
process.env.EXT_DIR = EXT_DIR;
const { launch, screenshot, waitFor } = require('../helpers/launch');
const { openPortal, strings } = require('../helpers/app');

const fire = (page, detail) => page.evaluate((d) => window.dispatchEvent(new CustomEvent('tplus-e2e', { detail: d })), detail);
const sheet = '#tplus-root dialog.tp-fb';

describe('feedback', () => {
  let h; let page;
  const api = { calls: [], status: 201 };
  const nl = strings('nl');

  before(async () => {
    h = await launch();
    page = h.page;
    await h.ctx.route(`${API}/**`, async (route) => {
      const r = route.request();
      api.calls.push({ url: r.url(), method: r.method(), body: r.postData() ? JSON.parse(r.postData()) : null, headers: await r.allHeaders() });
      if (r.url().endsWith('/v1/latest')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"9.9.9","url":null,"notes":""}' });
      if (r.url().endsWith('/v1/feedback')) {
        return route.fulfill({ status: api.status, contentType: 'application/json', headers: api.status === 429 ? { 'retry-after': '3600' } : {}, body: api.status === 201 ? '{"ok":true}' : '{"error":"x"}' });
      }
      return route.fulfill({ status: 204 });
    });
    await openPortal(h);
  });
  after(async () => { await h?.close(); fs.rmSync(EXT_DIR, { recursive: true, force: true }); });

  it('opens an accessible sheet: kinds, counter, optional contact, meta switch on, honeypot hidden', async () => {
    await fire(page, { action: 'feedback' });
    const d = page.locator(sheet);
    await d.waitFor({ state: 'visible' });
    assert.equal(await d.getAttribute('aria-labelledby') !== null, true);
    assert.equal((await page.locator(`${sheet} h2`).innerText()).trim(), nl['feedback.title']);
    assert.equal(await page.locator(`${sheet} input[name="tp-fb-kind"]`).count(), 3);
    assert.equal(await page.locator(`${sheet} input[name="tp-fb-kind"][value="idea"]`).isChecked(), true);
    assert.equal(await page.locator(`${sheet} input[name="tp-fb-meta"]`).isChecked(), true);
    const hp = await page.locator(`${sheet} input[name="website"]`).boundingBox();
    assert.ok(!hp || hp.x + hp.width <= 0, 'honeypot off-screen');
    assert.equal(await page.locator(`${sheet} .tp-fb-hp`).getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator(`${sheet} input[name="website"]`).getAttribute('tabindex'), '-1');
    const focused = await page.evaluate(() => document.querySelector('#tplus-root').shadowRoot.activeElement?.name);
    assert.equal(focused, 'text', 'focus starts in the message');
    await page.locator(`${sheet} textarea`).fill('Hallo');
    assert.match(await page.locator(`${sheet} .tp-fb-count`).innerText(), /^5 \/ 4000$/);
    await page.waitForTimeout(350); // sheet-in animation
    await screenshot(page, 'feedback-light-desktop');
  });

  it('too short → inline error, nothing sent', async () => {
    await page.locator(`${sheet} [data-fb="send"]`).click();
    await page.locator(`${sheet} .tp-fb-error:not(:empty)`).waitFor();
    assert.equal(await page.locator(`${sheet} textarea`).getAttribute('aria-invalid'), 'true');
    assert.equal(api.calls.filter((c) => c.url.endsWith('/v1/feedback')).length, 0);
  });

  it('too long → no silent cut: the counter and the error say it, nothing sent (TP-144)', async () => {
    await page.locator(`${sheet} textarea`).fill('a'.repeat(4100));
    assert.equal(await page.locator(`${sheet} textarea`).getAttribute('maxlength'), null, 'no hard cut at 4000 UTF-16 units');
    assert.match(await page.locator(`${sheet} .tp-fb-count`).innerText(), /^4100 \/ 4000$/);
    assert.equal(await page.locator(`${sheet} .tp-fb-count.tp-fb-over`).count(), 1);
    await page.locator(`${sheet} [data-fb="send"]`).click();
    await page.waitForFunction(() => /te lang/.test(document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-fb-error').textContent));
    assert.equal(api.calls.filter((c) => c.url.endsWith('/v1/feedback')).length, 0);
  });

  it('Escape keeps the typed message: reopening starts from the draft (TP-142)', async () => {
    await page.locator(`${sheet} textarea`).fill('Een concept dat ik nog niet verstuurde.');
    await page.keyboard.press('Escape');
    await page.locator(sheet).waitFor({ state: 'detached' });
    await fire(page, { action: 'feedback' });
    await page.locator(sheet).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`${sheet} textarea`).inputValue(), 'Een concept dat ik nog niet verstuurde.');
  });

  it('429 → "Even rustig" message, text kept', async () => {
    api.status = 429;
    await page.locator(`${sheet} textarea`).fill('De agenda toont niets op maandag.');
    await page.locator(`${sheet} [data-fb="send"]`).click();
    await page.locator(`${sheet} .tp-fb-error:not(:empty)`).waitFor();
    await page.waitForFunction((t) => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-fb-error').textContent === t, nl['feedback.error.rate']);
    assert.equal(await page.locator(`${sheet} textarea`).inputValue(), 'De agenda toont niets op maandag.');
  });

  it('sends kind, text, contact, meta and page via the relay; success state; Esc returns focus', async () => {
    api.status = 201;
    api.calls.length = 0;
    await page.locator(`${sheet} input[name="tp-fb-kind"][value="bug"]`).check({ force: true });
    await page.locator(`${sheet} input[name="contact"]`).fill('student.a@example.edu');
    await page.locator(`${sheet} [data-fb="send"]`).click();
    await page.locator(`${sheet} .tp-fb-done`).waitFor({ state: 'visible' });
    assert.equal((await page.locator(`${sheet} .tp-fb-done h3`).innerText()).trim(), nl['feedback.done.title']);
    const call = api.calls.find((c) => c.url === `${API}/v1/feedback`);
    assert.ok(call, 'feedback POSTed');
    assert.equal(call.method, 'POST');
    assert.match(call.headers.origin || '', /^chrome-extension:\/\//, 'sent by the extension (background relay)');
    assert.equal(call.headers.cookie, undefined, 'no cookies to the API');
    assert.equal(call.body.kind, 'bug');
    assert.equal(call.body.text, 'De agenda toont niets op maandag.');
    assert.equal(call.body.contact, 'student.a@example.edu');
    assert.equal(call.body.page, 'overview');
    assert.equal(call.body.website, '');
    assert.equal(call.body.id, undefined, 'never the install id (TP-179)');
    assert.equal(call.body.lang, 'nl');
    assert.ok(['chrome', 'other'].includes(call.body.browser));
    await page.keyboard.press('Escape');
    await page.locator(sheet).waitFor({ state: 'detached' });
  });

  it('usage ping: exactly {id, v, browser, lang}', async () => {
    api.calls.length = 0;
    await fire(page, { action: 'ping' });
    await page.waitForFunction(() => document.documentElement.dataset.tpPing);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.tpPing), 'sent');
    const p = api.calls.find((c) => c.url === `${API}/v1/ping`);
    assert.deepEqual(Object.keys(p.body).sort(), ['browser', 'id', 'lang', 'v']);
    assert.match(p.body.id, /^[0-9a-f-]{36}$/);
  });

  it('relay: only the four API method+path pairs are allowed', async () => {
    for (const [method, p, want] of [['POST', '/v1/stats', 'blocked'], ['GET', '/v1/stats', 'blocked'], ['POST', '/v1/ping?x=1', 'blocked'], ['PATCH', '/v1/ping', 'blocked'], ['POST', '/v1/forget', 'ok']]) {
      await page.evaluate(() => { delete document.documentElement.dataset.tpRelay; });
      await fire(page, { action: 'relay', url: API + p, method });
      await page.waitForFunction(() => document.documentElement.dataset.tpRelay);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.tpRelay), want, `${method} ${p}`);
    }
  });

  it('no foreign requests, no console errors', async () => {
    await waitFor(() => true);
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.errors, []);
  });
});
