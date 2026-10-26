'use strict';
// TP.fulltext (src/core/fulltext.js) in a vm sandbox with a stub host: one file at a time, only supported types,
// pause while the tab is hidden, the daily budget, back-off on 429, the 25 MB cap (no body read), unchanged files
// are not downloaded again, and a download through Toledo+ is indexed from its blob (no second fetch).
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');
const { world, fakeChrome, tick } = require('../helpers/fake-chrome');
const F = require('../helpers/fixture-files');

const ULTRA = 'https://ultra.edu.kuleuven.cloud';
const MB = 1024 * 1024;

function node(id, fileName, mimeType, modified = '2026-10-01T10:00:00Z') {
  return { id, title: fileName, modified, contentHandler: { id: 'resource/x-bb-file', file: { fileName, mimeType } } };
}
const ROOTS = [
  { id: 'f1', title: 'Week 1', kids: [node('c1', 'les1.pdf', 'application/pdf'), node('c2', 'film.mp4', 'video/mp4')] },
  node('c3', 'draaiboek.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
];

function setup(o = {}) {
  const w = world(o.local ? { local: o.local } : {});
  const chrome = fakeChrome(w);
  const listeners = {};
  const document = {
    hidden: !!o.hidden,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((x) => x !== fn); },
    show() { this.hidden = false; for (const fn of [...(listeners.visibilitychange || [])]) fn(); },
  };
  const log = { fetches: [], inflight: 0, maxInflight: 0, host: [], json: [] };
  const responses = o.responses || {};
  async function fetch(url) {
    log.fetches.push(url);
    log.inflight++; log.maxInflight = Math.max(log.maxInflight, log.inflight);
    await tick(5);
    log.inflight--;
    const name = decodeURIComponent(url.split('/attachments/')[1].split('/')[0]).replace(/^att-/, '');
    const queued = responses[name] && responses[name].shift && responses[name].shift();
    const r = queued || { status: 200, body: F.fileBody('Syllabus.pdf') };
    const headers = new Map(Object.entries(r.headers || {}));
    let bodyRead = false;
    return {
      ok: r.status >= 200 && r.status < 300, status: r.status, url,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      body: null,
      async arrayBuffer() { bodyRead = true; log.bodyRead = (log.bodyRead || 0) + 1; const b = r.body || Buffer.alloc(0); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
      get bodyRead() { return bodyRead; },
    };
  }
  const settings = { search: { fullText: o.enabled !== false } };
  const s = sandbox({ origin: ULTRA, globals: { chrome, document, fetch, Blob, TextDecoder, TextEncoder, Uint8Array, requestIdleCallback: (fn) => setTimeout(fn, 0), crypto: globalThis.crypto } });
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  s.load('src/i18n/fulltext.js');
  const TP = s.ctx.TP;
  TP.settings = { get: () => settings, set: async (p) => { Object.assign(settings.search, p.search || {}); }, subscribe: () => () => {} };
  TP.state = { get: () => ({ cidMap: { 'LU-1': '_1_1' } }) };
  TP.data = { course: () => ({ name: 'Filmtaal 1', color: '#000' }), courses: () => [], isStale: () => false, ultraOpen: async () => {}, ultraTree: async () => ROOTS };
  TP.index = { get: () => ({ luId: 'LU-1', name: 'Filmtaal 1', items: [['c1', 'les1.pdf', 'file', 'Week 1', 'f1'], ['c2', 'film.mp4', 'video', 'Week 1', 'f1'], ['c3', 'draaiboek.docx', 'file', '', '']] }) };
  TP.net = {
    json: async (url) => {
      log.json.push(url);
      const id = /contents\/([^/]+)\/attachments/.exec(url)[1];
      const n = { c1: 'les1.pdf', c2: 'film.mp4', c3: 'draaiboek.docx' }[id];
      return { results: [{ id: 'att-' + n, fileName: n, mimeType: '' }] };
    },
    blob: async (url) => new Blob([F.fileBody('Syllabus.pdf')], { type: 'application/pdf' }),
    resolve: (u) => u,
  };
  s.load('src/core/fulltext-engine.js');
  s.load('src/core/fulltext.js');
  const store = new Map(o.records || []);
  TP.fulltext._test.cfg.host = async (op, args) => {
    log.host.push(op);
    if (op === 'get') return store.get(args.key) || null;
    if (op === 'list') return [...store.values()].filter((r) => r.cid === args.cid);
    if (op === 'put') { store.set(`${args.meta.cid}:${args.meta.contentId}`, { ...args.meta, bytes: args.bytes.byteLength }); return { pages: 1, skipped: '' }; }
    if (op === 'skip') { store.set(`${args.meta.cid}:${args.meta.contentId}`, { ...args.meta, skipped: args.reason }); return { skipped: args.reason }; }
    if (op === 'touch') return true;
    return null;
  };
  TP.fulltext._test.cfg.gapMs = 0;
  TP.fulltext._test.cfg.backoffScale = 0.002; // 5 s → 10 ms
  const progress = [];
  TP.fulltext.on('progress', (r) => progress.push(r && { ...r }));
  return { TP, F: TP.fulltext, log, store, document, chrome, w, progress, settings };
}
async function until(pred, ms = 3000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await tick(10); } return pred(); }
const runOf = (x) => x.F._test.runs.get('_1_1');

