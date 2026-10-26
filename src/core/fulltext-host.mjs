/* Toledo+ — full-text search host: a hidden extension page (src/core/fulltext-host.html) that the content script
   (src/core/fulltext.js) embeds as an invisible iframe on Toledo/Ultra pages.
   Why an extension frame: it runs in the chrome-extension:// origin, so (1) one IndexedDB is shared by both
   Toledo origins and every tab, (2) it may start module workers from extension URLs (pdf.js), (3) it is an
   out-of-process frame, so indexing never janks the Toledo page; and it needs no extra permission (unlike an
   offscreen document) while bytes travel zero-copy (transferable ArrayBuffer over a MessagePort).
   Security: the content script proves itself with a nonce sent over chrome.runtime messaging (which page scripts
   cannot use), then hands over a MessagePort with postMessage. Nothing here touches the network.

   IndexedDB 'tplus-fulltext' v1:
     files  key → { key, cid, luId, course, contentId, attId, title, path, fileName, type, unit, size, modified, url,
                    pages, chars, skipped, t, used }
     pages  [key, n] → { key, n, text }          (page/slide text, for snippets)
     terms  [key, n] → { key, n, terms }         (unique normalised words, joined by ' ', for the in-memory index)
   Port protocol: request { id, op, ...args } → reply { id, ok, result | error }; push { push: 'status', status }. */
import './fulltext-engine.js';

const E = globalThis.TPFT;
const DB_NAME = 'tplus-fulltext';
const ORIGINS = ['https://toledo.kuleuven.be', 'https://ultra.edu.kuleuven.cloud'];
const NONCE_TTL = 30e3;
const WORKER_IDLE = 60e3;

// ---------------------------------------------------------------- IndexedDB helpers
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: ['key', 'n'] });
      if (!d.objectStoreNames.contains('terms')) d.createObjectStore('terms', { keyPath: ['key', 'n'] });
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); dbp = null; };
      res(d);
    };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  return dbp;
}
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const range = (key) => IDBKeyRange.bound([key, -Infinity], [key, Infinity]);

// ---------------------------------------------------------------- in-memory state
const index = E.createIndex();
const files = new Map(); // key → record (metadata only)
let ready = null;

