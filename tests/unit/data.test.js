/* Unit tests for src/core/data.js: models (courses, feed, deadlines, announcements), mutations, ICS,
   cache layout, Ultra course cache, session/stale handling. Real util/i18n/settings/state in a vm sandbox
   with a fake chrome; NOW is pinned at 12:00 local (no midnight/DST flakiness). */
'use strict';
process.env.TZ = 'Europe/Brussels';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, settle, tick } = require('../helpers/tp');

const DAY = 864e5, HOUR = 36e5;
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
// Values from the vm sandbox have other prototypes: compare as plain JSON.
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);

const LU_A = 'ULTRA-B-X10265-2627', LU_B = 'ULTRA-B-X10300-2627', LU_OLD = 'ULTRA-B-X1-2526';
const SETTINGS = { sync: { markReadInToledo: false }, deadlines: { horizonDays: 42, urgentDays: 3, reminder: '1d' } };

function seed(TP, NOW) {
  const T = TP.data._test;
  T._reset();
  T._put('enrollments', [
    { id: 11, learningUnitId: LU_A, title: 'Filmtaal 1 [X10265]', type: 'course', semester: 'SEMESTER1', academicYear: 2627, color: 1, favorite: false, available: true, link: 'https://x/a' },
    { id: 12, learningUnitId: LU_B, title: 'Montage [X10300]', type: 'course', semester: 'YEAR', academicYear: 2627, color: 2, favorite: true, available: true, link: 'https://x/b' },
    { id: 13, learningUnitId: LU_OLD, title: 'Oud vak [X1]', type: 'course', semester: 'SEMESTER2', academicYear: 2526, color: 3, favorite: false, available: true, link: '' },
    { id: 14, learningUnitId: 'COMM-1', title: 'Studentenraad', type: 'community', semester: 'UNKNOWN', academicYear: 0, color: 4, favorite: false, available: true, link: '' },
  ]);
  const ev = (id, sourceId, subType, title, date, extra = {}) => Object.assign({ id, title, source: sourceId === LU_A ? 'Filmtaal 1 [X10265]' : 'Montage [X10300]', sourceId, date, type: 'notifications', eventType: 'update', subType, read: false, seen: false, dismissed: false, url: 'https://e/' + id, color: 1 }, extra);
  T._put('events', [
    ev('e1', LU_A, 'content', 'slides week 3.pdf', NOW - 2 * HOUR),
    ev('e2', LU_A, 'content', 'clip.mp4', NOW - 3 * HOUR),
    ev('e3', LU_A, 'other', 'Opdracht 2', NOW - 4 * HOUR),
    ev('e4', LU_B, 'content', 'Leeswijzer', NOW - 1 * HOUR),
    ev('e5', LU_B, 'content', 'gelezen.pdf', NOW - 1 * HOUR, { read: true }),
    ev('e6', LU_B, 'content', 'weg.pdf', NOW - 1 * HOUR, { dismissed: true }),
    ev('e7', LU_A, 'course', 'Filmtaal 1', NOW - 1 * HOUR),
    ev('e8', LU_A, 'announcement', 'Les verplaatst', NOW - 5 * HOUR),
    ev('e9', LU_A, 'due', 'Scène 1 uploaden', NOW + 1 * DAY),
    ev('e10', LU_B, 'due', 'Montage-oefening', NOW + 10 * DAY),
    ev('adv', 'advalvas', 'advalvas', 'Sluiting campus', NOW - 1 * HOUR, { type: 'advalvas', source: 'Ad Valvas' }),
  ]);
  T._put('ultraDeadlines', [
    // duplicate of e9 with slightly different spelling/time → deduped
    { id: 'c1', title: 'Scene 1 Uploaden!', due: NOW + 1 * DAY + 60e3, courseLuId: LU_A, courseTitle: 'Filmtaal 1 [X10265]', cid: '_900001_1', url: 'https://ultra/1' },
    { id: 'c2', title: 'Reflectie', due: NOW + 5 * DAY, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: '_900002_1', url: null },
    { id: 'c3', title: 'Te ver', due: NOW + 100 * DAY, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: null },
    { id: 'c4', title: 'Gisteren', due: NOW - 1 * DAY, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: null },
    { id: 'c5', title: 'Lang geleden', due: NOW - 10 * DAY, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: null },
  ], { range: { from: NOW - 14 * DAY, until: NOW + 400 * DAY } });
}

async function setup(extra = {}) {
  const b = await boot(Object.assign({ settings: SETTINGS }, extra));
  const NOW = b.clock.now();
  seed(b.TP, NOW);
  return Object.assign(b, { NOW, D: b.TP.data, T: b.TP.data._test });
}

// ---- pure helpers -------------------------------------------------------
test('parseCalendarName splits on the first colon', async () => {
  const { T } = await setup();
  eq(plain(T.parseCalendarName('ULTRA-B-X10265-2627: Filmtaal 1 [X10265]')), { luId: 'ULTRA-B-X10265-2627', title: 'Filmtaal 1 [X10265]' });
  eq(plain(T.parseCalendarName('X: a: b')), { luId: 'X', title: 'a: b' });
  eq(plain(T.parseCalendarName('Persoonlijk')), { luId: '', title: 'Persoonlijk' });
  eq(plain(T.parseCalendarName(undefined)), { luId: '', title: '' });
});

