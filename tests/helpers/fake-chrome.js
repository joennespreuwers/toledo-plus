'use strict';
// A fake `chrome` (storage.sync/local, onChanged, runtime) for unit tests.
// Several sandboxes can share one `world` → they behave like tabs of the same browser profile:
// writes in one tab fire storage.onChanged in every tab (asynchronously, like Chrome).

const QUOTA_BYTES_PER_ITEM = 8192;
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** A browser profile: the stores and every tab's onChanged listeners. */
function world(init = {}) {
  return { stores: { sync: clone(init.sync) || {}, local: clone(init.local) || {} }, listeners: [], writes: [] };
}

/**
 * @param w        world()
 * @param opts     { id='testext' (runtime.id; set to undefined to simulate an invalidated context),
 *                   syncQuota=QUOTA_BYTES_PER_ITEM, localFail: (obj)=>string|null (simulate quota errors),
 *                   onMessage: (msg, sender) => reply | Promise<reply> }
 */
function fakeChrome(w, opts = {}) {
  const runtime = { id: 'id' in opts ? opts.id : 'testext', lastError: undefined };
  const fire = (changes, name) => {
    if (!Object.keys(changes).length) return;
    setTimeout(() => { for (const fn of [...w.listeners]) { try { fn(clone(changes), name); } catch (e) { console.error(e); } } }, 0);
  };
  const withError = (msg, cb) => { runtime.lastError = { message: msg }; try { cb && cb(); } finally { runtime.lastError = undefined; } };
  const area = (name) => ({
    get(keys, cb) {
      const st = w.stores[name];
      let out = {};
      if (keys == null) out = clone(st);
      else if (typeof keys === 'string') { if (keys in st) out[keys] = clone(st[keys]); }
      else if (Array.isArray(keys)) { for (const k of keys) if (k in st) out[k] = clone(st[k]); }
      else for (const [k, d] of Object.entries(keys)) out[k] = k in st ? clone(st[k]) : d;
      const p = Promise.resolve(out);
      if (cb) setTimeout(() => cb(out), 0);
      return p;
    },
    set(obj, cb) {
      if (!runtime.id) throw new Error('Extension context invalidated.');
      if (name === 'sync') {
        const quota = opts.syncQuota != null ? opts.syncQuota : QUOTA_BYTES_PER_ITEM;
        for (const [k, v] of Object.entries(obj)) {
          if (quota && k.length + JSON.stringify(v).length > quota) { setTimeout(() => withError('QUOTA_BYTES_PER_ITEM quota exceeded', cb), 0); return; }
        }
      }
      if (name === 'local' && opts.localFail) {
        const err = opts.localFail(obj);
        if (err) { setTimeout(() => withError(err, cb), 0); return; }
      }
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: clone(w.stores[name][k]), newValue: clone(v) };
        w.stores[name][k] = clone(v);
      }
      w.writes.push({ area: name, keys: Object.keys(obj) });
      fire(changes, name);
      if (cb) setTimeout(cb, 0);
    },
    remove(keys, cb) {
      const changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (k in w.stores[name]) { changes[k] = { oldValue: clone(w.stores[name][k]) }; delete w.stores[name][k]; }
      }
      fire(changes, name);
      if (cb) setTimeout(cb, 0);
    },
  });
  const listeners = [];
  const chromeObj = {
    runtime: Object.assign(runtime, {
      sendMessage(msg, cb) {
        if (!runtime.id) throw new Error('Extension context invalidated.');
        if (!opts.onMessage) { setTimeout(() => withError('Could not establish connection. Receiving end does not exist.', () => cb && cb(undefined)), 0); return; }
        Promise.resolve(opts.onMessage(clone(msg), { id: runtime.id, origin: 'https://toledo.kuleuven.be' })).then(
          (reply) => setTimeout(() => cb && cb(clone(reply)), 0),
          (e) => setTimeout(() => withError(String(e && e.message || e), () => cb && cb(undefined)), 0));
      },
    }),
    storage: {
      sync: area('sync'),
      local: area('local'),
      onChanged: {
        addListener(fn) { listeners.push(fn); w.listeners.push(fn); },
        removeListener(fn) { const i = w.listeners.indexOf(fn); if (i >= 0) w.listeners.splice(i, 1); },
      },
    },
    /** Fire onChanged in this tab only (simulating another browser/tab's write). */
    _fire: (changes, name) => listeners.forEach((fn) => fn(changes, name)),
    /** Simulate an extension update/reload: this tab's context is invalidated. */
    _invalidate() { runtime.id = undefined; },
  };
  return chromeObj;
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

module.exports = { world, fakeChrome, tick, QUOTA_BYTES_PER_ITEM };
