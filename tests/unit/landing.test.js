'use strict';
// src/landing.js: skip Toledo's landing page → /portal/, except when turned off, right after a logout, or in a loop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');

const s = sandbox({ origin: 'https://toledo.kuleuven.be' });
s.load('src/landing.js'); // no chrome in the sandbox → only defines TPLanding
const { decide, PORTAL } = s.ctx.TPLanding;
const NOW = 1_800_000_000_000;
const d = (o) => decide({ now: NOW, url: 'https://toledo.kuleuven.be/', referrer: '', ...o });

test('goes to the portal by default', () => {
  assert.equal(PORTAL, 'https://toledo.kuleuven.be/portal/');
  assert.equal(d({}).go, true);
  assert.equal(d({ url: 'https://toledo.kuleuven.be/?lang=nl' }).go, true);
  assert.equal(d({ url: 'https://toledo.kuleuven.be/index.html' }).go, true);
  assert.equal(d({ settings: { wrap: { portal: true } } }).go, true, 'skipLanding missing = default on');
});

test('never acts outside the landing page', () => {
  for (const url of ['https://toledo.kuleuven.be/portal/', 'https://toledo.kuleuven.be/portal/#/home', 'https://toledo.kuleuven.be/other', 'https://ultra.edu.kuleuven.cloud/', 'nonsense']) {
    assert.deepEqual({ ...d({ url }) }, { go: false, reason: 'path' }, url);
  }
});

test('turned off with settings.wrap.skipLanding === false (sync or local fallback)', () => {
  assert.equal(d({ settings: { wrap: { skipLanding: false } } }).reason, 'off');
  assert.equal(d({ settingsLocal: { wrap: { skipLanding: false } } }).reason, 'off');
});

test('stays after a logout: referrer, URL parameters, or the logout flag (5 min)', () => {
  assert.equal(d({ referrer: 'https://toledo.kuleuven.be/Shibboleth.sso/Logout?return=x' }).reason, 'logout');
  assert.equal(d({ referrer: 'https://idp.kuleuven.be/idp/profile/Logout' }).reason, 'logout');
  assert.equal(d({ url: 'https://toledo.kuleuven.be/?logout=true' }).reason, 'logout');
  assert.equal(d({ url: 'https://toledo.kuleuven.be/?error=session' }).reason, 'logout');
  assert.equal(d({ loggedOutAt: NOW - 60e3 }).reason, 'logout');
  assert.equal(d({ loggedOutAt: NOW - 6 * 60e3 }).go, true, 'flag expires after 5 minutes');
  assert.equal(d({ referrer: 'https://toledo.kuleuven.be/portal/' }).go, true);
});

test('loop guard: at most one bounce per 30 s', () => {
  assert.equal(d({ bouncedAt: NOW - 10e3 }).reason, 'loop');
  assert.equal(d({ bouncedAt: NOW - 31e3 }).go, true);
});