test('mapCalendarItem maps a GradebookColumn calendar item', async () => {
  const { T } = await setup();
  const d = T.mapCalendarItem({ id: 'x', type: 'GradebookColumn', title: 'Taak', end: '2026-11-03T22:59:00.000Z', calendarId: '_900661_1', calendarName: 'ULTRA-B-X10265-2627: Filmtaal 1 [X10265]' });
  assert.equal(d.courseLuId, 'ULTRA-B-X10265-2627');
  assert.equal(d.due, Date.parse('2026-11-03T22:59:00.000Z'));
  assert.equal(d.url, 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900661_1/outline');
  assert.equal(T.mapCalendarItem({ calendarId: 'PERSONAL', calendarName: 'x', end: 1 }).url, null);
});

test('hash and normTitle are stable', async () => {
  const { T } = await setup();
  assert.equal(T.hash('abc'), T.hash('abc'));
  assert.notEqual(T.hash('abc'), T.hash('abd'));
  assert.equal(T.normTitle('  Scène 1 — Uploaden! '), 'scene 1 uploaden');
});

test('calendar windows are ≤ 60 days and capped (B2)', async () => {
  const { T, NOW } = await setup();
  const w = T.calWindows(NOW - 14 * DAY, NOW + 366 * DAY);
  assert.ok(w.length <= 7, `${w.length} windows`);
  for (const [a, b] of w) assert.ok(b - a <= 60 * DAY);
  assert.equal(w[0][0], NOW - 14 * DAY);
  assert.equal(w.at(-1)[1], NOW + 366 * DAY, 'covers the whole year view');
});

// ---- courses ---------------------------------------------------------------
test('courses: current year only, communities/hidden excluded, nickname + colors, no pins', async () => {
  const { TP, D } = await setup();
  await TP.settings.setCourse(LU_B, { nickname: 'Monteren', color: 'red' });
  await TP.settings.setCourse(LU_A, { color: '#123456' });
  const list = D.courses();
  eq(list.map((c) => c.luId), [LU_B, LU_A], 'activity: LU_B −1h before LU_A −2h');
  const b = D.course(LU_B);
  assert.equal(b.name, 'Monteren');
  assert.equal(b.color, TP.util.PALETTE.red);
  assert.equal(b.colorKey, 'red');
  assert.equal(b.pinned, undefined, 'no pinned flag any more');
  assert.equal(b.favorite, undefined, 'no favourite flag any more');
  const a = D.course(LU_A);
  assert.equal(a.color, '#123456');
  assert.equal(a.code, 'X10265');
  assert.equal(a.unread, 3); // e1,e2,e3 (announcement excluded by default, course/due excluded)
  assert.equal(D.courses({ currentOnly: false, includeCommunities: true }).length, 4);
  assert.equal(D.courses({ currentOnly: false, includeCommunities: true }).at(-1).type, 'community', 'communities last');
  await TP.settings.setCourse(LU_A, { hidden: true });
  assert.equal(D.courses().length, 1);
  assert.equal(D.courses({ includeHidden: true }).length, 2);
});

test('courses sort: activity, name, manual order (no pinned-first)', async () => {
  const { TP, D } = await setup();
  // activity: latest non-due, non-course event (LU_B −1h, LU_A −2h)
  eq(D.courses().map((c) => c.name), ['Montage', 'Filmtaal 1']);
  await TP.settings.set({ courses: { sort: 'name' } });
  eq(D.courses().map((c) => c.name), ['Filmtaal 1', 'Montage']);
  await TP.settings.set({ courses: { sort: 'manual', order: [LU_B, LU_A] } });
  eq(D.courses().map((c) => c.luId), [LU_B, LU_A]);
  await TP.settings.set({ courses: { sort: 'manual', order: [LU_A] } });
  eq(D.courses().map((c) => c.luId), [LU_A, LU_B], 'unknown courses after the ordered ones');
});

test('setPinned is a temporary no-op that returns false and never touches Toledo', async () => {
  const { D, calls } = await setup();
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  try {
    assert.equal(await D.setPinned(LU_A, true), false);
    assert.equal(await D.setPinned(LU_A, false), false);
  } finally { console.warn = warn; }
  assert.equal(warned, 1, 'logs once');
  assert.equal(calls.length, 0);
  assert.equal(D.setFavorite, undefined, 'favourite sync removed');
});

// ---- feed ------------------------------------------------------------------
test('feed: rules, grouping, counts and ordering', async () => {
  const { TP, D } = await setup();
  let f = D.feed();
  eq(f.map((g) => g.luId), [LU_A, LU_B]); // LU_A has a deadline ≤48h
  const a = f[0];
  eq(a.items.map((e) => e.id), ['e1', 'e2', 'e3']);
  eq(plain(a.counts), { file: 1, video: 1, page: 0, assignment: 1, announcement: 0 });
  assert.equal(a.name, 'Filmtaal 1');
  eq(f[1].items.map((e) => e.id), ['e4']);
  assert.equal(f[1].counts.page, 1);
  await TP.settings.set({ feed: { includeAnnouncements: true } });
  assert.equal(D.feed()[0].counts.announcement, 1);
  await TP.settings.setCourse(LU_A, { hidden: true });
  eq(D.feed().map((g) => g.luId), [LU_B]);
});

test('feed: markFeedSeen hides the current items; a late-published item with an OLDER date still shows (B3)', async () => {
  const { TP, D, NOW } = await setup();
  await D.markFeedSeen();
  eq(D.feed(), []);
  const st = TP.state.get().feedSeen;
  assert.ok(st.ids.e1 && st.ids.e4, 'seen ids stored');
  // Toledo publishes an item later whose date is older than everything seen.
  const ev = D.peek('events').concat({ id: 'late', title: 'laat.pdf', source: 'Montage [X10300]', sourceId: LU_B, date: NOW - 30 * HOUR, type: 'notifications', subType: 'content', read: false, dismissed: false });
  D._test._put('events', ev);
  eq(D.feed().flatMap((g) => g.items.map((e) => e.id)), ['late']);
});

test('feed: a v1.1 feedSeenAt is migrated to the floor of the new model', async () => {
  const { world } = require('../helpers/tp');
  const w = world({ local: { state: { feedSeenAt: 1234, done: { dold: true }, recent: [], cache: {} } } });
  const { TP } = await boot({ world: w });
  await settle(50);
  eq(plain(TP.state.get().feedSeen), { ids: {}, floor: 1234 });
  assert.equal(TP.state.get().feedSeenAt, undefined);
  assert.equal(typeof TP.state.get().done.dold, 'number', 'done:true → timestamp');
  assert.equal(w.stores.local.state, undefined, "legacy 'state' item removed");
  eq(w.stores.local['state:feedSeen'], { ids: {}, floor: 1234 });
});

test('feed: seen ids are bounded; evicted ones raise the floor', async () => {
  const { TP, D, NOW } = await setup();
  const many = Array.from({ length: 2100 }, (_, i) => ({ id: 'm' + i, title: 'f' + i + '.pdf', source: 'Montage [X10300]', sourceId: LU_B, date: NOW - (i + 1) * 60e3, type: 'notifications', subType: 'content', read: false, dismissed: false }));
  D._test._put('events', many);
  await D.markFeedSeen();
  const fs = TP.state.get().feedSeen;
  assert.equal(Object.keys(fs.ids).length, 2000);
  assert.equal(fs.floor, NOW - 2001 * 60e3, 'floor = newest evicted date');
  eq(D.feed(), []);
});

// ---- deadlines -------------------------------------------------------------
test('deadlines: merge, dedupe, window, done, custom', async () => {
  const { TP, D } = await setup();
  await TP.settings.set({ custom: [{ id: 'my1', title: 'Scène 1 uploaden', courseLuId: LU_A, due: D.peek('events').find((e) => e.id === 'e9').date }] });
  let list = D.deadlines();
  eq(list.map((d) => d.title), ['Lang geleden', 'Gisteren', 'Scène 1 uploaden', 'Scène 1 uploaden', 'Reflectie', 'Montage-oefening']);
  const toledo = list.find((d) => d.source === 'toledo' && d.courseLuId === LU_A);
  assert.equal(toledo.url, 'https://e/e9'); // Toledo wins, Ultra duplicate merged
  assert.equal(toledo.keys.length, 2, 'Toledo + Ultra key');
  assert.ok(list.find((d) => d.source === 'custom' && d.customId === 'my1'), 'custom never deduped away');
  assert.equal(toledo.courseName, 'Filmtaal 1');
  assert.match(toledo.key, /^d[0-9a-z]+$/);
  assert.equal(D.deadlines()[2].key, list[2].key, 'keys stable across calls');
  // done (via toggleDone: marks every merged source key)
  assert.equal(await D.toggleDone(toledo.key), true);
  assert.ok(!D.deadlines().some((d) => d.key === toledo.key));
  const again = D.deadlines({ includeDone: true }).find((d) => d.key === toledo.key);
  assert.ok(again.done);
  assert.equal(typeof TP.state.get().done[toledo.keys[1]], 'number', 'ultra alias marked too');
  assert.equal(await D.toggleDone(toledo.key), false);
  assert.ok(!D.deadlines({ includeDone: true }).find((d) => d.key === toledo.key).done);
  // horizon
  assert.ok(D.deadlines({ horizonDays: 200 }).some((d) => d.title === 'Te ver'));
  assert.ok(!D.deadlines().some((d) => d.title === 'Te ver'));
});

test('deadlines: overdue items stay until done, whatever their age (B2)', async () => {
  const { D, NOW } = await setup();
  let list = D.deadlines();
  const old = list.find((d) => d.title === 'Lang geleden');
  assert.ok(old, '10 days overdue is still listed');
  assert.equal(old.overdue, true);
  assert.equal(old.ageDays, 10);
  const y = list.find((d) => d.title === 'Gisteren');
  assert.equal(y.overdue, true); assert.equal(y.ageDays, 1);
  const future = list.find((d) => d.title === 'Reflectie');
  assert.equal(future.overdue, false); assert.equal(future.ageDays, 0);
  await D.toggleDone(old.key);
  list = D.deadlines({ includeDone: true });
  // TP-209: a done item stays listed (Klaar) for HORIZON.donePastDays after its due date, so the tick can be undone.
  assert.equal(D.HORIZON.donePastDays, 120);
  assert.ok(list.some((d) => d.title === 'Lang geleden' && d.done), 'done 10 days after due → still listed as done');
  assert.ok(!D.deadlines({ includeDone: true, pastDays: 7 }).some((d) => d.title === 'Lang geleden'), 'pastDays narrows it');
  await D.toggleDone(y.key);
  const yd = D.deadlines({ includeDone: true }).find((d) => d.title === 'Gisteren');
  assert.ok(yd.done && !yd.overdue, 'done items are not overdue');
  // 300 days overdue, not done → still there
  D._test._put('ultraDeadlines', D.peek('ultraDeadlines').concat({ id: 'c9', title: 'Vergeten', due: NOW - 300 * DAY, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: null }), { range: { from: NOW - 14 * DAY, until: NOW + 400 * DAY } });
  assert.equal(D.deadlines().find((d) => d.title === 'Vergeten').ageDays, 300);
});

test('deadlines: dedupe within ±2 h across midnight (23:59 vs 00:00), not beyond (B13)', async () => {
  const { D, NOW } = await setup();
  const d0 = new Date(NOW + 3 * DAY); d0.setHours(23, 59, 0, 0);
  const d1 = new Date(NOW + 4 * DAY); d1.setHours(0, 0, 0, 0);
  const ev = D.peek('events').concat({ id: 'm1', title: 'Paper', source: 'Montage [X10300]', sourceId: LU_B, date: d0.getTime(), type: 'notifications', subType: 'due', read: false, dismissed: false });
  D._test._put('events', ev);
  D._test._put('ultraDeadlines', [
    { id: 'u1', title: 'paper', due: d1.getTime(), courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: 'https://ultra/p' },
    { id: 'u2', title: 'Paper', due: d0.getTime() + 3 * HOUR, courseLuId: LU_B, courseTitle: 'Montage [X10300]', cid: null, url: null },
    { id: 'u3', title: 'Paper', due: d0.getTime(), courseLuId: LU_A, courseTitle: 'Filmtaal 1 [X10265]', cid: null, url: null },
  ], { range: { from: NOW - 14 * DAY, until: NOW + 400 * DAY } });
  const papers = D.deadlines().filter((d) => /paper/i.test(d.title));
  assert.equal(papers.length, 3, 'm1+u1 merged; u2 (+3h) and u3 (other course) separate');
  const merged = papers.find((d) => d.source === 'toledo');
  assert.equal(merged.url, 'https://ultra/p', 'url filled from the duplicate');
  assert.equal(merged.keys.length, 2);
});

test('deadline keys are based on the source id: a moved due date keeps done + ICS UID (B13)', async () => {
  const { TP, D, NOW } = await setup();
  const before = D.deadlines().find((d) => d.title === 'Reflectie');
  await D.toggleDone(before.key);
  const moved = D.peek('ultraDeadlines').map((d) => (d.id === 'c2' ? Object.assign({}, d, { due: NOW + 9 * DAY }) : d));
  D._test._put('ultraDeadlines', moved, { range: { from: NOW - 14 * DAY, until: NOW + 400 * DAY } });
  const after = D.deadlines({ includeDone: true }).find((d) => d.title === 'Reflectie');
  assert.equal(after.key, before.key);
  assert.ok(after.done, 'still done after the move');
  assert.ok(D.ics([after]).includes(`UID:${before.key}@toledo-plus`));
  assert.equal(after.key, D._test.ultraKey({ id: 'c2' }));
  assert.equal(TP.state.get().done[before.key] > 0, true);
});

test('done marks stored under the v1.1 key are migrated to the source-id key (B13)', async () => {
  const { TP, D, T, NOW } = await setup();
  const e9 = D.peek('events').find((e) => e.id === 'e9');
  const c2 = D.peek('ultraDeadlines').find((d) => d.id === 'c2');
  const oldA = T.legacyKey(e9.title, e9.sourceId, e9.date);
  const oldB = T.legacyKey(c2.title, c2.courseLuId, c2.due);
  await TP.state.set({ done: { [oldA]: NOW - DAY, [oldB]: NOW - DAY } });
  const patch = T.migrateDoneKeys();
  await settle(200);
  const done = TP.state.get().done;
  assert.equal(done[oldA], undefined); assert.equal(done[oldB], undefined);
  assert.equal(done[T.toledoKey(e9)], NOW - DAY);
  assert.equal(done[T.ultraKey(c2)], NOW - DAY);
  assert.ok(Object.keys(patch).length >= 3);
  assert.ok(!D.deadlines().some((d) => d.title === 'Reflectie'), 'still done');
  eq(plain(T.migrateDoneKeys()), {}, 'idempotent');
});

test('custom deadline keys stay as they were; toggling an unknown key works', async () => {
  const { TP, D } = await setup();
  await TP.settings.set({ custom: [{ id: 'my1', title: 'X', courseLuId: '', due: Date.now() + DAY }] });
  const c = D.deadlines().find((d) => d.source === 'custom');
  assert.equal(c.key, 'c' + D._test.hash('my1'));
  assert.equal(await D.toggleDone('dunknown'), true);
  assert.ok(TP.state.get().done.dunknown);
});

test('the deadlines view asks for 366 days → the missing calendar range is fetched lazily', async () => {
  const urls = [];
  const { D, NOW } = await setup({ net: { json: async (url) => { urls.push(url); return { results: [{ id: 'far', type: 'GradebookColumn', title: 'Eindwerk', end: new Date(Date.now() + 300 * DAY).toISOString(), calendarName: LU_B + ': Montage [X10300]' }] }; } } });
  D._test._put('ultraDeadlines', D.peek('ultraDeadlines').filter((d) => d.due < NOW + 50 * DAY), { range: { from: NOW - 14 * DAY, until: NOW + 42 * DAY } });
  let changed = false; D.on('change', (k) => { if (k === 'ultraDeadlines') changed = true; });
  assert.ok(!D.deadlines({ horizonDays: 366 }).some((d) => d.title === 'Eindwerk'));
  await tick(50);
  assert.ok(changed, "'change' after the lazy load");
  assert.ok(urls.length >= 1 && urls.length <= 6, `${urls.length} windows`);
  for (const u of urls) {
    const q = new URL(u).searchParams;
    assert.ok(Date.parse(q.get('since')) >= NOW + 41 * DAY, 'only the part beyond the cached range');
    assert.ok(Date.parse(q.get('until')) - Date.parse(q.get('since')) <= 60 * DAY);
  }
  assert.ok(D.deadlines({ horizonDays: 366 }).some((d) => d.title === 'Eindwerk'));
  assert.ok(D.deadlines({ horizonDays: 366 }).some((d) => d.title === 'Reflectie'), 'existing items kept');
  const n = urls.length;
  D.deadlines({ horizonDays: 366 }); await tick(20);
  assert.equal(urls.length, n, 'no refetch once covered');
});

test('refresh keeps overdue, not-done Ultra deadlines that fell out of the fetch window', async () => {
  const { D, NOW } = await setup({ net: { json: async () => ({ results: [] }) } });
  await D.load('ultraDeadlines', { force: true });
  eq(D.peek('ultraDeadlines'), [], 'c4/c5 (≤ 14 days old) lie inside the fetch window → replaced');
  // an older overdue one lies before the (routine, 14-day) fetch window → retained:
  const routine = { range: { from: NOW - 14 * DAY, until: NOW + 42 * DAY, deepAt: NOW } };
  D._test._put('ultraDeadlines', [{ id: 'o1', title: 'Heel oud', due: NOW - 40 * DAY, courseLuId: LU_B, courseTitle: '', cid: null, url: null }], routine);
  await D.load('ultraDeadlines', { force: true });
  eq(D.peek('ultraDeadlines').map((d) => d.title), ['Heel oud']);
  // done: still kept (Klaar) within HORIZON.donePastDays …
  await D.toggleDone(D.deadlines().find((d) => d.title === 'Heel oud').key);
  await D.load('ultraDeadlines', { force: true });
  eq(D.peek('ultraDeadlines').map((d) => d.title), ['Heel oud'], 'done 40 days ago: kept');
  // … and dropped once it is older than that.
  D._test._put('ultraDeadlines', [{ id: 'o1', title: 'Heel oud', due: NOW - 130 * DAY, courseLuId: LU_B, courseTitle: '', cid: null, url: null }], routine);
  await D.load('ultraDeadlines', { force: true });
  eq(D.peek('ultraDeadlines'), [], 'done and older than donePastDays → dropped');
});

test('Ultra calendar: the first fetch and one a day reach 120 days back (TP-195); routine refreshes 14 days', async () => {
  const urls = [];
  const { D, NOW } = await setup({ net: { json: async (u) => { urls.push(u); return { results: [] }; } } });
  D._test._reset();
  const since = (u) => Date.parse(decodeURIComponent(/since=([^&]+)/.exec(u)[1]));
  await D.load('ultraDeadlines', { force: true });
  assert.equal(Math.round((NOW - Math.min(...urls.map(since))) / DAY), 120, 'first fetch is deep');
  const deepAt = D._test._entry('ultraDeadlines').range.deepAt;
  assert.ok(deepAt > 0);
  urls.length = 0;
  await D.load('ultraDeadlines', { force: true });
  assert.equal(Math.round((NOW - Math.min(...urls.map(since))) / DAY), 14, 'routine refresh');
  assert.equal(D._test._entry('ultraDeadlines').range.deepAt, deepAt);
});

test('Ultra calendar: items that are not gradebook columns are kept apart, not dropped (TP-196)', async () => {
  const item = (id, type, title, startOff) => ({ id, type, title, start: new Date(Date.now() + startOff).toISOString(), end: new Date(Date.now() + startOff + HOUR).toISOString(), calendarName: 'ULTRA-B-X10300-2627: Montage [X10300]', calendarId: '_900002_1' });
  const { D } = await setup({ net: { json: async () => ({ results: [
    item('a', 'Course', 'Online vragenuurtje', 2 * DAY), item('b', 'GradebookColumn', 'Tentamen Statistiek', 3 * DAY), item('c', 'User', 'Eigen herinnering', 4 * DAY),
  ] }) } });
  await D.load('ultraDeadlines', { force: true });
  eq(D.peek('ultraDeadlines').map((d) => d.title), ['Tentamen Statistiek']);
  eq(D.calendarItems().map((d) => [d.title, d.type]), [['Online vragenuurtje', 'Course'], ['Eigen herinnering', 'User']]);
  eq(D.calendarItems({ from: Date.now() + 3.5 * DAY }).map((d) => d.title), ['Eigen herinnering']);
});

test('deadlines: own deadlines are never cut off on the Deadlines page horizon (TP-015)', async () => {
  const { TP, D, NOW } = await setup();
  await D.addCustomDeadline({ title: 'Ver weg', courseLuId: '', due: NOW + 4 * 365 * DAY });
  assert.ok(D.deadlines({ horizonDays: D.HORIZON.viewDays }).some((d) => d.title === 'Ver weg'), 'Deadlines page shows it');
  assert.ok(!D.deadlines({ horizonDays: 42 }).some((d) => d.title === 'Ver weg'), 'Overview keeps its own horizon');
  void TP;
});

// ---- announcements / kindOf / ICS ---------------------------------------------
test('announcements filters (+ local read-set for unread)', async () => {
  const { TP, D } = await setup();
  eq(D.announcements().map((e) => e.id), ['adv', 'e8']);
  eq(D.announcements({ filter: 'school' }).map((e) => e.id), ['adv']);
  eq(D.announcements({ filter: 'courses' }).map((e) => e.id), ['e8']);
  eq(D.announcements({ filter: 'unread' }).map((e) => e.id), ['adv', 'e8']);
  await TP.state.set({ read: { adv: Date.now() } });
  eq(D.announcements({ filter: 'unread' }).map((e) => e.id), ['e8']);
});

test('kindOf for events and content nodes', async () => {
  const { D } = await setup();
  assert.equal(D.kindOf({ subType: 'content', title: 'a.PDF' }), 'file');
  assert.equal(D.kindOf({ subType: 'content', title: 'a.mov' }), 'video');
  assert.equal(D.kindOf({ subType: 'content', title: 'Week 1' }), 'page');
  assert.equal(D.kindOf({ subType: 'advalvas', type: 'advalvas' }), 'notice');
  assert.equal(D.kindOf({ contentHandler: { id: 'resource/x-bb-folder' } }), 'folder');
  assert.equal(D.kindOf({ contentHandler: { id: 'resource/x-bb-file', file: { mimeType: 'video/mp4' } } }), 'video');
  assert.equal(D.kindOf({ contentHandler: { id: 'resource/x-bb-asmt-test-link' } }), 'assignment');
  assert.equal(D.kindOf({ contentHandler: { id: 'resource/x-bb-blti-link' } }), 'tool');
  assert.equal(D.kindOf({ contentHandler: { id: 'resource/x-bb-externallink', url: 'https://a' } }), 'link');
});

test('ics: valid structure, CRLF, escaping, folding, alarm', async () => {
  const { TP, D } = await setup();
  const due = Date.UTC(2026, 10, 3, 22, 59, 0);
  const d = { key: 'dabc', title: 'Scène 1; deel 2, \\ final\nversie', courseName: 'Filmtaal 1', due, url: 'https://e/9' };
  const long = { key: 'dlong', title: 'é'.repeat(80), courseName: 'X', due, url: null };
  const s = D.ics([d, long]);
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:'));
  assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(s), 'every LF preceded by CR');
  const lines = s.split('\r\n');
  for (const l of lines) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'line ≤ 75 octets: ' + l);
  assert.ok(lines.includes('UID:dabc@toledo-plus'));
  assert.ok(lines.includes('DTSTART:20261103T222900Z'));
  assert.ok(lines.includes('DTEND:20261103T225900Z'));
  assert.ok(lines.includes('SUMMARY:Filmtaal 1: Scène 1\\; deel 2\\, \\\\ final\\nversie'));
  assert.ok(lines.includes('URL:https://e/9'));
  assert.ok(lines.includes('TRIGGER;RELATED=END:-P1D'), 'reminder counts back from the due time, not from DTSTART (TP-107)');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 2);
  const unfolded = s.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:X: ' + 'é'.repeat(80) + '\r\n'));
  await TP.settings.set({ deadlines: { reminder: 'none' } });
  assert.ok(!D.ics([d]).includes('VALARM'));
  await TP.settings.set({ deadlines: { reminder: '1h' } });
  assert.ok(D.ics([d]).includes('TRIGGER;RELATED=END:-PT1H'));
});

