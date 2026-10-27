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
    writeTimer = setTimeout(() => {
      if (TP.data && TP.data.isStale && TP.data.isStale()) return;
      idx = cap(idx); sset({ index: idx, indexMeta: meta });
    }, 300);
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
    if (TP.data.isStale && TP.data.isStale()) return Promise.resolve(status()); // extension reloaded: stop quietly
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
          if (!enabled() || (TP.data.isStale && TP.data.isStale())) return;
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
  // One matcher for every search surface (⌘K, the toolbar filter of each view, course search): case- and
  // accent-insensitive, every query word must occur (any order), punctuation separates words, a course code
  // matches with or without its space ("zx1003" ~ "ZX 1003"), one-letter words only match at a word start,
  // a query that reads as a date ("morgen", "28 okt", "vr 30/10") matches items on that day, and — only when
  // nothing matches exactly — words of 5+ letters tolerate one typo. Haystacks come from hay() / hayOf.*.
  const COMBINING = /[̀-ͯ]/g;
  const ALNUM = /[\p{L}\p{N}]/u;
  const SPLIT = /[^\p{L}\p{N}]+/u;
  const SPLIT_G = /[^\p{L}\p{N}]+/gu;
  const DATE_SEP = ' ‖ ';   // "‖": separates a haystack's text from its day markers (never part of a query word)
  const FUZZY_MIN = 5;

  /** Lowercase, no diacritics (fast path for plain ASCII). */
  function fold(s) {
    s = String(s == null ? '' : s).toLowerCase();
    return /[^\x00-\x7f]/.test(s) ? s.normalize('NFKD').replace(COMBINING, '') : s;
  }
  /** Lowercase, no diacritics, single spaces. */
  function norm(s) { return fold(s).replace(/\s+/g, ' ').trim(); }
  /** Query words: normalised, split on anything that is not a letter or digit ("[" or "-" alone → no words). */
  const words = (q) => norm(q).split(SPLIT).filter(Boolean);
  const isDigit = (c) => c >= '0' && c <= '9';
  /** i starts a word in s: string start, after a non-letter/digit, or at a letter↔digit change ("les1" → "1"). */
  function startsWord(s, i) {
    if (i <= 0) return true;
    const p = s[i - 1];
    return !ALNUM.test(p) || isDigit(p) !== isDigit(s[i]);
  }

  // ---- dates: "vandaag", "morgen", "28 okt", "okt 28", "vr 30 okt", "30/10", "vrijdag" (the next one; ≥ 3 letters)
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
  const REL = {
    nl: { vandaag: 0, morgen: 1, overmorgen: 2, gisteren: -1, eergisteren: -2 },
    en: { today: 0, tomorrow: 1, yesterday: -1 },
    fr: { aujourd: 0, demain: 1, hier: -1 },
  };
  let names = null;   // { months: [[name, 0..11]…], days: { nl|en|fr: [[name, 0..6]…] } }, folded
  function calNames() {
    if (names) return names;
    names = { months: [], days: { nl: [], en: [], fr: [] } };
    for (const [l, loc] of [['nl', 'nl-BE'], ['en', 'en-GB'], ['fr', 'fr-BE']]) {
      try {
        const mf = new Intl.DateTimeFormat(loc, { month: 'long' });
        for (let m = 0; m < 12; m++) names.months.push([fold(mf.format(new Date(2026, m, 15))), m]);
        const wf = new Intl.DateTimeFormat(loc, { weekday: 'long' });
        for (let i = 0; i < 7; i++) { const d = new Date(2026, 0, 4 + i); names.days[l].push([fold(wf.format(d)), d.getDay()]); }
      } catch (_) { /* no Intl: dates stay plain text */ }
    }
    return names;
  }
  const uiLang = () => { try { return TP.i18n.lang(); } catch (_) { return 'nl'; } };
  /** A word that starts exactly one month name (≥ 3 letters: "okt", "oct", "mei") → 0..11, else -1. */
  function monthOf(w) {
    if (w.length < 3 || !/^\p{L}+$/u.test(w)) return -1;
    const hit = new Set(calNames().months.filter(([n]) => n.startsWith(w)).map(([, m]) => m));
    return hit.size === 1 ? [...hit][0] : -1;
  }
  /** A word that starts one weekday name (UI language first, then the others) → 0 (Sunday)..6, else -1. */
  function weekdayOf(w, min) {
    if (w.length < min || !/^\p{L}+$/u.test(w)) return -1;
    for (const l of [uiLang(), 'nl', 'en', 'fr']) {
      const hit = new Set((calNames().days[l] || []).filter(([n]) => n.startsWith(w)).map(([, d]) => d));
      if (hit.size === 1) return [...hit][0];
    }
    return -1;
  }
  function validDay(y, m, d) { const x = new Date(y, m, d, 12); return x.getMonth() === m && x.getDate() === d ? x : null; }
  /** The year that puts day/month closest to today (no year in the query). */
  function nearest(m, d, now) {
    const y = new Date(now).getFullYear();
    let best = null;
    for (const yy of [y - 1, y, y + 1]) {
      const x = validDay(yy, m, d);
      if (x && (!best || Math.abs(x - now) < Math.abs(best - now))) best = x;
    }
    return best;
  }
  /** Query words → { keys: [dayKey], rest: [the words that are not part of the date] } or null. */
  function parseDate(ws, now = Date.now()) {
    if (!ws.length) return null;
    const used = new Set();
    const today = new Date(now);
    const shift = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 12);
    let day = null;
    const rel = Object.assign({}, REL.en, REL[uiLang()] || {});
    for (let i = 0; i < ws.length && !day; i++) {
      const w = ws[i];
      if (w === 'apres' && ws[i + 1] === 'demain') { day = shift(2); used.add(i).add(i + 1); break; }
      if (Object.prototype.hasOwnProperty.call(rel, w)) {
        day = shift(rel[w]); used.add(i);
        if (w === 'aujourd' && ws[i + 1] === 'hui') used.add(i + 1);
      }
    }
    // "30/10", "30-10-2026", "30.10": day first, as everywhere in Belgium
    for (let i = 0; !day && i + 1 < ws.length; i++) {
      if (!/^\d{1,2}$/.test(ws[i]) || !/^\d{1,2}$/.test(ws[i + 1])) continue;
      const d = +ws[i], m = +ws[i + 1] - 1;
      const yw = ws[i + 2] && /^(\d{2}|\d{4})$/.test(ws[i + 2]) ? ws[i + 2] : null;
      const x = m >= 0 && m < 12 ? (yw ? validDay(yw.length === 2 ? 2000 + +yw : +yw, m, d) : nearest(m, d, now)) : null;
      if (x) { day = x; used.add(i).add(i + 1); if (yw) used.add(i + 2); }
    }
    if (!day) {
      const mi = ws.findIndex((w) => monthOf(w) >= 0);
      if (mi >= 0) {
        const m = monthOf(ws[mi]);
        for (const di of [mi - 1, mi + 1]) {
          if (di < 0 || di >= ws.length || !/^\d{1,2}$/.test(ws[di])) continue;
          const yi = [mi + 1, di + 1].find((i) => i !== di && i < ws.length && /^\d{4}$/.test(ws[i]));
          const x = yi != null ? validDay(+ws[yi], m, +ws[di]) : nearest(m, +ws[di], now);
          if (x) { day = x; used.add(mi).add(di); if (yi != null) used.add(yi); break; }
        }
      }
      if (day) ws.forEach((w, i) => { if (!used.has(i) && weekdayOf(w, 2) >= 0) used.add(i); }); // "vr 30 okt": the weekday adds nothing
    }
    for (let i = 0; !day && i < ws.length; i++) {
      const wd = weekdayOf(ws[i], 3);
      if (wd >= 0) { day = shift((wd - today.getDay() + 7) % 7); used.add(i); }
    }
    if (!day) return null;
    return { keys: [dayKey(day.getTime())], rest: ws.filter((_, i) => !used.has(i)) };
  }

  /** Parse a query once: { words, date } (also accepts a word array or an already parsed query). */
  function query(q) {
    if (q && typeof q === 'object' && !Array.isArray(q) && Array.isArray(q.words)) return q;
    const ws = Array.isArray(q) ? q.flatMap((w) => words(w)) : words(q);
    return { words: ws, date: parseDate(ws) };
  }

  /** Optimal-string-alignment distance ≤ 1 between a and b (an adjacent swap counts as one). */
  function near1(a, b) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (i === la && i === lb) return true;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  /** w is one typo away from a word or from the start of a word ("programeren" ~ "programmeren", "statistik" ~ "statistiek"). */
  function fuzzyIn(text, w) {
    if (w.length < FUZZY_MIN) return false;
    for (const tok of text.split(SPLIT)) {
      if (tok.length < w.length - 1) continue;
      for (let L = w.length - 1; L <= w.length + 1 && L <= tok.length; L++) if (near1(w, tok.slice(0, L))) return true;
    }
    return false;
  }

  /** Does one query word occur in a (folded) text? */
  function hasWord(text, w, fuzzy) {
    if (w.length === 1) { for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) if (startsWord(text, i)) return true; return false; }
    if (text.includes(w)) return true;
    if (/\d/.test(w) && text.replace(SPLIT_G, '').includes(w)) return true;   // course codes with or without a space
    return !!fuzzy && fuzzyIn(text, w);
  }

  /** A parsed query against a haystack (hay() output, or any string). */
  function test(Q, h, fuzzy) {
    if (!Q.words.length) return true;
    h = fold(h);
    const cut = h.indexOf(DATE_SEP);
    const text = cut >= 0 ? h.slice(0, cut) : h;
    if (Q.words.every((w) => hasWord(text, w, fuzzy))) return true;
    if (!Q.date || cut < 0) return false;
    const marks = h.slice(cut);
    return Q.date.keys.some((k) => marks.includes('d' + k)) && Q.date.rest.every((w) => hasWord(text, w, fuzzy));
  }

  /**
   * A predicate for one query: m(hay) → bool, with m.empty (no words: everything matches), m.words, m.query, m.fuzzy.
   * Given `hays` (every candidate haystack): when none matches exactly, the typo-tolerant version is returned (m.fuzzy).
   */
  function matcher(q, hays) {
    const Q = query(q);
    let fuzzy = false;
    if (Q.words.length && Array.isArray(hays) && Q.words.some((w) => w.length >= FUZZY_MIN) && !hays.some((h) => test(Q, h, false))) fuzzy = true;
    const m = Q.words.length ? (h) => test(Q, h, fuzzy) : () => true;
    return Object.assign(m, { empty: !Q.words.length, words: Q.words, query: Q, fuzzy });
  }

  /** Haystack: the texts (normalised) plus day markers for `dates` (ms), so date queries find them. */
  function hay(parts, dates) {
    const text = norm((parts || []).filter((x) => x != null && x !== '').join(' '));
    const ds = (dates || []).filter((d) => d && isFinite(d)).map((d) => 'd' + dayKey(d));
    return ds.length ? text + DATE_SEP + ds.join(' ') : text;
  }
  const codeOf = (luId) => { try { const c = luId && TP.data.course ? TP.data.course(luId) : null; return (c && c.code) || ''; } catch (_) { return ''; } };
  /** The same fields for the same kind of item on every surface: title, course, code, teacher/sender, date. */
  const hayOf = {
    course: (c) => hay([c.name, c.title, c.code, ...(c.teachers || [])]),
    deadline: (d) => hay([d.title, d.courseName, d.courseCode || codeOf(d.courseLuId)], [d.due]),
    announcement: (e) => {
      const school = e.subType === 'advalvas' || e.type === 'advalvas';
      const src = school ? TP.t('announcements.school') : TP.util.courseName(e.source || '');
      return hay([e.title, src, school ? 'Ad Valvas' : codeOf(e.sourceId), e.author], [e.date]);
    },
    lesson: (l, extra = []) => hay([l.title, l.courseName, l.courseCode || codeOf(l.courseLuId), ...(l.teachers || []), ...extra], [l.start]),
  };

  /**
   * Score a candidate: every query word must occur in title or in one of `extra` strings (or the query is a date
   * found in them, see hay()); → -1 if not.
   * Rank: 3 title starts with the query · 2 every word starts a word in the title · 1 title contains every word ·
   * 0 match via path/course/date. opts.fuzzy: allow one typo per word of 5+ letters (always rank 0).
   */
  function score(q, title, extra, opts = {}) {
    const Q = query(q);
    const ws = Q.words;
    if (!ws.length) return -1;
    const nt = norm(title);
    const h = nt + ' ' + (extra || []).map(fold).join(' ');
    if (!test(Q, h, false)) return opts.fuzzy && test(Q, h, true) ? 0 : -1;
    if (nt.startsWith(ws.join(' '))) return 3;
    const atStart = (w) => { for (let i = nt.indexOf(w); i >= 0; i = nt.indexOf(w, i + 1)) if (startsWord(nt, i)) return true; return false; };
    if (ws.every(atStart)) return 2;
    if (ws.every((w) => hasWord(nt, w))) return 1;
    return 0;
  }

  /** → [{cid, luId, course, color, id, title, kind, path, parentId, score}] best first (hidden courses skipped).
   *  A document must match at least one query word in its own title or folder path: a query that only names a
   *  course does not list every file of that course (the course itself is in "Vakken").
   *  opts: { limit = 50, fuzzy, total: {} → total.n = number of hits before the limit }. */
  function search(q, opts = {}) {
    const Q = query(q);
    const ws = Q.words;
    if (!ws.length) return [];
    const limit = opts.limit || 50;
    const out = [];
    for (const [cid, e] of Object.entries(idx)) {
      if (!e || !Array.isArray(e.items)) continue;
      const c = courseFor(e.luId);
      if (c && c.hidden) continue;
      const course = (c && c.name) || e.name || '';
      for (const it of e.items) {
        const s = score(Q, it[1], [it[3], course], opts);
        if (s < 0) continue;
        if (s === 0 && !ws.some((w) => hasWord(fold(it[1] + ' ' + it[3]), w, opts.fuzzy))) continue;
        out.push({ cid, luId: e.luId, course, color: c ? c.color : null, id: it[0], title: it[1], kind: it[2], path: it[3], parentId: it[4], score: s });
      }
    }
    if (opts.total) opts.total.n = out.length;
    return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit);
  }

  // ---------------------------------------------------------------- highlighting
  /** Remove the marks highlight() added under root. */
  function unmark(root) {
    if (!root || !root.querySelectorAll) return;
    for (const mk of root.querySelectorAll('mark.tp-hl')) {
      const p = mk.parentNode;
      mk.replaceWith(mk.ownerDocument.createTextNode(mk.textContent));
      if (p && p.normalize) p.normalize();
    }
  }
  /** [start, end) ranges in `s` (original text) where a query word occurs, accent- and case-insensitive. */
  function ranges(s, ws) {
    let f = '';
    const map = [];
    for (let i = 0; i < s.length; i++) { const x = fold(s[i]); for (let k = 0; k < x.length; k++) { f += x[k]; map.push(i); } }
    const out = [];
    for (const w of ws) {
      for (let i = f.indexOf(w); i >= 0; i = f.indexOf(w, i + 1)) {
        if (w.length === 1 && !startsWord(f, i)) continue;
        out.push([map[i], map[i + w.length - 1] + 1]);
      }
    }
    out.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of out) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); }
    return merged;
  }
  /** Wrap the query words in <mark class="tp-hl"> in the text of the elements under root that match `sel` and are
   *  not hidden: the reason a row matched. Clears earlier marks under root first. `q`: a string or a matcher()
   *  (nothing is marked for a typo-tolerant match). → number of marks. */
  function highlight(root, q, sel) {
    if (!root || !root.querySelectorAll) return 0;
    unmark(root);
    const ws = q && typeof q === 'function' ? (q.fuzzy ? [] : q.words) : words(q);
    if (!ws || !ws.length) return 0;
    const doc = root.ownerDocument;
    let n = 0;
    for (const el of root.querySelectorAll(sel)) {
      if (el.closest('[hidden]')) continue;
      const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      const nodes = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue.trim() && !(node.parentElement && node.parentElement.closest('svg, kbd, mark, script, style'))) nodes.push(node);
      }
      for (const node of nodes) {
        const s = node.nodeValue;
        const rs = ranges(s, ws);
        if (!rs.length) continue;
        const frag = doc.createDocumentFragment();
        let at = 0;
        for (const [a, b] of rs) {
          if (a > at) frag.appendChild(doc.createTextNode(s.slice(at, a)));
          const mk = doc.createElement('mark');
          mk.className = 'tp-hl';
          mk.textContent = s.slice(a, b);
          frag.appendChild(mk);
          at = b; n++;
        }
        if (at < s.length) frag.appendChild(doc.createTextNode(s.slice(at)));
        node.replaceWith(frag);
      }
    }
    return n;
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
    fold, words, query, matcher, hay, hayOf, highlight, unmark,
    get(cid) { return idx[cid] || null; },
    _test: { flatten, cap, parseDate, near1, dayKey, ranges, _set(o) { idx = o; }, _reset() { idx = {}; meta = { lastCrawl: 0, attempt: 0, failed: 0 }; } },
  };
})();
