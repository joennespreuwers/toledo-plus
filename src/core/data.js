/* Toledo+ — TP.data: loading, cache, models and mutations.
   Stale-while-revalidate: everything renders from the cache (chrome.storage.local 'cache' = {key:{v,t}})
   and is refreshed in the background. Models are pure functions of cache + settings + state. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const PORTAL = 'https://toledo.kuleuven.be';
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const DAY = 864e5;
  const KEYS = ['enrollments', 'events', 'upcoming', 'mail', 'links', 'ultraDeadlines'];
  const PORTAL_KEYS = ['enrollments', 'events', 'upcoming', 'mail', 'links'];
  const MAX_EVENTS = 600;          // newest events kept in the persisted cache
  const MAX_CACHE_CHARS = 4e6;     // chrome.storage.local quota is 10 MB; stay well below
  const FRESH_MS = 30e3;           // load() without force reuses data younger than this
  const GRAPHITE = '#8E8E93';

  // ---------------------------------------------------------------- small helpers
  const S = () => (TP.settings && TP.settings.get ? TP.settings.get() : {}) || {};
  const ST = () => (TP.state && TP.state.get ? TP.state.get() : {}) || {};
  const U = () => TP.util || {};
  const log = (...a) => { try { console.debug('[Toledo+]', ...a); } catch (_) { /* noop */ } };

  const courseName = (s) => (U().courseName ? U().courseName(s) : String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^-\s*/, ''));
  const courseCode = (s) => (U().courseCode ? U().courseCode(s) : ((String(s || '').match(/\[([^\]]+)\]\s*$/) || [])[1] || ''));
  const colorForIndex = (n) => (U().colorForIndex ? U().colorForIndex(n) : GRAPHITE);
  const palette = () => U().PALETTE || {};
  const dayKey = (ms) => {
    if (TP.fmt && TP.fmt.dayKey) return TP.fmt.dayKey(ms);
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const toMs = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const arr = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.results) ? v.results : []));
  const debounce = (fn, ms) => {
    if (U().debounce) return U().debounce(fn, ms);
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  async function pool(items, n, fn) {
    if (U().pool) return U().pool(items, n, fn);
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
    }));
    return out;
  }
  const net = () => {
    if (!TP.net) throw Object.assign(new Error('TP.net missing'), { status: 0 });
    return TP.net;
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

  /** "ULTRA-B-N50265-2627: Filmtaal 1 [N50265]" → {luId:'ULTRA-B-N50265-2627', title:'Filmtaal 1 [N50265]'} */
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

  // ---------------------------------------------------------------- cache
  let mem = {};                     // {key:{v,t}}
  const status = {};                // {key:{loading, error, t}}
  const inflight = {};

  function storageGet(k) {
    return new Promise((res) => {
      try { chrome.storage.local.get(k, (o) => res((o && o[k]) || null)); } catch (_) { res(null); }
    });
  }

  function trimForStorage(c) {
    const out = {};
    for (const k of KEYS) {
      if (!c[k]) continue;
      out[k] = c[k];
      if (k === 'events' && Array.isArray(c[k].v) && c[k].v.length > MAX_EVENTS) {
        out[k] = { v: c[k].v.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, MAX_EVENTS), t: c[k].t };
      }
    }
    try {
      if (JSON.stringify(out).length > MAX_CACHE_CHARS) { delete out.events; log('cache too large, events not persisted'); }
    } catch (_) { /* ignore */ }
    return out;
  }

  const persist = debounce(() => {
    try { chrome.storage.local.set({ cache: trimForStorage(mem) }); } catch (e) { log('cache write failed', e); }
  }, 400);

  function put(key, v) {
    mem[key] = { v, t: Date.now() };
    persist();
    emit('change', key);
  }

  let initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const c = await storageGet('cache');
      if (c && typeof c === 'object') {
        for (const k of KEYS) if (c[k] && 'v' in c[k]) mem[k] = { v: c[k].v, t: c[k].t || 0 };
      }
      // Keep tabs in sync: another tab refreshed → take its newer data.
      try {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local' || !changes.cache || !changes.cache.newValue) return;
          const nv = changes.cache.newValue;
          for (const k of KEYS) {
            if (nv[k] && (!mem[k] || (nv[k].t || 0) > (mem[k].t || 0))) { mem[k] = nv[k]; emit('change', k); }
          }
        });
      } catch (_) { /* not in extension context (tests) */ }
    })();
    return initPromise;
  }

  function peek(key) { return mem[key] ? mem[key].v : null; }
  function stamp(key) { return mem[key] ? mem[key].t : null; }
  function lastUpdated() {
    const ts = ['enrollments', 'events'].map(stamp).filter(Boolean);
    return ts.length ? Math.max(...ts) : null;
  }
  function getStatus(key) { return Object.assign({ loading: false, error: null, t: stamp(key) }, status[key] || {}); }

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

  async function loadUltraDeadlines() {
    const horizon = Number((S().deadlines || {}).horizonDays) || 42;
    const from = Date.now() - 7 * DAY;
    const until = Date.now() + horizon * DAY;
    const windows = [];
    for (let a = from; a < until; a += 60 * DAY) windows.push([a, Math.min(a + 60 * DAY, until)]);
    const items = [];
    for (const [a, b] of windows) {
      const q = `/learn/api/public/v1/calendars/items?since=${encodeURIComponent(new Date(a).toISOString())}&until=${encodeURIComponent(new Date(b).toISOString())}&limit=100`;
      items.push(...await ultraPaged(q));
    }
    const seen = new Set();
    const out = [];
    for (const it of items) {
      if (it.type !== 'GradebookColumn') continue;
      const d = mapCalendarItem(it);
      if (!d.due || !d.title) continue;
      const k = d.id || d.title + d.due;
      if (seen.has(k)) continue;
      seen.add(k); out.push(d);
    }
    // Free luId → cid mappings for resolveCourseId().
    const known = ST().cidMap || {};
    const add = {};
    for (const d of out) if (d.courseLuId && d.cid && !known[d.courseLuId]) add[d.courseLuId] = d.cid;
    if (Object.keys(add).length && TP.state && TP.state.set) TP.state.set({ cidMap: add }).catch(() => {});
    return out.sort((a, b) => a.due - b.due);
  }

  const LOADERS = {
    enrollments: () => portal('enrollments').then(arr),
    events: () => portal('events').then(arr),
    upcoming: () => portal('upcoming').then(arr),
    mail: () => portal('emails/unread').then((r) => (r && typeof r.value === 'number' ? r.value : null)),
    links: () => portal('links').then(arr),
    ultraDeadlines: loadUltraDeadlines,
  };

  const warned = new Set();
  function load(key, opts = {}) {
    if (!LOADERS[key]) return Promise.reject(Object.assign(new Error('unknown key ' + key), { status: 0 }));
    if (inflight[key]) return inflight[key];
    if (!opts.force && mem[key] && Date.now() - mem[key].t < FRESH_MS) return Promise.resolve(mem[key].v);
    status[key] = { loading: true, error: null };
    const p = (async () => {
      try {
        const v = await LOADERS[key]();
        status[key] = { loading: false, error: null };
        put(key, v);
        return v;
      } catch (e) {
        status[key] = { loading: false, error: e };
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

  /** Loads all portal keys + ultraDeadlines (best-effort). Never rejects. → {ok, errors:{key:Error}} */
  async function refresh() {
    const keys = PORTAL_KEYS.concat('ultraDeadlines');
    const res = await Promise.allSettled(keys.map((k) => load(k, { force: true })));
    const errors = {};
    res.forEach((r, i) => { if (r.status === 'rejected') errors[keys[i]] = r.reason; });
    return { ok: !errors.enrollments && !errors.events, errors };
  }

  // ---------------------------------------------------------------- models
  function courseSettings(luId) {
    if (TP.settings && TP.settings.course) return TP.settings.course(luId) || {};
    const it = ((S().courses || {}).items || {})[luId] || {};
    return Object.assign({ nickname: '', color: null, hidden: false, pinned: null }, it);
  }

  /** Pinned == Toledo favourite: an explicit choice wins; otherwise, while favourites sync with
   *  Toledo, a Toledo favourite counts as pinned. */
  function isPinned(cs, en) {
    if (cs.pinned === true || cs.pinned === false) return cs.pinned;
    return !!((S().sync || {}).favoritesToToledo && en && en.favorite);
  }

  function resolveColor(luId, toledoIndex) {
    const cs = courseSettings(luId);
    const pal = palette();
    if (cs.color) {
      if (pal[cs.color]) return { color: pal[cs.color], colorKey: cs.color };
      if (/^#[0-9a-f]{3,8}$/i.test(cs.color)) return { color: cs.color, colorKey: null };
    }
    const hex = colorForIndex(toledoIndex);
    if (U().colorKeyForIndex) return { color: hex, colorKey: U().colorKeyForIndex(toledoIndex) };
    const key = Object.keys(pal).find((k) => String(pal[k]).toLowerCase() === String(hex).toLowerCase()) || null;
    return { color: hex, colorKey: key };
  }

  function eventTime(e) { return toMs(e.date); }

  /** Feed rules, without the hidden-course filter (Course.unread uses these too). */
  function feedEligible(e, s, st) {
    if (!e || e.type !== 'notifications') return false;
    if (e.read || e.dismissed) return false;
    if (e.subType === 'due' || e.subType === 'course') return false;
    if (e.subType === 'announcement' && !((s.feed || {}).includeAnnouncements)) return false;
    if (e.subType === 'advalvas') return false;
    return eventTime(e) > (st.feedSeenAt || 0);
  }

  function buildCourse(en, unreadBy, latestBy) {
    const luId = en.learningUnitId;
    const cs = courseSettings(luId);
    const { color, colorKey } = resolveColor(luId, en.color);
    return {
      luId,
      enrollmentId: en.id,
      title: en.title || '',
      name: (cs.nickname && String(cs.nickname).trim()) || courseName(en.title),
      code: courseCode(en.title),
      color, colorKey,
      semester: en.semester || 'UNKNOWN',
      year: en.academicYear || 0,
      type: en.type || 'course',
      favorite: !!en.favorite,
      pinned: isPinned(cs, en),
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
    for (const e of peek('events') || []) {
      if (!e || !e.sourceId) continue;
      if (feedEligible(e, s, st)) unreadBy[e.sourceId] = (unreadBy[e.sourceId] || 0) + 1;
      if (e.subType !== 'due' && e.subType !== 'course' && !e.dismissed) {
        const t = eventTime(e);
        if (t <= Date.now() && t > (latestBy[e.sourceId] || 0)) latestBy[e.sourceId] = t;
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
   * opts.currentOnly (default true). Sorted: pinned first, then per settings.courses.sort.
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
    return list.sort((a, b) => (b.pinned - a.pinned) || (a.type === b.type ? 0 : a.type === 'course' ? -1 : 1) || cmp(a, b));
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
      if (h === 'resource/x-bb-externallink') return 'link';
      if (/lti-link/.test(h)) return 'tool';
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
    return list.sort((a, b) =>
      ((b.course && b.course.pinned ? 1 : 0) - (a.course && a.course.pinned ? 1 : 0)) ||
      ((soon.has(b.luId) ? 1 : 0) - (soon.has(a.luId) ? 1 : 0)) ||
      (b.latest - a.latest));
  }

  function deadlineKey(title, luId, due) { return 'd' + hash(normTitle(title) + '|' + (luId || '') + '|' + dayKey(due)); }

  /** opts.includeDone (default false), opts.horizonDays (default settings.deadlines.horizonDays). Window: now−7d … now+horizon. */
  function deadlines(opts = {}) {
    const s = S(), st = ST();
    const horizon = opts.horizonDays != null ? Number(opts.horizonDays) : (Number((s.deadlines || {}).horizonDays) || 42);
    const now = Date.now();
    const from = now - 7 * DAY, until = now + horizon * DAY;
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    const done = st.done || {};
    const out = new Map();
    const inWindow = (t) => t && t >= from && t <= until;
    const meta = (luId, fallbackTitle) => {
      const c = byLu[luId];
      return { courseName: c ? c.name : courseName(fallbackTitle || ''), color: c ? c.color : GRAPHITE };
    };

    for (const e of peek('events') || []) {
      if (!e || e.subType !== 'due' || e.dismissed) continue;
      const due = eventTime(e);
      if (!inWindow(due)) continue;
      const key = deadlineKey(e.title, e.sourceId, due);
      if (out.has(key)) continue;
      out.set(key, Object.assign({ key, title: e.title || '', courseLuId: e.sourceId || '', due, url: e.url || null, source: 'toledo' }, meta(e.sourceId, e.source)));
    }
    for (const d of peek('ultraDeadlines') || []) {
      if (!inWindow(d.due)) continue;
      const key = deadlineKey(d.title, d.courseLuId, d.due);
      const prev = out.get(key);
      if (prev) { if (!prev.url && d.url) prev.url = d.url; continue; }
      out.set(key, Object.assign({ key, title: d.title, courseLuId: d.courseLuId || '', due: d.due, url: d.url || null, source: 'ultra' }, meta(d.courseLuId, d.courseTitle)));
    }
    for (const c of Array.isArray(s.custom) ? s.custom : []) {
      const due = toMs(c.due);
      if (!c || !c.id || !inWindow(due)) continue;
      const key = 'c' + hash(c.id);
      const m = c.courseLuId ? meta(c.courseLuId, '') : { courseName: '', color: GRAPHITE };
      // Custom items are never deduped away (the student must be able to remove them).
      out.set(key, Object.assign({ key, title: c.title || '', courseLuId: c.courseLuId || '', due, url: null, source: 'custom', customId: c.id }, m));
    }
    const list = [...out.values()].map((d) => Object.assign(d, { done: !!done[d.key] }));
    return list.filter((d) => opts.includeDone || !d.done).sort((a, b) => a.due - b.due || a.title.localeCompare(b.title));
  }

  function announcements(opts = {}) {
    const filter = opts.filter || 'all';
    const byLu = Object.fromEntries(allCourses().map((c) => [c.luId, c]));
    return (peek('events') || []).filter((e) => {
      if (!e || e.dismissed) return false;
      const isAnn = e.subType === 'announcement', isAdv = e.subType === 'advalvas' || e.type === 'advalvas';
      if (!isAnn && !isAdv) return false;
      if (isAnn && byLu[e.sourceId] && byLu[e.sourceId].hidden) return false;
      if (filter === 'courses') return isAnn;
      if (filter === 'school') return isAdv;
      if (filter === 'unread') return !e.read;
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
  async function markRead(events) {
    const list = (Array.isArray(events) ? events : [events]).filter((e) => e && e.id != null);
    if (!list.length) return true;
    const ids = new Set(list.map((e) => e.id));
    const ev = peek('events');
    if (Array.isArray(ev)) {
      mem.events = { v: ev.map((e) => (ids.has(e.id) ? Object.assign({}, e, { read: true }) : e)), t: mem.events.t };
      persist();
      emit('change', 'events');
    }
    if (!((S().sync || {}).markReadInToledo)) return true;
    try {
      await net().json(PORTAL + '/portal/api/batch/events', {
        method: 'PATCH',
        body: list.map((e) => ({ id: e.id, type: e.type, subType: e.subType, read: true })),
      });
      return true;
    } catch (e) {
      log('markRead sync failed', e && e.status);
      return false;
    }
  }

  async function markFeedSeen() {
    const items = feed().flatMap((g) => g.items);
    try { await TP.state.set({ feedSeenAt: Date.now() }); } catch (e) { log('state write failed', e); }
    emit('change', 'state');
    if ((S().sync || {}).markReadInToledo && items.length) return markRead(items);
    return true;
  }

  async function setFavorite(luId, fav) {
    const en = peek('enrollments');
    const row = Array.isArray(en) ? en.find((e) => e.learningUnitId === luId) : null;
    if (!row) return false;
    mem.enrollments = { v: en.map((e) => (e === row ? Object.assign({}, e, { favorite: !!fav }) : e)), t: mem.enrollments.t };
    persist();
    emit('change', 'enrollments');
    if (!((S().sync || {}).favoritesToToledo)) return true;
    try {
      await net().json(`${PORTAL}/portal/api/enrollments/${encodeURIComponent(row.id)}`, { method: 'PATCH', body: { favorite: !!fav } });
      return true;
    } catch (e) {
      log('favorite sync failed', e && e.status);
      return false;
    }
  }

  /** Pin/unpin a course (sidebar "Pinned" group, first in lists). While sync.favoritesToToledo is on
   *  this is also the course's Toledo favourite. → false only when the Toledo sync failed. */
  async function setPinned(luId, pinned) {
    if (!luId) return false;
    pinned = !!pinned;
    Promise.resolve(TP.settings.setCourse(luId, { pinned })).catch((e) => log('settings write failed', e));
    emit('change', 'settings');
    if (!((S().sync || {}).favoritesToToledo)) return true;
    return setFavorite(luId, pinned);
  }

  async function toggleDone(key) {
    const next = !((ST().done || {})[key]);
    // TP.state.set deep-merges; null deletes the map entry.
    await TP.state.set({ done: { [key]: next ? true : null } });
    emit('change', 'state');
    return next;
  }

  async function addCustomDeadline({ title, courseLuId, due }) {
    const id = U().uid ? U().uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const item = { id, title: String(title || '').trim(), courseLuId: courseLuId || '', due: toMs(due) };
    const custom = (Array.isArray(S().custom) ? S().custom : []).concat(item);
    await TP.settings.set({ custom });
    emit('change', 'settings');
    return item;
  }

  async function removeCustomDeadline(id) {
    const custom = (Array.isArray(S().custom) ? S().custom : []).filter((c) => c.id !== id);
    await TP.settings.set({ custom });
    emit('change', 'settings');
  }

  async function addRecent(item) {
    if (!item || !item.url) return;
    const entry = { title: item.title || '', url: item.url, courseName: item.courseName || '', courseLuId: item.courseLuId || '', kind: item.kind || 'page', ts: Date.now() };
    const recent = [entry].concat((ST().recent || []).filter((r) => r && r.url !== item.url)).slice(0, 12);
    try { await TP.state.set({ recent }); } catch (e) { log('state write failed', e); }
    emit('change', 'state');
  }

  // ---------------------------------------------------------------- ICS
  const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsText = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
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

  function ics(list) {
    const reminder = (S().deadlines || {}).reminder || 'none';
    const trig = TRIGGER[reminder];
    const now = icsStamp(Date.now());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Toledo+//Deadlines//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Toledo+ deadlines'];
    for (const d of list || []) {
      if (!d || !d.due) continue;
      const summary = d.courseName ? `${d.courseName}: ${d.title}` : d.title;
      L.push('BEGIN:VEVENT',
        `UID:${d.key || hash(d.title + d.due)}@toledo-plus`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsStamp(d.due - 30 * 60e3)}`,
        `DTEND:${icsStamp(d.due)}`,
        `SUMMARY:${icsText(summary)}`);
      if (d.url && /^https?:\/\/[^\s]+$/i.test(d.url)) L.push(`URL:${d.url}`);
      if (trig) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, `TRIGGER:${trig}`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- Ultra
  const BB = '/learn/api/public';
  const itemLink = (cid, contentId) => `${ULTRA}/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(cid)}&contentId=${encodeURIComponent(contentId)}`;
  const isFolder = (c) => !!(c && (c.hasChildren || /x-bb-(folder|lesson|module)/.test((c.contentHandler && c.contentHandler.id) || '')));
  const visible = (c) => c && !(c.availability && c.availability.available === 'No');
  const courseCache = new Map();   // cid → Promise<result>
  const courseData = new Map();    // cid → latest (possibly partial) result

  function ultraCourse(cid, onProgress) {
    const progress = (r) => { if (onProgress) { try { onProgress(r); } catch (e) { log('onProgress error', e); } } };
    if (courseCache.has(cid)) {
      const p = courseCache.get(cid);
      const d = courseData.get(cid);
      if (d) progress(d);
      if (d && !d.partial) return p;
      return p.then((r) => { progress(r); return r; });
    }
    const p = (async () => {
      const base = `${BB}/v1/courses/${encodeURIComponent(cid)}`;
      const [meta, top, ann, cols, staff] = await Promise.allSettled([
        ultra(`${BB}/v3/courses/${encodeURIComponent(cid)}`),
        ultraPaged(`${base}/contents?limit=200`, 5),
        ultra(`${base}/announcements?limit=20`),
        ultraPaged(`${BB}/v2/courses/${encodeURIComponent(cid)}/gradebook/columns?limit=200`, 3),
        ultra(`${base}/users?role=Instructor&expand=user&limit=50`),
      ]);
      if (meta.status === 'rejected' && top.status === 'rejected') throw meta.reason;
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
      };
      if (m.courseId && m.id) rememberCid(m.courseId, m.id);
      courseData.set(cid, result);
      progress(result);

      // Breadth-first walk: one TP.util.pool per level keeps total concurrency at 6.
      let level = result.roots.filter(isFolder);
      for (let depth = 1; level.length && depth <= 6; depth++) {
        const next = [];
        await pool(level, 6, async (node) => {
          try {
            node.kids = (await ultraPaged(`${base}/contents/${encodeURIComponent(node.id)}/children?limit=200`, 5)).filter(visible);
          } catch (_) { node.kids = []; }
          for (const k of node.kids) if (isFolder(k)) next.push(k);
        });
        level = next;
      }
      result.partial = false;
      progress(result);
      return result;
    })();
    courseCache.set(cid, p);
    p.catch(() => { courseCache.delete(cid); courseData.delete(cid); });
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

  /** Download a file item: attachment → blob (default credentials) → <a download>. Never throws; → true when saved. */
  async function ultraDownload(cid, contentId, fileName) {
    const node = cachedNode(cid, contentId);
    const name = fileName || (node && node.contentHandler && node.contentHandler.file && node.contentHandler.file.fileName) || (node && node.title) || '';
    let att = null;
    try {
      att = await attachmentUrl(cid, contentId, name);
      if (!att) { openUrl(null, itemLink(cid, contentId)); return false; }
      // Only on the Ultra origin do we have the session cookie for the download endpoint.
      if (!net().isSameOrigin(att.url)) { openUrl(null, att.url); return false; }
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
      log('download failed', e && e.status);
      openUrl(null, att ? att.url : itemLink(cid, contentId));
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

  function rememberCid(luId, cid) {
    if ((ST().cidMap || {})[luId] === cid || !TP.state || !TP.state.set) return;
    TP.state.set({ cidMap: { [luId]: cid } }).catch(() => {});
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

  TP.data = {
    KEYS,
    init, peek, load, refresh, lastUpdated, status: getStatus, on, off,
    courses, course, feed, kindOf, deadlines, announcements, schedule, link, quickLinks,
    markRead, markFeedSeen, setFavorite, setPinned, toggleDone, addCustomDeadline, removeCustomDeadline, addRecent, ics,
    ultraCourse, ultraDownload, ultraOpen, ultraAnnouncement, resolveCourseId, ultraItemUrl: itemLink,
    // exposed for unit tests only
    _test: { hash, normTitle, parseCalendarName, mapCalendarItem, icsFold, icsText, icsStamp, deadlineKey, trimForStorage,
      _reset() { mem = {}; courseCache.clear(); courseData.clear(); }, _put(k, v) { mem[k] = { v, t: Date.now() }; } },
  };
})();