// ---- mark read ------------------------------------------------------------------
test('markRead: optimistic update; PATCH body (keepalive) when sync on; never throws', async () => {
  const { TP, D, calls } = await setup();
  const e1 = D.peek('events').find((e) => e.id === 'e1');
  let changed = 0; const fn = () => changed++;
  D.on('change', fn);
  assert.equal(await D.markRead([e1]), true);
  assert.equal(D.peek('events').find((e) => e.id === 'e1').read, true);
  assert.equal(calls.length, 0);
  await TP.settings.set({ sync: { markReadInToledo: true } });
  const e2 = D.peek('events').find((e) => e.id === 'e2');
  assert.equal(await D.markRead([e2]), true);
  assert.equal(calls.at(-1).opts.method, 'PATCH');
  assert.equal(calls.at(-1).opts.keepalive, true);
  assert.match(calls.at(-1).url, /\/portal\/api\/batch\/events$/);
  eq(plain(calls.at(-1).opts.body), [{ id: 'e2', type: 'notifications', subType: 'content', read: true }]);
  TP.net.json = async () => { throw Object.assign(new Error('x'), { status: 500 }); };
  const e3 = D.peek('events').find((e) => e.id === 'e3');
  const warn = console.debug; console.debug = () => {};
  try { assert.equal(await D.markRead([e3]), false); } finally { console.debug = warn; }
  assert.equal(D.peek('events').find((e) => e.id === 'e3').read, true);
  D.off('change', fn);
  assert.ok(changed >= 3);
});

