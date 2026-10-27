/* Unit tests for background.js — the cross-origin relay: target allowlist, per-origin methods,
   sender check, redirects, timeout, JSON/HTML parsing. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('../helpers/sandbox');

const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const CS = { id: EXT, origin: 'https://toledo.kuleuven.be', url: 'https://toledo.kuleuven.be/portal/#/home' };

function res(body, { status = 200, type = 'application/json', url, headers = {} } = {}) {
  const h = Object.assign({ 'content-type': type }, headers);
  return { ok: status >= 200 && status < 300, status, url, headers: { get: (k) => h[String(k).toLowerCase()] ?? null }, text: async () => body };
}

function load(fetchImpl) {
  let listener = null;
  const calls = [];
  const ctx = {
    console, setTimeout, clearTimeout, URL, AbortController, JSON, Promise,
    fetch: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    chrome: { runtime: { id: EXT, onMessage: { addListener: (fn) => { listener = fn; } } } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const send = (msg, sender = CS) => new Promise((resolve) => {
    const ret = listener(msg, sender, (r) => resolve(JSON.parse(JSON.stringify(r))));
    if (ret !== true) setTimeout(() => resolve('sync-or-ignored'), 20);
  });
  return { send, calls, ctx };
}
const msg = (url, extra = {}) => Object.assign({ type: 'tp-fetch', url, method: 'GET', as: 'json' }, extra);

test('only https on the allowed origins; no credentials in the URL', async () => {
  const { send, calls } = load(async () => res('[]'));
  for (const url of ['https://evil.example.com/x', 'http://toledo.kuleuven.be/portal/api/events', 'https://user:secret@example.invalid@toledo.kuleuven.be/x',
    'https://toledo.kuleuven.be.evil.com/x', 'javascript:alert(1)', 'not a url']) {
    assert.equal((await send(msg(url))).error, 'blocked-url', url);
  }
  assert.equal(calls.length, 0);
  for (const url of ['https://toledo.kuleuven.be/portal/api/events', 'https://ultra.edu.kuleuven.cloud/learn/api/x',
    'https://webwsp.aps.kuleuven.be/sap/opu/odata/sap/X', 'https://cloud.timeedit.net/be_kuleuven/web/public/s.ics']) {
    assert.equal((await send(msg(url))).ok, true, url);
  }
});

test('methods: GET/PATCH on Toledo + Ultra, GET only on KU Loket and TimeEdit; nothing else', async () => {
  const { send } = load(async () => res(''));
  assert.equal((await send(msg('https://toledo.kuleuven.be/portal/api/batch/events', { method: 'PATCH', body: [] }))).ok, true);
  assert.equal((await send(msg('https://ultra.edu.kuleuven.cloud/learn/api/x', { method: 'patch', body: {} }))).ok, true);
  assert.equal((await send(msg('https://webwsp.aps.kuleuven.be/sap/x', { method: 'PATCH', body: {} }))).error, 'blocked-method');
  assert.equal((await send(msg('https://cloud.timeedit.net/x', { method: 'PATCH', body: {} }))).error, 'blocked-method');
  for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.equal((await send(msg('https://toledo.kuleuven.be/portal/api/events', { method: m }))).error, 'blocked-method', m);
  }
});

test('sender check: only our content scripts on Toledo/Ultra or our own extension pages', async () => {
  const { send } = load(async () => res('[]'));
  const url = 'https://toledo.kuleuven.be/portal/api/events';
  assert.equal((await send(msg(url), { id: 'otherextension', origin: 'https://toledo.kuleuven.be' })).error, 'blocked-sender');
  assert.equal((await send(msg(url), { id: EXT, origin: 'https://evil.example.com' })).error, 'blocked-sender');
  assert.equal((await send(msg(url), { id: EXT })).error, 'blocked-sender', 'no origin/url');
  assert.equal((await send(msg(url), { id: EXT, origin: 'https://webwsp.aps.kuleuven.be' })).error, 'blocked-sender', 'not a page we run on');
  assert.equal((await send(msg(url), { id: EXT, url: 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900001_1/outline' })).ok, true, 'url fallback');
  assert.equal((await send(msg(url), { id: EXT, origin: `chrome-extension://${EXT}` })).ok, true, 'extension page');
  assert.equal(await send({ type: 'other' }), 'sync-or-ignored');
});

test('request shape: credentials include, headers sanitized, body JSON-encoded', async () => {
  const { send, calls } = load(async () => res('{}'));
  await send(msg('https://toledo.kuleuven.be/portal/api/batch/events', { method: 'PATCH', body: [{ id: 1, read: true }], headers: { Accept: 'application/json', bad: { x: 1 }, n: 2 } }));
  const init = calls[0].init;
  assert.equal(init.credentials, 'include');
  assert.equal(init.body, '[{"id":1,"read":true}]');
  assert.deepEqual(JSON.parse(JSON.stringify(init.headers)), { Accept: 'application/json', n: '2' });
  await send(msg('https://toledo.kuleuven.be/portal/api/events', { body: 'ignored for GET' }));
  assert.equal(calls[1].init.body, undefined);
});

test('a redirect off the allowed origins (SSO login) → error "redirected"', async () => {
  const { send } = load(async () => res('<html>', { type: 'text/html', url: 'https://idp.kuleuven.be/idp/profile/SAML2/Redirect/SSO' }));
  const r = await send(msg('https://ultra.edu.kuleuven.cloud/learn/api/x'));
  assert.equal(r.error, 'redirected');
  assert.equal(r.ok, false);
});

test('parsing: JSON, empty → null, HTML → "html", garbage → "parse", as:text, Retry-After', async () => {
  const bodies = {
    '/json': res('{"a":1}'),
    '/empty': res('', { status: 204 }),
    '/html': res('<!doctype html><p>login</p>', { type: 'text/html' }),
    '/garbage': res('{nope', { type: 'application/json' }),
    '/ics': res('BEGIN:VCALENDAR', { type: 'text/calendar' }),
    '/busy': res('{}', { status: 503, headers: { 'retry-after': '3' } }),
  };
  const { send } = load(async (url) => bodies[new URL(url).pathname]);
  const base = 'https://cloud.timeedit.net';
  assert.deepEqual((await send(msg(base + '/json'))).data, { a: 1 });
  const e = await send(msg(base + '/empty'));
  assert.equal(e.data, null); assert.equal(e.ok, true); assert.equal(e.status, 204);
  assert.equal((await send(msg(base + '/html'))).error, 'html');
  assert.equal((await send(msg(base + '/garbage'))).error, 'parse');
  assert.equal((await send(msg(base + '/ics', { as: 'text' }))).data, 'BEGIN:VCALENDAR');
  const busy = await send(msg(base + '/busy'));
  assert.equal(busy.ok, false); assert.equal(busy.status, 503); assert.equal(busy.retryAfter, '3');
});

test('timeout → error "timeout"; network error → message', async () => {
  const { send, ctx } = load((url, init) => new Promise((_, rej) => {
    if (url.includes('/fail')) { rej(new TypeError('Failed to fetch')); return; }
    init.signal.addEventListener('abort', () => rej(new Error('aborted')));
  }));
  vm.runInContext('tpCfg.timeout = 30', ctx);
  assert.equal((await send(msg('https://toledo.kuleuven.be/portal/api/slow'))).error, 'timeout');
  const f = await send(msg('https://toledo.kuleuven.be/portal/api/fail'));
  assert.equal(f.status, 0); assert.match(f.error, /Failed to fetch/);
});

test('Toledo+ API: only the exact method+path pairs, no query/hash, no cookies', async () => {
  const { send, calls } = load(async (url) => res('{}', { url }));
  const API = 'https://api.toledoplus.be';
  for (const [m, p] of [['POST', '/v1/ping'], ['POST', '/v1/forget'], ['POST', '/v1/feedback'], ['GET', '/v1/latest']]) {
    const r = await send(msg(API + p, { method: m, body: m === 'POST' ? { id: 'x' } : undefined }));
    assert.equal(r.ok, true, `${m} ${p}`);
  }
  assert.ok(calls.every((c) => c.init.credentials === 'omit'));
  for (const [m, p] of [['GET', '/v1/stats'], ['GET', '/v1/ping'], ['POST', '/v1/latest'], ['GET', '/v1/latest?x=1'], ['POST', '/v1/ping#a'], ['POST', '/']]) {
    assert.equal((await send(msg(API + p, { method: m }))).error, 'blocked-url', `${m} ${p}`);
  }
  assert.equal((await send(msg(API + '/v1/ping', { method: 'PATCH' }))).error, 'blocked-method');
});

test('Ad Valvas: GET of one message page only (path + "?continue"), cookies included, IdP redirect → "redirected"', async () => {
  const V = 'https://icts-p-toledo-valvas.cloud.icts.kuleuven.be';
  const { send, calls } = load(async (url) => res('<!doctype html><h1 class="modal-title">x</h1>', { type: 'text/html', url }));
  for (const p of ['/student/messages/775906/external', '/student/messages/1/external?continue']) {
    const r = await send(msg(V + p, { as: 'text' }));
    assert.equal(r.ok, true, p);
    assert.match(r.data, /modal-title/);
  }
  assert.ok(calls.length === 2 && calls.every((c) => c.init.credentials === 'include'));
  for (const p of ['/student/messages/775906', '/student/messages/abc/external', '/student/messages/775906/external/x', '/admin/messages/1/external',
    '/student/messages/775906/external?x=1', '/student/messages/775906/external?continue=1', '/student/messages/775906/external#a', '/', '/student/messages/1/external/../../2/attachments/1']) {
    assert.equal((await send(msg(V + p, { as: 'text' }))).error, 'blocked-url', p);
  }
  for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal((await send(msg(V + '/student/messages/1/external', { method: m }))).error, 'blocked-method', m);
  assert.equal((await send(msg('https://icts-p-toledo-valvas.cloud.icts.kuleuven.be.evil.com/student/messages/1/external'))).error, 'blocked-url');
  assert.equal((await send(msg('http://icts-p-toledo-valvas.cloud.icts.kuleuven.be/student/messages/1/external'))).error, 'blocked-url');
  assert.equal(calls.length, 2, 'nothing blocked was fetched');

  // No valvas session: the page bounces to the KU Leuven IdP (SAML) → 'redirected'; landing on another valvas page → 'redirected' too.
  const idp = load(async () => res('<form><input name="SAMLRequest"></form>', { type: 'text/html', url: 'https://idp.kuleuven.be/idp/profile/SAML2/Redirect/SSO?execution=e1s1' }));
  assert.equal((await idp.send(msg(V + '/student/messages/2/external', { as: 'text' }))).error, 'redirected');
  const home = load(async () => res('<html>home</html>', { type: 'text/html', url: V + '/student/login' }));
  assert.equal((await home.send(msg(V + '/student/messages/2/external', { as: 'text' }))).error, 'redirected');
});
