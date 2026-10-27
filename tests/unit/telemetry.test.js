'use strict';
// TP.telemetry: 24 h ping throttle, portal-only, opt-out deletes the id (+ forget call) and stops pings,
// payload has exactly {id, v, browser, lang}, 12 h update check + 'update' event, feedback error mapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('crypto');
const { sandbox } = require('../helpers/sandbox');
const { world, fakeChrome, tick } = require('../helpers/fake-chrome');

const HOUR = 3600e3;
const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function load({ origin = 'https://toledo.kuleuven.be', telemetry, updateCheck, latest = { version: '1.3.0', url: 'https://github.com/joennespreuwers/toledo-plus/releases/tag/v1.3.0', notes: 'Nieuw' },
  fail = null, w = world(), ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0' } = {}) {
  const s = sandbox({ origin, now: T0, globals: { crypto: webcrypto } });
  s.ctx.navigator.userAgent = ua;
  const chrome = fakeChrome(w);
  chrome.runtime.getManifest = () => ({ version: '1.2.0' });
  s.ctx.chrome = chrome;
  let cur = { language: 'nl', privacy: {} };
  if (telemetry !== undefined) cur.privacy.telemetry = telemetry;
  if (updateCheck !== undefined) cur.privacy.updateCheck = updateCheck;
  const subs = new Set();
  const calls = [];
  s.ctx.TP = {
    settings: {
      get: () => cur,
      subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      set: async (patch) => { cur = { ...cur, ...patch, privacy: { ...cur.privacy, ...(patch.privacy || {}) } }; for (const fn of subs) fn(cur, Object.keys(patch)); },
    },
    i18n: { lang: () => cur.language },
    net: {
      json: async (url, opts = {}) => {
        calls.push({ url, method: opts.method || 'GET', body: opts.body === undefined ? undefined : JSON.parse(JSON.stringify(opts.body)) });
        const f = typeof fail === 'function' ? fail(url) : fail;
        if (f) { const e = new Error('x'); e.status = f; throw e; }
        if (url.endsWith('/v1/latest')) return latest;
        return null;
      },
    },
  };
  s.load('src/core/telemetry.js');
  return { s, TP: s.ctx.TP, calls, w, stores: w.stores, clock: s.clock, setFail: (f) => { fail = f; }, setLatest: (l) => { latest = l; } };
}

const pings = (calls) => calls.filter((c) => c.url === 'https://api.toledoplus.be/v1/ping');

test('forget: a failed /v1/forget stays queued and is retried on the next boot (TP-139); a 4xx is dropped', async () => {
  const { TP, calls, stores, setFail } = load();
  await TP.telemetry.ping();
  const id = stores.local['telemetry:id'];
  setFail((u) => (u.endsWith('/v1/forget') ? 503 : null));
  assert.equal(await TP.telemetry.forget(), true);
  assert.equal(stores.local['telemetry:id'], undefined, 'deleted locally right away');
  assert.deepEqual([...stores.local['telemetry:forget']], [id], 'kept for a retry');
  // next boot (another sandbox on the same profile) retries and clears the queue
  const next = load({ w: undefined });
  next.stores.local['telemetry:forget'] = [id];
  next.TP.telemetry._cfg.idleDelay = 0;
  assert.equal(await next.TP.telemetry.flushForget(), 'sent');
  assert.deepEqual(next.calls.filter((c) => c.url.endsWith('/v1/forget')).map((c) => c.body), [{ id }]);
  assert.equal(next.stores.local['telemetry:forget'], undefined);
  // a 400 means there is nothing to delete: do not retry forever
  setFail((u) => (u.endsWith('/v1/forget') ? 400 : null));
  stores.local['telemetry:forget'] = [id];
  assert.equal(await TP.telemetry.flushForget(), 'sent');
  assert.equal(stores.local['telemetry:forget'], undefined);
  void calls;
});

test('forget queue is sent on boot even with the usage signal off (it is a deletion, not a signal)', async () => {
  const { TP, calls, stores, clock } = load({ telemetry: false });
  stores.local['telemetry:forget'] = ['3f2b8c1e-5d4a-4c3b-9a8e-1b2c3d4e5f60'];
  TP.telemetry._cfg.idleDelay = 0;
  TP.telemetry.schedule();
  clock.add(10);
  await tick(30);
  assert.equal(calls.filter((c) => c.url.endsWith('/v1/forget')).length, 1);
  assert.equal(pings(calls).length, 0, 'still no ping');
});

test('update URL: only this project on GitHub or toledoplus.be; "../" escapes fall back to the releases page (TP-178)', () => {
  const { TP } = load();
  const R = 'https://github.com/joennespreuwers/toledo-plus/releases/latest';
  assert.equal(TP.telemetry.safeUrl('https://github.com/joennespreuwers/toledo-plus/releases/tag/v1.7.0'), 'https://github.com/joennespreuwers/toledo-plus/releases/tag/v1.7.0');
  assert.equal(TP.telemetry.safeUrl('https://toledoplus.be/#update'), 'https://toledoplus.be/#update');
  assert.equal(TP.telemetry.safeUrl('https://github.com/joennespreuwers/toledo-plus/../../evil-org/evil-repo/releases/latest'), R);
  assert.equal(TP.telemetry.safeUrl('https://github.com/joennespreuwers/toledo-plus/%2e%2e/%2e%2e/evil/x'), R);
  assert.equal(TP.telemetry.safeUrl('https://toledoplus.be.evil.example/'), R);
  assert.equal(TP.telemetry.safeUrl('https://github.com/joennespreuwers/toledo-plus-evil/x'), R);
  assert.equal(TP.telemetry.safeUrl('javascript:alert(1)'), R);
});

test('ping: payload is exactly {id, v, browser, lang}; id is a stored uuid v4; POST to the API', async () => {
  const { TP, calls, stores } = load();
  assert.equal(await TP.telemetry.ping(), 'sent');
  const p = pings(calls);
  assert.equal(p.length, 1);
  assert.equal(p[0].method, 'POST');
  assert.deepEqual(Object.keys(p[0].body).sort(), ['browser', 'id', 'lang', 'v']);
  assert.match(p[0].body.id, UUID4);
  assert.equal(p[0].body.v, '1.2.0');
  assert.equal(p[0].body.browser, 'edge');
  assert.equal(p[0].body.lang, 'nl');
  assert.equal(stores.local['telemetry:id'], p[0].body.id);
  // nothing personal can sneak in: the payload only has primitives of bounded shape
  assert.ok(JSON.stringify(p[0].body).length < 120);
});

test('ping: at most once per 24 h; a failure retries after ~1 h; same id across pings', async () => {
  const { TP, calls, clock, setFail } = load();
  assert.equal(await TP.telemetry.ping(), 'sent');
  clock.add(23 * HOUR);
  assert.equal(await TP.telemetry.ping(), 'throttled');
  clock.add(HOUR + 1000);
  setFail(503);
  assert.equal(await TP.telemetry.ping(), 'error');
  clock.add(30 * 60e3);
  assert.equal(await TP.telemetry.ping(), 'throttled', 'backs off after a failure');
  clock.add(31 * 60e3);
  setFail(null);
  assert.equal(await TP.telemetry.ping(), 'sent');
  const p = pings(calls);
  assert.equal(p.length, 3);
  assert.equal(new Set(p.map((x) => x.body.id)).size, 1);
  // concurrent calls in one tab share one request
  clock.add(25 * HOUR);
  const [a, b] = await Promise.all([TP.telemetry.ping(), TP.telemetry.ping()]);
  assert.equal(a, 'sent'); assert.equal(b, 'sent');
  assert.equal(pings(calls).length, 4);
});

test('ping: portal origin only; never throws without chrome/net', async () => {
  const { TP, calls } = load({ origin: 'https://ultra.edu.kuleuven.cloud' });
  assert.equal(await TP.telemetry.ping(), 'origin');
  assert.equal(calls.length, 0);
  const x = load();
  x.TP.net = undefined;
  assert.equal(await x.TP.telemetry.ping(), 'error');
  const y = load();
  y.s.ctx.chrome.runtime.id = undefined; // orphaned content script
  assert.equal(await y.TP.telemetry.ping(), 'error');
});

test('opt-out: no pings, id deleted locally + forget sent; opt-in again → new id', async () => {
  const off = load({ telemetry: false });
  assert.equal(await off.TP.telemetry.ping(), 'off');
  assert.equal(off.calls.length, 0);
  assert.equal(off.stores.local['telemetry:id'], undefined, 'no id is created while off');

  const { TP, calls, stores, clock } = load();
  TP.telemetry._cfg.idleDelay = 0;
  TP.telemetry.schedule();
  await TP.telemetry.ping();
  const id1 = stores.local['telemetry:id'];
  assert.match(id1, UUID4);
  await TP.settings.set({ privacy: { telemetry: false } });
  await tick(20);
  assert.equal(stores.local['telemetry:id'], undefined, 'id deleted');
  assert.equal(stores.local['telemetry:lastPing'], undefined);
  const forget = calls.filter((c) => c.url.endsWith('/v1/forget'));
  assert.equal(forget.length, 1);
  assert.deepEqual(forget[0].body, { id: id1 });
  clock.add(48 * HOUR);
  assert.equal(await TP.telemetry.ping(), 'off');
  assert.equal(pings(calls).length, 1);
  await TP.settings.set({ privacy: { telemetry: true } });
  await tick(20);
  const id2 = stores.local['telemetry:id'];
  assert.match(id2, UUID4);
  assert.notEqual(id2, id1, 'opting back in starts a new, unrelated id');
});

test('update check: at most every 12 h, emits update for a newer version, respects dismiss and opt-out', async () => {
  const { TP, calls, clock, setLatest } = load();
  const seen = [];
  TP.telemetry.on('update', (u) => seen.push(u));
  const u = await TP.telemetry.checkUpdate();
  assert.deepEqual(JSON.parse(JSON.stringify(u)), { version: '1.3.0', url: 'https://github.com/joennespreuwers/toledo-plus/releases/tag/v1.3.0', notes: 'Nieuw' });
  assert.equal(seen.length, 1);
  assert.equal(TP.telemetry.pendingUpdate().version, '1.3.0');
  const gets = () => calls.filter((c) => c.url.endsWith('/v1/latest')).length;
  assert.equal(gets(), 1);
  clock.add(6 * HOUR);
  assert.equal((await TP.telemetry.checkUpdate()).version, '1.3.0', 'cached value still announced');
  assert.equal(gets(), 1, 'no request within 12 h');
  await TP.telemetry.dismissUpdate('1.3.0');
  assert.equal(await TP.telemetry.checkUpdate(), null, 'dismissed');
  clock.add(7 * HOUR);
  setLatest({ version: '1.4.0', url: 'https://evil.example.com/x.zip', notes: 'x'.repeat(900) });
  const v4 = await TP.telemetry.checkUpdate();
  assert.equal(gets(), 2);
  assert.equal(v4.version, '1.4.0');
  assert.equal(v4.url, 'https://github.com/joennespreuwers/toledo-plus/releases/latest', 'only our own release URLs');
  assert.equal(v4.notes.length, 500);
  clock.add(13 * HOUR);
  setLatest({ version: '1.2.0' });
  assert.equal(await TP.telemetry.checkUpdate(), null, 'same version → nothing');
  setLatest({ version: '1.1.9' });
  assert.equal(await TP.telemetry.checkUpdate({ force: true }), null, 'older → nothing');

  const off = load({ updateCheck: false });
  assert.equal(await off.TP.telemetry.checkUpdate(), null);
  assert.equal(off.calls.length, 0);
  const err = load({ fail: 500 });
  assert.equal(await err.TP.telemetry.checkUpdate(), null, 'errors → null, no throw');
  assert.ok(TP.telemetry.compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(TP.telemetry.compareVersions('1.2.0-beta.1', '1.2.0') < 0);
});

test('update check does not send the install id or any body', async () => {
  const { TP, calls } = load();
  await TP.telemetry.ping();
  await TP.telemetry.checkUpdate();
  const g = calls.find((c) => c.url.endsWith('/v1/latest'));
  assert.equal(g.method, 'GET');
  assert.equal(g.body, undefined);
  assert.ok(!g.url.includes('?'));
});

test('feedback: fields, never the install id (TP-179), page only with the meta box, error mapping', async () => {
  const { TP, calls } = load();
  await TP.telemetry.ping();
  const r = await TP.telemetry.sendFeedback({ kind: 'bug', text: '  De agenda is leeg op maandag  ', contact: 'student.a@example.edu', page: 'agenda', website: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true });
  const f = calls.filter((c) => c.url.endsWith('/v1/feedback'));
  assert.equal(f[0].method, 'POST');
  assert.deepEqual(Object.keys(f[0].body).sort(), ['browser', 'contact', 'kind', 'lang', 'page', 'text', 'v', 'website'], 'no install id, even with telemetry on');
  assert.equal(f[0].body.text, 'De agenda is leeg op maandag');
  await TP.telemetry.sendFeedback({ kind: 'idea', text: 'Een idee zonder metadata', includeMeta: false, page: 'agenda' });
  assert.deepEqual(Object.keys(calls.at(-1).body).sort(), ['kind', 'text', 'website'], 'meta off: no version/browser/language/page');
  await TP.telemetry.sendFeedback({ kind: 'idea', text: 'Een idee met een rare pagina', page: 'https://x' });
  assert.equal(calls.at(-1).body.page, undefined, 'invalid page dropped');

  const off = load({ telemetry: false });
  assert.deepEqual(JSON.parse(JSON.stringify(await off.TP.telemetry.sendFeedback({ kind: 'other', text: 'Werkt ook zonder telemetrie' }))), { ok: true });
  assert.equal(off.calls[0].body.id, undefined, 'no install id while telemetry is off');
  assert.equal(off.stores.local['telemetry:id'], undefined);

  assert.equal((await TP.telemetry.sendFeedback({ kind: 'idea', text: 'kort' })).error, 'invalid');
  const m = load();
  for (const [status, error] of [[429, 'rate'], [400, 'invalid'], [422, 'invalid'], [500, 'server'], [403, 'server'], [0, 'network']]) {
    m.setFail(status);
    if (!status) m.TP.net.json = async () => { const e = new Error('offline'); e.status = 0; throw e; };
    assert.equal((await m.TP.telemetry.sendFeedback({ kind: 'idea', text: 'Een geldig bericht hier' })).error, error, String(status));
  }
});