test('markRead: 250 events → PATCH chunks of 100; failed chunk queued in pendingRead and sent on refresh (B7)', async () => {
  let n = 0; const bodies = [];
  const { TP, D } = await setup({ settings: Object.assign({}, SETTINGS, { sync: { markReadInToledo: true } }), net: {
    json: async (url, opts) => {
      if (opts && opts.method === 'PATCH') { n++; bodies.push(opts.body); if (n === 2) throw Object.assign(new Error('503'), { status: 503 }); return null; }
      return url.includes('/calendars/') ? { results: [] } : [];
    },
  } });
  const many = Array.from({ length: 250 }, (_, i) => ({ id: 'x' + i, type: 'notifications', subType: 'content', title: 't', date: 1, sourceId: LU_A }));
  const dbg = console.debug; console.debug = () => {};
  try { assert.equal(await D.markRead(many), false); } finally { console.debug = dbg; }
  eq(bodies.map((b) => b.length), [100, 100, 50]);
  await settle(250);
  const q = TP.state.get().pendingRead;
  assert.equal(Object.keys(q).length, 100, 'the failed chunk is queued');
  eq(plain(q.x100), { id: 'x100', type: 'notifications', subType: 'content', t: q.x100.t });
  bodies.length = 0;
  await D.refresh();
  assert.equal(bodies[0].length, 100, 'queue flushed first on refresh');
  await settle(250);
  eq(plain(TP.state.get().pendingRead), {}, 'queue emptied');
});

