/* Unit tests for the announcement-sheet data functions in src/core/data.js: Ad Valvas ids/urls, TP.data.advalvasMessage
   (relay text fetch, needs-login, in-memory cache: TTL, no caching of failures, shared in-flight requests),
   TP.data.announcementBody (id from url/event id, fallback by title) and TP.data.markUnread.
   The HTML parser itself needs a DOM: it is tested in Chromium (tests/e2e/advalvas.e2e.js). */
'use strict';
process.env.TZ = 'Europe/Brussels';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, settle } = require('../helpers/tp');

const V = 'https://icts-p-toledo-valvas.cloud.icts.kuleuven.be';
const plain = (x) => JSON.parse(JSON.stringify(x));
const ev = (id, extra = {}) => Object.assign({ id, title: 'Bericht', source: 'Ad Valvas', sourceId: 'advalvas', type: 'advalvas', subType: 'advalvas', read: false, date: Date.now(), url: `${V}/student/messages/775906/external`, author: 'Docent A' }, extra);

async function setup(net = {}, settings = { sync: { markReadInToledo: false } }) {
  const texts = [];
  const b = await boot({ settings, net: Object.assign({ text: async (url, opts) => { texts.push({ url, opts }); return '<page>'; } }, net) });
  const T = b.TP.data._test;
  T._reset();
  T.setValvasParser((html) => ({ title: 'T', from: 'Docent A (docent.a@example.edu)', to: 'X', date: 1, dateText: '', attachments: [], html: `<p>${html}</p>` }));
  return Object.assign(b, { D: b.TP.data, T, texts });
}

test('Ad Valvas id + url: from the message url, the event id "tol-valven~N", a number; nothing else', async () => {
  const { D } = await setup();
  assert.equal(D.advalvasId(ev('tol-valven~775906')), '775906');
  assert.equal(D.advalvasId({ id: 'x', url: `${V}/student/messages/42/external` }), '42');
  assert.equal(D.advalvasId({ id: 'tol-valven~7', url: 'https://ultra.edu.kuleuven.cloud/ultra/institution-page' }), '7');
  assert.equal(D.advalvasId(775906), '775906');
  assert.equal(D.advalvasId('tol-valven~12'), '12');
  assert.equal(D.advalvasId({ id: 'ev-50', url: 'https://ultra.edu.kuleuven.cloud/ultra/institution-page' }), null);
  assert.equal(D.advalvasId({ id: 'x', url: 'https://evil.example.org/student/messages/1/external' }), null);
  assert.equal(D.advalvasId(null), null);
  assert.equal(D.advalvasUrl(ev('tol-valven~5', { url: null })), `${V}/student/messages/5/external`);
  assert.equal(D.advalvasUrl({ id: 'nope' }), null);
});

test('advalvasMessage: one text fetch through TP.net (Accept text/html), parsed, cached per id', async () => {
  const { D, T, texts } = await setup();
  const m = await D.advalvasMessage(ev('tol-valven~775906'));
  assert.equal(m.id, '775906');
  assert.equal(m.url, `${V}/student/messages/775906/external`);
  assert.equal(m.html, '<p><page></p>');
  assert.equal(texts.length, 1);
  assert.equal(texts[0].url, `${V}/student/messages/775906/external`);
  assert.equal(texts[0].opts.headers.Accept, 'text/html');
  // cache hit (also via another key shape of the same id), force → new fetch
  assert.equal((await D.advalvasMessage('775906')).html, m.html);
  assert.equal(texts.length, 1);
  await D.advalvasMessage(775906, { force: true });
  assert.equal(texts.length, 2);
  assert.equal(T.bodyCacheSize(), 1);
});

test('advalvasMessage: concurrent calls share one request; the cache expires after 30 min', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { D, texts, clock } = await setup({ text: async (url) => { texts.push({ url }); await gate; return 'x'; } });
  const a = D.advalvasMessage(1); const b = D.advalvasMessage(1);
  release();
  assert.deepEqual(plain(await a), plain(await b));
  assert.equal(texts.length, 1);
  await D.advalvasMessage(1);
  assert.equal(texts.length, 1);
  clock.add(31 * 60e3);
  await D.advalvasMessage(1);
  assert.equal(texts.length, 2, 'expired → fetched again');
});

