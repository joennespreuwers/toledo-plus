/* Unit tests for src/core/settings.js persistence: storage.sync per-item quota (8 KB) and the local fallback. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');

const QUOTA_BYTES_PER_ITEM = 8192;

function fakeChrome(stores) {
  const area = (name, quota) => ({
    get(keys, cb) {
      const ks = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in stores[name]) out[k] = JSON.parse(JSON.stringify(stores[name][k]));
      cb(out);
    },
    set(obj, cb) {
      for (const [k, v] of Object.entries(obj)) {
        if (quota && (k.length + JSON.stringify(v).length) > quota) {
          chromeObj.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
          cb && cb();
          chromeObj.runtime.lastError = undefined;
          return;
        }
      }
      Object.assign(stores[name], JSON.parse(JSON.stringify(obj)));
      cb && cb();
    },
  });
  const listeners = [];
  const chromeObj = {
    runtime: { lastError: undefined },
    storage: { sync: area('sync', QUOTA_BYTES_PER_ITEM), local: area('local', 0), onChanged: { addListener(fn) { listeners.push(fn); } } },
    _fire: (changes, name) => listeners.forEach((fn) => fn(changes, name)),
  };
  return chromeObj;
}

async function boot(stores, out) {
  const s = sandbox();
  s.ctx.chrome = fakeChrome(stores);
  if (out) out.chrome = s.ctx.chrome;
  s.load('src/core/settings.js');
  await s.TP.settings.load();
  return s.TP;
}
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

const lu = (i) => `ULTRA-B-LUCA-N5${String(i).padStart(4, '0')}-2627`;

test('100 customised courses still fit in one storage.sync item (default fields are not stored)', async () => {
  const stores = { sync: {}, local: {} };
  const TP = await boot(stores);
  for (let i = 0; i < 100; i++) TP.settings.setCourse(lu(i), { pinned: i % 2 === 0, hidden: i % 5 === 0 });
  await TP.settings.setCourse(lu(100), { color: 'green' });
  assert.ok(stores.sync.settings, 'written to storage.sync');
  assert.equal(stores.local.settingsLocal, undefined, 'no local fallback needed');
  assert.ok(JSON.stringify(stores.sync.settings).length < QUOTA_BYTES_PER_ITEM);
  // Round trip: a fresh tab sees the same per-course settings (defaults merged back in).
  const TP2 = await boot(stores);
  assert.deepEqual({ ...TP2.settings.course(lu(0)) }, { nickname: '', color: null, hidden: true, pinned: true });
  assert.deepEqual({ ...TP2.settings.course(lu(1)) }, { nickname: '', color: null, hidden: false, pinned: false });
  assert.equal(TP2.settings.course(lu(100)).color, 'green');
});

test('custom deadlines live in their own sync key; too many fall back to storage.local and load back', async () => {
  const stores = { sync: {}, local: {} };
  const TP = await boot(stores);
  await TP.settings.set({ custom: [{ id: 'a', title: 'Eigen deadline', courseLuId: '', due: 1790000000000 }] });
  assert.equal(stores.sync.custom.length, 1, "stored under sync key 'custom'");
  assert.equal(stores.sync.settings.custom, undefined, "not inside the 'settings' item");
  const custom = Array.from({ length: 120 }, (_, i) => ({ id: 'id' + i, title: 'Een vrij lange eigen deadline titel nummer ' + i, courseLuId: lu(i), due: 1790000000000 + i }));
  await quiet(() => TP.settings.set({ custom, accent: 'pink' }));
  assert.equal(stores.local.customLocal.length, 120, 'persisted locally');
  assert.equal(stores.sync.settings.accent, 'pink', 'the settings item itself still syncs');
  const TP2 = await boot(stores);
  assert.equal(TP2.settings.get().custom.length, 120, 'restored from the local fallback');
  assert.equal(TP2.settings.get().accent, 'pink');
});

test('v1 settings with custom deadlines inside are migrated to the separate key', async () => {
  const old = [{ id: 'x', title: 'Oude deadline', courseLuId: '', due: 1790000000000 }];
  const stores = { sync: { settings: { v: 1, accent: 'green', custom: old }, settingsSavedAt: 1 }, local: {} };
  const TP = await boot(stores);
  assert.deepEqual(JSON.parse(JSON.stringify(TP.settings.get().custom)), old, 'available right away');
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(stores.sync.custom, old, "moved to sync key 'custom'");
  assert.equal(stores.sync.settings.custom, undefined, "removed from 'settings'");
  assert.equal(stores.sync.settings.v, 2);
  assert.equal(stores.sync.settings.accent, 'green');
  const TP2 = await boot(stores);
  assert.equal(TP2.settings.get().custom.length, 1);
});

test('changes from other tabs update settings, also via the local fallback keys', async () => {
  const stores = { sync: {}, local: {} };
  const out = {};
  const TP = await boot(stores, out);
  const seen = [];
  TP.settings.subscribe((s, keys) => seen.push(keys.join(',')));
  out.chrome._fire({ custom: { newValue: [{ id: 'o', title: 'Van elders', courseLuId: '', due: 1 }] } }, 'sync');
  assert.equal(TP.settings.get().custom.length, 1);
  out.chrome._fire({ customLocal: { newValue: [] } }, 'local');
  assert.equal(TP.settings.get().custom.length, 0);
  out.chrome._fire({ settingsLocal: { newValue: { v: 2, accent: 'mint' } } }, 'local');
  assert.equal(TP.settings.get().accent, 'mint');
  out.chrome._fire({ settings: { newValue: { v: 2, accent: 'teal' } } }, 'sync');
  assert.equal(TP.settings.get().accent, 'teal');
  assert.deepEqual(seen, ['custom', 'custom', 'accent', 'accent']);
});

test('pinned defaults to "no explicit choice" (null) and an explicit false is kept', async () => {
  const stores = { sync: {}, local: {} };
  const TP = await boot(stores);
  assert.equal(TP.settings.course(lu(7)).pinned, null);
  await TP.settings.setCourse(lu(7), { pinned: false });
  const TP2 = await boot(stores);
  assert.equal(TP2.settings.course(lu(7)).pinned, false);
});