test('read-set: with sync off, "read" survives a refresh that returns unread events (B4)', async () => {
  const fresh = (now) => [{ id: 'r1', title: 'a.pdf', source: 'Montage [X10300]', sourceId: LU_B, date: now - HOUR, type: 'notifications', subType: 'content', read: false, dismissed: false }];
  let N = 0;
  const { TP, D, NOW } = await setup({ net: { json: async (url) => (url.endsWith('/events') ? fresh(N) : url.includes('/calendars/') ? { results: [] } : []) } });
  N = NOW;
  await D.load('events', { force: true });
  assert.equal(D.feed().length, 1);
  await D.markRead(D.peek('events'));
  assert.equal(D.feed().length, 0);
  await D.load('events', { force: true });
  assert.equal(D.peek('events')[0].read, true, 'read-set applied to fresh data');
  assert.equal(D.feed().length, 0);
  await settle(250);
  assert.ok(TP.state.get().read.r1);
});

test('flush() waits for state writes and PATCHes; never rejects', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { world, D } = await setup({ settings: Object.assign({}, SETTINGS, { sync: { markReadInToledo: true } }), net: { json: async () => { await gate; return null; } } });
  await D.addRecent({ title: 'Doc', url: 'https://u/1', courseName: 'Filmtaal 1', kind: 'file' });
  const e1 = D.peek('events').find((e) => e.id === 'e1');
  D.markRead([e1]);
  let done = false;
  const f = D.flush().then(() => { done = true; });
  await tick(20);
  assert.equal(done, false, 'waits for the PATCH');
  release();
  await f;
  assert.equal(world.stores.local['state:recent'][0].url, 'https://u/1', 'recent written before navigation');
});

