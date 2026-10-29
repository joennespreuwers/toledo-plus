/* Toledo+ — TP.data: loading, cache, models and mutations.
   Stale-while-revalidate: everything renders from the cache (chrome.storage.local 'cache:<key>' = {v, t, rev})
   and is refreshed in the background. Models are pure functions of cache + settings + state.
   Depends on TP.util / TP.fmt (loaded first), TP.settings / TP.state and TP.net. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const PORTAL = 'https://toledo.kuleuven.be';
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const DAY = 864e5;
  const HOUR = 36e5;
  const KEYS = ['enrollments', 'events', 'upcoming', 'mail', 'links', 'ultraDeadlines'];
  const PORTAL_KEYS = ['enrollments', 'events', 'upcoming', 'mail', 'links'];
  const ULTRA_KEYS = ['ultraDeadlines']; // an Ultra 401 means no Ultra session yet, not an expired Toledo session
  const CP = 'cache:';             // one chrome.storage.local item per data key
  const MAX_EVENTS = 600;          // newest events kept in the persisted cache
  const MAX_CACHE_CHARS = 4e6;     // chrome.storage.local quota is 10 MB; stay well below
  const FRESH_MS = 30e3;           // load() without force reuses data younger than this
  const STALE_MS = 5 * 60e3;       // maybeRefresh(): refresh when the data is older than this
  const GRAPHITE = '#8E8E93';
  // Deadlines (B2/B13) — time horizons: ONE policy (TP-015, TP-195, TP-196, TP-209), exported as TP.data.HORIZON and
  // explained to the student in Settings › Deadlines. Nothing the student can act on silently falls out of every view:
  //  - overdue + not done: always listed, however old (Ultra items are kept 365 days after they leave the fetch window);
  //  - done: stays listed (Deadlines › Klaar, Agenda) for donePastDays after the due date, so a "Klaar" can be undone;
  //  - the Ultra calendar is read calPastDays back on a routine refresh, and calDeepPastDays back on the first fetch
  //    and once a day, so unfinished work from weeks ago (first run, back from a holiday) is found too;
  //  - own deadlines are never cut off by a horizon of viewDays or more (the Deadlines page): a date years ahead still shows;
  //  - Ultra calendar items that are not gradebook columns (course events, personal entries) are not deadlines: they are
  //    kept apart (TP.data.calendarItems) instead of being dropped on the floor.
  const HORIZON = Object.freeze({
    donePastDays: 120, overdueKeepDays: 365, calPastDays: 14, calDeepPastDays: 120, calDeepEveryMs: DAY, viewDays: 366,
  });
  const PAST_DAYS = HORIZON.donePastDays;
  const CAL_PAST_DAYS = HORIZON.calPastDays;
  const CAL_WINDOW = 60 * DAY;     // Blackboard calendar API: keep windows ≤ 60 days
  const CAL_MAX_WINDOWS = 9;       // ≤ 9 windows → 120 days back + 366 days ahead
  const VIEW_DAYS = HORIZON.viewDays; // what the Deadlines view asks for
  const DEDUPE_MS = 2 * HOUR;      // same title + course within ±2 h = one deadline
  const KEEP_OVERDUE_DAYS = HORIZON.overdueKeepDays;
  // State bounds
  const MAX_SEEN = 2000, MAX_READ = 3000, READ_DAYS = 120, DONE_DAYS = 60, VISIT_DAYS = 120, MAX_PENDING = 1000;
  const PATCH_CHUNK = 100;
  // Ultra course cache (B5)
  const COURSE_TTL = 10 * 60e3, COURSE_MAX = 5;
  const cfg = { folderRetryMs: [1000, 3000] }; // backoff between retry rounds for failed folders (tests shrink it)

  // ---------------------------------------------------------------- small helpers
  const S = () => (TP.settings && TP.settings.get ? TP.settings.get() : {}) || {};
  const ST = () => (TP.state && TP.state.get ? TP.state.get() : {}) || {};
  const U = () => TP.util;
  const log = (...a) => { try { console.debug('[Toledo+]', ...a); } catch (_) { /* noop */ } };
  const courseName = (s) => U().courseName(s);
  const courseCode = (s) => U().courseCode(s);
  const colorForIndex = (n) => U().colorForIndex(n);
  const dayKey = (ms) => TP.fmt.dayKey(ms);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const toMs = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const arr = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.results) ? v.results : []));
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const net = () => {
    if (!TP.net) throw Object.assign(new Error('TP.net missing'), { status: 0 });
    return TP.net;
  };
  const setState = (patch, opts) => {
    if (stale || !TP.state || !TP.state.set) return Promise.resolve();
    return Promise.resolve(TP.state.set(patch, opts)).catch((e) => log('state write failed', e));
  };

  /** FNV-1a 32-bit → base36. Stable across sessions/browsers (used for deadline keys and ICS UIDs). */
  function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  /** Normalize a title for dedupe: lowercase, no accents, alphanumerics separated by single spaces. */
  function normTitle(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** "ULTRA-B-X10265-2627: Filmtaal 1 [X10265]" → {luId:'ULTRA-B-X10265-2627', title:'Filmtaal 1 [X10265]'} */
  function parseCalendarName(name) {
    const s = String(name || '');
    const i = s.indexOf(':');
    if (i < 0) return { luId: '', title: s.trim() };
    return { luId: s.slice(0, i).trim(), title: s.slice(i + 1).trim() };
  }

  // ---------------------------------------------------------------- events
  const listeners = {};
  function on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => off(evt, fn); }
  function off(evt, fn) { listeners[evt] && listeners[evt].delete(fn); }
  function emit(evt, arg) {
    for (const fn of [...(listeners[evt] || [])]) {
      try { fn(arg); } catch (e) { log('listener error', e); }
    }
  }

  // ---------------------------------------------------------------- extension context (F4)
  let stale = false;
  const cleanups = [];
  /** The extension was updated/reloaded: stop timers and writes, tell the shell once ('stale'). */
  function markStale() {
    if (stale) return;
    stale = true;
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (_) { /* ignore */ } }
    emit('stale');
  }
  function checkStale() {
    if (!stale && TP.net && TP.net.isStale && TP.net.isStale()) markStale();
    return stale;
  }

  // ---------------------------------------------------------------- storage
  const hasStore = () => typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
  function sget(keys) {
    return new Promise((res) => {
      if (!hasStore()) { res({}); return; }
      try { chrome.storage.local.get(keys, (o) => { void (chrome.runtime && chrome.runtime.lastError); res(o || {}); }); } catch (_) { res({}); }
    });
  }
  /** Never rejects (B14): quota and other errors are logged. */
  function sset(obj) {
    return new Promise((res) => {
      if (!hasStore() || checkStale()) { res(false); return; }
      try {
        chrome.storage.local.set(obj, () => {
          const e = chrome.runtime && chrome.runtime.lastError;
          if (e) log('storage write failed', e.message);
          res(!e);
        });
      } catch (e) { log('storage write failed', e && e.message); res(false); }
    });
  }
  function sremove(keys) {
    return new Promise((res) => {
      if (!hasStore() || checkStale()) { res(); return; }
      try { chrome.storage.local.remove(keys, () => { void (chrome.runtime && chrome.runtime.lastError); res(); }); } catch (_) { res(); }
    });
  }

  // ---------------------------------------------------------------- cache
  let mem = {};                     // {key:{v, t, rev, range?}}
  const status = {};                // {key:{loading, error, auth, t}}
  const inflight = {};

  /** Entry as persisted: events capped at MAX_EVENTS (newest), nothing larger than MAX_CACHE_CHARS. */
  function trimEntry(key, e) {
    if (!e) return null;
    let out = e;
    if (key === 'events' && Array.isArray(e.v) && e.v.length > MAX_EVENTS) {
      out = Object.assign({}, e, { v: e.v.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, MAX_EVENTS) });
    }
    try {
      if (JSON.stringify(out).length > MAX_CACHE_CHARS) { log(`cache entry ${key} too large, not persisted`); return null; }
    } catch (_) { return null; }
    return out;
  }

  const writeTimers = {};
  const written = {};               // key → JSON of the last write by this tab (skip our own onChanged echo)
  function persist(key) {
    clearTimeout(writeTimers[key]);
    writeTimers[key] = setTimeout(() => {
      delete writeTimers[key];
      const e = trimEntry(key, mem[key]);
      if (!e) return;
      written[key] = JSON.stringify(e);
      sset({ [CP + key]: e });
    }, 400);
  }
  function flushCache() {
    const keys = Object.keys(writeTimers);
    const obj = {};
    for (const k of keys) {
      clearTimeout(writeTimers[k]); delete writeTimers[k];
      const e = trimEntry(k, mem[k]);
      if (e) { obj[CP + k] = e; written[k] = JSON.stringify(e); }
    }
    return Object.keys(obj).length ? sset(obj) : Promise.resolve(true);
  }

  /** (t, rev) ordering: a fresh load has a newer t; an optimistic mutation keeps t and bumps rev (B6). */
  const newer = (a, b) => !b || (a.t || 0) > (b.t || 0) || ((a.t || 0) === (b.t || 0) && (a.rev || 0) > (b.rev || 0));

  function put(key, v, extra) {
    mem[key] = Object.assign({ v, t: Date.now(), rev: 0 }, extra || {});
    persist(key);
    emit('change', key);
  }
  /** Optimistic local change of cached data: same t, rev + 1 → other tabs adopt it. */
  function mutate(key, v) {
    if (!mem[key]) return;
    mem[key] = Object.assign({}, mem[key], { v, rev: (mem[key].rev || 0) + 1 });
    persist(key);
    emit('change', key);
  }

  let initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let got = await sget(KEYS.map((k) => CP + k).concat('cache', WIPE_KEY));
      // A wipe (logout / reset) that the navigation interrupted: finish it before anything is shown from the cache.
      if (got[WIPE_KEY] && typeof got[WIPE_KEY] === 'object') {
        await wipeLocal({ scope: got[WIPE_KEY].scope, resume: true });
        got = {};
      }
      for (const k of KEYS) {
        const c = got[CP + k];
        if (c && typeof c === 'object' && 'v' in c) mem[k] = Object.assign({ t: 0, rev: 0 }, c);
      }
      // v1.1: one big 'cache' item → one item per key.
      const legacy = got.cache;
      if (legacy && typeof legacy === 'object') {
        const obj = {};
        for (const k of KEYS) {
          if (!mem[k] && legacy[k] && 'v' in legacy[k]) { mem[k] = { v: legacy[k].v, t: legacy[k].t || 0, rev: 0 }; obj[CP + k] = mem[k]; }
        }
        if (Object.keys(obj).length) await sset(obj);
        await sremove('cache');
      }
      if (mem.events) mem.events.v = withReadSet(mem.events.v);
      // Keep tabs in sync: another tab refreshed or changed data optimistically → take its newer data.
      try {
        const onChanged = (changes, area) => {
          if (area !== 'local') return;
          for (const [sk, ch] of Object.entries(changes)) {
            if (!sk.startsWith(CP)) continue;
            const k = sk.slice(CP.length);
            const nv = ch.newValue;
            if (!KEYS.includes(k) || !nv || JSON.stringify(nv) === written[k]) continue;
            if (newer(nv, mem[k])) {
              mem[k] = k === 'events' ? Object.assign({}, nv, { v: withReadSet(nv.v) }) : nv;
              emit('change', k);
            }
          }
        };
        chrome.storage.onChanged.addListener(onChanged);
        cleanups.push(() => { try { chrome.storage.onChanged.removeListener(onChanged); } catch (_) { /* gone */ } });
      } catch (_) { /* not in extension context (tests) */ }
      // Local read-set / done marks changed (here or in another tab) → re-apply to the cached events.
      try {
        const unsub = TP.state.subscribe((st, keys = []) => {
          if (keys.includes('read') && mem.events) {
            const v = withReadSet(mem.events.v);
            if (v !== mem.events.v) { mem.events = Object.assign({}, mem.events, { v }); emit('change', 'events'); }
          }
        });
        cleanups.push(unsub);
      } catch (_) { /* no state */ }
      migrateDoneKeys();
      watchVisibility();
    })();
    return initPromise;
  }

  function peek(key) { return mem[key] ? mem[key].v : null; }
  function stamp(key) { return mem[key] ? mem[key].t : null; }
  function lastUpdated() {
    const ts = ['enrollments', 'events'].map(stamp).filter(Boolean);
    return ts.length ? Math.max(...ts) : null;
  }
  function getStatus(key) { return Object.assign({ loading: false, error: null, auth: false, t: stamp(key) }, status[key] || {}); }

  // ---------------------------------------------------------------- session (F4)
  let authExpired = false;
  function setAuth(expired, key) {
    if (expired === authExpired) return;
    authExpired = expired;
    emit('auth', { expired, key });
  }
  // Ultra has its own session: it only exists after Ultra was opened once in this browser session.
  let ultraAuth = false;
  function setUltraAuth(expired) {
    if (expired === ultraAuth) return;
    ultraAuth = expired;
    emit('ultraAuth', { expired });
  }
  /** The "Log opnieuw in" target: Toledo's own login link when known, else the portal (it redirects to SSO). */
  function loginUrl() { return link('LOGIN') || `${PORTAL}/portal/`; }

  // ---------------------------------------------------------------- loaders
  const portal = (p, opts) => net().json(PORTAL + '/portal/api/' + p, opts);
  const ultra = (p, opts) => net().json(ULTRA + p, opts);

  async function ultraPaged(path, maxPages = 10) {
    const out = [];
    let next = path;
    for (let i = 0; next && i < maxPages; i++) {
      const r = await ultra(next);
      out.push(...arr(r));
      const np = r && r.paging && r.paging.nextPage;
      next = np ? (np.startsWith('http') ? np.replace(ULTRA, '') : np) : null;
    }
    return out;
  }

  function mapCalendarItem(it) {
    const { luId, title } = parseCalendarName(it.calendarName);
    const cid = /^_\d+_\d+$/.test(it.calendarId || '') ? it.calendarId : null;
    return {
      id: it.id || '',
      title: it.title || '',
      due: toMs(it.end || it.start),
      courseLuId: luId,
      courseTitle: title,
      cid,
      url: cid ? `${ULTRA}/ultra/courses/${cid}/outline` : null,
    };
  }

  /** Calendar windows (≤ 60 days each, at most CAL_MAX_WINDOWS) covering [from, until). */
  function calWindows(from, until) {
    const out = [];
    for (let a = from; a < until && out.length < CAL_MAX_WINDOWS; a += CAL_WINDOW) out.push([a, Math.min(a + CAL_WINDOW, until)]);
    return out;
  }
  let wantDays = 0;                 // largest horizon a view asked for in this tab (lazy extension, B2)

  async function fetchCalendar(from, until) {
    const items = [];
    for (const [a, b] of calWindows(from, until)) {
      const q = `/learn/api/public/v1/calendars/items?since=${encodeURIComponent(new Date(a).toISOString())}&until=${encodeURIComponent(new Date(b).toISOString())}&limit=100`;
      items.push(...await ultraPaged(q));
    }
    const seen = new Set();
    const out = [];
    const other = [];
    for (const it of items) {
      const d = mapCalendarItem(it);
      if (!d.due || !d.title) continue;
      const k = d.id || d.title + d.due;
      if (seen.has(k)) continue;
      seen.add(k);
      if (it.type === 'GradebookColumn') out.push(d);
      // TP-196: course events / personal entries are not deadlines, but they are not thrown away either.
      else other.push(Object.assign(d, { type: String(it.type || ''), start: toMs(it.start) || d.due, end: toMs(it.end) || d.due }));
    }
    return { list: out, other };
  }

  /** opts.extend: only fetch the part beyond what is cached (lazy, for the 366-day Deadlines view). */
  async function loadUltraDeadlines(opts = {}) {
    const now = Date.now();
    const horizon = Number((S().deadlines || {}).horizonDays) || 42;
    const days = Math.min(VIEW_DAYS, Math.max(horizon, wantDays, opts.days || 0));
    const prev = mem.ultraDeadlines;
    const deepAt = (prev && prev.range && prev.range.deepAt) || 0;
    const until = now + days * DAY;
    const idOf = (d) => d.id || d.title + d.due;
    let list;
    let other;
    let range;
    if (opts.extend && prev && prev.range && prev.range.until > now - CAL_PAST_DAYS * DAY) {
      const more = await fetchCalendar(prev.range.until, until);
      const ids = new Set(more.list.map(idOf));
      list = (prev.v || []).filter((d) => !ids.has(idOf(d))).concat(more.list);
      const oids = new Set(more.other.map(idOf));
      other = (prev.other || []).filter((d) => !oids.has(idOf(d))).concat(more.other);
      range = { from: prev.range.from, until, deepAt };
    } else {
      // Deep fetch on the first load and once a day (HORIZON.calDeepPastDays), else the short routine window.
      const deep = !deepAt || deepAt > now || now - deepAt >= HORIZON.calDeepEveryMs;
      const from = now - (deep ? HORIZON.calDeepPastDays : CAL_PAST_DAYS) * DAY;
      const got = await fetchCalendar(from, until);
      list = got.list;
      other = got.other;
      range = { from, until, deepAt: deep ? now : deepAt };
      // B2: deadlines that left the fetch window stay: not done for HORIZON.overdueKeepDays, done for HORIZON.donePastDays.
      const ids = new Set(list.map(idOf));
      const done = ST().done || {};
      for (const d of (prev && prev.v) || []) {
        if (d.due >= from || ids.has(idOf(d))) continue;
        const isDone = !!(done[ultraKey(d)] || done[legacyKey(d.title, d.courseLuId, d.due)]);
        if (d.due < now - (isDone ? PAST_DAYS : KEEP_OVERDUE_DAYS) * DAY) continue;
        list.push(d);
      }
    }
    // Free luId → cid mappings for resolveCourseId().
    const known = ST().cidMap || {};
    const add = {};
    for (const d of list) if (d.courseLuId && d.cid && !known[d.courseLuId]) add[d.courseLuId] = d.cid;
    if (Object.keys(add).length) setState({ cidMap: add });
    return { value: list.sort((a, b) => a.due - b.due), extra: { range, other: other.sort((a, b) => a.start - b.start).slice(0, 500) } };
  }

  /** Ultra calendar items that are not deadlines (type 'Course', 'User', 'Institution', …) in [from, to), from the cache.
      → [{id, title, type, start, end, courseLuId, courseTitle, cid, url}] sorted by start. */
  function calendarItems({ from = -Infinity, to = Infinity } = {}) {
    const e = mem.ultraDeadlines;
    return ((e && e.other) || []).filter((d) => d && d.end >= from && d.start < to);
  }

  const LOADERS = {
    enrollments: () => portal('enrollments').then(arr),
    events: () => portal('events').then(arr).then(withReadSet),
    upcoming: () => portal('upcoming').then(arr),
    mail: () => portal('emails/unread').then((r) => (r && typeof r.value === 'number' ? r.value : null)),
    links: () => portal('links').then(arr),
    ultraDeadlines: loadUltraDeadlines,
  };
  const AFTER = {
    enrollments: () => pruneState(),
    events: () => { migrateDoneKeys(); pruneState(); },
    ultraDeadlines: () => migrateDoneKeys(),
  };

  const warned = new Set();
  function load(key, opts = {}) {
    if (!LOADERS[key]) return Promise.reject(Object.assign(new Error('unknown key ' + key), { status: 0 }));
    if (inflight[key]) return inflight[key];
    if (!opts.force && mem[key] && Date.now() - mem[key].t < FRESH_MS) return Promise.resolve(mem[key].v);
    if (checkStale()) return Promise.reject(Object.assign(new Error('extension context invalidated'), { status: 0, stale: true }));
    status[key] = { loading: true, error: null, auth: false };
    const started = Date.now();
    const p = (async () => {
      try {
        const r = await LOADERS[key](opts);
        const v = r && r.extra ? r.value : r;
        status[key] = { loading: false, error: null, auth: false };
        if (wipedAt && started <= wipedAt) return v; // the student logged out / reset meanwhile: don't cache it again
        put(key, v, r && r.extra);
        if (ULTRA_KEYS.includes(key)) setUltraAuth(false);
        setAuth(Object.entries(status).some(([k, s]) => !ULTRA_KEYS.includes(k) && s && s.auth), key);
        try { AFTER[key] && AFTER[key](); } catch (e) { log('after load', key, e); }
        return v;
      } catch (e) {
        status[key] = { loading: false, error: e, auth: !!(e && e.auth) };
        if (e && e.stale) markStale();
        if (e && e.auth) { if (ULTRA_KEYS.includes(key)) setUltraAuth(true); else setAuth(true, key); }
        if (!warned.has(key)) { warned.add(key); log(`load ${key} failed (using cache)`, e && e.status, e && e.message); }
        emit('error', key);
        throw e;
      } finally {
        delete inflight[key];
      }
    })();
    inflight[key] = p;
    return p;
  }

  /** Loads all portal keys + ultraDeadlines (best-effort), after sending queued mark-read PATCHes.
   *  Clears the Ultra course cache (↻ also refreshes course contents). Never rejects.
   *  → {ok, errors:{key:Error}, auth:boolean, stale:boolean} */
  let refreshing = null;
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      clearCourseCache();
      emit('courseCache', { cleared: true });
      if (checkStale()) return { ok: false, errors: {}, auth: authExpired, stale: true };
      await flushPendingRead().catch(() => {});
      const keys = PORTAL_KEYS.concat('ultraDeadlines');
      loadUser().catch(() => {}); // greeting name: best-effort, never blocks or flags the session
      const res = await Promise.allSettled(keys.map((k) => load(k, { force: true })));
      const errors = {};
      res.forEach((r, i) => { if (r.status === 'rejected') errors[keys[i]] = r.reason; });
      return { ok: !errors.enrollments && !errors.events, errors, auth: authExpired, stale };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /** Refresh only when the data is older than opts.maxAge (default 5 min). → refresh() result or null. */
  function maybeRefresh(opts = {}) {
    if (checkStale()) return Promise.resolve(null);
    const maxAge = opts.maxAge != null ? opts.maxAge : STALE_MS;
    const last = lastUpdated();
    if (last && Date.now() - last < maxAge) return Promise.resolve(null);
    return refresh();
  }

  // Back to a tab after a while → refresh in the background (the shell may also call maybeRefresh()).
  function watchVisibility() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    const fn = () => {
      if (document.visibilityState !== 'visible') return;
      maybeRefresh().catch(() => {});
      if (ultraAuth) load('ultraDeadlines', { force: true }).catch(() => {}); // back from opening Ultra
    };
    document.addEventListener('visibilitychange', fn);
    cleanups.push(() => document.removeEventListener('visibilitychange', fn));
  }

  // ---------------------------------------------------------------- local read-set (B4)
  /** Events with read:true for every id in state.read (kept even when Toledo sync is off or a PATCH failed). */
  function withReadSet(list) {
    const read = ST().read || {};
    if (!Array.isArray(list) || !Object.keys(read).length) return list;
    let changed = false;
    const out = list.map((e) => {
      if (e && !e.read && e.id != null && read[e.id]) { changed = true; return Object.assign({}, e, { read: true }); }
      return e;
    });
    return changed ? out : list;
  }

  // ---------------------------------------------------------------- state pruning
  /** Bounded state maps: read-set (age + size), done marks (> 60 days and no longer in any source),
   *  visits/openFolders of courses that are not current. */
  function pruneState() {
    const st = ST();
    const now = Date.now();
    const patch = {};
    // read: drop old entries, keep the newest MAX_READ
    const read = Object.entries(st.read || {});
    const keepRead = read.filter(([, t]) => typeof t === 'number' && t > now - READ_DAYS * DAY).sort((a, b) => b[1] - a[1]).slice(0, MAX_READ);
    if (keepRead.length !== read.length) {
      const keep = new Set(keepRead.map(([id]) => id));
      patch.read = Object.fromEntries(read.filter(([id]) => !keep.has(id)).map(([id]) => [id, null]));
    }
    // done: only when the sources are loaded, otherwise every mark would look unreferenced
    if (peek('events') && peek('ultraDeadlines')) {
      const live = new Set(candidates().flatMap((c) => [c.key, c.legacy]));
      for (const c of Array.isArray(S().custom) ? S().custom : []) if (c && c.id) live.add('c' + hash(c.id));
      const drop = Object.entries(st.done || {}).filter(([k, t]) => !live.has(k) && (typeof t !== 'number' || t < now - DONE_DAYS * DAY));
      if (drop.length) patch.done = Object.fromEntries(drop.map(([k]) => [k, null]));
    }
    // visits / openFolders: only for courses we can tell are not current
    const en = peek('enrollments');
    if (Array.isArray(en) && en.length) {
      const year = maxYear(en.map((e) => ({ type: e.type || 'course', year: e.academicYear || 0 })));
      const currentLu = new Set(en.filter((e) => (e.type || 'course') !== 'course' || (e.academicYear || 0) === year).map((e) => e.learningUnitId));
      const cidToLu = {};
      for (const [lu, cid] of Object.entries(st.cidMap || {})) cidToLu[cid] = lu;
      const old = (cid, t) => (cidToLu[cid] ? !currentLu.has(cidToLu[cid]) : (typeof t === 'number' && t < now - VISIT_DAYS * DAY));
      const visits = Object.entries(st.visits || {}).filter(([cid, t]) => old(cid, t));
      if (visits.length) patch.visits = Object.fromEntries(visits.map(([cid]) => [cid, null]));
      const vAfter = st.visits || {};
      const folders = Object.keys(st.openFolders || {}).filter((cid) => (cidToLu[cid] ? !currentLu.has(cidToLu[cid]) : !vAfter[cid] || old(cid, vAfter[cid])));
      if (folders.length) patch.openFolders = Object.fromEntries(folders.map((cid) => [cid, null]));
    }
    if (Object.keys(patch).length) setState(patch);
    return patch;
  }

  // ---------------------------------------------------------------- models
  function courseSettings(luId) {
    return (TP.settings && TP.settings.course ? TP.settings.course(luId) : null) || {};
  }

  function resolveColor(luId, toledoIndex) {
    const cs = courseSettings(luId);
    const pal = U().PALETTE || {};
    if (cs.color) {
      if (pal[cs.color]) return { color: pal[cs.color], colorKey: cs.color };
      if (/^#[0-9a-f]{3,8}$/i.test(cs.color)) return { color: cs.color, colorKey: null };
    }
    // Default: unique among the current courses even when several share a Toledo colour number (N7, TP-111).
    const key = U().courseColorKey ? U().courseColorKey(luId, toledoIndex) : (U().colorKeyForIndex ? U().colorKeyForIndex(toledoIndex) : null);
    return { color: (key && pal[key]) || colorForIndex(toledoIndex), colorKey: key };
  }

  function eventTime(e) { return toMs(e.date); }

  /** Feed rules, without the hidden-course filter (Course.unread uses these too).
   *  B3: an item counts as new until its id is in state.feedSeen.ids (or its date ≤ feedSeen.floor),
   *  so a late-published item with an older date still shows up. */
  function feedEligible(e, s, st) {
    if (!e || e.type !== 'notifications') return false;
    if (e.read || e.dismissed) return false;
    if (st.read && e.id != null && st.read[e.id]) return false;
    if (e.subType === 'due' || e.subType === 'course') return false;
    if (e.subType === 'announcement' && !((s.feed || {}).includeAnnouncements)) return false;
    if (e.subType === 'advalvas') return false;
    const fs = st.feedSeen || {};
    if (fs.ids && e.id != null && fs.ids[e.id] != null) return false;
    return eventTime(e) > (fs.floor || 0);
  }

  function buildCourse(en, unreadBy, latestBy) {
    const luId = en.learningUnitId;
    const cs = courseSettings(luId);
    const { color, colorKey } = resolveColor(luId, en.color);
    return {
      luId,
      enrollmentId: en.id,
      title: en.title || '',
      name: (cs.nickname && String(cs.nickname).trim().slice(0, 60)) || courseName(en.title), // same limit as the field (imports, TP-008)
      code: courseCode(en.title),
      color, colorKey,
      semester: en.semester || 'UNKNOWN',
      year: en.academicYear || 0,
      type: en.type || 'course',
      hidden: !!cs.hidden,
      available: en.available !== false,
      link: en.link || null,
      unread: unreadBy[luId] || 0,
      latest: latestBy[luId] || 0,
    };
  }

  function eventStats() {
    const s = S(), st = ST();
    const unreadBy = {}, latestBy = {};
    const now = Date.now();
    for (const e of peek('events') || []) {
      if (!e || !e.sourceId) continue;
      if (feedEligible(e, s, st)) unreadBy[e.sourceId] = (unreadBy[e.sourceId] || 0) + 1;
      if (e.subType !== 'due' && e.subType !== 'course' && !e.dismissed) {
        const t = eventTime(e);
        if (t <= now && t > (latestBy[e.sourceId] || 0)) latestBy[e.sourceId] = t;
      }
    }
    return { unreadBy, latestBy };
  }

  function allCourses() {
    const { unreadBy, latestBy } = eventStats();
    return (peek('enrollments') || []).filter((e) => e && e.learningUnitId).map((e) => buildCourse(e, unreadBy, latestBy));
  }

  function maxYear(list) {
    return Math.max(0, ...list.filter((c) => c.type === 'course').map((c) => c.year || 0));
  }

  /**
   * opts.includeHidden (default false), opts.includeCommunities (default settings.courses.showCommunities),
   * opts.currentOnly (default true). Sorted: courses before communities, then settings.courses.sort:
   * 'manual' (settings.courses.order, unknown courses last by name) | 'name' | 'activity' (latest activity, then name).
   */
  function courses(opts = {}) {
    const s = S();
    const cs = s.courses || {};
    const includeHidden = !!opts.includeHidden;
    const includeCommunities = opts.includeCommunities != null ? !!opts.includeCommunities : !!cs.showCommunities;
    const currentOnly = opts.currentOnly != null ? !!opts.currentOnly : true;
    const all = allCourses();
    const year = maxYear(all);
    const list = all.filter((c) => {
      if (!includeHidden && c.hidden) return false;
      if (c.type === 'community') return includeCommunities;
      if (currentOnly && c.year !== year) return false;
      return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    let cmp;
    if (cs.sort === 'name') cmp = byName;
    else if (cs.sort === 'manual') {
      const order = Array.isArray(cs.order) ? cs.order : [];
      const pos = (c) => { const i = order.indexOf(c.luId); return i < 0 ? 1e9 : i; };
      cmp = (a, b) => pos(a) - pos(b) || byName(a, b);
    } else cmp = (a, b) => (b.latest - a.latest) || byName(a, b);
    return list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'course' ? -1 : 1) || cmp(a, b));
  }

  function course(luId) {
    if (!luId) return null;
    return allCourses().find((c) => c.luId === luId) || null;
  }

  const VIDEO = /\.(mp4|mov|m4v|avi|mkv|webm|wmv|mpe?g)$/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|heic|svg|tiff?|bmp)$/i;
  const FILE = /\.[a-z0-9]{2,5}$/i;

  /** kind of a portal event or a Blackboard content node. */
  function kindOf(x) {
    if (!x) return 'page';
    if (x.contentHandler || x.hasChildren != null) {
      const h = (x.contentHandler && x.contentHandler.id) || '';
      const mime = (x.contentHandler && x.contentHandler.file && x.contentHandler.file.mimeType) || '';
      const fname = (x.contentHandler && x.contentHandler.file && x.contentHandler.file.fileName) || x.title || '';
      if (x.hasChildren || /x-bb-(folder|lesson|module)/.test(h)) return 'folder';
      if (h === 'resource/x-bb-file') {
        if (mime.startsWith('video/') || VIDEO.test(fname)) return 'video';
        if (mime.startsWith('image/') || IMAGE.test(fname)) return 'image';
        return 'file';
      }
      if (h === 'resource/x-bb-document') return 'page';
      if (/asmt|assignment|test|survey/.test(h)) return 'assignment';
      if (h === 'resource/x-bb-externallink' || h === 'resource/x-bb-courselink') return 'link';
      if (/lti-link|forumlink|journallink|bloglink|wikilink|x-bb-discussion/i.test(h)) return 'tool'; // TP-099: not "Pagina"
      return 'page';
    }
    const st = x.subType;
    if (st === 'due' || st === 'other') return 'assignment';
    if (st === 'announcement') return 'announcement';
    if (st === 'advalvas' || x.type === 'advalvas') return 'notice';
    const t = String(x.title || '').trim();
    if (VIDEO.test(t)) return 'video';
    if (IMAGE.test(t)) return 'image';
    if (FILE.test(t)) return 'file';
    return 'page';
  }

  function countKind(counts, k) {
    const m = k === 'image' ? 'file' : (k === 'link' || k === 'tool') ? 'page' : k;
    if (m in counts) counts[m]++;
  }

  /** Sorted: groups with a deadline ≤ 48 h first, then latest activity. */
  function feed() {
    const s = S(), st = ST();
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    const groups = {};
    for (const e of peek('events') || []) {
      if (!feedEligible(e, s, st)) continue;
      const c = byLu[e.sourceId] || null;
      if (c && c.hidden) continue;
      const g = groups[e.sourceId] ||= {
        luId: e.sourceId,
        course: c,
        name: c ? c.name : courseName(e.source),
        color: c ? c.color : colorForIndex(e.color),
        items: [], latest: 0,
        counts: { file: 0, video: 0, page: 0, assignment: 0, announcement: 0 },
      };
      g.items.push(e);
      g.latest = Math.max(g.latest, eventTime(e));
      countKind(g.counts, kindOf(e));
    }
    const now = Date.now();
    const soon = new Set(deadlines({ includeDone: false }).filter((d) => d.due >= now && d.due <= now + 2 * DAY).map((d) => d.courseLuId));
    const list = Object.values(groups);
    list.forEach((g) => g.items.sort((a, b) => eventTime(b) - eventTime(a)));
    return list.sort((a, b) => ((soon.has(b.luId) ? 1 : 0) - (soon.has(a.luId) ? 1 : 0)) || (b.latest - a.latest));
  }

  // ---------------------------------------------------------------- deadlines (B2, B13)
  /** v1.1 key (title + course + due day). Only used to migrate old done marks. */
  function legacyKey(title, luId, due) { return 'd' + hash(normTitle(title) + '|' + (luId || '') + '|' + dayKey(due)); }
  /** v1.2 keys: based on the source id, so a moved due date keeps its done mark and ICS UID. */
  const toledoKey = (e) => (e.id != null && e.id !== '' ? 'd' + hash('t|' + e.id) : legacyKey(e.title, e.sourceId, eventTime(e)));
  const ultraKey = (d) => (d.id ? 'd' + hash('u|' + d.id) : legacyKey(d.title, d.courseLuId, d.due));

  /** All Toledo + Ultra deadline candidates (no window, no dedupe). */
  function candidates() {
    const out = [];
    for (const e of peek('events') || []) {
      if (!e || e.subType !== 'due' || e.dismissed) continue;
      const due = eventTime(e);
      if (!due) continue;
      out.push({ key: toledoKey(e), legacy: legacyKey(e.title, e.sourceId, due), title: e.title || '', courseLuId: e.sourceId || '', courseTitle: e.source || '', due, url: e.url || null, source: 'toledo' });
    }
    for (const d of peek('ultraDeadlines') || []) {
      if (!d || !d.due || !d.title) continue;
      out.push({ key: ultraKey(d), legacy: legacyKey(d.title, d.courseLuId, d.due), title: d.title, courseLuId: d.courseLuId || '', courseTitle: d.courseTitle || '', due: d.due, url: d.url || null, source: 'ultra' });
    }
    return out;
  }

  /** Move done marks stored under the v1.1 key to the v1.2 source-id key. */
  function migrateDoneKeys() {
    const done = ST().done || {};
    if (!Object.keys(done).length) return {};
    const patch = {};
    for (const c of candidates()) {
      if (c.legacy === c.key || done[c.legacy] == null) continue;
      if (done[c.key] == null) patch[c.key] = done[c.legacy];
      patch[c.legacy] = null;
    }
    // A legacy key that is also some item's new key must not be deleted.
    for (const c of candidates()) if (patch[c.key] === null) delete patch[c.key];
    if (Object.keys(patch).length) setState({ done: patch });
    return patch;
  }

  let aliasMap = new Map(); // deadline key → all source keys merged into it (toggleDone marks all)

  /**
   * opts.includeDone (default false), opts.horizonDays (default settings.deadlines.horizonDays),
   * opts.pastDays (default HORIZON.donePastDays: how long done items stay listed after their due date), opts.allCustom (own deadlines beyond the horizon too).
   * Overdue items that are not done are always included, however old (overdue:true, ageDays).
   * Own (custom) deadlines are not cut off when horizonDays ≥ HORIZON.viewDays (the Deadlines page shows them all).
   * Toledo/Ultra duplicates (same normalized title + course, due within ±2 h) are merged.
   * Asking for a horizon beyond the fetched Ultra calendar range loads the rest lazily ('change' follows).
   */
  function deadlines(opts = {}) {
    const s = S(), st = ST();
    const horizon = opts.horizonDays != null ? Number(opts.horizonDays) : (Number((s.deadlines || {}).horizonDays) || 42);
    const now = Date.now();
    const pastFrom = now - (opts.pastDays != null ? Number(opts.pastDays) : PAST_DAYS) * DAY;
    const until = now + horizon * DAY;
    const untilOwn = horizon >= VIEW_DAYS ? Infinity : until;
    lazyHorizon(horizon);
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    const done = st.done || {};
    const meta = (luId, fallbackTitle) => {
      const c = byLu[luId];
      return { courseName: c ? c.name : courseName(fallbackTitle || ''), color: c ? c.color : GRAPHITE };
    };

    const buckets = new Map();     // normTitle|course → merged items
    const merged = [];
    for (const c of candidates()) {
      if (c.due > until) continue;
      const b = normTitle(c.title) + '|' + c.courseLuId;
      const list = buckets.get(b) || [];
      const hit = list.find((x) => Math.abs(x.due - c.due) <= DEDUPE_MS);
      if (hit) {
        if (!hit.keys.includes(c.key)) hit.keys.push(c.key);
        if (!hit.url && c.url) hit.url = c.url;
        continue;
      }
      const d = Object.assign({ key: c.key, keys: [c.key], title: c.title, courseLuId: c.courseLuId, due: c.due, url: c.url, source: c.source }, meta(c.courseLuId, c.courseTitle));
      list.push(d); buckets.set(b, list); merged.push(d);
    }
    for (const c of Array.isArray(s.custom) ? s.custom : []) {
      const due = toMs(c && c.due);
      if (!c || !c.id || !due || (due > untilOwn && !opts.allCustom)) continue; // allCustom: own items beyond the horizon too (TP-015)
      const key = 'c' + hash(c.id);
      const m = c.courseLuId ? meta(c.courseLuId, '') : { courseName: '', color: GRAPHITE };
      // Custom items are never deduped away (the student must be able to remove them).
      merged.push(Object.assign({ key, keys: [key], title: c.title || '', courseLuId: c.courseLuId || '', due, url: null, source: 'custom', customId: c.id }, m));
    }
    const nextAliases = new Map();
    const out = [];
    for (const d of merged) {
      d.done = d.keys.some((k) => !!done[k]);
      if (d.due < pastFrom && d.done) continue;                 // old and done: gone
      if (!opts.includeDone && d.done) continue;
      d.overdue = !d.done && d.due < now;
      d.ageDays = d.due < now ? Math.max(0, -TP.fmt.daysUntil(d.due)) : 0; // calendar days, like "gisteren" (TP-219)
      for (const k of d.keys) nextAliases.set(k, d.keys);
      out.push(d);
    }
    for (const [k, v] of nextAliases) aliasMap.set(k, v);
    if (aliasMap.size > 5000) aliasMap = nextAliases;
    return out.sort((a, b) => a.due - b.due || a.title.localeCompare(b.title));
  }

  // Lazy extension of the Ultra calendar range (max once per 5 min per horizon, never during a load).
  let lazyAt = 0, lazyDays = 0;
  function lazyHorizon(days) {
    days = Math.min(VIEW_DAYS, Number(days) || 0);
    const e = mem.ultraDeadlines;
    if (!e || !e.range || stale) return;
    if (e.range.until >= Date.now() + days * DAY - DAY) return;
    wantDays = Math.max(wantDays, days);
    if (inflight.ultraDeadlines || (days <= lazyDays && Date.now() - lazyAt < STALE_MS)) return;
    lazyAt = Date.now(); lazyDays = days;
    setTimeout(() => { load('ultraDeadlines', { force: true, extend: true, days }).catch(() => {}); }, 0);
  }

  function announcements(opts = {}) {
    const filter = opts.filter || 'all';
    const read = ST().read || {};
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    return (peek('events') || []).filter((e) => {
      if (!e || e.dismissed) return false;
      const isAnn = e.subType === 'announcement', isAdv = e.subType === 'advalvas' || e.type === 'advalvas';
      if (!isAnn && !isAdv) return false;
      if (isAnn && byLu[e.sourceId] && byLu[e.sourceId].hidden) return false;
      if (filter === 'courses') return isAnn;
      if (filter === 'school') return isAdv;
      if (filter === 'unread') return !e.read && !read[e.id];
      return true;
    }).sort((a, b) => eventTime(b) - eventTime(a));
  }

  /** → {dayKey: Upcoming[]} sorted by start; each item gets .color and .courseName added. */
  function schedule() {
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    const out = {};
    const list = (peek('upcoming') || []).filter((u) => u && u.start).slice().sort((a, b) => toMs(a.start) - toMs(b.start));
    for (const u of list) {
      const src = u.source || {};
      const c = byLu[src.learningUnitId];
      const item = Object.assign({}, u, {
        start: toMs(u.start), end: toMs(u.end),
        color: c ? c.color : colorForIndex(src.color),
        courseName: c ? c.name : courseName(u.name),
        courseLuId: src.learningUnitId || '',
      });
      (out[dayKey(item.start)] ||= []).push(item);
    }
    return out;
  }

  function flatLinks() {
    const groups = peek('links') || [];
    return groups.flatMap((g) => (g && Array.isArray(g.links) ? g.links : (g && g.url ? [g] : [])));
  }
  function absPortal(url) {
    if (!url) return null;
    try {
      const u = new URL(/^https?:\/\//i.test(url) ? url : String(url).replace(/^\/?/, ''), PORTAL + '/');
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (_) { return null; }
  }
  function link(label) {
    const l = flatLinks().find((x) => x.label === label);
    return l ? absPortal(l.url) : null;
  }
  const QUICK = ['KULOKET-UURROOSTER', 'LUCA-STUDENT-WEBMAIL', 'BB-CALENDAR-ULTRA', 'LUCA-CAL', 'ADVALVAS', 'KULOKET-STUDENT', 'TOLBIZZ-ENROLL', 'NOTIFICATION-SETTINGS-ULTRA'];
  function quickLinks() {
    const all = flatLinks();
    return QUICK.map((label) => {
      const l = all.find((x) => x.label === label);
      const url = l && absPortal(l.url);
      return url ? { label, title: l.translation || l.label, url } : null;
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- mutations
  const patching = new Set();       // in-flight PATCH promises (flush() waits for them)
  const track = (p) => { patching.add(p); p.finally(() => patching.delete(p)); return p; };

  /** PATCH batch/events in chunks of 100 with keepalive (survives navigation). → ids that failed. */
  async function sendRead(entries) {
    const failed = [];
    for (let i = 0; i < entries.length; i += PATCH_CHUNK) {
      const chunk = entries.slice(i, i + PATCH_CHUNK);
      try {
        await net().json(PORTAL + '/portal/api/batch/events', { method: 'PATCH', keepalive: true, body: chunk.map((e) => ({ id: e.id, type: e.type, subType: e.subType, read: true })) });
      } catch (e) {
        if (e && e.stale) markStale();
        if (e && e.auth) setAuth(true, 'events');
        log('markRead sync failed', e && e.status);
        failed.push(...chunk);
      }
    }
    return failed;
  }

  /** Optimistic: events read:true + local read-set (B4). With sync on: PATCH Toledo; failures are queued
   *  in state.pendingRead and retried on the next refresh (B7). → false when the Toledo sync failed. */
  function markRead(events) {
    const list = (Array.isArray(events) ? events : [events]).filter((e) => e && e.id != null);
    if (!list.length) return Promise.resolve(true);
    const ids = new Set(list.map((e) => e.id));
    const ev = peek('events');
    if (Array.isArray(ev)) mutate('events', ev.map((e) => (ids.has(e.id) && !e.read ? Object.assign({}, e, { read: true }) : e)));
    const now = Date.now();
    setState({ read: Object.fromEntries(list.map((e) => [e.id, now])) });
    if (!((S().sync || {}).markReadInToledo)) return Promise.resolve(true);
    return track((async () => {
      const failed = await sendRead(list);
      if (!failed.length) return true;
      const pending = Object.keys(ST().pendingRead || {}).length;
      if (pending < MAX_PENDING) {
        setState({ pendingRead: Object.fromEntries(failed.slice(0, MAX_PENDING - pending).map((e) => [e.id, { id: e.id, type: e.type, subType: e.subType, t: now }])) });
      }
      return false;
    })());
  }

  /** Send queued mark-read PATCHes (called by refresh()). Dropped when the sync was switched off. */
  function flushPendingRead() {
    const q = ST().pendingRead || {};
    const ids = Object.keys(q);
    if (!ids.length) return Promise.resolve(true);
    if (!((S().sync || {}).markReadInToledo)) { setState({ pendingRead: {} }, { replace: true }); return Promise.resolve(true); }
    const entries = ids.map((id) => ({ id: q[id] && q[id].id != null ? q[id].id : id, type: q[id] && q[id].type, subType: q[id] && q[id].subType }));
    return track((async () => {
      const failed = new Set((await sendRead(entries)).map((e) => String(e.id)));
      const patch = Object.fromEntries(ids.filter((id) => !failed.has(id)).map((id) => [id, null]));
      if (Object.keys(patch).length) setState({ pendingRead: patch });
      return !failed.size;
    })());
  }

  /**
   * One "mark as read" for every list (shared pattern 5). scope:
   *   {events: Event[]}  exactly these (the rows in view: a filtered/searched list)
   *   {luId}             what Nieuw shows for one course
   *   {}                 everything in Nieuw
   * Always writes local state (feedSeen + the read-set), also with "Markeer gelezen in Toledo" off (TP-155); with it on,
   * the unread ones are PATCHed to Toledo (failures queue in pendingRead).
   * → {n (items in scope), unread (newly read), synced: Promise<bool> (false = Toledo not updated yet), undo(): Promise}
   */
  async function markAllRead(scope = {}) {
    const items = Array.isArray(scope.events) ? scope.events.filter((e) => e && e.id != null)
      : feed().filter((g) => !scope.luId || g.luId === scope.luId).flatMap((g) => g.items);
    const read = ST().read || {};
    const unread = items.filter((e) => !e.read && !read[e.id]);
    const before = JSON.parse(JSON.stringify(ST().feedSeen || {}));
    await seeFeed(items);
    const synced = unread.length ? markRead(unread) : Promise.resolve(true);
    const undo = async () => {
      await Promise.resolve(synced).catch(() => {}); // a read:false must not overtake the read:true PATCH
      await setState({ feedSeen: before }, { replace: true });
      if (unread.length) await markUnread(unread);
      emit('change', 'state');
    };
    return { n: items.length, unread: unread.length, synced: Promise.resolve(synced).catch(() => false), undo };
  }

  /** Everything new in the feed counts as seen and read (= markAllRead({})). → bool (false when the Toledo sync failed) */
  async function markFeedSeen() {
    const r = await markAllRead({});
    return r.synced;
  }

  /** feedSeen <- these items (ids + floor, bounded). */
  async function seeFeed(items) {
    const fs = ST().feedSeen || {};
    const ids = Object.assign({}, fs.ids || {});
    for (const e of items) if (e.id != null) ids[e.id] = eventTime(e);
    let floor = fs.floor || 0;
    const entries = Object.entries(ids);
    if (entries.length > MAX_SEEN) {
      entries.sort((a, b) => b[1] - a[1]);
      for (const [, t] of entries.slice(MAX_SEEN)) floor = Math.max(floor, t || 0);
      await setState({ feedSeen: { ids: Object.fromEntries(entries.slice(0, MAX_SEEN)), floor } }, { replace: true });
    } else {
      await setState({ feedSeen: { ids: Object.fromEntries(items.filter((e) => e.id != null).map((e) => [e.id, eventTime(e)])) } });
    }
    emit('change', 'state');
  }

  let pinWarned = false;
  /** @deprecated v1.2: pins are gone (maintainer decision). Temporary no-op so old UI code can't crash. */
  function setPinned() {
    if (!pinWarned) { pinWarned = true; try { console.warn('[Toledo+] TP.data.setPinned() was removed in v1.2 and does nothing'); } catch (_) { /* noop */ } }
    return Promise.resolve(false);
  }

  /** Toggle "klaar" for a deadline (and every source key merged into it). → new done state. */
  async function toggleDone(key) {
    const keys = aliasMap.get(key) || [key];
    const done = ST().done || {};
    const next = !keys.some((k) => !!done[k]);
    const now = Date.now();
    // TP.state.set deep-merges; null deletes the map entry.
    await setState({ done: Object.fromEntries(keys.map((k) => [k, next ? now : null])) });
    emit('change', 'state');
    return next;
  }

  /** Set "klaar" for several deadlines at once (one state write; bulk action + its Undo). keys: deadline keys. */
  async function setDone(keys, on = true) {
    const all = [...new Set([].concat(keys || []).flatMap((k) => aliasMap.get(k) || [k]))];
    if (!all.length) return;
    const now = Date.now();
    await setState({ done: Object.fromEntries(all.map((k) => [k, on ? now : null])) });
    emit('change', 'state');
  }

  const customList = () => (Array.isArray(S().custom) ? S().custom : []);
  /** Add an own deadline. Passing the `id` of a removed one restores it (Undo): same key, so its "klaar" mark survives. */
  async function addCustomDeadline({ id, title, courseLuId, due }) {
    const list = customList();
    const keep = id && !list.some((c) => c.id === id) ? String(id) : U().uid();
    const item = { id: keep, title: String(title || '').trim(), courseLuId: courseLuId || '', due: toMs(due) };
    await TP.settings.set({ custom: list.concat(item) });
    emit('change', 'settings');
    return item;
  }

  /** Change an own deadline in place (title, course, due); the id (and so its key and done mark) stays. → item | null */
  async function updateCustomDeadline(id, patch = {}) {
    let out = null;
    const custom = customList().map((c) => {
      if (!c || c.id !== id) return c;
      out = { ...c };
      if (patch.title != null) out.title = String(patch.title).trim() || c.title;
      if (patch.courseLuId != null) out.courseLuId = String(patch.courseLuId || '');
      if (patch.due != null && toMs(patch.due)) out.due = toMs(patch.due);
      return out;
    });
    if (!out) return null;
    await TP.settings.set({ custom });
    emit('change', 'settings');
    return out;
  }

  /** → the removed item (pass it to addCustomDeadline to undo) | null */
  async function removeCustomDeadline(id) {
    const list = customList();
    const gone = list.find((c) => c && c.id === id) || null;
    await TP.settings.set({ custom: list.filter((c) => c.id !== id) });
    emit('change', 'settings');
    return gone;
  }

  async function addRecent(item) {
    if (!item || !item.url) return;
    const entry = { title: item.title || '', url: item.url, courseName: item.courseName || '', courseLuId: item.courseLuId || '', kind: item.kind || 'page', ts: Date.now() };
    const recent = [entry].concat((ST().recent || []).filter((r) => r && r.url !== item.url)).slice(0, 12);
    await setState({ recent });
    emit('change', 'state');
  }

  /** Wait for pending writes (state, settings, cache) and mark-read PATCHes — await before navigating away.
   *  Never rejects. */
  function flush() {
    const parts = [...patching].map((p) => p.catch(() => {}));
    try { if (TP.state && TP.state.flush) parts.push(Promise.resolve(TP.state.flush()).catch(() => {})); } catch (_) { /* ignore */ }
    try { if (TP.settings && TP.settings.flush) parts.push(Promise.resolve(TP.settings.flush()).catch(() => {})); } catch (_) { /* ignore */ }
    parts.push(flushCache());
    return Promise.all(parts).then(() => undefined, () => undefined);
  }
  try { if (typeof addEventListener === 'function') addEventListener('pagehide', () => { if (!wipedAt) flushCache(); }); } catch (_) { /* not a page */ }

  // ---------------------------------------------------------------- local wipe (pattern 7: TP-001, TP-003, TP-139, TP-181)
  // One helper decides what "forget" means, for the two ways a student asks for it:
  //  scope 'user' — log out through Toledo+: everything that was fetched for this Toledo user and would greet the next
  //    student on a shared browser profile: the data cache (enrolments, events, deadlines, mail count, links, first name),
  //    KU Loket (lessons, exams, the personal iCal link), the ⌘K index, recently opened documents, course/folder ids and,
  //    when it is on, the file-content index. Kept: settings, own deadlines, done/read marks (ids only) and device prefs.
  //  scope 'all' — Settings › Reset everything (after TP.settings.reset()): every key Toledo+ keeps in chrome.storage.local
  //    and the file-content index; the anonymous install id is deleted here and queued for deletion on the server
  //    (TP.telemetry.forget, retried until it succeeds). Kept: that deletion queue, the settings fallback items (reset
  //    has just rewritten them), the download budget and the logout/landing timestamps.
  // Phase 1 is synchronous (memory + the fixed keys + a 'tp:wipePending' marker), so a logout navigation right after the
  // call cannot stop it; init() finishes an interrupted wipe before anything is read from the cache.
  const WIPE_KEY = 'tp:wipePending';
  const USER_STATE = ['me', 'recent', 'focus', 'cidMap', 'openFolders', 'visits'];
  const USER_KEYS = ['cache', 'index', 'indexMeta', 'kuloket:meta', 'kuloket:exams', 'kuloket:icsUrl', 'kuloket:icsUrlT', 'kuloket:authAt'];
  const USER_PREFIXES = [CP, 'kuloket:'];
  const KEEP_ON_RESET = ['telemetry:forget', 'settingsLocal', 'customLocal', 'settingsSavedAt', 'customSavedAt', 'fulltext:budget', 'tp:loggedOutAt', 'tp:landingBounceAt'];
  let wipedAt = 0;

  /** → Promise<true>; never rejects. opts: {scope:'user'|'all'} */
  function wipeLocal(opts = {}) {
    const scope = opts.scope === 'all' ? 'all' : 'user';
    const quiet = (p) => Promise.resolve(p).catch(() => {});
    wipedAt = Date.now();
    if (!opts.resume) sset({ [WIPE_KEY]: { scope, t: wipedAt } });
    for (const k of Object.keys(writeTimers)) { clearTimeout(writeTimers[k]); delete writeTimers[k]; }
    mem = {};
    for (const k of Object.keys(status)) delete status[k];
    courseCache.clear(); courseData.clear(); bodyCache.clear(); bodyInflight.clear();
    aliasMap = new Map(); wantDays = 0; lazyAt = 0; lazyDays = 0; meTried = false;
    const fixed = KEYS.map((k) => CP + k).concat(USER_KEYS);
    const removed = sremove(fixed);
    let st = null;
    try { st = TP.state && TP.state.forget ? TP.state.forget(scope === 'all' ? undefined : USER_STATE) : null; } catch (_) { st = null; }
    // The install id must be queued for server-side deletion before phase 2 removes 'telemetry:id'.
    let tel = null;
    try { tel = scope === 'all' && TP.telemetry && TP.telemetry.forget ? TP.telemetry.forget({ background: true }) : null; } catch (_) { tel = null; }
    let ft = null;
    try {
      const F = TP.fulltext;
      if (F && F.wipe && (scope === 'all' || (F.enabled && F.enabled()))) ft = F.wipe();
    } catch (_) { ft = null; }
    const rest = quiet(tel).then(() => sget(null)).then((all) => {
      const drop = Object.keys(all || {}).filter((k) => (scope === 'all'
        ? k !== WIPE_KEY && !KEEP_ON_RESET.includes(k)
        : USER_PREFIXES.some((p) => k.startsWith(p)) || USER_KEYS.includes(k)));
      return drop.length ? sremove(drop) : null;
    });
    return Promise.all([removed, st, ft, rest].map(quiet)).then(() => sremove([WIPE_KEY])).then(() => true, () => true);
  }

  // ---------------------------------------------------------------- ICS
  // One writer for every calendar file (deadlines, exams, agenda lessons): RFC 5545 escaping, octet folding, UTC times.
  const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  /** TEXT value: CR/LF/CRLF → "\n", other control characters dropped (a bare CR must never start a new line, TP-176). */
  const icsText = (s) => String(s == null ? '' : s).replace(/\r\n|\r|\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const icsUrl = (u) => (typeof u === 'string' && /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(u) ? u : '');
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const octets = (ch) => (enc ? enc.encode(ch).length : unescape(encodeURIComponent(ch)).length);

  /** RFC 5545 §3.1: fold lines longer than 75 octets (CRLF + one space), never inside a UTF-8 sequence. */
  function icsFold(line) {
    const out = [];
    let cur = '', n = 0, limit = 75;
    for (const ch of line) {
      const k = octets(ch);
      if (n + k > limit) { out.push(cur); cur = ' '; n = 1; limit = 75; }
      cur += ch; n += k;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  const TRIGGER = { '1h': '-PT1H', '1d': '-P1D', '2d': '-P2D' };
  /** settings.deadlines.reminder as a VALARM trigger duration, or null. */
  const icsReminder = () => TRIGGER[(S().deadlines || {}).reminder || 'none'] || null;
  // The language of the text in the file (e.g. "Examen:") is the UI language (TP-017: was always NL).
  const icsLang = () => { try { return String(TP.i18n.lang() || 'nl').toUpperCase(); } catch (_) { return 'NL'; } };
  const tr = (k) => { try { return TP.t(k); } catch (_) { return k; } };

  /**
   * One VCALENDAR. events: [{ uid, start, end, summary, location?, description?, url?, alarm?: '-P1D', alarmRel?: 'START'|'END' }].
   * opts: { name (X-WR-CALNAME), now }.
   */
  function icsEvents(events, opts = {}) {
    const now = icsStamp(opts.now || Date.now());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Toledo+//Toledo+//${icsLang()}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (opts.name) L.push(`X-WR-CALNAME:${icsText(opts.name)}`);
    for (const e of events || []) {
      if (!e || !Number.isFinite(e.start)) continue;
      const end = Number.isFinite(e.end) && e.end > e.start ? e.end : e.start + 60e3;
      L.push('BEGIN:VEVENT',
        `UID:${String(e.uid || hash(String(e.summary) + e.start)).replace(/[\s\u0000-\u001f\u007f]/g, '')}`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsStamp(e.start)}`,
        `DTEND:${icsStamp(end)}`,
        `SUMMARY:${icsText(e.summary)}`);
      if (e.location) L.push(`LOCATION:${icsText(e.location)}`);
      if (e.description) L.push(`DESCRIPTION:${icsText(e.description)}`);
      const url = icsUrl(e.url);
      if (url) L.push(`URL:${url}`);
      if (e.alarm) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.summary)}`, `TRIGGER${e.alarmRel === 'END' ? ';RELATED=END' : ''}:${e.alarm}`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  /** Deadline → event: the 30 min before the due time; the reminder counts back from the due time itself (TP-107). */
  function deadlineEvent(d, trig) {
    const summary = d.courseName ? `${d.courseName}: ${d.title}` : d.title;
    return { uid: `${d.key || hash(d.title + d.due)}@toledo-plus`, start: d.due - 30 * 60e3, end: d.due, summary, url: d.url, alarm: trig, alarmRel: 'END' };
  }
  /** KU Loket exam (TP.kuloket exam shape) → event titled "Examen: <course>" with the reminder (TP-105). */
  function examEvent(x, trig) {
    const loc = x.location || {};
    let c = null;
    try { c = x.courseLuId ? course(x.courseLuId) : null; } catch (_) { c = null; }
    const name = (c && c.name) || x.title || '';
    return {
      uid: `${String(x.id || hash(name + x.start)).replace(/[^\w.-]/g, '')}@toledoplus`,
      start: x.start, end: x.end,
      summary: `${tr('agenda.exam')}: ${name}`,
      location: [loc.room, loc.building && loc.building !== loc.room ? loc.building : '', loc.street, loc.city].filter(Boolean).join(', '),
      description: [x.courseCode, x.text, x.group, (x.teachers || []).join(', ')].filter(Boolean).join('\n'),
      url: loc.url, alarm: trig,
    };
  }

  /** UID = the deadline key (source id based since v1.2), so a moved deadline updates the same calendar event.
   *  opts.exams: KU Loket exams to add to the same file (bulk "Zet in agenda", TP-104). */
  function ics(list, opts = {}) {
    const trig = icsReminder();
    const evs = (list || []).filter((d) => d && d.due).map((d) => deadlineEvent(d, trig));
    for (const x of opts.exams || []) if (x && x.start) evs.push(examEvent(x, trig));
    return icsEvents(evs, { name: opts.name || 'Toledo+ deadlines' });
  }

  /** File name for a download: lowercase ASCII slug cut at a word boundary (≤ 60 chars, TP-017). */
  function icsName(title, fallback = 'toledo') {
    const s = String(title || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (s.length <= 60) return s || fallback;
    const cut = s.slice(0, 61);
    const i = cut.lastIndexOf('-');
    return (i >= 12 ? cut.slice(0, i) : s.slice(0, 60)).replace(/-$/, '') || fallback;
  }

  // ---------------------------------------------------------------- Ultra
  const BB = '/learn/api/public';
  const itemLink = (cid, contentId) => `${ULTRA}/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(cid)}&contentId=${encodeURIComponent(contentId)}`;
  const isFolder = (c) => !!(c && (c.hasChildren || /x-bb-(folder|lesson|module)/.test((c.contentHandler && c.contentHandler.id) || '')));
  const visible = (c) => c && !(c.availability && c.availability.available === 'No');
  // B5: complete results only, 10 min TTL, LRU of 5 courses. Map order = recency.
  const courseCache = new Map();   // cid → {p: Promise<result>, t}
  const courseData = new Map();    // cid → latest (possibly partial) result (for downloads/announcements)

  function clearCourseCache(cid) {
    if (cid) { courseCache.delete(cid); return; }
    courseCache.clear();
  }
  function remember(map, cid, v) {
    map.delete(cid); map.set(cid, v);
    while (map.size > COURSE_MAX) map.delete(map.keys().next().value);
  }

  /** Breadth-first walk of a course's content tree (in place: folders get .kids). One TP.util.pool per
   *  level keeps total concurrency at `n`; depth ≤ 6; unavailable items dropped. A folder that fails is
   *  retried in later rounds (backoff cfg.folderRetryMs); still failing → kids [] and failed:true.
   *  → number of folders that failed. */
  async function walkTree(cid, roots, n) {
    const base = `${BB}/v1/courses/${encodeURIComponent(cid)}`;
    let level = (roots || []).filter(isFolder);
    const depthOf = new Map(level.map((x) => [x, 1]));
    let failed = [];
    const fetchKids = async (node) => {
      try {
        node.kids = (await ultraPaged(`${base}/contents/${encodeURIComponent(node.id)}/children?limit=200`, 5)).filter(visible);
        delete node.failed;
        return true;
      } catch (e) {
        if (e && e.stale) markStale();
        node.kids = []; node.failed = true;
        return false;
      }
    };
    const walk = async (start) => {
      let lvl = start;
      while (lvl.length) {
        const next = [];
        await U().pool(lvl, n, async (node) => {
          if (!(await fetchKids(node))) { failed.push(node); return; }
          const d = depthOf.get(node) || 1;
          if (d < 6) for (const k of node.kids) if (isFolder(k)) { depthOf.set(k, d + 1); next.push(k); }
        });
        lvl = next;
      }
    };
    await walk(level);
    for (const ms of cfg.folderRetryMs) {
      if (!failed.length || stale) break;
      await sleep(ms);
      const retry = failed; failed = [];
      await walk(retry);
    }
    return failed.length;
  }

  /** Content tree only (no announcements/columns/staff), for the search index crawl. Default concurrency 2.
   *  Rejects when the top level can't be loaded (e.g. no Ultra session behind the relay). */
  async function ultraTree(cid, opts = {}) {
    const top = (await ultraPaged(`${BB}/v1/courses/${encodeURIComponent(cid)}/contents?limit=200`, 5)).filter(visible);
    await walkTree(cid, top, opts.concurrency || 2);
    return top;
  }

  /**
   * → { course, roots, announcements, deadlines, staff, partial, contentsError?, failedFolders }
   * contentsError: the top level of the content tree could not be loaded (roots is then [] and the
   * result is NOT cached, so the next call retries). failedFolders > 0: some folders stayed empty after
   * retries (marked node.failed); not cached either.
   */
  function ultraCourse(cid, onProgress) {
    const progress = (r) => { if (onProgress) { try { onProgress(r); } catch (e) { log('onProgress error', e); } } };
    const hit = courseCache.get(cid);
    if (hit && Date.now() - hit.t < COURSE_TTL) {
      remember(courseCache, cid, hit);
      const d = courseData.get(cid);
      if (d) progress(d);
      if (d && !d.partial) return hit.p;
      return hit.p.then((r) => { progress(r); return r; });
    }
    if (hit) courseCache.delete(cid);
    const p = (async () => {
      const base = `${BB}/v1/courses/${encodeURIComponent(cid)}`;
      const [meta, top, ann, cols, staff] = await Promise.allSettled([
        ultra(`${BB}/v3/courses/${encodeURIComponent(cid)}`),
        ultraPaged(`${base}/contents?limit=200`, 5),
        ultra(`${base}/announcements?limit=20`),
        ultraPaged(`${BB}/v2/courses/${encodeURIComponent(cid)}/gradebook/columns?limit=200`, 3),
        ultra(`${base}/users?role=Instructor&expand=user&limit=50`),
      ]);
      if (meta.status === 'rejected' && top.status === 'rejected') {
        if (top.reason && top.reason.stale) markStale();
        throw top.reason || meta.reason;
      }
      const m = meta.status === 'fulfilled' && meta.value ? meta.value : {};
      const result = {
        course: { id: m.id || cid, courseId: m.courseId || '', name: m.name || '' },
        roots: (top.status === 'fulfilled' ? top.value : []).filter(visible),
        announcements: arr(ann.status === 'fulfilled' ? ann.value : []).filter((a) => a && !a.draft)
          .sort((a, b) => toMs(b.created) - toMs(a.created)),
        deadlines: (cols.status === 'fulfilled' ? cols.value : [])
          .filter((c) => c && c.grading && c.grading.due)
          .map((c) => ({ title: c.name || '', due: toMs(c.grading.due), url: c.contentId ? itemLink(cid, c.contentId) : null }))
          .sort((a, b) => a.due - b.due),
        staff: arr(staff.status === 'fulfilled' ? staff.value : []).map((x) => x && x.user).filter(Boolean)
          .map((u) => ({ name: [u.name && u.name.given, u.name && u.name.family].filter(Boolean).join(' '), email: (u.contact && u.contact.email) || '' }))
          .filter((x) => x.name),
        partial: true,
        failedFolders: 0,
      };
      if (top.status === 'rejected') {
        const e = top.reason || {};
        result.contentsError = { status: e.status || 0, auth: !!e.auth, message: String(e.message || e) };
      }
      if (m.courseId && m.id) rememberCid(m.courseId, m.id);
      remember(courseData, cid, result);
      progress(result);

      result.failedFolders = await walkTree(cid, result.roots, 6);
      result.partial = false;
      progress(result);
      if (!result.contentsError && !result.failedFolders) emit('course', { cid, result });
      return result;
    })();
    const entry = { p, t: Date.now() };
    remember(courseCache, cid, entry);
    p.then((r) => {
      // Incomplete results are not cached: the next call (or ↻) retries.
      if ((r.contentsError || r.failedFolders) && courseCache.get(cid) === entry) courseCache.delete(cid);
    }, () => { if (courseCache.get(cid) === entry) courseCache.delete(cid); courseData.delete(cid); });
    return p;
  }

  function findNode(nodes, id) {
    for (const n of nodes || []) {
      if (n.id === id) return n;
      const k = findNode(n.kids, id);
      if (k) return k;
    }
    return null;
  }
  function cachedNode(cid, contentId) {
    const r = courseData.get(cid);
    return r ? findNode(r.roots, contentId) : null;
  }

  async function attachmentUrl(cid, contentId, fileName) {
    const r = await ultra(`${BB}/v1/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(contentId)}/attachments`);
    const list = arr(r);
    const a = (fileName && list.find((x) => x.fileName === fileName)) || list[0];
    return a ? { url: `${ULTRA}${BB}/v1/courses/${encodeURIComponent(cid)}/contents/${encodeURIComponent(contentId)}/attachments/${encodeURIComponent(a.id)}/download`, fileName: a.fileName } : null;
  }

  // Only http(s) may be opened (content handler URLs are teacher-supplied; never run javascript:/data:).
  // Note: window.open(…, 'noopener') ALWAYS returns null, so it can't be used to detect a blocked popup.
  function openUrl(win, url) {
    let u = null;
    try { u = new URL(String(url || '')); } catch (_) { u = null; }
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) { if (win && !win.closed) win.close(); return; }
    const href = u.href;
    if (win && !win.closed) { try { win.location.href = href; return; } catch (_) { /* fall through */ } }
    let w = null;
    try { w = window.open(href, '_blank'); } catch (_) { w = null; }
    if (w) { try { w.opener = null; } catch (_) { /* cross-origin already */ } return; }
    location.href = href; // popup blocked: navigate this tab instead of doing nothing
  }

  /** Download a file item: attachment → blob (default credentials) → <a download>. Never throws.
   *  → true (saved) | 'opened' (no blob possible here, e.g. on the portal: opened in a new tab instead) | false (failed; nothing
   *  opened — the caller says "Download mislukt", TP-085). */
  async function ultraDownload(cid, contentId, fileName) {
    const node = cachedNode(cid, contentId);
    const name = fileName || (node && node.contentHandler && node.contentHandler.file && node.contentHandler.file.fileName) || (node && node.title) || '';
    let att = null;
    try {
      att = await attachmentUrl(cid, contentId, name);
      if (!att) { openUrl(null, itemLink(cid, contentId)); return 'opened'; }
      // Only on the Ultra origin do we have the session cookie for the download endpoint.
      if (!net().isSameOrigin(att.url)) { openUrl(null, att.url); return 'opened'; }
      const blob = await net().blob(att.url);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name || att.fileName || 'download';
      a.rel = 'noopener';
      a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
      return true;
    } catch (e) {
      // No new tab here: it would show the same error (or, with the click's activation gone, navigate this tab away).
      log('download failed', e && e.status);
      return false;
    }
  }

  /** Open an item: file → its download URL in a new tab; external link → its URL; else the Ultra item. */
  async function ultraOpen(cid, contentId) {
    const node = cachedNode(cid, contentId);
    const h = (node && node.contentHandler) || {};
    if (h.id === 'resource/x-bb-externallink' && h.url) { openUrl(null, h.url); return; }
    if (node && h.id && h.id !== 'resource/x-bb-file') { openUrl(null, itemLink(cid, contentId)); return; }
    // Open a blank tab synchronously (keeps the click's user activation), then point it at the file.
    let win = null;
    try { win = window.open('', '_blank'); if (win) win.opener = null; } catch (_) { win = null; }
    try {
      const att = await attachmentUrl(cid, contentId);
      openUrl(win, att ? att.url : itemLink(cid, contentId));
    } catch (_) {
      openUrl(win, itemLink(cid, contentId));
    }
  }

  /** → {title, body (raw HTML — sanitize before rendering), created} */
  async function ultraAnnouncement(cid, aid) {
    const r = courseData.get(cid);
    const hit = r && r.announcements.find((a) => a.id === aid);
    if (hit) return { title: hit.title || '', body: hit.body || '', created: toMs(hit.created) };
    const a = await ultra(`${BB}/v1/courses/${encodeURIComponent(cid)}/announcements/${encodeURIComponent(aid)}`);
    return { title: (a && a.title) || '', body: (a && a.body) || '', created: toMs(a && a.created) };
  }

  // ---------------------------------------------------------------- announcement bodies (sheet)
  // Small in-memory caches (per tab, never persisted: notices stay off disk). Failures are never cached.
  const BODY_TTL = 30 * 60e3, BODY_MAX = 40;
  const bodyCache = new Map();     // key → {v, t}   (Map order = recency)
  const bodyInflight = new Map();  // key → Promise
  function memo(key, opts, fn) {
    const hit = bodyCache.get(key);
    if (!(opts && opts.force) && hit && Date.now() - hit.t < BODY_TTL) {
      bodyCache.delete(key); bodyCache.set(key, hit);
      return Promise.resolve(hit.v);
    }
    if (bodyInflight.has(key)) return bodyInflight.get(key);
    const p = Promise.resolve().then(fn).then((v) => {
      bodyCache.delete(key); bodyCache.set(key, { v, t: Date.now() });
      while (bodyCache.size > BODY_MAX) bodyCache.delete(bodyCache.keys().next().value);
      return v;
    }).finally(() => bodyInflight.delete(key));
    bodyInflight.set(key, p);
    return p;
  }

  /** Ultra course id + announcement id of a portal announcement event (url, else the event id 'ultra~_123_1'). */
  function annIds(e) {
    let s = String((e && e.url) || '');
    try { s = decodeURIComponent(s); } catch (_) { /* keep raw */ }
    const cid = (s.match(/\/courses\/(_\d+_\d+)/) || s.match(/course_?[iI]d=(_\d+_\d+)/) || [])[1] || null;
    const aid = (s.match(/announcements?\/(_\d+_\d+)/) || s.match(/announcement_?[iI]d=(_\d+_\d+)/) || [])[1]
      || (String((e && e.id) || '').match(/^ultra~(_\d+_\d+)$/) || [])[1] || null;
    return { cid, aid };
  }

  /** Full text of a course announcement (portal event) → {title, html (raw — sanitize before rendering), created, cid, aid}.
   *  Course id from the url, else resolved from the event's learning unit; announcement id from the url/event id, else the
   *  course's latest announcements are matched by title. Same origin on Ultra, relay on the portal. */
  async function announcementBody(e) {
    if (!e) throw Object.assign(new Error('no announcement'), { status: 0 });
    let { cid, aid } = annIds(e);
    if (!cid && e.sourceId && e.sourceId !== 'advalvas') cid = await resolveCourseId(e.sourceId);
    if (!cid) throw Object.assign(new Error('no course id'), { status: 404 });
    return memo(`u:${cid}:${aid || normTitle(e.title)}`, null, async () => {
      if (aid) {
        try {
          const a = await ultraAnnouncement(cid, aid);
          return { title: a.title, html: a.body, created: a.created, cid, aid };
        } catch (err) { if (!err || err.status !== 404) throw err; }
      }
      const want = normTitle(e.title);
      const list = arr(await ultra(`${BB}/v1/courses/${encodeURIComponent(cid)}/announcements?limit=50`)).filter((a) => a && !a.draft);
      const hit = list.find((a) => normTitle(a.title) === want);
      if (!hit) throw Object.assign(new Error('announcement not found'), { status: 404 });
      return { title: hit.title || '', html: hit.body || '', created: toMs(hit.created), cid, aid: hit.id };
    });
  }

  // ---------------------------------------------------------------- Ad Valvas (school notices)
  // The portal's Ad Valvas events link to a server-rendered page on the valvas host (verified live):
  //   GET /student/messages/{id}/external → #messageModalExternal (.modal-title, input#from, textarea#recipients,
  //   input#startDate "26/10/2026 13:23", attachment row, textarea#message = the body as escaped HTML).
  // Without a valvas session it redirects to the KU Leuven IdP: the relay answers error 'redirected' → needsLogin.
  // A top-level visit (new tab) lets SSO set the session; after that the relay can read it.
  const VALVAS = 'https://icts-p-toledo-valvas.cloud.icts.kuleuven.be';
  function valvasId(x) {
    if (x == null) return null;
    if (typeof x === 'number' || /^\d+$/.test(String(x))) return String(x);
    if (typeof x !== 'object') return (String(x).match(/^tol-valven~(\d+)$/) || [])[1] || null;
    try {
      const u = new URL(String(x.url || ''));
      const m = u.origin === VALVAS && u.pathname.match(/^\/student\/messages\/(\d+)(\/|$)/);
      if (m) return m[1];
    } catch (_) { /* no url */ }
    return (String(x.id || '').match(/^tol-valven~(\d+)$/) || [])[1] || null;
  }
  const advalvasUrl = (x) => { const id = valvasId(x); return id ? `${VALVAS}/student/messages/${id}/external` : null; };

  const needsLogin = (msg) => Object.assign(new Error(msg || 'Ad Valvas: sign-in needed'), { status: 0, auth: true, needsLogin: true });
  const nbsp = (s) => String(s == null ? '' : s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  /** "26/10/2026 13:23" → local ms (0 when unparseable). */
  function valvasDate(s) {
    const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return 0;
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }
  const PRESENTATIONAL = ['style', 'class', 'id', 'color', 'face', 'size', 'bgcolor', 'background', 'width', 'height', 'align', 'valign', 'border', 'cellpadding', 'cellspacing', 'dir', 'lang'];

  /** Parse an Ad Valvas message page (string) → {title, from, to, date, dateText, attachments:[{name,url}], html (sanitized)}.
   *  Never injects the page: DOMParser documents are inert. Throws needsLogin for a login/SAML page, an Error otherwise. */
  function parseAdvalvas(html, base) {
    base = base || VALVAS + '/';
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const box = doc.querySelector('#messageModalExternal') || doc.querySelector('.modal-content') || null;
    const msg = (box || doc).querySelector('textarea#message');
    const titleEl = (box || doc).querySelector('.modal-title');
    if (!box || (!msg && !titleEl)) {
      const login = doc.querySelector('input[name="SAMLRequest"], input[name="SAMLResponse"], input[type="password"], form[action*="idp" i], form[action*="saml" i], form[action*="login" i]');
      if (login || /idp\.kuleuven|shibboleth|single sign-on|aanmelden|log ?in/i.test(doc.title || '')) throw needsLogin();
      throw Object.assign(new Error('Ad Valvas: unexpected page'), { status: 0, parse: true });
    }
    const val = (sel) => { const el = box.querySelector(sel); return el ? nbsp(el.tagName === 'TEXTAREA' ? el.value || el.textContent : (el.getAttribute('value') || el.textContent)) : ''; };
    const abs = (h) => { try { const u = new URL(h, base); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (_) { return null; } };
    const dateText = val('#startDate');
    // Attachments: every link in the "Bijlage" row (markup varies), none when #attachmentMissing is the only content.
    const attachments = [];
    const labelRe = /^(bijlage|bijlagen|attachments?|pi[eè]ces? jointes?)\s*:?$/i;
    const label = [...box.querySelectorAll('label, dt, th, .control-label, strong, b, span, div')].find((el) => labelRe.test(nbsp(el.textContent)));
    let row = label ? (label.closest('.row, .form-group, tr, dl') || label.parentElement) : null;
    if (row && msg && row.contains(msg)) row = label.parentElement;
    let links = row ? [...row.querySelectorAll('a[href]')] : [];
    if (!links.length) links = [...box.querySelectorAll('a[href*="attachment" i], a[href*="bijlage" i], a[href*="download" i]')];
    for (const a of links) {
      const url = abs(a.getAttribute('href'));
      if (!url || attachments.some((x) => x.url === url)) continue;
      let name = nbsp(a.textContent) || nbsp(a.getAttribute('title')) || '';
      if (!name) { try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (_) { name = ''; } }
      attachments.push({ name: name || url, url });
    }
    // Body: escaped HTML inside the summernote textarea → own inert document; strip presentation, images and
    // relative links (absolutized against the valvas page — our sanitize would resolve them against Toledo), then sanitize.
    const body = new DOMParser().parseFromString(msg ? String(msg.value || msg.textContent || '') : '', 'text/html');
    body.querySelectorAll('img, picture, video, audio, source, svg, font[face=""]').forEach((n) => n.remove());
    body.querySelectorAll('font').forEach((f) => f.replaceWith(...f.childNodes));
    body.querySelectorAll('*').forEach((el) => {
      for (const a of PRESENTATIONAL) el.removeAttribute(a);
      if (el.tagName === 'A') {
        const h = el.getAttribute('href');
        const u = h && !/^(mailto|tel):/i.test(h.trim()) ? abs(h) : h;
        if (u) el.setAttribute('href', u); else el.removeAttribute('href');
      }
    });
    return {
      title: nbsp(titleEl ? titleEl.textContent : ''),
      from: val('#from'),
      to: val('#recipients'),
      date: valvasDate(dateText),
      dateText,
      attachments,
      html: U().sanitize(body.body ? body.body.innerHTML : ''),
    };
  }
  let valvasParser = parseAdvalvas; // unit tests swap it (no DOM in node)

  /** → Promise<{id, url, title, from, to, date, dateText, attachments, html}>. Errors: .needsLogin (no valvas session:
   *  open advalvasUrl() top-level once, then retry), .noId, or a network/parse error. 30 min in-memory cache, failures not cached. */
  function advalvasMessage(x, opts = {}) {
    const id = valvasId(x);
    if (!id) return Promise.reject(Object.assign(new Error('no Ad Valvas id'), { status: 0, noId: true }));
    const url = advalvasUrl(id);
    return memo('v:' + id, opts, async () => {
      let html;
      try {
        html = await net().text(url, { headers: { Accept: 'text/html' } });
      } catch (e) {
        if (e && e.stale) markStale();
        if (e && e.auth) e.needsLogin = true; // redirected to the IdP (relay 'redirected') or 401/403
        throw e;
      }
      return Object.assign(valvasParser(html, url), { id, url });
    });
  }

  /** Undo a read mark: events read:false + out of the local read-set and the pending queue. With sync on, a best-effort
   *  PATCH read:false (Toledo may ignore it; then the next refresh shows the item as read again). → bool */
  function markUnread(events) {
    const list = (Array.isArray(events) ? events : [events]).filter((e) => e && e.id != null);
    if (!list.length) return Promise.resolve(true);
    const ids = new Set(list.map((e) => e.id));
    const ev = peek('events');
    if (Array.isArray(ev)) mutate('events', ev.map((e) => (ids.has(e.id) && e.read ? Object.assign({}, e, { read: false }) : e)));
    const gone = Object.fromEntries(list.map((e) => [e.id, null]));
    setState({ read: gone, pendingRead: gone });
    if (!((S().sync || {}).markReadInToledo)) return Promise.resolve(true);
    return track(net().json(PORTAL + '/portal/api/batch/events', { method: 'PATCH', body: list.map((e) => ({ id: e.id, type: e.type, subType: e.subType, read: false })) })
      .then(() => true, (e) => { if (e && e.stale) markStale(); log('markUnread sync failed', e && e.status); return false; }));
  }

  function rememberCid(luId, cid) {
    if ((ST().cidMap || {})[luId] === cid) return;
    setState({ cidMap: { [luId]: cid } });
  }

  const cidInflight = {};
  function resolveCourseId(luId) {
    const known = (ST().cidMap || {})[luId];
    if (known) return Promise.resolve(known);
    if (cidInflight[luId]) return cidInflight[luId];
    const p = ultra(`${BB}/v3/courses/courseId:${encodeURIComponent(luId)}`).then((c) => {
      if (!c || !c.id) throw Object.assign(new Error('course not found'), { status: 404 });
      rememberCid(luId, c.id);
      return c.id;
    }).finally(() => { delete cidInflight[luId]; });
    cidInflight[luId] = p;
    return p;
  }

  // ---------------------------------------------------------------- user's first name (greeting)
  // Source: Blackboard Ultra `GET /learn/api/public/v1/users/me` → name.given (same origin on Ultra, relay on
  // the portal; no portal profile endpoint is known). Cached in state.me = {given, t} (chrome.storage.local,
  // never synced, never sent anywhere – telemetry/feedback don't read it). Refreshed at most once a week;
  // one attempt per tab after a failure. Failure is silent and does not touch the session/auth state.
  const ME_TTL = 7 * DAY;
  let meTried = false;
  let meInflight = null;
  function firstName(u) {
    const n = (u && u.name) || {};
    const raw = typeof n.given === 'string' && n.given.trim() ? n.given : '';
    // first given name only ("Alex Jan" → "Alex"), no control characters, bounded length
    const first = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().split(/\s+/)[0] || '';
    return first.slice(0, 40);
  }
  function userName() {
    const me = ST().me;
    return me && typeof me.given === 'string' ? me.given : '';
  }
  function loadUser(opts = {}) {
    if (meInflight) return meInflight;
    const me = ST().me || {};
    if (!opts.force && ((me.given && me.t && Date.now() - me.t < ME_TTL) || meTried)) return Promise.resolve(userName());
    if (stale) return Promise.resolve(userName());
    meTried = true;
    meInflight = ultra(BB + '/v1/users/me')
      .then((u) => {
        const given = firstName(u);
        if (given && (given !== me.given || !me.t || Date.now() - me.t > DAY)) setState({ me: { given, t: Date.now() } });
        return given || userName();
      })
      .catch(() => userName())
      .finally(() => { meInflight = null; });
    return meInflight;
  }

  TP.data = {
    KEYS, HORIZON,
    init, peek, load, refresh, maybeRefresh, flush, wipeLocal, lastUpdated, status: getStatus, on, off,
    authExpired: () => authExpired, loginUrl, isStale: () => stale,
    ultraAuthExpired: () => ultraAuth, ultraLoginUrl: () => `${ULTRA}/ultra/course`,
    courses, course, feed, kindOf, deadlines, calendarItems, announcements, schedule, link, quickLinks,
    markRead, markFeedSeen, markAllRead, setPinned, toggleDone, setDone, addCustomDeadline, updateCustomDeadline, removeCustomDeadline, addRecent,
    ics, icsEvents, icsName, icsReminder,
    userName, loadUser,
    ultraCourse, ultraTree, ultraDownload, ultraOpen, ultraAnnouncement, resolveCourseId, clearCourseCache, ultraItemUrl: itemLink,
    announcementBody, annIds, advalvasMessage, advalvasUrl, advalvasId: valvasId, markUnread, VALVAS,
    // exposed for unit tests only
    _test: {
      hash, normTitle, parseCalendarName, mapCalendarItem, icsFold, icsText, icsStamp, legacyKey, toledoKey, ultraKey,
      trimEntry, calWindows, firstName, migrateDoneKeys, pruneState, flushPendingRead, markStale, cfg,
      parseAdvalvas, valvasDate, setValvasParser(fn) { valvasParser = fn || parseAdvalvas; }, bodyCacheSize: () => bodyCache.size,
      _reset() { mem = {}; courseCache.clear(); courseData.clear(); bodyCache.clear(); bodyInflight.clear(); aliasMap = new Map(); wantDays = 0; lazyAt = 0; lazyDays = 0; authExpired = false; ultraAuth = false; meTried = false; meInflight = null; wipedAt = 0; for (const k of Object.keys(status)) delete status[k]; },
      _put(k, v, extra) { mem[k] = Object.assign({ v, t: Date.now(), rev: 0 }, extra || {}); },
      _entry(k) { return mem[k]; },
      courseCacheSize: () => courseCache.size,
    },
  };
})();