test('a course run downloads only supported files, one at a time, and stores them', async () => {
  const x = setup();
  await x.F.indexCourse({ cid: '_1_1', luId: 'LU-1', roots: ROOTS });
  assert.ok(await until(() => runOf(x).state === 'done'), JSON.stringify(runOf(x)));
  assert.equal(x.log.fetches.length, 2, 'mp4 is never downloaded');
  assert.ok(x.log.fetches.every((u) => u.startsWith(`${ULTRA}/learn/api/public/v1/courses/_1_1/contents/`)), 'absolute download URLs');
  assert.equal(x.log.maxInflight, 1, 'one file at a time');
  const r = runOf(x);
  assert.deepEqual([r.total, r.done, r.indexed, r.skipped, r.failed], [2, 2, 2, 0, 0]);
  assert.equal(x.store.get('_1_1:c1').title, 'les1.pdf');
  assert.equal(x.store.get('_1_1:c1').path, 'Week 1');
  assert.equal(x.store.get('_1_1:c1').modified, '2026-10-01T10:00:00Z');
  assert.match(x.store.get('_1_1:c3').url, /attachments\/att-draaiboek\.docx\/download$/);
  // the budget counts the downloaded bytes
  const b = x.w.stores.local['fulltext:budget'];
  assert.equal(b.bytes, F.fileBody('Syllabus.pdf').length * 2);
});

test('unchanged files are not downloaded again; a changed one is', async () => {
  const known = [['_1_1:c1', { key: '_1_1:c1', cid: '_1_1', contentId: 'c1', attId: 'att-les1.pdf', modified: '2026-10-01T10:00:00Z' }],
    ['_1_1:c3', { key: '_1_1:c3', cid: '_1_1', contentId: 'c3', attId: 'att-draaiboek.docx', modified: '2026-09-01T10:00:00Z' }]];
  const x = setup({ records: known });
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(x).state === 'done'));
  assert.equal(x.log.fetches.length, 1);
  assert.match(x.log.fetches[0], /draaiboek/);
  assert.equal(x.log.json.length, 1, 'no attachment lookup for the unchanged file');
});

test('pauses while the tab is hidden and resumes when it is shown', async () => {
  const x = setup({ hidden: true });
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  await tick(60);
  assert.equal(x.log.fetches.length, 0, 'nothing while hidden');
  assert.equal(runOf(x).pause, 'hidden');
  assert.match(x.TP.t('fulltext.pause.hidden'), /gepauzeerd/);
  x.document.show();
  assert.ok(await until(() => runOf(x).state === 'done'));
  assert.equal(x.log.fetches.length, 2);
});