// ---- state pruning ------------------------------------------------------------
test('pruneState: read-set, done (> 60 days and unreferenced), visits/openFolders of old courses', async () => {
  const { TP, D, T, NOW } = await setup();
  const ref = D.deadlines()[0].key;
  await TP.state.set({
    read: { a: NOW, b: NOW - 200 * DAY },
    done: { [ref]: NOW - 100 * DAY, gone: NOW - 100 * DAY, recent: NOW - DAY },
    cidMap: { [LU_A]: '_900001_1', [LU_OLD]: '_900009_1' },
    visits: { _900001_1: NOW, _900009_1: NOW, _900077_1: NOW - 200 * DAY, _900078_1: NOW },
    openFolders: { _900001_1: ['x'], _900009_1: ['y'], _900077_1: ['z'] },
  });
  T.pruneState();
  await settle(250);
  const st = TP.state.get();
  eq(Object.keys(st.read), ['a']);
  eq(Object.keys(st.done).sort(), [ref, 'recent'].sort(), 'referenced marks stay, even when old');
  eq(Object.keys(st.visits).sort(), ['_900001_1', '_900078_1']);
  eq(Object.keys(st.openFolders), ['_900001_1']);
});

// ---- cache layout ---------------------------------------------------------------
test("cache: one storage item per key ('cache:<key>'), events capped; v1.1 'cache' migrated", async () => {
  const { world: mk } = require('../helpers/tp');
  const w = mk({ local: { cache: { mail: { v: 7, t: 5 }, junk: { v: 1, t: 1 } } } });
  const { TP } = await boot({ world: w });
  const D = TP.data, T = D._test;
  await settle(50);
  assert.equal(D.peek('mail'), 7);
  eq(w.stores.local['cache:mail'], { v: 7, t: 5, rev: 0 });
  assert.equal(w.stores.local.cache, undefined);
  const many = Array.from({ length: 900 }, (_, i) => ({ id: i, date: i }));
  const out = T.trimEntry('events', { v: many, t: 1 });
  assert.equal(out.v.length, 600);
  assert.equal(out.v[0].id, 899);
  assert.equal(T.trimEntry('mail', { v: 3, t: 2 }).v, 3);
});

test('storage write errors (quota) never surface as unhandled rejections (B14)', async () => {
  const { world: mk } = require('../helpers/tp');
  const w = mk();
  const { TP: { data: D } } = await boot({ world: w, chrome: { localFail: () => 'QUOTA_BYTES quota exceeded' }, net: { json: async () => ({ value: 7 }) } });
  let unhandled = 0; const h = () => unhandled++;
  process.on('unhandledRejection', h);
  const warn = console.warn, dbg = console.debug; console.warn = () => {}; console.debug = () => {};
  try {
    await D.load('mail', { force: true });
    await D.addRecent({ title: 'a', url: 'https://u/2' });
    await D.flush();
    await settle(500);
  } finally { console.warn = warn; console.debug = dbg; process.off('unhandledRejection', h); }
  assert.equal(unhandled, 0);
  assert.equal(D.peek('mail'), 7, 'in memory regardless');
});

// ---- Ultra course cache (B5) -------------------------------------------------
function ultraNet(opts = {}) {
  const hits = {};
  const json = async (url) => {
    const p = new URL(url).pathname;
    hits[p] = (hits[p] || 0) + 1;
    if (opts.fail && opts.fail(p, hits[p])) throw Object.assign(new Error('503'), { status: 503 });
    if (/\/v3\/courses\/_9_1$/.test(p)) return { id: '_9_1', courseId: LU_A, name: 'Filmtaal 1' };
    if (/\/contents$/.test(p)) return { results: [{ id: 'f1', title: 'Week 1', hasChildren: true }, { id: 'p1', title: 'Info', contentHandler: { id: 'resource/x-bb-document' } }] };
    if (/\/contents\/f1\/children$/.test(p)) return { results: [{ id: 'd1', title: 'a.pdf', contentHandler: { id: 'resource/x-bb-file' } }] };
    return { results: [] };
  };
  return { json, hits };
}

