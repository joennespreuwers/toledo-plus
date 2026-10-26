'use strict';
// Toledo's landing page (https://toledo.kuleuven.be/) is skipped: straight to /portal/ — not after a logout, not when turned off.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launch, waitForShell } = require('../helpers/launch');

describe('landing page skip', () => {
  let h; let page;
  before(async () => { h = await launch(); page = h.page; });
  after(async () => { await h?.close(); });

  it('goes straight to the portal', async () => {
    await page.goto('https://toledo.kuleuven.be/');
    await page.waitForURL(/\/portal\//, { timeout: 8000 });
    await waitForShell(page);
  });

  it('stays on the landing page right after a logout (flag) and when turned off', async () => {
    await h.sw.evaluate(() => chrome.storage.local.set({ 'tp:loggedOutAt': Date.now(), 'tp:landingBounceAt': 0 }));
    await page.goto('https://toledo.kuleuven.be/');
    await page.waitForTimeout(800);
    assert.equal(new URL(page.url()).pathname, '/');
    await h.sw.evaluate(() => chrome.storage.local.set({ 'tp:loggedOutAt': 0 }));
    await h.setSettings({ wrap: { skipLanding: false } });
    await page.goto('https://toledo.kuleuven.be/?x=1');
    await page.waitForTimeout(800);
    assert.equal(new URL(page.url()).pathname, '/');
  });

  it('no console errors or foreign requests', () => {
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.rec.foreign, []);
  });
});