test('the daily budget stops downloads (and resets the next day)', async () => {
  const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const x = setup({ local: { 'fulltext:budget': { day, bytes: 300 * MB } } });
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(x).pause === 'budget'));
  assert.equal(x.log.fetches.length, 0);
  assert.equal(runOf(x).state, 'paused');
  const y = setup({ local: { 'fulltext:budget': { day: '2000-01-01', bytes: 300 * MB } } });
  await y.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(y).state === 'done'));
  assert.equal(y.log.fetches.length, 2, 'yesterday’s budget does not count');
});

test('backs off on 429/5xx and retries the same file; gives up after 4 retries', async () => {
  const x = setup({ responses: { 'les1.pdf': [{ status: 429, headers: {} }, { status: 503, headers: {} }] } });
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(x).state === 'done'));
  assert.equal(x.log.fetches.filter((u) => /les1/.test(u)).length, 3, '2 failures + 1 success');
  assert.ok(x.progress.some((p) => p && p.pause === 'backoff'), 'progress shows the back-off');
  assert.equal(runOf(x).indexed, 2);
  const y = setup({ responses: { 'les1.pdf': Array.from({ length: 6 }, () => ({ status: 500, headers: {} })) } });
  await y.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(y).state === 'done', 5000));
  assert.equal(y.log.fetches.filter((u) => /les1/.test(u)).length, 5);
  assert.deepEqual([runOf(y).indexed, runOf(y).failed], [1, 1]);
});

test('files over 25 MB are skipped from Content-Length without reading the body', async () => {
  const x = setup({ responses: { 'les1.pdf': [{ status: 200, headers: { 'content-length': String(26 * MB) }, body: Buffer.alloc(1) }] } });
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  assert.ok(await until(() => runOf(x).state === 'done'));
  assert.equal(x.store.get('_1_1:c1').skipped, 'large');
  assert.equal(x.log.bodyRead, 1, 'only the docx body was read');
  assert.deepEqual([runOf(x).indexed, runOf(x).skipped], [1, 1]);
});

test('cancel stops the run', async () => {
  const x = setup();
  await x.F.indexCourse({ cid: '_1_1', roots: ROOTS });
  x.F.cancelCourse('_1_1');
  await tick(80);
  assert.equal(runOf(x).state, 'cancelled');
  assert.ok(x.log.fetches.length <= 1);
});

test('a download through Toledo+ (TP.net.blob) is indexed from the same blob, without fetching again', async () => {
  const x = setup();
  await x.TP.net.blob(`${ULTRA}/learn/api/public/v1/courses/_1_1/contents/c1/attachments/att-les1.pdf/download`);
  assert.ok(await until(() => x.store.has('_1_1:c1')));
  assert.equal(x.log.fetches.length, 0);
  const rec = x.store.get('_1_1:c1');
  assert.equal(rec.attId, 'att-les1.pdf');
  assert.equal(rec.title, 'les1.pdf');
  assert.equal(rec.bytes, F.fileBody('Syllabus.pdf').length);
  // off → no tap
  const y = setup({ enabled: false });
  await y.TP.net.blob(`${ULTRA}/learn/api/public/v1/courses/_1_1/contents/c1/attachments/att-les1.pdf/download`);
  await tick(50);
  assert.equal(y.store.size, 0);
});

test('palette helpers: page/slide labels, escaped snippet with <mark>, footer text', () => {
  const x = setup();
  assert.equal(x.F.where({ page: 14, unit: 'page' }), 'p. 14');
  assert.equal(x.F.where({ page: 6, unit: 'slide' }), 'dia 6');
  assert.equal(x.F.where({ page: 1, unit: '' }), '');
  assert.equal(x.F.snippetHtml([['…<b>', false], ['scène', true], [' & co', false]]), '…&lt;b&gt;<mark>scène</mark> &amp; co');
  assert.equal(x.F.statusText(), '', 'no count yet');
});
