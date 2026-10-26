/* Toledo+ — TP.settings (chrome.storage.sync 'settings' + 'custom') and TP.state (chrome.storage.local 'state').
   Settings deep-merge over DEFAULTS; writes are applied in memory + notified immediately,
   then persisted (debounced, to stay under storage.sync write quotas). Custom deadlines live in
   settings.custom in memory but are stored under their own sync key 'custom', so they never push
   the 'settings' item over the 8 KB per-item quota. Each item falls back to storage.local
   ('settingsLocal' / 'customLocal') when storage.sync refuses it. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const DEFAULTS = {
    v: 2,
    language: 'system',
    appearance: 'system',
    accent: 'blue',
    density: 'standard',
    startPage: 'overview',
    wrap: { portal: true, courses: true, deepBar: true },
    overview: { sections: [{ id: 'deadlines', on: true }, { id: 'new', on: true }, { id: 'recent', on: true }, { id: 'courses', on: true },
      { id: 'schedule', on: true }, { id: 'announcements', on: true }, { id: 'links', on: false }] },
    feed: { includeAnnouncements: false, maxCourses: 5 },
    deadlines: { horizonDays: 42, urgentDays: 3, reminder: '1d' },
    courses: { sort: 'activity', showCommunities: false, items: {} },
    sync: { markReadInToledo: true, favoritesToToledo: true },
    custom: [],
  };
  // pinned: null = no explicit choice (a Toledo favourite then counts as pinned while
// sync.favoritesToToledo is on); true/false = the student's own choice.
  const COURSE_DEFAULTS = { nickname: '', color: null, hidden: false, pinned: null };
  const STATE_DEFAULTS = { visits: {}, feedSeenAt: 0, done: {}, recent: [], cache: {} };

  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  // Deep merge: plain objects merge recursively, arrays and scalars replace, undefined is skipped.
  // With `nullDeletes`, a null value removes the key (used by TP.state for map entries).
  function merge(target, patch, nullDeletes = false) {
    if (!isObj(patch)) return clone(patch);
    const out = isObj(target) ? { ...target } : {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v === null && nullDeletes) { delete out[k]; continue; }
      out[k] = isObj(v) ? merge(out[k], v, nullDeletes) : clone(v);
    }
    return out;
  }

  // Deep freeze for read-only snapshots.
  function freeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); }
    return o;
  }

  const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.storage;
  const area = (name) => (hasChrome() ? chrome.storage[name] : null);
  const sget = (name, key) => new Promise((res) => {
    try { area(name).get(key, (v) => { void chrome.runtime?.lastError; res(v || {}); }); } catch (_) { res({}); }
  });
  const sset = (name, obj) => new Promise((res, rej) => {
    try {
      area(name).set(obj, () => { const e = chrome.runtime?.lastError; e ? rej(new Error(e.message)) : res(); });
    } catch (e) { rej(e); }
  });

  // Fill in sections that a stored (older) list doesn't know about; drop unknown ids.
  function normalize(s) {
    const known = DEFAULTS.overview.sections.map((x) => x.id);
    const list = Array.isArray(s.overview?.sections) ? s.overview.sections.filter((x) => x && known.includes(x.id)) : [];
    const seen = new Set();
    const clean = list.filter((x) => !seen.has(x.id) && seen.add(x.id)).map((x) => ({ id: x.id, on: x.on !== false }));
    for (const d of DEFAULTS.overview.sections) if (!seen.has(d.id)) clean.push({ ...d });
    s.overview = { ...s.overview, sections: clean };
    if (!Array.isArray(s.custom)) s.custom = [];
    s.v = DEFAULTS.v; // older shapes (imports, other tabs) are normalized to the current version
    if (!isObj(s.courses.items)) s.courses.items = {};
    return s;
  }

  // storage.sync allows 8 KB per item: drop per-course fields that equal the defaults (course()
  // merges them back) and course entries left empty, so many courses still fit. If it still fails,
  // persist() falls back to storage.local.
  function compact(s) {
    if (s) delete s.custom; // stored under its own key
    const items = s && s.courses && s.courses.items;
    if (isObj(items)) {
      for (const [lu, it] of Object.entries(items)) {
        if (!isObj(it)) { delete items[lu]; continue; }
        for (const [k, v] of Object.entries(it)) if (k in COURSE_DEFAULTS && v === COURSE_DEFAULTS[k]) delete it[k];
        if (!Object.keys(it).length) delete items[lu];
      }
    }
    return s;
  }

  // ---------------- settings ----------------
  let settings = freeze(normalize(clone(DEFAULTS)));
  const subs = new Set();
  let lastWritten = '';

  function notify(keys) {
    for (const fn of [...subs]) { try { fn(settings, keys); } catch (e) { console.warn('[Toledo+] settings subscriber', e); } }
  }
  function apply(next, keys) {
    settings = freeze(normalize(next));
    notify(keys);
  }

  // Throttled persist (leading edge, then at most once per second) to respect storage.sync
  // write quotas while keeping the first write immediate. Each item falls back to storage.local
  // when sync refuses it (quota); only items that changed since the last write are written.
  let pending = null, timer = null, lastWriteAt = 0;
  let lastCustom = '[]';
  async function writeItem(syncKey, localKey, data, savedAt) {
    try {
      await sset('sync', { [syncKey]: data, [syncKey + 'SavedAt']: savedAt });
    } catch (e) {
      console.warn(`[Toledo+] storage.sync failed for '${syncKey}', using local:`, e.message);
      try { await sset('local', { [localKey]: data, [syncKey + 'SavedAt']: savedAt }); } catch (_) { /* nothing else to try */ }
    }
  }
  function persist() {
    if (!pending) {
      let resolve;
      pending = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    if (timer) return pending.promise; // a write is already scheduled; it will pick up the latest settings
    const wait = Math.max(0, lastWriteAt + 1000 - Date.now());
    timer = setTimeout(async () => {
      timer = null;
      lastWriteAt = Date.now();
      const p = pending; pending = null;
      const custom = clone(settings.custom || []);
      const data = compact(clone(settings));
      const savedAt = Date.now();
      const json = JSON.stringify(data), cjson = JSON.stringify(custom);
      const writes = [];
      if (json !== lastWritten) { lastWritten = json; writes.push(writeItem('settings', 'settingsLocal', data, savedAt)); }
      if (cjson !== lastCustom) { lastCustom = cjson; writes.push(writeItem('custom', 'customLocal', custom, savedAt)); }
      await Promise.all(writes);
      p.resolve();
    }, wait);
    return pending.promise;
  }

  // Newest of the sync item and its local fallback.
  function pick(syn, loc, syncKey, localKey) {
    const at = (o) => o[syncKey + 'SavedAt'] || 0;
    if (loc[localKey] !== undefined && (syn[syncKey] === undefined || at(loc) > at(syn))) return loc[localKey];
    return syn[syncKey];
  }

  // A change from another tab/browser: storage.sync 'settings'/'custom' or their local fallbacks.
  function settingsChangedElsewhere(changes, name) {
    const sk = name === 'sync' ? 'settings' : 'settingsLocal';
    const ck = name === 'sync' ? 'custom' : 'customLocal';
    const sv = changes[sk] && changes[sk].newValue;
    const cv = changes[ck] && changes[ck].newValue;
    let next = null;
    if (isObj(sv) && JSON.stringify(sv) !== lastWritten) {
      lastWritten = JSON.stringify(sv);
      next = merge(clone(DEFAULTS), sv);
      next.custom = clone(settings.custom);
    }
    if (Array.isArray(cv) && JSON.stringify(cv) !== lastCustom) {
      lastCustom = JSON.stringify(cv);
      next = next || clone(settings);
      next.custom = clone(cv);
    }
    if (!next) return;
    const before = settings;
    next = normalize(next);
    const keys = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
    if (keys.length) apply(next, keys);
  }

  async function load() {
    if (!hasChrome()) return settings;
    const [syn, loc] = await Promise.all([
      sget('sync', ['settings', 'settingsSavedAt', 'custom', 'customSavedAt']),
      sget('local', ['settingsLocal', 'settingsSavedAt', 'customLocal', 'customSavedAt']),
    ]);
    const stored = pick(syn, loc, 'settings', 'settingsLocal');
    const storedCustom = pick(syn, loc, 'custom', 'customLocal');
    const next = merge(clone(DEFAULTS), isObj(stored) ? stored : {});
    let migrate = false;
    if (Array.isArray(storedCustom)) next.custom = clone(storedCustom);
    else if (isObj(stored) && Array.isArray(stored.custom) && stored.custom.length) migrate = true; // v1: inside 'settings'
    if (isObj(stored) && (stored.v || 1) < DEFAULTS.v) migrate = true;
    next.v = DEFAULTS.v;
    settings = freeze(normalize(next));
    lastWritten = isObj(stored) && !migrate ? JSON.stringify(stored) : '';
    lastCustom = Array.isArray(storedCustom) ? JSON.stringify(storedCustom) : (migrate ? '' : '[]');
    try {
      chrome.storage.onChanged.addListener((changes, name) => {
        if (name === 'sync' || name === 'local') settingsChangedElsewhere(changes, name);
        if (name === 'local' && changes.state?.newValue) stateChangedElsewhere(changes.state.newValue);
      });
    } catch (_) { /* not in an extension context */ }
    if (migrate) persist().catch(() => {}); // move v1 custom deadlines to their own key, drop them from 'settings'
    await loadState();
    return settings;
  }

  const get = () => settings;

  function set(patch) {
    if (!isObj(patch)) return Promise.resolve();
    const keys = Object.keys(patch);
    apply(merge(clone(settings), patch), keys);
    return persist();
  }

  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  function reset() {
    apply(clone(DEFAULTS), Object.keys(DEFAULTS));
    return persist();
  }
  const exportJSON = () => JSON.stringify(settings, null, 2);
  function importJSON(json) {
    const obj = typeof json === 'string' ? JSON.parse(json) : json; // throws on invalid JSON (caller shows error)
    if (!isObj(obj)) throw new Error('Invalid settings');
    apply(merge(clone(DEFAULTS), obj), Object.keys(DEFAULTS));
    return persist();
  }

  const course = (luId) => ({ ...COURSE_DEFAULTS, ...(settings.courses.items?.[luId] || {}) });
  const setCourse = (luId, patch) => set({ courses: { items: { [luId]: { ...course(luId), ...patch } } } });

  TP.settings = { DEFAULTS: freeze(clone(DEFAULTS)), load, get, set, subscribe, reset, export: exportJSON, import: importJSON, course, setCourse, merge };

  // ---------------- state (local, not synced) ----------------
  // set(patch) deep-merges; a null value deletes a map entry (e.g. {done:{[key]:null}}).
  // Pass {replace:true} to replace the given top-level keys wholesale.
  let state = clone(STATE_DEFAULTS);
  const stateSubs = new Set();
  let stateTimer = null, stateWritten = '', statePending = null;

  async function loadState() {
    const v = await sget('local', 'state');
    state = merge(clone(STATE_DEFAULTS), isObj(v.state) ? v.state : {});
  }
  function notifyState(keys) {
    for (const fn of [...stateSubs]) { try { fn(state, keys); } catch (e) { console.warn('[Toledo+] state subscriber', e); } }
  }
  function stateChangedElsewhere(nv) {
    if (JSON.stringify(nv) === stateWritten) return;
    const next = merge(clone(STATE_DEFAULTS), nv);
    const keys = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(state[k]));
    state = next;
    if (keys.length) notifyState(keys);
  }
  function setState(patch, opts = {}) {
    if (!isObj(patch)) return Promise.resolve();
    if (opts.replace) {
      state = { ...state };
      for (const [k, v] of Object.entries(patch)) state[k] = clone(v);
    } else {
      state = merge(state, patch, true);
    }
    if (Array.isArray(state.recent) && state.recent.length > 12) state.recent = state.recent.slice(0, 12);
    notifyState(Object.keys(patch));
    if (!statePending) {
      let resolve;
      statePending = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    clearTimeout(stateTimer);
    stateTimer = setTimeout(async () => {
      const p = statePending; statePending = null;
      stateWritten = JSON.stringify(state);
      try { await sset('local', { state }); } catch (e) { console.warn('[Toledo+] state write failed', e.message); }
      p.resolve();
    }, 150);
    return statePending.promise;
  }

  TP.state = {
    DEFAULTS: freeze(clone(STATE_DEFAULTS)),
    get: () => state,
    set: setState,
    subscribe: (fn) => { stateSubs.add(fn); return () => stateSubs.delete(fn); },
  };
})();