test('advalvasMessage: no session (relay redirect / login page) → needsLogin; failures are never cached', async () => {
  let mode = 'redirect';
  const { D, T, texts } = await setup({
    text: async (url) => {
      texts.push({ url });
      if (mode === 'redirect') throw Object.assign(new Error('session'), { status: 0, auth: true, relay: true });
      if (mode === '500') throw Object.assign(new Error('500'), { status: 500 });
      return mode;
    },
  });
  await assert.rejects(D.advalvasMessage(9), (e) => e.needsLogin === true && e.auth === true);
  // the parser says "login page" (an IdP form that came back with 200)
  T.setValvasParser((html) => { if (html === 'login') { throw Object.assign(new Error('login'), { needsLogin: true, auth: true }); } return { title: 't', html: 'ok', attachments: [] }; });
  mode = 'login';
  await assert.rejects(D.advalvasMessage(9), (e) => e.needsLogin === true);
  mode = '500';
  await assert.rejects(D.advalvasMessage(9), (e) => e.status === 500 && !e.needsLogin);
  assert.equal(T.bodyCacheSize(), 0, 'nothing cached');
  mode = 'fine';
  assert.equal((await D.advalvasMessage(9)).html, 'ok');
  assert.equal(texts.length, 4, 'every failure was retried');
  await assert.rejects(D.advalvasMessage({ id: 'ev-50', url: 'https://ultra.edu.kuleuven.cloud/ultra/institution-page' }), (e) => e.noId === true);
});

test('advalvasMessage: the cache is bounded (LRU)', async () => {
  const { D, T } = await setup();
  for (let i = 1; i <= 45; i++) await D.advalvasMessage(i);
  assert.ok(T.bodyCacheSize() <= 40);
});

test('announcementBody: ids from the url / event id ("ultra~_x_1"); unknown id → match by title; cached', async () => {
  const urls = [];
  const anns = { _900001_1: [{ id: '_701_1', title: 'Lokaal gewijzigd!', body: '<p>C207</p>', created: '2026-10-25T10:00:00.000Z' }, { id: '_702_1', title: 'Concept', body: 'x', draft: true }] };
  const { D } = await setup({
    json: async (url) => {
      urls.push(url);
      let m = url.match(/courses\/(_\d+_\d+)\/announcements\/(_\d+_\d+)$/);
      if (m) { const a = (anns[m[1]] || []).find((x) => x.id === m[2]); if (!a) throw Object.assign(new Error('404'), { status: 404 }); return a; }
      m = url.match(/courses\/(_\d+_\d+)\/announcements\?limit=50$/);
      if (m) return { results: anns[m[1]] || [] };
      m = url.match(/courses\/courseId:(.+)$/);
      if (m) return { id: '_900001_1' };
      return null;
    },
  });
  const byUrl = await D.announcementBody({ id: 'ultra~_701_1', title: 'x', sourceId: 'LU', url: 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900001_1/announcements/announcement-detail?courseId=_900001_1' });
  assert.equal(byUrl.html, '<p>C207</p>');
  assert.equal(byUrl.aid, '_701_1');
  assert.equal(byUrl.cid, '_900001_1');
  assert.ok(urls.some((u) => /\/announcements\/_701_1$/.test(u)));
  // redirect url with a content id only → course id from the url, the announcement by (normalized) title
  const byTitle = await D.announcementBody({ id: 'ev-7', title: 'lokaal  gewijzigd', sourceId: 'LU', url: 'https://ultra.edu.kuleuven.cloud/ultra/redirect?redirectType=nautilus&courseId=_900001_1&contentId=_9008_1' });
  assert.equal(byTitle.aid, '_701_1');
  // no url → course id resolved from the learning unit
  const n = urls.length;
  const byLu = await D.announcementBody({ id: 'ev-8', title: 'Lokaal gewijzigd!', sourceId: 'ULTRA-B-X1-2627', url: null });
  assert.equal(byLu.html, '<p>C207</p>');
  assert.ok(urls.slice(n).some((u) => /courseId:ULTRA-B-X1-2627$/.test(u)));
  // cached: same item again → no request
  const m = urls.length;
  await D.announcementBody({ id: 'ev-7', title: 'lokaal  gewijzigd', sourceId: 'LU', url: 'https://ultra.edu.kuleuven.cloud/ultra/redirect?courseId=_900001_1&contentId=_9008_1' });
  assert.equal(urls.length, m);
  await assert.rejects(D.announcementBody({ id: 'ev-9', title: 'Concept', sourceId: 'LU', url: 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900001_1/outline' }), (e) => e.status === 404, 'drafts are never matched');
});

test('markUnread: event read:false, out of state.read/pendingRead; with sync on a best-effort PATCH read:false', async () => {
  const patches = [];
  const { TP, D, T } = await setup({ json: async (url, opts) => { if (opts && opts.method === 'PATCH') patches.push(JSON.parse(JSON.stringify(opts.body))); return null; } }, { sync: { markReadInToledo: true } });
  const e = ev('tol-valven~1', { read: false });
  T._put('events', [e]);
  await D.markRead([e]);
  await settle();
  assert.equal(D.peek('events')[0].read, true);
  assert.ok(TP.state.get().read['tol-valven~1']);
  assert.equal(await D.markUnread([D.peek('events')[0]]), true);
  await settle();
  assert.equal(D.peek('events')[0].read, false);
  assert.equal((TP.state.get().read || {})['tol-valven~1'], undefined);
  assert.equal(D.announcements({ filter: 'unread' }).length, 1);
  assert.deepEqual(patches.at(-1), [{ id: 'tol-valven~1', type: 'advalvas', subType: 'advalvas', read: false }]);
});