test('ultraCourse: top-level failure → contentsError and not cached; next call retries', async () => {
  const n = ultraNet({ fail: (p, i) => /\/contents$/.test(p) && i === 1 });
  const { D } = await setup({ net: { json: n.json } });
  const r1 = await D.ultraCourse('_9_1');
  assert.ok(r1.contentsError, 'error reported');
  assert.equal(r1.contentsError.status, 503);
  assert.equal(r1.roots.length, 0);
  const r2 = await D.ultraCourse('_9_1');
  assert.ok(!r2.contentsError);
  assert.equal(r2.roots.length, 2);
  assert.equal(r2.roots[0].kids[0].id, 'd1');
  await D.ultraCourse('_9_1');
  assert.equal(n.hits['/learn/api/public/v1/courses/_9_1/contents'], 2, 'complete result cached');
});

test('ultraCourse: a failing folder is retried with backoff; still failing → failed:true, not cached', async () => {
  const flaky = ultraNet({ fail: (p, i) => /f1\/children$/.test(p) && i === 1 });
  const { D, T } = await setup({ net: { json: flaky.json } });
  T.cfg.folderRetryMs = [5, 10];
  const r = await D.ultraCourse('_9_1');
  assert.equal(r.failedFolders, 0, 'second round succeeded');
  assert.equal(r.roots[0].kids.length, 1);
  assert.ok(!r.roots[0].failed);

  const broken = ultraNet({ fail: (p) => /f1\/children$/.test(p) });
  const b = await setup({ net: { json: broken.json } });
  b.T.cfg.folderRetryMs = [5, 10];
  const r2 = await b.D.ultraCourse('_9_1');
  assert.equal(r2.failedFolders, 1);
  assert.equal(r2.roots[0].failed, true);
  eq(r2.roots[0].kids, []);
  assert.equal(broken.hits['/learn/api/public/v1/courses/_9_1/contents/f1/children'], 3, '1 + 2 retry rounds');
  await b.D.ultraCourse('_9_1');
  assert.equal(broken.hits['/learn/api/public/v1/courses/_9_1/contents'], 2, 'not cached → refetched');
});

test('ultraCourse cache: refresh() clears it (+ courseCache event); LRU of 5; 10 min TTL', async () => {
  const n = ultraNet();
  const { D, T, clock } = await setup({ net: { json: async (url) => (url.includes('/portal/') ? [] : n.json(url)) } });
  await D.ultraCourse('_9_1');
  let cleared = 0; D.on('courseCache', (e) => { if (e.cleared) cleared++; });
  await D.refresh();
  assert.equal(cleared, 1);
  assert.equal(T.courseCacheSize(), 0);
  for (const cid of ['_1_1', '_2_1', '_3_1', '_4_1', '_5_1', '_6_1']) await D.ultraCourse(cid);
  assert.equal(T.courseCacheSize(), 5);
  const before = n.hits['/learn/api/public/v1/courses/_6_1/contents'];
  await D.ultraCourse('_6_1');
  assert.equal(n.hits['/learn/api/public/v1/courses/_6_1/contents'], before, 'cached');
  clock.add(11 * 60e3);
  await D.ultraCourse('_6_1');
  assert.equal(n.hits['/learn/api/public/v1/courses/_6_1/contents'], before + 1, 'expired after 10 min');
});

// ---- session / stale (F4) ---------------------------------------------------------
test("session expired: status(key).auth, one 'auth' event, loginUrl; recovers on success", async () => {
  let expired = true;
  const { D } = await setup({ net: { json: async () => { if (expired) throw Object.assign(new Error('login page'), { status: 200, auth: true }); return []; } } });
  const seen = [];
  D.on('auth', (e) => seen.push(plain(e)));
  const dbg = console.debug; console.debug = () => {};
  try { await D.refresh(); } finally { console.debug = dbg; }
  assert.equal(D.status('events').auth, true);
  assert.equal(D.authExpired(), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].expired, true);
  assert.equal(D.loginUrl(), 'https://toledo.kuleuven.be/portal/');
  D._test._put('links', [{ label: 'x', links: [{ label: 'LOGIN', url: '/portal/login' }] }]);
  assert.equal(D.loginUrl(), 'https://toledo.kuleuven.be/portal/login');
  expired = false;
  await D.refresh();
  assert.equal(D.authExpired(), false);
  assert.equal(seen.at(-1).expired, false);
  assert.equal(D.status('events').auth, false);
});

