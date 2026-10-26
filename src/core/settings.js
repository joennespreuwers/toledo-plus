/* Toledo+ — TP.settings (chrome.storage.sync 'settings') and TP.state (chrome.storage.local 'state').
   Settings deep-merge over DEFAULTS; writes are applied in memory + notified immediately,
   then persisted (debounced, to stay under storage.sync write quotas). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const DEFAULTS = {
    v: 1,
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
  const COURSE_DEFAULTS = { nickname: '', color: null, hidden: false, pinned: false };
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
    if (!isObj(s.courses.items)) s.courses.items = {};
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

  // Debounced persist. Falls back to storage.local when sync is over quota.
  let pending = null, timer = null;
  function persist() {
    if (!pending) {
      let resolve;
      pending = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = pending; pending = null;
      const data = clone(settings);
      const savedAt = Date.now();
      lastWritten = JSON.stringify(data);
      try {
        await sset('sync', { settings: data, settingsSavedAt: savedAt });
      } catch (e) {
        console.warn('[Toledo+] storage.sync failed, using local:', e.message);
        try { await sset('local', { settingsLocal: data, settingsSavedAt: savedAt }); } catch (_) { /* nothing else to try */ }
      }
      p.resolve();
    }, 250);
    return pending.promise;
  }

  async function load() {
    if (!hasChrome()) return settings;
    const [syn, loc] = await Promise.all([sget('sync', ['settings', 'settingsSavedAt']), sget('local', ['settingsLocal', 'settingsSavedAt'])]);
    let stored = syn.settings;
    if (loc.settingsLocal && (!stored || (loc.settingsSavedAt || 0) > (syn.settingsSavedAt || 0))) stored = loc.settingsLocal;
    settings = freeze(normalize(merge(clone(DEFAULTS), isObj(stored) ? stored : {})));
    try {
      chrome.storage.onChanged.addListener((changes, name) => {
        if (name === 'sync' && changes.settings?.newValue) {
          const nv = changes.settings.newValue;
          if (JSON.stringify(nv) === lastWritten) return; // our own write echoing back
          const before = settings;
          const next = normalize(merge(clone(DEFAULTS), nv));
          const keys = Object.keys(next).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
          if (keys.length) apply(next, keys);
        }
        if (name === 'local' && changes.state?.newValue) stateChangedElsewhere(changes.state.newValue);
      });
    } catch (_) { /* not in an extension context */ }
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
