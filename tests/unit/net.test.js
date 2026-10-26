/* Unit tests for src/core/net.js: same-origin fetch vs relay, session-expired detection (F4),
   retries with backoff on 429/5xx (F5), timeouts, keepalive, invalidated extension context. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');
const { world, fakeChrome } = require('../helpers/fake-chrome');

const PORTAL = 'https://toledo.kuleuven.be';
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** A minimal fetch Response. */
function res(body, { status = 200, type = 'application/json', url = '', redirected = false, headers = {} } = {}) {
  const h = Object.assign({ 'content-type': type }, headers);
  return {
    ok: status >= 200 && status < 300, status, url, redirected,
    headers: { get: (k) => h[String(k).toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : body == null ? '' : JSON.stringify(body)),
    blob: async () => ({ size: 1 }),
  };
}

function load({ fetch, onMessage, origin = PORTAL, chrome } = {}) {
  const calls = [];
  const c = chrome || fakeChrome(world(), { onMessage: onMessage && ((m) => { calls.push(m); return onMessage(m); }) });
  const s = sandbox({ origin, globals: { chrome: c, fetch: fetch && ((url, init) => { calls.push({ url, init }); return fetch(url, init); }) } });
  s.load('src/core/net.js');
  Object.assign(s.TP.net._cfg, { retryBaseMs: 5, retryMaxMs: 50 });
  return { net: s.TP.net, calls, chrome: c };
}
const rejects = async (p, check) => { try { await p; } catch (e) { check(e); return; } assert.fail('expected a rejection'); };

test('same origin: JSON, credentials, Toledo-Language header, keepalive passed through', async () => {
  const { net, calls } = load({ fetch: async () => res([{ id: 1 }]) });
  assert.deepEqual(plain(await net.json('/portal/api/events')), [{ id: 1 }]);
  assert.equal(calls[0].url, PORTAL + '/portal/api/events');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['Toledo-Language'], 'nl');
  await net.json('/portal/api/batch/events', { method: 'PATCH', body: [{ id: 1 }], keepalive: true });
  assert.equal(calls[1].init.keepalive, true);
  assert.equal(calls[1].init.body, '[{"id":1}]');
  assert.equal(calls[1].init.headers['Content-Type'], 'application/json');
});

test('204 / empty body → null', async () => {
  const { net } = load({ fetch: async () => res('', { status: 204 }) });
  assert.equal(await net.json('/portal/api/batch/events', { method: 'PATCH', body: [] }), null);
});

test('session expired: HTML login page with 200 → error.auth', async () => {
  const { net } = load({ fetch: async () => res('<!doctype html><title>Login</title>', { type: 'text/html' }) });
  await rejects(net.json('/portal/api/events'), (e) => { assert.equal(e.auth, true); assert.equal(e.status, 200); });
});

test('session expired: 401, 403 and a redirect to the IdP → error.auth (no retries)', async () => {
  for (const r of [res({}, { status: 401 }), res({}, { status: 403 }),
    res('<html>', { type: 'text/html', redirected: true, url: 'https://idp.kuleuven.be/idp/profile/SAML2/Redirect/SSO?x=1' })]) {
    let n = 0;
    const { net } = load({ fetch: async () => { n++; return r; } });
    await rejects(net.json('/portal/api/events'), (e) => assert.equal(e.auth, true));
    assert.equal(n, 1);
  }
});

test('invalid JSON that is not HTML → plain error (not auth)', async () => {
  const { net } = load({ fetch: async () => res('{oops', { type: 'application/json' }) });
  await rejects(net.json('/portal/api/events'), (e) => { assert.ok(!e.auth); assert.match(e.message, /invalid JSON/); });
});

