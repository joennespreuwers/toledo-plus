/* Toledo+ — TP.fulltext: full-text search of course files for the ⌘K palette (opt-in: settings.search.fullText).
   This content script owns fetching and throttling; text extraction, storage and search run in a hidden extension
   frame (src/core/fulltext-host.html → .mjs, with a module worker for pdf.js/zip) — see docs/ARCHITECTURE.md › Full-text.
     (a) files the student opens/downloads through Toledo+ are indexed (a download is tapped in TP.net.blob: no
         second download; "open" queues one idle-time fetch of that file),
     (b) "Doorzoek alle bestanden" on a course page queues every supported file of that course,
   one file at a time, only while the tab is visible and the browser is idle, ≤ 25 MB per file, ≤ 300 MB per day,
   backing off on 429/5xx. Fetching only happens on the Ultra origin (the download endpoint needs that session);
   searching works on both origins (one index in the extension origin). Nothing is sent anywhere. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const E = globalThis.TPFT;
  if (!E) return;

  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const BB = '/learn/api/public/v1';
  const BUDGET_KEY = 'fulltext:budget';
  const MAX_RETRY = 4;
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const log = (...a) => { try { console.debug('[Toledo+ fulltext]', ...a); } catch (_) { /* noop */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const onUltra = () => { try { return location.origin === ULTRA; } catch (_) { return false; } };
  const enabled = () => { try { return ((TP.settings.get() || {}).search || {}).fullText === true; } catch (_) { return false; } };
  const cfg = { idleTimeout: 3000, gapMs: 120, connectTimeout: 10000, backoffScale: 1, host: null }; // tests shrink/stub these

  // ---------------------------------------------------------------- events
  const subs = { change: new Set(), progress: new Set() };
  function on(evt, fn) { (subs[evt] || subs.change).add(fn); return () => (subs[evt] || subs.change).delete(fn); }
  function emit(evt, data) { for (const fn of [...(subs[evt] || [])]) { try { fn(data); } catch (e) { log('listener', e); } } }

  // ---------------------------------------------------------------- the extension frame (host)
  let conn = null;          // Promise<MessagePort>
  let port = null;
  let seq = 0;
  const pending = new Map();
  let stat = null;          // last status from the host

  function connect() {
    if (conn) return conn;
    conn = new Promise((resolve, reject) => {
      let frame;
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.id) throw new Error('no extension context');
        frame = document.createElement('iframe');
        frame.src = chrome.runtime.getURL('src/core/fulltext-host.html');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        frame.title = 'Toledo+';
        frame.dataset.tplusFulltext = '';
        frame.style.cssText = 'display:none!important';
      } catch (e) { reject(e); return; }
      const timer = setTimeout(() => reject(new Error('host timeout')), cfg.connectTimeout);
      frame.addEventListener('load', () => {
        const nonce = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
        try {
          chrome.runtime.sendMessage({ type: 'tp-ft-hello', nonce }, () => {
            void chrome.runtime.lastError;
            const ch = new MessageChannel();
            ch.port1.onmessage = (ev) => {
              const m = ev.data || {};
              if (m.push === 'hello') { clearTimeout(timer); port = ch.port1; resolve(port); return; }
              if (m.push === 'status') { stat = m.status; emit('change', status()); return; }
              const p = m.id != null && pending.get(m.id);
              if (p) { pending.delete(m.id); clearTimeout(p.timer); if (m.ok) p.res(m.result); else p.rej(new Error(m.error || 'host error')); }
            };
            frame.contentWindow.postMessage({ type: 'tp-ft-port', nonce }, new URL(frame.src).origin, [ch.port2]);
          });
        } catch (e) { clearTimeout(timer); reject(e); }
      }, { once: true });
      (document.documentElement || document).appendChild(frame);
    });
    conn.catch((e) => { log('host unavailable', e && e.message); setTimeout(() => { conn = null; }, 30e3); });
    return conn;
  }

  async function call(op, args = {}, transfer = [], timeout = 15000) {
    if (cfg.host) return cfg.host(op, args); // unit tests: a stub host
    const p = await connect();
    return new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + op)); }, timeout);
      pending.set(id, { res, rej, timer });
      p.postMessage({ id, op, ...args }, transfer);
    });
  }

  // ---------------------------------------------------------------- status
  function status() {
    return { enabled: enabled(), files: (stat && stat.files) || 0, skipped: (stat && stat.skipped) || 0, bytes: (stat && stat.bytes) || 0, known: !!stat, active: activeRun() };
  }
  /** Fetch the host status (and build its in-memory index) — the palette calls this when it opens. Never rejects. */
  function warm() {
    if (!enabled()) return Promise.resolve(status());
    return call('warm').then((s) => { stat = s; emit('change', status()); return status(); }, () => status());
  }
  /** Palette footer: "Doorzoekt ook de inhoud van 312 bestanden" ('' when off or empty). */
  function statusText() {
    const s = status();
    return s.enabled && s.files ? t('fulltext.footer', { n: s.files }) : '';
  }
  const mb = (bytes) => (bytes / (1024 * 1024)).toLocaleString((TP.i18n && TP.i18n.locale && TP.i18n.locale()) || 'nl-BE', { maximumFractionDigits: 1, minimumFractionDigits: bytes && bytes < 10 * 1024 * 1024 ? 1 : 0 });
  /** Settings › Zoeken status line. */
  function settingsText() {
    const s = status();
    if (!s.enabled && !s.files) return t('fulltext.statusOff');
    if (!s.known) { warmQuiet(); return t('fulltext.statusNone'); }
    if (!s.files) return s.skipped ? `${t('fulltext.statusNone')} · ${t('fulltext.skipped', { n: s.skipped })}` : t('fulltext.statusNone');
    return [t('fulltext.statusN', { n: s.files, size: mb(s.bytes) }), s.skipped ? t('fulltext.skipped', { n: s.skipped }) : ''].filter(Boolean).join(' · ');
  }
  let warming = false;
  function warmQuiet() {
    if (warming) return;
    warming = true;
    call('status').then((s) => { stat = s; emit('change', status()); }, () => {}).finally(() => { warming = false; });
  }

  // ---------------------------------------------------------------- search
  function hiddenLuIds() {
    try { return (TP.data.courses({ includeHidden: true, includeCommunities: true }) || []).filter((c) => c.hidden).map((c) => c.luId); } catch (_) { return []; }
  }
  /** → [{ cid, luId, id, title, course, color, page, unit, type, url, snippet: [[text, marked]] }] (never rejects). */
  async function search(q, opts = {}) {
    if (!enabled() || !String(q || '').trim()) return [];
    try {
      const hits = await call('search', { q: String(q), limit: opts.limit || 8, hidden: hiddenLuIds() }, [], 4000);
      return (hits || []).map((h) => {
        let c = null;
        try { c = h.luId ? TP.data.course(h.luId) : null; } catch (_) { c = null; }
        return { key: h.key, cid: h.cid, luId: h.luId, id: h.contentId, title: h.title || h.fileName || '', fileName: h.fileName, course: (c && c.name) || h.course || '',
          color: c ? c.color : null, page: h.page, unit: h.unit || '', type: h.type, url: h.url, snippet: Array.isArray(h.snippet) ? h.snippet : [] };
      });
    } catch (e) { log('search', e && e.message); return []; }
  }
  /** "p. 14" | "dia 6" | '' */
  function where(hit) {
    if (!hit || !hit.page) return '';
    if (hit.unit === 'slide') return t('fulltext.slide', { n: hit.page });
    if (hit.unit === 'page') return t('fulltext.page', { n: hit.page });
    return '';
  }
  /** Snippet segments → HTML with <mark> (every segment escaped). */
  function snippetHtml(segs) {
    return (segs || []).map(([s, m]) => (m ? `<mark>${esc(s)}</mark>` : esc(s))).join('');
  }

  /** Open a result: PDFs open in the browser viewer at the page (#page=n survives the redirect to storage). Sync: keeps the key press' user activation. */
  function open(hit) {
    if (!hit) return;
    call('touch', { key: hit.key || `${hit.cid}:${hit.id}`, patch: { used: true } }).catch(() => {});
    const page = hit.type === 'pdf' && hit.page > 1 ? `#page=${hit.page}` : '';
    let url = null;
    try { url = hit.url ? new URL(hit.url) : null; } catch (_) { url = null; }
    if (url && url.origin === ULTRA) {
      let w = null;
      try { w = window.open(url.href + page, '_blank'); } catch (_) { w = null; }
      if (w) { try { w.opener = null; } catch (_) { /* cross-origin */ } return; }
    }
    Promise.resolve(TP.data.ultraOpen(hit.cid, hit.id)).catch(() => TP.shell && TP.shell.toast && TP.shell.toast(t('course.openFailed')));
  }

  // ---------------------------------------------------------------- metadata from the document index
  function metaFor(cid, contentId) {
    const m = { cid, contentId };
    try {
      const e = TP.index && TP.index.get ? TP.index.get(cid) : null;
      if (e) {
        m.luId = e.luId || '';
        m.course = e.name || '';
        const it = (e.items || []).find((x) => x[0] === contentId);
        if (it) { m.title = it[1]; m.kind = it[2]; m.path = it[3]; }
      }
      const c = m.luId ? TP.data.course(m.luId) : null;
      if (c && c.name) m.course = c.name;
    } catch (_) { /* best effort */ }
    if (!m.luId) { try { const map = (TP.state.get() || {}).cidMap || {}; m.luId = Object.keys(map).find((k) => map[k] === cid) || ''; } catch (_) { /* ignore */ } }
    return m;
  }
  const dlUrl = (cid, contentId, attId) => `${ULTRA}${BB}/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(contentId)}/attachments/${encodeURIComponent(attId)}/download`;
  const DL_RE = /\/learn\/api\/public\/v1\/courses\/([^/]+)\/contents\/([^/]+)\/attachments\/([^/]+)\/download/;

  // ---------------------------------------------------------------- budget (chrome.storage.local, shared by tabs)
  const sget = (k) => new Promise((res) => { try { chrome.storage.local.get(k, (o) => { void chrome.runtime.lastError; res((o && o[k]) || null); }); } catch (_) { res(null); } });
  const sset = (o) => new Promise((res) => { try { chrome.storage.local.set(o, () => { void chrome.runtime.lastError; res(); }); } catch (_) { res(); } });
  async function budgetLeft() { return E.budget(await sget(BUDGET_KEY), Date.now()); }
  async function spend(bytes) { const b = E.budget(await sget(BUDGET_KEY), Date.now(), bytes); await sset({ [BUDGET_KEY]: { day: b.day, bytes: b.bytes } }); return b; }

  // ---------------------------------------------------------------- queue (one file at a time)
  const queue = [];          // tasks: { cid, contentId, origin:'open'|'course'|'blob', meta?, blob?, modified?, fileName?, mime? }
  const runs = new Map();    // cid → course run { cid, total, done, indexed, skipped, failed, state, pause }
  let pumping = false;
  let current = null;        // { task, ctrl }
  const ui = new Map();      // cid → 'confirm' (course box state)

  const key = (x) => `${x.cid}:${x.contentId}`;
  function activeRun() { for (const r of runs.values()) if (r.state === 'running' || r.state === 'paused') return { ...r }; return null; }

  function enqueue(task, front = false) {
    const k = key(task);
    const i = queue.findIndex((x) => key(x) === k);
    if (i >= 0) { if (task.blob) queue[i] = task; else if (task.origin === 'course') queue[i].origin = 'course'; return; }
    if (current && key(current.task) === k && !task.blob) return;
    if (front) queue.unshift(task); else queue.push(task);
    pump();
  }

  function setPause(reason) {
    for (const r of runs.values()) if (r.state === 'running' || r.state === 'paused') { r.pause = reason || ''; r.state = reason ? 'paused' : 'running'; }
    emit('progress', activeRun());
  }

  const visible = () => (typeof document === 'undefined' || !document.hidden ? Promise.resolve() : new Promise((r) => {
    const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } };
    document.addEventListener('visibilitychange', f);
  }));
  const idle = () => new Promise((r) => { if (typeof requestIdleCallback === 'function') requestIdleCallback(() => r(), { timeout: cfg.idleTimeout }); else setTimeout(r, 50); });

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      let fails = 0;
      while (queue.length) {
        if (!enabled() || (TP.data && TP.data.isStale && TP.data.isStale())) { queue.length = 0; break; }
        if (typeof document !== 'undefined' && document.hidden) { setPause('hidden'); await visible(); setPause(''); }
        await idle();
        const task = queue[0];
        if (!task) continue;
        if (task.origin !== 'blob') {
          const b = await budgetLeft();
          if (!b.ok) { setPause('budget'); break; } // the rest waits for tomorrow (or the next visit)
        }
        const ctrl = new AbortController();
        current = { task, ctrl };
        let outcome;
        try {
          outcome = await process(task, ctrl.signal);
          fails = 0;
        } catch (e) {
          if (e && e.retry && !ctrl.signal.aborted) {
            fails++;
            if (fails <= MAX_RETRY) { setPause('backoff'); current = null; await sleep(E.backoff(fails, e.retryAfter) * cfg.backoffScale); setPause(''); continue; }
            outcome = 'failed';
            fails = 0;
          } else if (e && e.auth) { setPause('auth'); current = null; break; } else outcome = ctrl.signal.aborted ? 'cancelled' : 'failed';
          if (outcome === 'failed') log('file failed', e && (e.status || e.message));
        }
        current = null;
        if (queue[0] === task) queue.shift();
        count(task, outcome);
        await sleep(cfg.gapMs);
      }
    } finally {
      pumping = false;
      current = null;
      for (const r of runs.values()) if (r.state === 'running' && !queue.some((x) => x.cid === r.cid)) { r.state = 'done'; r.pause = ''; announceDone(r); }
      emit('progress', null);
    }
  }

  function count(task, outcome) {
    const r = runs.get(task.cid);
    if (!r || task.origin !== 'course' || r.state === 'cancelled' || outcome === 'cancelled') { if (outcome !== 'cancelled') emit('progress', null); return; }
    r.done++;
    if (outcome === 'indexed' || outcome === 'same') r.indexed++;
    else if (outcome === 'failed') r.failed++;
    else r.skipped++;
    if (r.done >= r.total) { r.state = 'done'; r.pause = ''; announceDone(r); }
    emit('progress', { ...r });
  }
  function announceDone(r) {
    if (r.announced) return;
    r.announced = true;
    try { TP.shell && TP.shell.announce && TP.shell.announce(courseLineText(r)); } catch (_) { /* ignore */ }
  }

  /** One task → 'indexed' | 'same' | 'skipped' | 'unsupported'. Throws {retry} on 429/5xx, {auth} on an expired session. */
  async function process(task, signal) {
    const meta = { ...metaFor(task.cid, task.contentId), ...(task.meta || {}) };
    if (task.origin === 'blob') return ingest(task, meta);
    if (!onUltra()) return 'skipped';
    // Attachment (id, name, type). Cheap JSON; same origin on Ultra.
    let list;
    try { list = await TP.net.json(`${ULTRA}${BB}/courses/${encodeURIComponent(task.cid)}/contents/${encodeURIComponent(task.contentId)}/attachments`); } catch (e) { throw httpErr(e); }
    const atts = Array.isArray(list) ? list : (list && list.results) || [];
    const att = (task.fileName && atts.find((a) => a.fileName === task.fileName)) || atts[0];
    if (!att) return 'unsupported';
    const fileName = att.fileName || task.fileName || meta.title || '';
    const type = E.typeOf(fileName, att.mimeType || task.mime);
    if (!type) return 'unsupported';
    const full = { ...meta, attId: att.id, fileName, title: meta.title || fileName, type, modified: task.modified || '', url: dlUrl(task.cid, task.contentId, att.id) };
    const prev = await call('get', { key: key(task) }).catch(() => null);
    if (!E.changed(prev, { attId: att.id, modified: task.modified })) {
      if (prev && !prev.modified && task.modified) await call('touch', { key: key(task), patch: { modified: task.modified } }).catch(() => {});
      return prev && prev.skipped ? 'skipped' : 'same';
    }
    const got = await download(full.url, signal);
    if (got.skip) { await call('skip', { meta: { ...full, size: got.size || 0 }, reason: got.skip }); return 'skipped'; }
    await spend(got.bytes.byteLength);
    full.size = got.bytes.byteLength;
    const r = await call('put', { meta: full, bytes: got.bytes }, [got.bytes], 120e3);
    return r && r.skipped ? 'skipped' : 'indexed';
  }

  function httpErr(e) {
    const s = e && e.status;
    if (e && e.auth) return Object.assign(new Error('auth'), { auth: true });
    if (s === 429 || (s >= 500 && s < 600)) return Object.assign(new Error('http ' + s), { retry: true, status: s });
    return e;
  }

  /** Default credentials (Ultra → 302 → signed storage URL; storage rejects credentialed CORS). Streams with a 25 MB cap. */
  async function download(url, signal) {
    let r;
    try { r = await fetch(url, { signal, cache: 'no-store' }); } catch (e) { if (signal.aborted) throw e; throw Object.assign(new Error('network'), { retry: true }); }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('auth'), { auth: true });
    if (r.status === 429 || r.status >= 500) throw Object.assign(new Error('http ' + r.status), { retry: true, retryAfter: r.headers.get('retry-after') });
    if (!r.ok) return { skip: 'unreadable' };
    const max = E.LIMITS.maxFileBytes;
    const len = Number(r.headers.get('content-length')) || 0;
    if (len > max) { try { r.body && r.body.cancel(); } catch (_) { /* ignore */ } return { skip: 'large', size: len }; }
    const ctype = r.headers.get('content-type') || '';
    if (/text\/html/i.test(ctype) && !/\.html?$/i.test(new URL(r.url || url).pathname) && /\/(login|idp|saml|Shibboleth)/i.test(r.url || '')) throw Object.assign(new Error('auth'), { auth: true });
    if (!r.body || !r.body.getReader) {
      const buf = await r.arrayBuffer();
      return buf.byteLength > max ? { skip: 'large', size: buf.byteLength } : { bytes: buf };
    }
    const reader = r.body.getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { try { await reader.cancel(); } catch (_) { /* ignore */ } return { skip: 'large', size: total }; }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return { bytes: out.buffer };
  }

  /** A file Toledo+ already downloaded for the student (tapped blob) → index it without a second download. */
  async function ingest(task, meta) {
    const blob = task.blob;
    const fileName = meta.title || '';
    const type = E.typeOf(fileName, blob.type);
    if (!type) return 'unsupported';
    const full = { ...meta, attId: task.attId, fileName, title: meta.title || fileName, type, modified: '', url: dlUrl(task.cid, task.contentId, task.attId), size: blob.size };
    const prev = await call('get', { key: key(task) }).catch(() => null);
    if (prev && !E.changed(prev, { attId: task.attId, size: blob.size })) return prev.skipped ? 'skipped' : 'same';
    if (blob.size > E.LIMITS.maxFileBytes) { await call('skip', { meta: full, reason: 'large' }); return 'skipped'; }
    const bytes = await blob.arrayBuffer();
    const r = await call('put', { meta: full, bytes }, [bytes], 120e3);
    return r && r.skipped ? 'skipped' : 'indexed';
  }

  // ---------------------------------------------------------------- hooks: downloads and opens through Toledo+
  function tap(url, blob) {
    if (!enabled() || !blob) return;
    const m = DL_RE.exec(String(url || ''));
    if (!m) return;
    const [cid, contentId, attId] = [m[1], m[2], m[3]].map(decodeURIComponent);
    const meta = metaFor(cid, contentId);
    if (meta.title && !E.typeOf(meta.title, blob.type)) return;
    enqueue({ cid, contentId, attId, origin: 'blob', blob }, true);
  }
  function hook() {
    if (TP.net && typeof TP.net.blob === 'function' && !TP.net.blob.__tpFulltext) {
      const orig = TP.net.blob;
      const wrapped = async function (url, ...rest) {
        const b = await orig.call(this, url, ...rest);
        try { tap(TP.net.resolve ? TP.net.resolve(url) : url, b); } catch (_) { /* never break a download */ }
        return b;
      };
      wrapped.__tpFulltext = true;
      TP.net.blob = wrapped;
    }
    if (TP.data && typeof TP.data.ultraOpen === 'function' && !TP.data.ultraOpen.__tpFulltext) {
      const orig = TP.data.ultraOpen;
      const wrapped = function (cid, contentId, ...rest) {
        const r = orig.call(this, cid, contentId, ...rest);
        try { opened(cid, contentId); } catch (_) { /* ignore */ }
        return r;
      };
      wrapped.__tpFulltext = true;
      TP.data.ultraOpen = wrapped;
    }
  }
  /** "Open" streams the file into a new tab (we never see the bytes): queue one idle-time fetch, if it is a supported type. */
  function opened(cid, contentId) {
    if (!enabled() || !onUltra() || !cid || !contentId) return;
    const meta = metaFor(cid, contentId);
    if (meta.kind && meta.kind !== 'file') return;
    if (meta.title && !E.typeOf(meta.title, '')) return;
    enqueue({ cid, contentId, origin: 'open' }, true);
  }

  // ---------------------------------------------------------------- course run ("Doorzoek alle bestanden")
  function fileNodes(roots) {
    const out = [];
    (function walk(nodes, path) {
      for (const n of nodes || []) {
        if (!n || !n.id) continue;
        const h = n.contentHandler || {};
        if (Array.isArray(n.kids)) walk(n.kids, path.concat(String(n.title || '').trim()));
        if (h.id !== 'resource/x-bb-file') continue;
        const f = h.file || {};
        const fileName = f.fileName || n.title || '';
        if (!E.typeOf(fileName, f.mimeType)) continue;
        out.push({ contentId: n.id, title: String(n.title || fileName).trim(), fileName, mime: f.mimeType || '', modified: String(n.modified || ''), path: path.join(' › ') });
      }
    })(roots, []);
    return out;
  }

  /** Queue every supported file of a course. info: { cid, luId?, roots? }. → the run (or null off Ultra). */
  async function indexCourse(info = {}) {
    const cid = info.cid;
    if (!cid || !onUltra()) return null;
    let roots = info.roots;
    const run = { cid, total: 0, done: 0, indexed: 0, skipped: 0, failed: 0, state: 'running', pause: '', counting: true };
    runs.set(cid, run);
    ui.delete(cid);
    emit('progress', { ...run });
    if (!enabled()) await TP.settings.set({ search: { fullText: true } }); // (re-renders the view: the box already shows the run)
    try { if (!Array.isArray(roots)) roots = await TP.data.ultraTree(cid, { concurrency: 2 }); } catch (e) { run.state = 'error'; run.counting = false; emit('progress', { ...run }); return run; }
    const list = fileNodes(roots);
    const known = new Map(((await call('list', { cid }).catch(() => [])) || []).map((r) => [r.contentId, r]));
    run.total = list.length; run.counting = false;
    const luId = info.luId || metaFor(cid, '').luId || '';
    let c = null;
    try { c = luId ? TP.data.course(luId) : null; } catch (_) { c = null; }
    for (const f of list) {
      const prev = known.get(f.contentId);
      if (prev && prev.modified && !E.changed(prev, { modified: f.modified })) { run.done++; if (prev.skipped) run.skipped++; else run.indexed++; continue; }
      enqueue({ cid, contentId: f.contentId, origin: 'course', fileName: f.fileName, mime: f.mime, modified: f.modified,
        meta: { title: f.title, path: f.path, luId, course: (c && c.name) || '' } });
    }
    if (run.done >= run.total) { run.state = 'done'; announceDone(run); }
    emit('progress', { ...run });
    return run;
  }

  function cancelCourse(cid) {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].cid === cid && queue[i].origin === 'course') queue.splice(i, 1);
    if (current && current.task.cid === cid && current.task.origin === 'course') current.ctrl.abort();
    const r = runs.get(cid);
    if (r && (r.state === 'running' || r.state === 'paused')) { r.state = 'cancelled'; r.pause = ''; }
    emit('progress', r ? { ...r } : null);
  }

  // ---------------------------------------------------------------- course view box (rendered by src/views/course.js)
  function courseLineText(r) {
    if (!r) return '';
    if (r.counting) return t('fulltext.course.counting');
    if (r.state === 'error') return t('fulltext.course.error');
    if (r.state === 'cancelled') return t('fulltext.course.cancelled', { done: r.done, total: r.total });
    if (r.state === 'done') {
      if (!r.total) return t('fulltext.course.none');
      return [t('fulltext.course.done', { n: r.indexed }), r.skipped ? t('fulltext.skipped', { n: r.skipped }) : '', r.failed ? t('fulltext.course.failed', { n: r.failed }) : ''].filter(Boolean).join(' · ');
    }
    const base = t('fulltext.course.progress', { done: r.done, total: r.total });
    if (r.pause === 'budget') return `${base} · ${t('fulltext.pause.budget', { mb: Math.round(E.LIMITS.dayBytes / 1048576) })}`;
    if (r.pause) return `${base} · ${t('fulltext.pause.' + r.pause)}`;
    return base;
  }
  /** The course header's "Doorzoek alle bestanden" box (Ultra only; '' elsewhere). */
  function courseBox(cid) {
    if (!cid || !onUltra()) return '';
    const r = runs.get(cid);
    const busy = r && (r.state === 'running' || r.state === 'paused');
    let html;
    if (ui.get(cid) === 'confirm') {
      const n = ui.get(cid + ':n');
      html = `<p class="cv-ft-text">${esc(t('fulltext.course.confirm', { n: n == null ? '…' : n }))}</p>
        <span class="cv-ft-btns"><button type="button" class="tp-btn tp-btn-tinted" data-action="ft-go" data-fk="ft-go">${esc(t('fulltext.course.go'))}</button>
        <button type="button" class="tp-btn tp-btn-plain" data-action="ft-dismiss" data-fk="ft-dismiss">${esc(t('common.cancel'))}</button></span>`;
    } else if (busy) {
      html = `<span class="cv-ft-text" role="status">${r.pause ? '' : '<span class="cv-spin" aria-hidden="true"></span>'}<span data-ft-line>${esc(courseLineText(r))}</span></span>
        <button type="button" class="tp-btn tp-btn-plain" data-action="ft-cancel" data-fk="ft-cancel">${esc(t('fulltext.course.stop'))}</button>`;
    } else {
      const line = r ? `<span class="cv-ft-text" role="status" data-ft-line>${esc(courseLineText(r))}</span>` : '';
      html = `<button type="button" class="cv-btn" data-action="ft-run" data-fk="ft-run">${TP.ui.icon('search', { size: 16 })}<span>${esc(t(r && r.state === 'done' ? 'fulltext.course.again' : 'fulltext.course.run'))}</span></button>${line}`;
    }
    return `<div class="cv-ft" data-ft-box>${html}</div>`;
  }
  /** Replace the box in place (keeps focus on the equivalent control). */
  function updateCourseBox(root, cid) {
    const box = root && root.querySelector('[data-ft-box]');
    if (!box) return;
    const sr = root.getRootNode ? root.getRootNode() : document;
    const focused = sr.activeElement && box.contains(sr.activeElement) ? sr.activeElement.dataset.fk : null;
    const line = box.querySelector('[data-ft-line]');
    const r = runs.get(cid);
    // While running only the text changes: update it without replacing the controls.
    if (line && r && (r.state === 'running' || r.state === 'paused') && box.querySelector('[data-action="ft-cancel"]') && !!box.querySelector('.cv-spin') === !r.pause) {
      line.textContent = courseLineText(r);
      return;
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = courseBox(cid);
    const next = tmp.firstElementChild;
    if (!next) { box.remove(); return; }
    box.replaceWith(next);
    const want = focused === 'ft-go' || focused === 'ft-run' ? 'ft-cancel' : focused === 'ft-cancel' || focused === 'ft-dismiss' ? 'ft-run' : focused;
    const el = want && (next.querySelector(`[data-fk="${want}"]`) || next.querySelector('button'));
    if (el) el.focus({ preventScroll: true });
  }
  /** Click on a [data-action^="ft-"] control in the course view. info: { cid, luId, roots|null, root }. */
  function courseAction(act, info = {}) {
    const cid = info.cid;
    if (!cid) return;
    if (act === 'ft-run') {
      if (enabled()) { indexCourse(info); } else {
        ui.set(cid, 'confirm');
        ui.set(cid + ':n', Array.isArray(info.roots) ? fileNodes(info.roots).length : null);
      }
    } else if (act === 'ft-go') { indexCourse(info); } else if (act === 'ft-dismiss') { ui.delete(cid); } else if (act === 'ft-cancel') { cancelCourse(cid); }
    if (info.root) updateCourseBox(info.root, cid);
  }

  // ---------------------------------------------------------------- wipe / settings
  async function wipe() {
    queue.length = 0;
    if (current) current.ctrl.abort();
    for (const r of runs.values()) if (r.state === 'running' || r.state === 'paused') r.state = 'cancelled';
    try { stat = await call('wipe', {}, [], 30e3); } catch (_) { stat = { files: 0, skipped: 0, bytes: 0, chars: 0 }; }
    emit('change', status());
    emit('progress', null);
    return status();
  }

  try {
    TP.settings && TP.settings.subscribe && TP.settings.subscribe((s, keys = []) => {
      if (!keys.includes('search')) return;
      if (!enabled()) { queue.length = 0; if (current) current.ctrl.abort(); for (const r of runs.values()) if (r.state === 'running' || r.state === 'paused') r.state = 'cancelled'; emit('progress', null); }
      emit('change', status());
    });
  } catch (_) { /* tests */ }
  hook();

  TP.fulltext = {
    enabled, status, statusText, settingsText, warm, search, where, snippetHtml, open, wipe, on,
    indexCourse, cancelCourse, courseBox, updateCourseBox, courseAction, canFetch: onUltra,
    _test: { cfg, queue, runs, fileNodes, tap, metaFor, call, reset() { queue.length = 0; runs.clear(); ui.clear(); stat = null; } },
  };
})();
