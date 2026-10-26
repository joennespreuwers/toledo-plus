'use strict';
// Sanity checks for the harness itself, with clear messages when the extension is not wired up.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, EXT } = require('../helpers/launch');
const { PORTAL } = require('../helpers/mock');

describe('harness', () => {
  let h;
  before(async () => { h = await launch(); });
  after(async () => { await h?.close(); });

  it('mock portal API answers', async () => {
    await h.page.goto(`${PORTAL}/portal/`);
    const n = await h.page.evaluate(async () => (await (await fetch('/portal/api/enrollments')).json()).length);
    assert.equal(n, h.fx.portal.enrollments.length);
  });

  it('the extension background service worker is running', () => {
    assert.ok(h.sw, `No service worker for the extension in ${EXT}. Is "background.service_worker" set in manifest.json and does it load without errors?`);
    assert.match(h.sw.url(), /^chrome-extension:\/\//);
  });

  it('chrome.storage is reachable from the harness', async () => {
    await h.setState({ __harness: 1 });
    assert.equal((await h.getState()).__harness, 1);
  });

  it('service-worker requests are intercepted by the mocks (cross-origin relay)', async () => {
    const r = await h.sw.evaluate(async () => { const res = await fetch('https://ultra.edu.kuleuven.cloud/learn/api/public/v3/courses/_900661_1', { credentials: 'include' }); return res.json(); });
    assert.equal(r.name, 'Filmtaal 1 [X10265]', 'context.route did not intercept the service worker fetch');
  });

  it('content scripts inject on the portal', async () => {
    await h.page.goto(`${PORTAL}/portal/#/home`);
    const ok = await h.page.waitForFunction(() => document.documentElement.classList.contains('tplus-on') || !!document.querySelector('#tplus-root'), null, { timeout: 8000 }).then(() => true, () => false);
    assert.ok(ok, 'Toledo+ did not inject on https://toledo.kuleuven.be/portal/#/home – check manifest content_scripts (matches + file list) and the console:\n' + h.errors.join('\n'));
  });
});
