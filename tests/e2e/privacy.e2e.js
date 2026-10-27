'use strict';
// Privacy cluster (bug bash pattern 7): Reset everything keeps the privacy opt-outs and wipes local data (TP-001, TP-003);
// turning the usage signal off is confirmed (TP-140); logging out through Toledo+ forgets the user's cached data
// (TP-181); importing a foreign/invalid settings file changes nothing and says why (TP-002, TP-120).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitFor } = require('../helpers/launch');
const { openPortal, strings, waitSettings } = require('../helpers/app');

const nl = strings('nl');
const toastText = (page) => page.evaluate(() => [...document.querySelector('#tplus-root').shadowRoot.querySelectorAll('.tp-toasts .tp-toast')].map((t) => t.textContent).join(' | '));
const localKeys = (h) => h.sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).sort());
const PERSONAL = /^(cache:|kuloket:|index$|indexMeta$|state:me$|state:recent$)/;

describe('privacy', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('turning the usage signal off is confirmed with a toast', async () => {
    await openPortal(h, 'settings');
    await page.locator('#tplus-root input[name="s:privacy.telemetry"]').uncheck({ force: true });
    await waitSettings(h, (s) => s && s.privacy && s.privacy.telemetry === false);
    await page.waitForFunction((txt) => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-toasts')?.textContent.includes(txt), nl['telemetry.off.toast']);
  });

  it('a file that is not a Toledo+ export is refused and changes nothing', async () => {
    const before = await h.getSettings();
    await page.locator('#tplus-root input[name="st-import"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world","appearance":"dark"}') });
    await page.waitForFunction((txt) => document.querySelector('#tplus-root').shadowRoot.querySelector('.tp-toasts')?.textContent.includes(txt), nl['settings.data.importForeign']);
    const after = await h.getSettings();
    assert.equal(after.appearance, before.appearance);
  });

  it('Reset everything: privacy choices stay off, local data is wiped, a reload says it is done', async () => {
    await openPortal(h, 'overview'); // fill the cache
    await openPortal(h, 'settings');
    const keysBefore = await localKeys(h);
    assert.ok(keysBefore.some((k) => k.startsWith('cache:')), 'cache present before: ' + keysBefore);
    const btn = page.locator('#tplus-root [data-action="reset"]');
    await btn.click();
    assert.match(await btn.innerText(), /\d+ s/, 'the confirm label states the time window');
    const nav = page.waitForEvent('load');
    await btn.click();
    await nav;
    await page.waitForFunction((txt) => document.querySelector('#tplus-root')?.shadowRoot.querySelector('.tp-toasts')?.textContent.includes(txt), nl['settings.data.resetDone'], { timeout: 15000 });
    const s = await h.getSettings();
    assert.equal(s.privacy.telemetry, false, 'usage signal stays off after a reset');
    // The app refills its cache right after the reload; what must be gone is everything from before (e.g. the
    // install id and the recent-documents list), and the reset never sent a usage ping.
    const keys = await localKeys(h);
    assert.ok(!keys.includes('telemetry:id'), 'install id gone: ' + keys);
    assert.ok(!keys.includes('tp:wipePending'));
    assert.deepEqual(h.rec.api.filter((c) => c.path === "/v1/ping"), [], 'no usage ping');
  });

  it('logging out through Toledo+ forgets this user\'s cached data (shared computers)', async () => {
    await openPortal(h, 'overview');
    await h.setState({ me: { given: 'Student', t: Date.now() }, recent: [{ title: 'Geheim.pdf', url: 'https://x', ts: 1 }] });
    await waitFor(async () => (await localKeys(h)).some((k) => k.startsWith('cache:')));
    await page.locator('#tplus-root .tp-avatar').click();
    const out = page.locator('#tplus-root [data-tp-logout]');
    await out.waitFor();
    await Promise.all([page.waitForURL(/Shibboleth\.sso/), out.click()]);
    await waitFor(async () => !(await localKeys(h)).some((k) => PERSONAL.test(k)), { timeout: 5000 }).catch(() => {});
    const left = (await localKeys(h)).filter((k) => PERSONAL.test(k));
    assert.deepEqual(left, [], 'personal data left after logout');
    const keys = await localKeys(h);
    assert.ok(keys.includes('tp:loggedOutAt'));
  });

  it('no foreign requests, no console errors', async () => {
    assert.deepEqual(h.rec.foreign, []);
    assert.deepEqual(h.errors, []);
  });
});
