/* Toledo+ — TP.index: a compact, local search index of the content trees of all current courses,
   used by the ⌘K palette. Stored in chrome.storage.local:
     'index'     = { [cid]: { luId, name, t, items: [[id, title, kind, path, parentId], …] } }
     'indexMeta' = { lastCrawl, attempt, failed }
   Sources: (a) every finished TP.data.ultraCourse (course view) via the TP.data 'course' event;
            (b) a background crawl of the current courses (≤ once per 24 h per course, concurrency 2).
   On the portal the crawl goes through the best-effort relay and may fail: it fails silently.
   Nothing leaves the browser. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const DAY = 864e5;
  const RETRY_MS = 36e5;          // after a crawl where nothing could be fetched, wait 1 h
  const LOCK_MS = 2 * 60e3;       // another tab started a crawl less than this ago → skip
  const MAX_CHARS = 2e6;          // ~2 MB cap for the stored index; oldest courses are dropped first
  const SEP = ' › ';

  let idx = {};                   // cid → entry
  let meta = { lastCrawl: 0, attempt: 0, failed: 0 };
  let loaded = null;
  let crawling = null;            // Promise while a crawl runs
  let progress = { done: 0, total: 0 };
  const subs = new Set();

  const S = () => (TP.settings && TP.settings.get ? TP.settings.get() : {}) || {};
  const onUltra = () => { try { return /(^|\.)ultra\.edu\.kuleuven\.cloud$/.test(location.hostname); } catch (_) { return false; } };
  const enabled = () => ((S().search || {}).indexAll) !== false;
  const log = (...a) => { try { console.debug('[Toledo+ index]', ...a); } catch (_) { /* noop */ } };

  function emit() { for (const fn of [...subs]) { try { fn(status()); } catch (e) { log('listener', e); } } }
  function on(evt, fn) { if (evt === 'change') subs.add(fn); return () => subs.delete(fn); }

  // ---------------------------------------------------------------- storage
  const sget = (k) => new Promise((res) => {
    try { chrome.storage.local.get(k, (o) => { void chrome.runtime?.lastError; res((o && o[k]) || null); }); } catch (_) { res(null); }
  });
  const sset = (obj) => new Promise((res) => {
    try { chrome.storage.local.set(obj, () => { void chrome.runtime?.lastError; res(); }); } catch (_) { res(); }
  });

  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const [i, m] = await Promise.all([sget('index'), sget('indexMeta')]);
      if (i && typeof i === 'object') idx = i;
      if (m && typeof m === 'object') meta = Object.assign(meta, m);
      try {
        chrome.storage.onChanged.addListener((ch, area) => {
          if (area !== 'local') return;
          if (ch.index) idx = ch.index.newValue || {};
          if (ch.indexMeta) meta = Object.assign({ lastCrawl: 0, attempt: 0, failed: 0 }, ch.indexMeta.newValue || {});
          if (ch.index || ch.indexMeta) emit();
        });
      } catch (_) { /* tests */ }
      emit();
    })();
    return loaded;
  }

  /** Drop the oldest courses until the serialized index fits MAX_CHARS. */
  function cap(o) {
    let size = 0;
    try { size = JSON.stringify(o).length; } catch (_) { return o; }
    if (size <= MAX_CHARS) return o;
    const out = { ...o };
    const order = Object.keys(out).sort((a, b) => (out[a].t || 0) - (out[b].t || 0));
    for (const cid of order) {
      if (size <= MAX_CHARS) break;
      try { size -= JSON.stringify(out[cid]).length; } catch (_) { /* ignore */ }
      delete out[cid];
    }
    return out;
  }

  let writeTimer = 0;
  function persist() {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => { idx = cap(idx); sset({ index: idx, indexMeta: meta }); }, 300);
  }

  // ---------------------------------------------------------------- building
  const isFolder = (n) => !!n && (n.hasChildren || Array.isArray(n.kids) || /x-bb-(folder|lesson|module)/.test((n.contentHandler && n.contentHandler.id) || ''));
  const kindOf = (n) => { try { return TP.data.kindOf(n) || 'page'; } catch (_) { return 'page'; } };

  /** Tree (Node[] with .kids) → compact rows [id, title, kind, path, parentId] in document order. */
  function flatten(roots) {
    const out = [];
    (function walk(nodes, path, parent) {
      for (const n of nodes || []) {
        if (!n || !n.id) continue;
        const title = String(n.title || '').trim();
        out.push([n.id, title, isFolder(n) ? 'folder' : kindOf(n), path.join(SEP), parent || '']);
        if (n.kids) walk(n.kids, path.concat(title), n.id);
      }
    })(roots, [], '');
    return out;
  }

  /** Store the tree of one course. */
  function put(cid, { luId, name, roots }) {
    if (!cid) return;
    idx = { ...idx, [cid]: { luId: luId || (idx[cid] && idx[cid].luId) || '', name: name || (idx[cid] && idx[cid].name) || '', t: Date.now(), items: flatten(roots) } };
    persist();
    emit();
  }

  function courseFor(luId) { try { return luId ? TP.data.course(luId) : null; } catch (_) { return null; } }

  // (a) the course view finished loading a course: index it (also when the crawl is switched off).
  function onCourse({ cid, result } = {}) {
    if (!cid || !result || !Array.isArray(result.roots)) return;
    const luId = (result.course && result.course.courseId) || '';
    const c = courseFor(luId);
    put(cid, { luId, name: (c && c.name) || TP.util.courseName((result.course && result.course.name) || ''), roots: result.roots });
  }

  // ---------------------------------------------------------------- crawl
  const entryFor = (luId) => Object.entries(idx).find(([, e]) => e && e.luId === luId);

  /** (b) Walk the trees of the current courses. Never rejects. opts.force ignores the 24 h freshness. */
  function crawl(opts = {}) {
    if (crawling) return crawling;
    if (!enabled() || !TP.data || !TP.data.ultraTree) return Promise.resolve(status());
    crawling = (async () => {
      await load();
      const now = Date.now();
      if (!opts.force && meta.attempt && now - meta.attempt < LOCK_MS) return status();
      // Behind the relay (portal) a failed crawl usually means "no Ultra session yet": back off for an hour.
      if (!opts.force && !onUltra() && meta.failed && meta.attempt && now - meta.attempt < RETRY_MS) return status();
      let list = [];
      try { list = TP.data.courses({ currentOnly: true }) || []; } catch (_) { list = []; }
      const todo = list.filter((c) => {
        const e = entryFor(c.luId);
        return opts.force || !e || now - (e[1].t || 0) > DAY;
      });
      if (!todo.length) return status();
      meta = { ...meta, attempt: now };
      progress = { done: 0, total: todo.length };
      sset({ indexMeta: meta });
      emit();
      let failed = 0;
      await TP.util.pool(todo, 2, async (c) => {
        try {
          if (!enabled()) return;
          const cid = await TP.data.resolveCourseId(c.luId);
          const roots = await TP.data.ultraTree(cid, { concurrency: 2 });
          put(cid, { luId: c.luId, name: c.name, roots });
        } catch (e) {
          failed++;
          log('crawl failed for a course', e && e.status);
        } finally {
          progress = { done: progress.done + 1, total: progress.total };
          emit();
        }
      });
      meta = { ...meta, lastCrawl: Date.now(), failed };
      persist();
      return status();
    })().catch((e) => { log('crawl', e); return status(); })
      .finally(() => { crawling = null; progress = { done: 0, total: 0 }; emit(); });
    emit();
    return crawling;
  }

  /** Crawl the courses that are missing or older than 24 h (used at boot and when the palette opens). */
  function crawlIfStale() { return load().then(() => crawl()); }

  /** Start a crawl 5 s after boot, when the browser is idle. */
  function schedule() {
    setTimeout(() => {
      const go = () => { crawlIfStale().catch(() => {}); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 10e3 }); else go();
    }, 5000);
  }

  async function rebuild() {
    await load();
    idx = {};
    meta = { lastCrawl: 0, attempt: 0, failed: 0 };
    await sset({ index: {}, indexMeta: meta });
    emit();
    return crawl({ force: true });
  }

  function status() {
    const entries = Object.values(idx).filter(Boolean);
    return {
      courses: entries.length,
      items: entries.reduce((a, e) => a + ((e.items && e.items.length) || 0), 0),
      lastCrawl: meta.lastCrawl || 0,
      updated: Math.max(meta.lastCrawl || 0, ...entries.map((e) => e.t || 0)),
      crawling: !!crawling,
      progress: { ...progress },
      failed: meta.failed || 0,
      enabled: enabled(),
    };
  }

  /** One status line, e.g. "Doorzoekt 214 documenten in 15 vakken · bijgewerkt 17:40". */
  function statusText() {
    const s = status();
    const t = (k, v) => TP.t(k, v);
    if (s.items) {
      let txt = `${t('palette.status.docs', { n: s.items })} ${t('palette.status.courses', { n: s.courses })}`;
      if (s.crawling) txt += ` · ${t('palette.status.updating')}`;
      else if (s.updated && TP.fmt && TP.fmt.ago) txt += ` · ${t('palette.status.updated', { time: TP.fmt.ago(s.updated) })}`;
      return txt;
    }
    if (s.crawling) return t('palette.status.building');
    return t('palette.status.openCourse');
  }

  // ---------------------------------------------------------------- matching
  /** Lowercase, no diacritics, single spaces. */
  function norm(s) {
    return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  const words = (q) => norm(q).split(' ').filter(Boolean);
  const WORD_START = /[\s\-_./\\()[\]›:,'"’]/;

  /**
   * Score a candidate: every query word must occur in title or in one of `extra` strings; → -1 if not.
   * Rank: 3 title starts with the query · 2 every word starts a word in the title · 1 title contains every word · 0 match via path/course.
   */
  function score(q, title, extra) {
    const ws = Array.isArray(q) ? q : words(q);
    if (!ws.length) return -1;
    const nt = norm(title);
    const hay = nt + ' ' + (extra || []).map(norm).join(' ');
    for (const w of ws) if (!hay.includes(w)) return -1;
    const full = ws.join(' ');
    if (nt.startsWith(full)) return 3;
    const atStart = (w) => { let i = nt.indexOf(w); while (i >= 0) { if (i === 0 || WORD_START.test(nt[i - 1])) return true; i = nt.indexOf(w, i + 1); } return false; };
    if (ws.every(atStart)) return 2;
    if (ws.every((w) => nt.includes(w))) return 1;
    return 0;
  }

  /** → [{cid, luId, course, color, id, title, kind, path, parentId, score}] best first (hidden courses skipped). */
  function search(q, opts = {}) {
    const ws = words(q);
    if (!ws.length) return [];
    const limit = opts.limit || 50;
    const out = [];
    for (const [cid, e] of Object.entries(idx)) {
      if (!e || !Array.isArray(e.items)) continue;
      const c = courseFor(e.luId);
      if (c && c.hidden) continue;
      const course = (c && c.name) || e.name || '';
      for (const it of e.items) {
        const s = score(ws, it[1], [it[3], course]);
        if (s < 0) continue;
        out.push({ cid, luId: e.luId, course, color: c ? c.color : null, id: it[0], title: it[1], kind: it[2], path: it[3], parentId: it[4], score: s });
      }
    }
    return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit);
  }

  /** Ancestor folder ids of an item (root first), from the index. */
  function ancestors(cid, id) {
    const e = idx[cid];
    if (!e || !Array.isArray(e.items)) return [];
    const parent = new Map(e.items.map((it) => [it[0], it[4]]));
    const out = [];
    for (let p = parent.get(id); p && out.length < 12; p = parent.get(p)) out.unshift(p);
    return out;
  }

  // ---------------------------------------------------------------- wiring
  try { TP.data && TP.data.on && TP.data.on('course', (r) => { load().then(() => onCourse(r)); }); } catch (_) { /* no data layer */ }
  try {
    TP.settings && TP.settings.subscribe && TP.settings.subscribe((s, keys = []) => {
      if (keys.includes('search')) { emit(); if (enabled()) crawlIfStale().catch(() => {}); }
    });
  } catch (_) { /* tests */ }

  TP.index = {
    load, put, crawl, crawlIfStale, schedule, rebuild, status, statusText, search, score, norm, ancestors, on, enabled,
    get(cid) { return idx[cid] || null; },
    _test: { flatten, cap, _set(o) { idx = o; }, _reset() { idx = {}; meta = { lastCrawl: 0, attempt: 0, failed: 0 }; } },
  };
})();
