/* Unit tests for src/core/settings.js: storage.sync per-item quota (8 KB) and the local fallback,
   v1/v2 → v3 migrations (pins removed), and TP.state (one storage item per key, read-merge-write). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');
const { world, fakeChrome, tick, QUOTA_BYTES_PER_ITEM } = require('../helpers/fake-chrome');

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

async function boot(w, out) {
  const s = sandbox();
  s.ctx.chrome = fakeChrome(w);
  if (out) out.chrome = s.ctx.chrome;
  s.load('src/core/settings.js');
  await s.TP.settings.load();
  return s.TP;
}
const quiet = async (fn) => { const warn = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = warn; } };

const lu = (i) => `ULTRA-B-LUCA-X1${String(i).padStart(4, '0')}-2627`;

test('100 customised courses still fit in one storage.sync item (default fields are not stored)', async () => {
  const w = world();
  const TP = await boot(w);
  for (let i = 0; i < 100; i++) TP.settings.setCourse(lu(i), { hidden: i % 2 === 0, nickname: i % 5 === 0 ? 'Vak ' + i : '' });
  await TP.settings.setCourse(lu(100), { color: 'green' });
  const st = w.stores.sync;
  assert.ok(st.settings, 'written to storage.sync');
  assert.equal(w.stores.local.settingsLocal, undefined, 'no local fallback needed');
  assert.ok(JSON.stringify(st.settings).length < QUOTA_BYTES_PER_ITEM);
  // Round trip: a fresh tab sees the same per-course settings (defaults merged back in).
  const TP2 = await boot(w);
  assert.deepEqual(plain(TP2.settings.course(lu(0))), { nickname: 'Vak 0', color: null, hidden: true, inSidebar: false });
  assert.deepEqual(plain(TP2.settings.course(lu(1))), { nickname: '', color: null, hidden: false, inSidebar: false });
  assert.equal(TP2.settings.course(lu(100)).color, 'green');
});

test('custom deadlines live in their own sync key; too many fall back to storage.local and load back', async () => {
  const w = world();
  const TP = await boot(w);
  await TP.settings.set({ custom: [{ id: 'a', title: 'Eigen deadline', courseLuId: '', due: 1790000000000 }] });
  assert.equal(w.stores.sync.custom.length, 1, "stored under sync key 'custom'");
  assert.equal(w.stores.sync.settings.custom, undefined, "not inside the 'settings' item");
  const custom = Array.from({ length: 120 }, (_, i) => ({ id: 'id' + i, title: 'Een vrij lange eigen deadline titel nummer ' + i, courseLuId: lu(i), due: 1790000000000 + i }));
  await quiet(() => TP.settings.set({ custom, accent: 'pink' }));
  assert.equal(w.stores.local.customLocal.length, 120, 'persisted locally');
  assert.equal(w.stores.sync.settings.accent, 'pink', 'the settings item itself still syncs');
  const TP2 = await boot(w);
  assert.equal(TP2.settings.get().custom.length, 120, 'restored from the local fallback');
  assert.equal(TP2.settings.get().accent, 'pink');
});

test('v1 settings with custom deadlines inside are migrated to the separate key', async () => {
  const old = [{ id: 'x', title: 'Oude deadline', courseLuId: '', due: 1790000000000 }];
  const w = world({ sync: { settings: { v: 1, accent: 'green', custom: old }, settingsSavedAt: 1 } });
  const TP = await boot(w);
  assert.deepEqual(plain(TP.settings.get().custom), old, 'available right away');
  await tick(50);
  assert.deepEqual(w.stores.sync.custom, old, "moved to sync key 'custom'");
  assert.equal(w.stores.sync.settings.custom, undefined, "removed from 'settings'");
  assert.equal(w.stores.sync.settings.v, 5);
  assert.equal(w.stores.sync.settings.accent, 'green');
  const TP2 = await boot(w);
  assert.equal(TP2.settings.get().custom.length, 1);
});

test('v2 → v4: pins and favourite sync are dropped; nickname/color/hidden/order kept', async () => {
  const w = world({ sync: { settingsSavedAt: 1, settings: { v: 2, sync: { markReadInToledo: false, favoritesToToledo: true },
    courses: { sort: 'manual', order: [lu(2), lu(1)], items: { [lu(1)]: { pinned: true, nickname: 'Een' }, [lu(2)]: { pinned: false } } } } } });
  const TP = await boot(w);
  const s = TP.settings.get();
  assert.equal(s.v, 5);
  assert.deepEqual(plain(s.sync), { markReadInToledo: false });
  assert.deepEqual(plain(TP.settings.course(lu(1))), { nickname: 'Een', color: null, hidden: false, inSidebar: false });
  assert.equal('pinned' in TP.settings.course(lu(2)), false);
  assert.deepEqual(plain(s.courses.order), [lu(2), lu(1)]);
  await tick(50);
  const stored = w.stores.sync.settings;
  assert.equal(stored.v, 5);
  assert.equal(stored.sync.favoritesToToledo, undefined);
  assert.deepEqual(stored.courses.items, { [lu(1)]: { nickname: 'Een' } }, 'empty entries compacted away');
  // Old UI code calling setCourse(…, {pinned}) during the transition can't bring it back.
  await TP.settings.setCourse(lu(3), { pinned: true, hidden: true });
  assert.deepEqual(plain(TP.settings.course(lu(3))), { nickname: '', color: null, hidden: true, inSidebar: false });
  assert.equal(TP.settings.DEFAULTS.sync.favoritesToToledo, undefined);
});

test('v3 → v4: courses start out of the sidebar (inSidebar false); adding one stores only that flag', async () => {
  const w = world({ sync: { settingsSavedAt: 1, settings: { v: 3, courses: { sort: 'name', items: { [lu(1)]: { nickname: 'Een' } } } } } });
  const TP = await boot(w);
  assert.equal(TP.settings.get().v, 5);
  assert.equal(TP.settings.course(lu(1)).inSidebar, false, 'existing users: nothing in the sidebar');
  assert.equal(TP.settings.course(lu(2)).inSidebar, false);
  await TP.settings.setCourse(lu(2), { inSidebar: true });
  await tick(50);
  assert.equal(w.stores.sync.settings.v, 5);
  assert.deepEqual(w.stores.sync.settings.courses.items, { [lu(1)]: { nickname: 'Een' }, [lu(2)]: { inSidebar: true } }, 'default false is not stored');
  await TP.settings.setCourse(lu(2), { inSidebar: false });
  await tick(1100);
  assert.deepEqual(w.stores.sync.settings.courses.items, { [lu(1)]: { nickname: 'Een' } }, 'removing it compacts the entry away');
  const TP2 = await boot(w);
  assert.equal(TP2.settings.course(lu(2)).inSidebar, false);
});

test('changes from other tabs update settings, also via the local fallback keys', async () => {
  const w = world();
  const out = {};
  const TP = await boot(w, out);
  const seen = [];
  TP.settings.subscribe((s, keys) => seen.push(keys.join(',')));
  out.chrome._fire({ custom: { newValue: [{ id: 'o', title: 'Van elders', courseLuId: '', due: 1 }] } }, 'sync');
  assert.equal(TP.settings.get().custom.length, 1);
  out.chrome._fire({ customLocal: { newValue: [] } }, 'local');
  assert.equal(TP.settings.get().custom.length, 0);
  out.chrome._fire({ settingsLocal: { newValue: { v: 3, accent: 'mint' } } }, 'local');
  assert.equal(TP.settings.get().accent, 'mint');
  out.chrome._fire({ settings: { newValue: { v: 3, accent: 'teal' } } }, 'sync');
  assert.equal(TP.settings.get().accent, 'teal');
  assert.deepEqual(seen, ['custom', 'custom', 'accent', 'accent']);
});

test('settings.flush() writes a throttled change right away', async () => {
  const w = world();
  const TP = await boot(w);
  await TP.settings.set({ accent: 'green' });         // first write: immediate
  TP.settings.set({ accent: 'orange' });               // throttled (≤ 1/s)
  await TP.settings.flush();
  assert.equal(w.stores.sync.settings.accent, 'orange');
});

// ---------------- TP.state ----------------

test("state: one storage item per key; the v1.1 'state' item is split and removed", async () => {
  const w = world({ local: { state: { visits: { _900001_1: 5 }, recent: [{ url: 'u' }], ui: { sidebarCollapsed: true }, cache: {}, feedSeenAt: 9 } } });
  const TP = await boot(w);
  await tick(20);
  const L = w.stores.local;
  assert.equal(L.state, undefined);
  assert.deepEqual(L['state:visits'], { _900001_1: 5 });
  assert.deepEqual(L['state:ui'], { sidebarCollapsed: true });
  assert.deepEqual(L['state:feedSeen'], { ids: {}, floor: 9 });
  assert.equal(L['state:cache'], undefined, 'dead cache key not carried over');
  assert.equal(TP.state.get().ui.sidebarCollapsed, true);
  await TP.state.set({ ui: { sidebarCollapsed: false } });
  assert.deepEqual(w.stores.local['state:ui'], { sidebarCollapsed: false });
  assert.deepEqual(w.writes.at(-1).keys.sort(), ['state:ui', 'staterev:ui'], 'only the changed key (+ its revision) is written');
});

test('state: two tabs marking different deadlines done do not clobber each other (read-merge-write, B6)', async () => {
  const w = world();
  const A = await boot(w), B = await boot(w);
  await Promise.all([A.state.set({ done: { d1: 1 } }), B.state.set({ done: { d2: 2 } })]);
  await tick(30);
  assert.deepEqual(w.stores.local['state:done'], { d1: 1, d2: 2 });
  assert.deepEqual(plain(A.state.get().done), { d1: 1, d2: 2 });
  assert.deepEqual(plain(B.state.get().done), { d1: 1, d2: 2 });
  // Deleting in one tab (null) propagates too.
  await A.state.set({ done: { d2: null } });
  await tick(30);
  assert.deepEqual(plain(B.state.get().done), { d1: 1 });
  // Other keys of a tab are untouched by another tab's write.
  await A.state.set({ recent: [{ url: 'a' }] });
  await B.state.set({ visits: { x: 1 } });
  await tick(30);
  assert.deepEqual(plain(A.state.get().visits), { x: 1 });
  assert.deepEqual(plain(B.state.get().recent), [{ url: 'a' }]);
});

test('state: a tab keeps its unwritten changes when another tab writes the same key', async () => {
  const w = world();
  const A = await boot(w), B = await boot(w);
  const seen = [];
  B.state.subscribe((s, keys) => seen.push(keys.join()));
  await A.state.set({ cidMap: { L1: '_1_1' } });
  B.state.set({ cidMap: { L2: '_2_1' } });           // not yet written when A's change arrives
  await tick(5);
  assert.deepEqual(plain(B.state.get().cidMap), { L1: '_1_1', L2: '_2_1' });
  await B.state.flush();
  await tick(20);
  assert.deepEqual(w.stores.local['state:cidMap'], { L1: '_1_1', L2: '_2_1' });
  assert.ok(seen.includes('cidMap'));
  assert.ok(B.state.rev() > 0);
});

test('state writes are no-ops (no throw) after the extension context is invalidated', async () => {
  const w = world();
  const out = {};
  const TP = await boot(w, out);
  out.chrome._invalidate();
  const n = w.writes.length;
  await TP.state.set({ recent: [] });
  await TP.settings.set({ accent: 'green' });
  await TP.state.flush();
  assert.equal(w.writes.length, n);
});

test('v4 → v5 (brand): the old default accent "blue" becomes "brand"; explicit other accents stay; v5 blue is kept', async () => {
  const w = world({ sync: { settingsSavedAt: 1, settings: { v: 4, accent: 'blue', density: 'compact' } } });
  const TP = await boot(w);
  assert.equal(TP.settings.get().accent, 'brand');
  assert.equal(TP.settings.get().density, 'compact');
  await tick(50);
  assert.equal(w.stores.sync.settings.accent, 'brand', 'migration persisted');
  assert.equal(w.stores.sync.settings.v, 5);
  const w2 = world({ sync: { settingsSavedAt: 1, settings: { v: 4, accent: 'teal' } } });
  assert.equal((await boot(w2)).settings.get().accent, 'teal', 'explicit choice kept');
  const w3 = world({ sync: { settingsSavedAt: 1, settings: { v: 5, accent: 'blue' } } });
  assert.equal((await boot(w3)).settings.get().accent, 'blue', 'blue chosen after v5 is kept');
  const w4 = world();
  assert.equal((await boot(w4)).settings.get().accent, 'brand', 'new users get the brand accent');
});