test('429/5xx GETs are retried (Retry-After honoured, max 2 retries); PATCH is not', async () => {
  let n = 0;
  const seq = [res({}, { status: 503 }), res({}, { status: 429, headers: { 'retry-after': '0' } }), res({ ok: 1 })];
  const { net } = load({ fetch: async () => seq[n++] });
  assert.deepEqual(plain(await net.json('/portal/api/events')), { ok: 1 });
  assert.equal(n, 3);

  let m = 0;
  const a = load({ fetch: async () => { m++; return res({}, { status: 500 }); } });
  await rejects(a.net.json('/portal/api/events'), (e) => assert.equal(e.status, 500));
  assert.equal(m, 3, '1 try + 2 retries');

  let p = 0;
  const b = load({ fetch: async () => { p++; return res({}, { status: 503 }); } });
  await rejects(b.net.json('/portal/api/batch/events', { method: 'PATCH', body: [] }), (e) => assert.equal(e.status, 503));
  assert.equal(p, 1);

  let q = 0;
  const c = load({ fetch: async () => { q++; return res({}, { status: 404 }); } });
  await rejects(c.net.json('/portal/api/events'), (e) => assert.equal(e.status, 404));
  assert.equal(q, 1, '4xx not retried');
});

test('timeout → status 0, .timeout', async () => {
  const { net } = load({ fetch: (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  net._cfg.timeout = 30;
  await rejects(net.json('/portal/api/events'), (e) => { assert.equal(e.status, 0); assert.equal(e.timeout, true); });
});

test('cross origin goes through the relay; relay errors map to auth / status', async () => {
  let reply = { ok: true, status: 200, data: { id: '_900001_1' } };
  const { net, calls } = load({ onMessage: () => reply });
  assert.deepEqual(plain(await net.json('/learn/api/public/v3/courses/_900001_1')), { id: '_900001_1' });
  assert.equal(calls[0].type, 'tp-fetch');
  assert.equal(calls[0].url, 'https://ultra.edu.kuleuven.cloud/learn/api/public/v3/courses/_900001_1');
  reply = { ok: false, status: 302, data: null, error: 'redirected' };
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/x'), (e) => { assert.equal(e.auth, true); assert.equal(e.relay, true); });
  reply = { ok: false, status: 200, data: null, error: 'html' };
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/x'), (e) => assert.equal(e.auth, true));
  reply = { ok: false, status: 401, data: null };
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/x'), (e) => assert.equal(e.auth, true));
  reply = { ok: false, status: 0, data: null, error: 'blocked-url' };
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/x'), (e) => assert.equal(e.blocked, true));
});

test('relay: 503 is retried; keepalive forwarded', async () => {
  let n = 0;
  const { net, calls } = load({ onMessage: () => (++n < 2 ? { ok: false, status: 503, data: null, retryAfter: '0' } : { ok: true, status: 200, data: [] }) });
  assert.deepEqual(plain(await net.json('https://ultra.edu.kuleuven.cloud/learn/api/y')), []);
  assert.equal(n, 2);
  await net.json('https://ultra.edu.kuleuven.cloud/learn/api/y', { method: 'PATCH', body: {}, keepalive: true });
  assert.equal(calls.at(-1).keepalive, true);
});

test('relay down (no receiver) → status 0, relayDown', async () => {
  const { net } = load({});
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/z'), (e) => { assert.equal(e.status, 0); assert.equal(e.relayDown, true); assert.ok(!e.auth); });
});

test('extension context invalidated → error.stale, nothing fetched', async () => {
  let n = 0;
  const { net, chrome } = load({ fetch: async () => { n++; return res([]); }, onMessage: () => ({ ok: true, status: 200, data: [] }) });
  chrome._invalidate();
  assert.equal(net.isStale(), true);
  await rejects(net.json('/portal/api/events'), (e) => assert.equal(e.stale, true));
  await rejects(net.json('https://ultra.edu.kuleuven.cloud/learn/api/x'), (e) => assert.equal(e.stale, true));
  assert.equal(n, 0);
});

test('resolve() maps API prefixes to their origin', () => {
  const { net } = load({ origin: 'https://ultra.edu.kuleuven.cloud' });
  assert.equal(net.resolve('/portal/api/events'), PORTAL + '/portal/api/events');
  assert.equal(net.resolve('/learn/api/x'), 'https://ultra.edu.kuleuven.cloud/learn/api/x');
  assert.equal(net.resolve('https://webwsp.aps.kuleuven.be/sap/x'), 'https://webwsp.aps.kuleuven.be/sap/x');
  assert.equal(net.isSameOrigin('/learn/api/x'), true);
});
