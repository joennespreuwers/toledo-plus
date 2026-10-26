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
  const chromeObj = {
    runtime: { lastError: undefined },
    storage: { sync: area('sync', QUOTA_BYTES_PER_ITEM), local: area('local', 0), onChanged: { addListener() {} } },
  };
  return chromeObj;
}

async function boot(stores) {
  const s = sandbox();
  s.ctx.chrome = fakeChrome(stores);
  s.load('src/core/settings.js');
  await s.TP.settings.load();
  return s.TP;
}

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

test('settings too large for storage.sync fall back to storage.local and load back', async () => {
  const stores = { sync: {}, local: {} };
  const TP = await boot(stores);
  const custom = Array.from({ length: 120 }, (_, i) => ({ id: 'id' + i, title: 'Een vrij lange eigen deadline titel nummer ' + i, courseLuId: lu(i), due: 1790000000000 + i }));
  const warn = console.warn; console.warn = () => {};
  try { await TP.settings.set({ custom }); } finally { console.warn = warn; }
  assert.equal(stores.local.settingsLocal.custom.length, 120, 'persisted locally');
  const TP2 = await boot(stores);
  assert.equal(TP2.settings.get().custom.length, 120, 'restored from the local fallback');
});