test("Ultra 401 (no Ultra session yet): 'ultraAuth' event, Toledo session not flagged; clears on success", async () => {
  let ultraOk = false;
  const { D } = await setup({ net: { json: async (url) => {
    if (/ultra\.edu/.test(url) && !ultraOk) throw Object.assign(new Error('401'), { status: 401, auth: true });
    return /ultra\.edu/.test(url) ? { results: [] } : [];
  } } });
  const auth = [], ultra = [];
  D.on('auth', (e) => auth.push(plain(e)));
  D.on('ultraAuth', (e) => ultra.push(plain(e)));
  const dbg = console.debug; console.debug = () => {};
  try { await D.refresh(); } finally { console.debug = dbg; }
  assert.equal(D.authExpired(), false, 'Toledo session is fine');
  assert.equal(auth.length, 0, 'no "session expired" banner');
  assert.equal(D.ultraAuthExpired(), true);
  eq(ultra, [{ expired: true }]);
  assert.match(D.ultraLoginUrl(), /^https:\/\/ultra\.edu\.kuleuven\.cloud\//);
  ultraOk = true;
  await D.load('ultraDeadlines', { force: true });
  assert.equal(D.ultraAuthExpired(), false);
  eq(ultra.at(-1), { expired: false });
});

test("extension context invalidated: one 'stale' event, no more writes or loads", async () => {
  const { D, chrome, world } = await setup();
  let stale = 0; D.on('stale', () => stale++);
  chrome._invalidate();
  const res = await D.refresh();
  assert.equal(res.stale, true);
  assert.equal(stale, 1);
  assert.equal(D.isStale(), true);
  const writes = world.writes.length;
  await D.markRead([D.peek('events')[0]]);
  await D.addRecent({ title: 'x', url: 'https://u/3' });
  await settle(500);
  assert.equal(world.writes.length, writes, 'no storage writes after invalidation');
  assert.equal(await D.maybeRefresh(), null);
  await D.refresh();
  assert.equal(stale, 1, 'emitted once');
});

test('maybeRefresh: only when data is older than 5 minutes', async () => {
  let n = 0;
  const { D, clock } = await setup({ net: { json: async (url) => { n++; return url.includes('/calendars/') ? { results: [] } : []; } } });
  await D.refresh();
  const after = n;
  assert.equal(await D.maybeRefresh(), null);
  assert.equal(n, after);
  clock.add(6 * 60e3);
  const r = await D.maybeRefresh();
  assert.ok(r && r.ok);
  assert.ok(n > after);
});

// ---- user's first name (greeting, v1.5) ---------------------------------
test('firstName: first given name only, trimmed, no control characters, bounded', async () => {
  const { TP } = await boot();
  const f = TP.data._test.firstName;
  assert.equal(f({ name: { given: 'Alex Jan', family: 'Voorbeeld' } }), 'Alex');
  assert.equal(f({ name: { given: '  Anne-Marie ' } }), 'Anne-Marie');
  assert.equal(f({ name: { given: 'Al\u0007ex' } }), 'Alex');
  assert.equal(f({ name: { given: '' } }), '');
  assert.equal(f(null), '');
  assert.equal(f({ name: { given: 'x'.repeat(80) } }).length, 40);
});

test('loadUser: Ultra users/me → state.me (local only); cached a week; failure is silent and keeps the session state', async () => {
  const net = { json: async (url) => { return /users\/me$/.test(url) ? { name: { given: 'Alex Jan' } } : null; } };
  const b = await boot({ net });
  const { TP, world: w } = b;
  assert.equal(TP.data.userName(), '');
  assert.equal(await TP.data.loadUser(), 'Alex');
  await settle();
  assert.equal(TP.data.userName(), 'Alex');
  assert.equal(w.stores.local['state:me'].given, 'Alex', 'chrome.storage.local');
  assert.ok(!JSON.stringify(w.stores.sync || {}).includes('Alex'), 'never synced');
  // within a week: no new request
  let asked = 0;
  TP.net.json = async () => { asked++; return { name: { given: 'Other' } }; };
  assert.equal(await TP.data.loadUser(), 'Alex');
  assert.equal(asked, 0);
  // a failing call never flags the session as expired and keeps the cached name
  TP.net.json = async () => { throw Object.assign(new Error('401'), { status: 401, auth: true }); };
  assert.equal(await TP.data.loadUser({ force: true }), 'Alex');
  assert.equal(TP.data.authExpired(), false);
});

// ---- local wipe (pattern 7: TP-181 logout, TP-003 reset) ----------------------
const { world: mkWorld } = require('../helpers/tp');
function seededWorld() {
  return mkWorld({ local: {
    'cache:enrollments': { v: [{ id: 1, learningUnitId: LU_A, title: 'Filmtaal 1 [X10265]', type: 'course', academicYear: 2627 }], t: 1, rev: 0 },
    'cache:events': { v: [], t: 1, rev: 0 }, 'cache:mail': { v: 3, t: 1, rev: 0 },
    'kuloket:icsUrl': 'https://cloud.timeedit.net/kuleuven/web/x/s.ics?sid=secret', 'kuloket:icsUrlT': 1, 'kuloket:exams': { t: 1, items: [] },
    'kuloket:lessons:2026-W44': { t: 1, items: [] }, 'kuloket:meta': { weeks: ['2026-W44'] },
    index: { c1: { items: [] } }, indexMeta: { lastCrawl: 1 },
    'state:me': { given: 'Alex', t: 1 }, 'state:recent': [{ title: 'Geheim.pdf' }], 'state:done': { d1: 1 }, 'state:ui': { sidebarCollapsed: true },
    'telemetry:id': '3f2b8c1e-5d4a-4c3b-9a8e-1b2c3d4e5f60', 'telemetry:lastPing': 1, 'telemetry:forget': [],
    'tp:loggedOutAt': 1, settingsLocal: { v: 5 }, 'fulltext:budget': { day: 'x', bytes: 1 },
  } });
}

test('wipeLocal({scope:"user"}) (logout): cached Toledo/KU Loket data, the iCal link, index, name and recent docs are gone; marks and prefs stay', async () => {
  const w = seededWorld();
  const { TP } = await boot({ world: w });
  assert.equal(TP.data.peek('mail'), 3);
  const p = TP.data.wipeLocal({ scope: 'user' });
  // phase 1 is synchronous: the fixed keys are already gone before the promise settles (a logout navigation follows)
  assert.equal(w.stores.local['cache:enrollments'], undefined);
  assert.equal(w.stores.local['kuloket:icsUrl'], undefined);
  assert.equal(TP.data.peek('mail'), null, 'memory cleared too');
  assert.equal(await p, true);
  await settle(50);
  const left = Object.keys(w.stores.local).sort();
  for (const k of left) assert.ok(!/^(cache:|kuloket:|index)/.test(k), 'left behind: ' + k);
  assert.ok(!('state:me' in w.stores.local) && !('state:recent' in w.stores.local));
  for (const k of ['state:done', 'state:ui', 'telemetry:id', 'tp:loggedOutAt', 'settingsLocal']) assert.ok(k in w.stores.local, 'kept: ' + k);
  assert.ok(!(('tp:wipePending') in w.stores.local), 'marker removed when done');
});

test('wipeLocal({scope:"all"}) (reset): everything goes except the deletion queue and settings fallbacks; the install id is queued for /v1/forget', async () => {
  const w = seededWorld();
  const forgot = [];
  const { TP, s } = await boot({ world: w });
  s.ctx.TP.telemetry = { forget: async () => { forgot.push(w.stores.local['telemetry:id']); w.stores.local['telemetry:forget'] = [w.stores.local['telemetry:id']]; delete w.stores.local['telemetry:id']; return true; } };
  await TP.data.wipeLocal({ scope: 'all' });
  await settle(50);
  assert.deepEqual(forgot, ['3f2b8c1e-5d4a-4c3b-9a8e-1b2c3d4e5f60'], 'queued before the store is cleared');
  assert.deepEqual(Object.keys(w.stores.local).sort(), ['fulltext:budget', 'settingsLocal', 'telemetry:forget', 'tp:loggedOutAt']);
});

test('an interrupted wipe (navigation) is finished by init() before the cache is shown', async () => {
  const w = seededWorld();
  w.stores.local['tp:wipePending'] = { scope: 'user', t: 1 };
  const { TP } = await boot({ world: w });
  assert.equal(TP.data.peek('enrollments'), null, 'nothing from the old cache');
  assert.equal(TP.data.userName(), '', 'no first name');
  await settle(50);
  assert.equal(w.stores.local['kuloket:lessons:2026-W44'], undefined);
  assert.equal(w.stores.local['tp:wipePending'], undefined);
});

test('a load that was in flight during a wipe is not cached again', async () => {
  let release;
  const { TP } = await boot({ world: seededWorld(), net: { json: () => new Promise((r) => { release = () => r({ value: 9 }); }) } });
  const p = TP.data.load('mail', { force: true });
  await TP.data.wipeLocal({ scope: 'user' });
  release();
  await p;
  assert.equal(TP.data.peek('mail'), null);
});