function load() {
  if (ready) return ready;
  ready = (async () => {
    const d = await db();
    const tx = d.transaction(['files', 'terms'], 'readonly');
    const [recs, terms] = await Promise.all([req(tx.objectStore('files').getAll()), req(tx.objectStore('terms').getAll())]);
    files.clear(); index.clear();
    for (const r of recs) files.set(r.key, r);
    const by = new Map();
    for (const t of terms) { let l = by.get(t.key); if (!l) by.set(t.key, (l = [])); l.push({ n: t.n, terms: t.terms }); }
    for (const [key, pages] of by) if (files.has(key)) index.add(key, pages);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function reloadKey(key) {
  await load();
  const d = await db();
  const tx = d.transaction(['files', 'terms'], 'readonly');
  const [rec, terms] = await Promise.all([req(tx.objectStore('files').get(key)), req(tx.objectStore('terms').getAll(range(key)))]);
  if (rec) { files.set(key, rec); index.add(key, terms.map((t) => ({ n: t.n, terms: t.terms }))); } else { files.delete(key); index.remove(key); }
}

function status() {
  let indexed = 0; let skipped = 0; let chars = 0; let bytes = 0;
  for (const r of files.values()) { if (r.skipped) skipped++; else { indexed++; chars += r.chars || 0; bytes += r.size || 0; } }
  return { files: indexed, skipped, chars, bytes, ...index.stats() };
}

// ---------------------------------------------------------------- cross-tab sync (every Toledo tab has its own frame)
const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('tplus-fulltext') : null;
function changed(msg) { try { bc && bc.postMessage(msg); } catch (_) { /* ignore */ } pushStatus(); }
if (bc) {
  bc.onmessage = async (ev) => {
    const m = ev.data || {};
    try {
      if (m.all) { ready = null; await load(); } else if (m.key) await reloadKey(m.key);
    } catch (_) { /* best effort */ }
    pushStatus();
  };
}

// ---------------------------------------------------------------- extraction worker
let worker = null; let wSeq = 0; let wIdle = 0;
const wPending = new Map();
function getWorker() {
  clearTimeout(wIdle);
  if (!worker) {
    worker = new Worker(new URL('./fulltext-worker.mjs', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      const p = m.id != null && wPending.get(m.id);
      if (p) { wPending.delete(m.id); p(m); }
    };
    worker.onerror = () => { for (const p of wPending.values()) p({ skipped: 'unreadable' }); wPending.clear(); try { worker.terminate(); } catch (_) { /* ignore */ } worker = null; };
  }
  return worker;
}
function idleWorker() {
  clearTimeout(wIdle);
  wIdle = setTimeout(() => { if (worker && !wPending.size) { worker.terminate(); worker = null; } }, WORKER_IDLE);
}
function extract(bytes, type) {
  return new Promise((res) => {
    const id = ++wSeq;
    wPending.set(id, (m) => { idleWorker(); res(m); });
    getWorker().postMessage({ id, bytes, type }, [bytes]);
  });
}

// ---------------------------------------------------------------- operations
const META = ['cid', 'luId', 'course', 'contentId', 'attId', 'title', 'path', 'fileName', 'type', 'size', 'modified', 'url'];
function pick(m) { const o = {}; for (const k of META) if (m && m[k] != null) o[k] = m[k]; return o; }
const keyOf = (m) => `${m.cid}:${m.contentId}`;

async function writeFile(rec, pages) {
  const d = await db();
  const tx = d.transaction(['files', 'pages', 'terms'], 'readwrite');
  const P = tx.objectStore('pages'); const T = tx.objectStore('terms');
  P.delete(range(rec.key)); T.delete(range(rec.key));
  tx.objectStore('files').put(rec);
  const tpages = [];
  for (const p of pages || []) {
    P.put({ key: rec.key, n: p.n, text: p.text });
    const terms = E.terms(p.text).join(' ');
    T.put({ key: rec.key, n: p.n, terms });
    tpages.push({ n: p.n, terms });
  }
  await done(tx);
  files.set(rec.key, rec);
  if (tpages.length) index.add(rec.key, tpages); else index.remove(rec.key);
}

async function removeKeys(keys) {
  if (!keys.length) return;
  const d = await db();
  const tx = d.transaction(['files', 'pages', 'terms'], 'readwrite');
  for (const k of keys) { tx.objectStore('files').delete(k); tx.objectStore('pages').delete(range(k)); tx.objectStore('terms').delete(range(k)); }
  await done(tx);
  for (const k of keys) { files.delete(k); index.remove(k); }
}

/** Least recently used files go first when the store is over its cap. */
async function evict() {
  let total = 0;
  for (const r of files.values()) total += r.chars || 0;
  if (total <= E.LIMITS.capChars) return [];
  const order = [...files.values()].filter((r) => !r.skipped).sort((a, b) => (a.used || a.t || 0) - (b.used || b.t || 0));
  const drop = [];
  for (const r of order) { if (total <= E.LIMITS.capChars * 0.9) break; total -= r.chars || 0; drop.push(r.key); }
  await removeKeys(drop);
  return drop;
}

const ops = {
  async status() { await load(); return status(); },
  async warm() { await load(); return status(); },
  async get({ key }) { await load(); return files.get(key) || null; },
  async list({ cid }) { await load(); return [...files.values()].filter((r) => r.cid === cid).map(({ key, contentId, attId, modified, size, skipped }) => ({ key, contentId, attId, modified, size, skipped })); },

  /** Extract + store one file (bytes transferred). → { key, pages, skipped } */
  async put({ meta, bytes }) {
    await load();
    const m = pick(meta);
    const key = keyOf(m);
    const type = m.type || E.typeOf(m.fileName || m.title, '');
    const size = (bytes && bytes.byteLength) || m.size || 0;
    let r;
    if (!type) r = { skipped: 'unsupported' };
    else if (size > E.LIMITS.maxFileBytes) r = { skipped: 'large' };
    else r = await extract(bytes, type);
    const pages = r.pages || [];
    const chars = pages.reduce((a, p) => a + p.text.length, 0);
    const prev = files.get(key);
    const rec = { ...m, key, type, size, unit: E.unitOf(type, pages.length ? pages[pages.length - 1].n : 0), pages: pages.length, chars,
      skipped: pages.length ? '' : (r.skipped || 'notext'), t: Date.now(), used: (prev && prev.used) || 0 };
    await writeFile(rec, pages);
    await evict();
    changed({ key });
    return { key, pages: pages.length, skipped: rec.skipped };
  },

  /** Remember a file that was not downloaded (too large, unsupported) so it is not tried again until it changes. */
  async skip({ meta, reason }) {
    await load();
    const m = pick(meta);
    const rec = { ...m, key: keyOf(m), pages: 0, chars: 0, skipped: reason || 'unsupported', t: Date.now(), used: 0 };
    await writeFile(rec, []);
    changed({ key: rec.key });
    return { key: rec.key, skipped: rec.skipped };
  },

  async touch({ key, patch }) {
    await load();
    const rec = files.get(key);
    if (!rec) return false;
    const next = { ...rec, ...pick(patch || {}), used: patch && patch.used ? Date.now() : rec.used };
    const d = await db();
    const tx = d.transaction('files', 'readwrite');
    tx.objectStore('files').put(next);
    await done(tx);
    files.set(key, next);
    changed({ key });
    return true;
  },

  async remove({ keys }) { await load(); await removeKeys(keys || []); for (const key of keys || []) changed({ key }); return true; },

  async wipe() {
    const d = await db();
    const tx = d.transaction(['files', 'pages', 'terms'], 'readwrite');
    for (const s of ['files', 'pages', 'terms']) tx.objectStore(s).clear();
    await done(tx);
    files.clear(); index.clear(); ready = Promise.resolve();
    changed({ all: true });
    return status();
  },

  /** → [{ key, cid, luId, course, contentId, title, path, fileName, type, unit, page, url, snippet, score }] */
  async search({ q, limit = 8, hidden = [] }) {
    await load();
    const words = E.queryWords(q);
    if (!words.length) return [];
    const hide = new Set(hidden || []);
    const titleBoost = (key) => {
      const r = files.get(key);
      if (!r) return 0;
      const t = E.norm(`${r.title || ''} ${r.fileName || ''}`);
      return words.every((w) => t.includes(w)) ? 2 : 0;
    };
    const hits = index.search(words, { limit: limit * 3, boost: titleBoost })
      .filter((h) => { const r = files.get(h.key); return r && !r.skipped && !hide.has(r.luId); })
      .slice(0, limit);
    if (!hits.length) return [];
    const d = await db();
    const tx = d.transaction('pages', 'readonly');
    const store = tx.objectStore('pages');
    const texts = await Promise.all(hits.map((h) => req(store.get([h.key, h.page]))));
    return hits.map((h, i) => {
      const r = files.get(h.key);
      const text = (texts[i] && texts[i].text) || '';
      const sn = E.snippet(text, words, { radius: 80 }) || { segs: [[text.slice(0, 160), false]] };
      return { key: r.key, cid: r.cid, luId: r.luId, course: r.course, contentId: r.contentId, title: r.title, path: r.path, fileName: r.fileName,
        type: r.type, unit: r.unit, page: h.page, url: r.url, snippet: sn.segs, score: h.score };
    });
  },
};

// ---------------------------------------------------------------- handshake + port
const nonces = new Map(); // nonce → time
const ports = new Set();

function pushStatus() {
  if (!ports.size || !ready) return;
  ready.then(() => { const s = status(); for (const p of ports) { try { p.postMessage({ push: 'status', status: s }); } catch (_) { ports.delete(p); } } }, () => {});
}

try {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'tp-ft-hello' || typeof msg.nonce !== 'string') return false;
    const origin = sender && (sender.origin || (() => { try { return new URL(sender.url).origin; } catch (_) { return ''; } })());
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || !ORIGINS.includes(origin)) return false;
    const now = Date.now();
    for (const [n, t] of nonces) if (now - t > NONCE_TTL) nonces.delete(n);
    nonces.set(msg.nonce, now);
    sendResponse({ ok: true });
    return false;
  });
} catch (_) { /* not an extension context (tests) */ }

window.addEventListener('message', (ev) => {
  const m = ev.data || {};
  if (m.type !== 'tp-ft-port' || !ORIGINS.includes(ev.origin) || !ev.ports || !ev.ports[0]) return;
  const t = nonces.get(m.nonce);
  if (!t || Date.now() - t > NONCE_TTL) return;
  nonces.delete(m.nonce);
  const port = ev.ports[0];
  ports.add(port);
  port.onmessage = async (e) => {
    const r = e.data || {};
    const fn = Object.prototype.hasOwnProperty.call(ops, r.op) ? ops[r.op] : null;
    if (!fn) { port.postMessage({ id: r.id, ok: false, error: 'unknown op' }); return; }
    try { port.postMessage({ id: r.id, ok: true, result: await fn(r) }); } catch (err) { port.postMessage({ id: r.id, ok: false, error: String((err && err.message) || err) }); }
  };
  port.postMessage({ push: 'hello' });
});
