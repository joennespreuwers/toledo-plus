/* Two tabs (two sandboxes) sharing one fake chrome.storage (B6): optimistic mutations become visible
   in the other tab, concurrent state writes don't clobber each other, newer data wins. */
'use strict';
process.env.TZ = 'Europe/Brussels';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, settle, world, tick } = require('../helpers/tp');

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const LU = 'ULTRA-B-X10265-2627';

function events(now) {
  return [
    { id: 'e1', title: 'a.pdf', source: 'Filmtaal 1 [X10265]', sourceId: LU, date: now - 36e5, type: 'notifications', subType: 'content', read: false, dismissed: false },
    { id: 'e2', title: 'b.pdf', source: 'Filmtaal 1 [X10265]', sourceId: LU, date: now - 72e5, type: 'notifications', subType: 'content', read: false, dismissed: false },
    { id: 'd1', title: 'Taak 1', source: 'Filmtaal 1 [X10265]', sourceId: LU, date: now + 864e5, type: 'notifications', subType: 'due', read: false, dismissed: false },
    { id: 'd2', title: 'Taak 2', source: 'Filmtaal 1 [X10265]', sourceId: LU, date: now + 2 * 864e5, type: 'notifications', subType: 'due', read: false, dismissed: false },
  ];
}
const enrollments = [{ id: 1, learningUnitId: LU, title: 'Filmtaal 1 [X10265]', type: 'course', academicYear: 2627, color: 1 }];

async function twoTabs() {
  const w = world();
  const json = async (url) => (url.endsWith('/events') ? events(Date.now()) : url.endsWith('/enrollments') ? enrollments : url.includes('/calendars/') ? { results: [] } : []);
  const A = await boot({ world: w, net: { json }, settings: { sync: { markReadInToledo: false } } });
  const B = await boot({ world: w, net: { json } });
  await A.TP.data.refresh();
  await settle(600); // cache written + delivered to B
  return { w, A: A.TP, B: B.TP };
}

test('tab B picks up tab A\'s refresh (newer t)', async () => {
  const { A, B } = await twoTabs();
  assert.equal(B.data.peek('events').length, 4);
  assert.equal(B.data.lastUpdated(), A.data.lastUpdated());
});

test("an optimistic markRead in tab A shows up in tab B (rev bump + read-set)", async () => {
  const { A, B } = await twoTabs();
  assert.equal(B.data.feed()[0].items.length, 2);
  let changed = false;
  B.data.on('change', (k) => { if (k === 'events') changed = true; });
  await A.data.markRead([A.data.peek('events')[0]]);
  await settle(600);
  assert.ok(changed, "'change' fired in tab B");
  assert.equal(B.data.peek('events').find((e) => e.id === 'e1').read, true);
  assert.deepEqual(plain(B.data.feed()[0].items.map((e) => e.id)), ['e2']);
  assert.ok(B.state.get().read.e1, 'read-set synced');
});

test('done marks set at the same time in both tabs are both kept', async () => {
  const { w, A, B } = await twoTabs();
  const [k1, k2] = A.data.deadlines().map((d) => d.key);
  await Promise.all([A.data.toggleDone(k1), B.data.toggleDone(k2)]);
  await settle(300);
  assert.deepEqual(Object.keys(w.stores.local['state:done']).sort(), [k1, k2].sort());
  assert.deepEqual(plain(A.data.deadlines()), []);
  assert.deepEqual(plain(B.data.deadlines()), []);
});

test('recent, visits, cidMap and openFolders written by different tabs all survive', async () => {
  const { w, A, B } = await twoTabs();
  await Promise.all([
    A.data.addRecent({ title: 'Doc A', url: 'https://u/a' }),
    B.state.set({ visits: { _900001_1: 1 }, openFolders: { _900001_1: ['f1'] } }),
    A.state.set({ cidMap: { [LU]: '_900001_1' } }),
    B.state.set({ cidMap: { 'ULTRA-B-X10300-2627': '_900002_1' } }),
  ]);
  await settle(300);
  const L = w.stores.local;
  assert.equal(L['state:recent'][0].url, 'https://u/a');
  assert.deepEqual(L['state:visits'], { _900001_1: 1 });
  assert.deepEqual(L['state:openFolders'], { _900001_1: ['f1'] });
  assert.deepEqual(L['state:cidMap'], { [LU]: '_900001_1', 'ULTRA-B-X10300-2627': '_900002_1' });
  assert.equal(B.state.get().recent[0].url, 'https://u/a');
  assert.deepEqual(plain(A.state.get().openFolders), { _900001_1: ['f1'] });
});

test('an older cache write from a lagging tab does not replace newer data', async () => {
  const { A, B } = await twoTabs();
  const t = A.data.lastUpdated();
  await tick(5);
  await B.data.refresh();        // newer
  await settle(600);
  assert.ok(A.data.lastUpdated() > t, 'A took B\'s newer data');
  // A mutates its (now same-t) copy → rev bump wins in B as well
  await A.data.markRead([A.data.peek('events')[1]]);
  await settle(600);
  assert.equal(B.data.peek('events').find((e) => e.id === 'e2').read, true);
});

test('feed "seen" in one tab clears the feed in the other', async () => {
  const { A, B } = await twoTabs();
  await A.data.markFeedSeen();
  await settle(300);
  assert.deepEqual(plain(B.data.feed()), []);
});
