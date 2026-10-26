/* Toledo+ — TP.settings (chrome.storage.sync 'settings' + 'custom') and TP.state (chrome.storage.local 'state:<key>').
   Settings deep-merge over DEFAULTS; writes are applied in memory + notified immediately,
   then persisted (debounced, to stay under storage.sync write quotas). Custom deadlines live in
   settings.custom in memory but are stored under their own sync key 'custom', so they never push
   the 'settings' item over the 8 KB per-item quota. Each item falls back to storage.local
   ('settingsLocal' / 'customLocal') when storage.sync refuses it. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const DEFAULTS = {
    v: 4,
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
    sync: { markReadInToledo: true },
    search: { indexAll: true },
    privacy: { telemetry: true, updateCheck: true },
    custom: [],
  };
  // v3: the pin/favourite concept is gone (no 'pinned' per course, no sync.favoritesToToledo).
  // v4: inSidebar — the course is listed in the sidebar's "Vakken" group (local to Toledo+, never sent to Toledo; default off;
  //     v3 settings have no such flag, so existing users start with an empty group).
  const COURSE_DEFAULTS = { nickname: '', color: null, hidden: false, inSidebar: false };
  const REMOVED_COURSE_KEYS = ['pinned'];
  // TP.state: each top-level key is its own chrome.storage.local item 'state:<key>' (see below).
  const STATE_DEFAULTS = {
    visits: {}, done: {}, recent: [], cidMap: {}, openFolders: {}, ui: {},
    feedSeen: { ids: {}, floor: 0 },   // B3: seen feed event ids (bounded) + floor (everything ≤ floor counts as seen)
    read: {},                          // B4: local read-set {eventId: ms}, also used when Toledo sync is off
    pendingRead: {},                   // B7: mark-read PATCHes still to send {eventId: {type, subType, t}}
    me: {},                            // v1.5: {given, t} first name for the greeting (local only, never synced/sent)
  };

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
  // After an extension update/reload the old content script is orphaned: chrome.runtime.id is gone and
  // every storage call throws. Writes then become silent no-ops (TP.data emits 'stale' for the shell).
  const stale = () => { try { return typeof chrome !== 'undefined' && !!chrome.runtime && !chrome.runtime.id; } catch (_) { return true; } };
  const area = (name) => (hasChrome() ? chrome.storage[name] : null);
  const sget = (name, key) => new Promise((res) => {
    try { area(name).get(key, (v) => { void chrome.runtime?.lastError; res(v || {}); }); } catch (_) { res({}); }
  });
  // Rejects with the lastError (quota…); callers always catch.
  const sset = (name, obj) => new Promise((res, rej) => {
    if (stale()) { res(); return; }
    try {
      area(name).set(obj, () => { const e = chrome.runtime?.lastError; e ? rej(new Error(e.message)) : res(); });
    } catch (e) { rej(e); }
  });
  const sremove = (name, keys) => new Promise((res) => {
    if (stale()) { res(); return; }
    try { area(name).remove(keys, () => { void chrome.runtime?.lastError; res(); }); } catch (_) { res(); }
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
    // v3: pins/favourites removed (maintainer decision) — drop them from every shape we see.
    for (const it of Object.values(s.courses.items)) if (isObj(it)) for (const k of REMOVED_COURSE_KEYS) delete it[k];
    if (isObj(s.sync)) delete s.sync.favoritesToToledo;
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
    if (stale()) return Promise.resolve();
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
  /** Write pending settings now (navigation / pagehide). Never rejects. */
  function flushSettings() {
    if (!timer || !pending) return Promise.resolve();
    clearTimeout(timer); timer = null; lastWriteAt = 0;
    return persist(); // re-arms with zero wait and resolves the same pending promise
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
        if (name === 'local') stateChangedElsewhere(changes);
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

  const course = (luId) => {
    const out = { ...COURSE_DEFAULTS, ...(settings.courses.items?.[luId] || {}) };
    for (const k of REMOVED_COURSE_KEYS) delete out[k];
    return out;
  };

  const setCourse = (luId, patch) => {
    const next = { ...course(luId), ...patch };
    for (const k of REMOVED_COURSE_KEYS) delete next[k];
    return set({ courses: { items: { [luId]: next } } });
  };

  TP.settings = { DEFAULTS: freeze(clone(DEFAULTS)), load, get, set, subscribe, reset, export: exportJSON, import: importJSON, course, setCourse, merge, flush: flushSettings };

  // ---------------- state (local, not synced) ----------------
  // Each top-level key lives in its own chrome.storage.local item 'state:<key>' (B6), so tabs only ever
  // write the keys they changed. Writes are read-merge-write: the stored value is read back and the
  // pending patches of this tab are applied on top of it, so two tabs marking different deadlines
  // "klaar" (or adding visits, cidMap entries, open folders…) don't clobber each other.
  // Each write also bumps 'staterev:<key>' = {n, by}. If another tab wrote the same n concurrently
  // (both read the same base), the loser re-applies its patches (idempotent) — see revChanged().
  // set(patch) deep-merges; a null value deletes a map entry (e.g. {done:{[key]:null}}).
  // Pass {replace:true} to replace the given top-level keys wholesale.
  const SP = 'state:';
  let state = clone(STATE_DEFAULTS);
  const stateSubs = new Set();
  let stateTimer = null, statePending = null;
  let ops = {};                 // key → [{replace, value}] not yet written
  const stateWritten = {};      // key → JSON of our last write (to ignore our own onChanged echo)
  let rev = 0;                  // bumped on every local mutation (TP.state.rev())
  const RP = 'staterev:';
  const TAB = Math.random().toString(36).slice(2, 10);
  const myWrites = {};          // key → {n, ops, t} of this tab's last write (conflict repair)

  function applyOps(base, list) {
    let v = clone(base);
    for (const op of list) v = op.replace || !isObj(op.value) ? clone(op.value) : merge(v, op.value, true);
    return v;
  }
  function boundState(s) {
    if (Array.isArray(s.recent) && s.recent.length > 12) s.recent = s.recent.slice(0, 12);
    return s;
  }

  /** One-time migrations of older state shapes (v1.1: feedSeenAt, done:{key:true}). */
  function migrateState(s, writes, removes) {
    if (typeof s.feedSeenAt === 'number') {
      const fs = isObj(s.feedSeen) ? s.feedSeen : { ids: {}, floor: 0 };
      s.feedSeen = { ids: fs.ids || {}, floor: Math.max(fs.floor || 0, s.feedSeenAt) };
      writes.feedSeen = s.feedSeen;
      removes.push(SP + 'feedSeenAt');
    }
    delete s.feedSeenAt;
    delete s.cache; // dead since v1.0 (the data cache has its own 'cache:<key>' items)
    if (isObj(s.done)) {
      const now = Date.now();
      let changed = false;
      for (const [k, v] of Object.entries(s.done)) if (v === true) { s.done[k] = now; changed = true; }
      if (changed) writes.done = s.done;
    }
    return s;
  }

  async function loadState() {
    const all = await sget('local', null);
    const legacy = isObj(all.state) ? all.state : null;
    const s = clone(STATE_DEFAULTS);
    const writes = {}, removes = [];
    if (legacy) { // v1.1 single 'state' item → one item per key
      for (const [k, v] of Object.entries(legacy)) { s[k] = isObj(v) && isObj(s[k]) ? merge(s[k], v) : clone(v); writes[k] = s[k]; }
      removes.push('state');
    }
    for (const [sk, v] of Object.entries(all)) {
      if (!sk.startsWith(SP)) continue;
      const k = sk.slice(SP.length);
      s[k] = isObj(v) && isObj(STATE_DEFAULTS[k]) ? merge(clone(STATE_DEFAULTS[k]), v) : clone(v);
      delete writes[k];
    }
    state = boundState(migrateState(s, writes, removes));
    const obj = {};
    for (const [k, v] of Object.entries(writes)) if (k !== 'cache' && k !== 'feedSeenAt') { obj[SP + k] = v; stateWritten[k] = JSON.stringify(v); }
    try {
      if (Object.keys(obj).length) await sset('local', obj);
      if (removes.length) await sremove('local', removes);
    } catch (e) { console.warn('[Toledo+] state migration write failed', e.message); }
  }
  function notifyState(keys) {
    for (const fn of [...stateSubs]) { try { fn(state, keys); } catch (e) { console.warn('[Toledo+] state subscriber', e); } }
  }
  /** Another tab wrote revision n of a key. n ≤ our last written n → it did not see our write (same base):
   *  re-apply our patches on top, unless its value already contains them. */
  function revChanged(k, nv, value) {
    const mine = myWrites[k];
    if (!mine || !isObj(nv) || nv.by === TAB || (nv.n || 0) > mine.n) return;
    if (Date.now() - mine.t > 10e3) { delete myWrites[k]; return; }
    const base = value === undefined ? clone(STATE_DEFAULTS[k]) : value;
    if (JSON.stringify(applyOps(base, mine.ops)) === JSON.stringify(base)) return;
    delete myWrites[k];
    (ops[k] ||= []).unshift(...mine.ops);
    schedule(0);
  }

  /** storage.onChanged (local): pick up 'state:<key>' items written by other tabs. */
  function stateChangedElsewhere(changes) {
    const keys = [];
    let next = null;
    for (const [sk, ch] of Object.entries(changes)) {
      if (sk.startsWith(RP)) {
        const k = sk.slice(RP.length);
        revChanged(k, ch.newValue, changes[SP + k] ? changes[SP + k].newValue : state[k]);
        continue;
      }
      if (!sk.startsWith(SP)) continue;
      const k = sk.slice(SP.length);
      const nv = ch.newValue;
      const json = JSON.stringify(nv === undefined ? null : nv);
      if (json === stateWritten[k]) continue; // our own write
      let v = nv === undefined ? clone(STATE_DEFAULTS[k]) : (isObj(nv) && isObj(STATE_DEFAULTS[k]) ? merge(clone(STATE_DEFAULTS[k]), nv) : clone(nv));
      if (ops[k]) v = applyOps(v, ops[k]); // keep this tab's not-yet-written changes on top
      if (JSON.stringify(v) === JSON.stringify(state[k])) continue;
      next = next || { ...state };
      next[k] = v;
      keys.push(k);
    }
    if (!next) return;
    state = boundState(next);
    rev++;
    notifyState(keys);
  }

  async function writeState() {
    const p = statePending; statePending = null;
    const mine = ops; ops = {};
    const keys = Object.keys(mine);
    try {
      if (keys.length && !stale()) {
        const stored = await sget('local', keys.flatMap((k) => [SP + k, RP + k]));
        const obj = {};
        const changed = [];
        for (const k of keys) {
          const n = ((stored[RP + k] && stored[RP + k].n) || 0) + 1;
          obj[RP + k] = { n, by: TAB };
          myWrites[k] = { n, ops: mine[k], t: Date.now() };
          const has = Object.prototype.hasOwnProperty.call(stored, SP + k);
          const base = has ? stored[SP + k] : clone(STATE_DEFAULTS[k]);
          let v = applyOps(base === undefined ? null : base, mine[k]);
          if (k === 'recent' && Array.isArray(v)) v = v.slice(0, 12);
          // Later local changes (made while we were reading) stay on top in memory.
          const mem = ops[k] ? applyOps(v, ops[k]) : v;
          if (JSON.stringify(mem) !== JSON.stringify(state[k])) { state = { ...state, [k]: mem }; changed.push(k); }
          obj[SP + k] = v === undefined ? null : v;
          stateWritten[k] = JSON.stringify(obj[SP + k]);
        }
        await sset('local', obj);
        if (changed.length) notifyState(changed); // merged in entries another tab wrote meanwhile
      }
    } catch (e) {
      console.warn('[Toledo+] state write failed', e.message);
    }
    if (p) p.resolve();
  }

  function setState(patch, opts = {}) {
    if (!isObj(patch)) return Promise.resolve();
    if (opts.replace) {
      state = { ...state };
      for (const [k, v] of Object.entries(patch)) state[k] = clone(v);
    } else {
      state = merge(state, patch, true);
    }
    boundState(state);
    rev++;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      (ops[k] ||= []).push({ replace: !!opts.replace || !isObj(v), value: clone(v) });
    }
    notifyState(Object.keys(patch));
    if (!statePending) {
      let resolve;
      statePending = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    const pr = statePending.promise;
    schedule(150);
    return pr;
  }
  function schedule(ms) {
    if (!statePending) {
      let resolve;
      statePending = { promise: new Promise((r) => { resolve = r; }), resolve };
    }
    clearTimeout(stateTimer);
    stateTimer = setTimeout(writeState, ms);
  }

  /** Write pending state now (before navigating away). Never rejects. */
  function flushState() {
    if (!statePending) return Promise.resolve();
    clearTimeout(stateTimer); stateTimer = null;
    const pr = statePending.promise;
    writeState();
    return pr;
  }

  TP.state = {
    DEFAULTS: freeze(clone(STATE_DEFAULTS)),
    get: () => state,
    set: setState,
    flush: flushState,
    rev: () => rev,
    subscribe: (fn) => { stateSubs.add(fn); return () => stateSubs.delete(fn); },
  };

  // B7: a navigation away must not lose the last writes ("recent", done marks, settings).
  try {
    if (typeof addEventListener === 'function') {
      addEventListener('pagehide', () => { flushState(); flushSettings(); });
    }
  } catch (_) { /* not in a page */ }
})();
