/* Unit tests for pure parts of src/core/data.js (feed grouping, deadline dedupe, ICS, calendarName parsing).
   Run: node --test tests/unit/   — uses only Node built-ins; TP core pieces and chrome.storage are stubbed. */
'use strict';
process.env.TZ = 'Europe/Brussels';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const DAY = 864e5;
const NOW = Date.now();

// ---- stubs ---------------------------------------------------------------
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: (k, cb) => cb({ [k]: store[k] }),
      set: (o, cb) => { Object.assign(store, o); cb && cb(); },
    },
    onChanged: { addListener() {} },
  },
};

const PALETTE = { blue: '#007AFF', purple: '#AF52DE', pink: '#FF2D55', red: '#FF3B30', orange: '#FF9500', yellow: '#FFCC00', green: '#34C759', mint: '#00C7BE', teal: '#30B0C7', cyan: '#32ADE6', indigo: '#5856D6', brown: '#A2845E', graphite: '#8E8E93' };
const keys = Object.keys(PALETTE);
let settings, state;
const resetSettings = () => {
  settings = {
    feed: { includeAnnouncements: false, maxCourses: 5 },
    deadlines: { horizonDays: 42, urgentDays: 3, reminder: '1d' },
    courses: { sort: 'activity', showCommunities: false, items: {} },
    sync: { markReadInToledo: false, favoritesToToledo: false },
    custom: [],
  };
  state = { feedSeenAt: 0, done: {}, recent: [], cidMap: {} };
};
resetSettings();

const netCalls = [];
globalThis.TP = {
  util: {
    PALETTE,
    colorForIndex: (n) => PALETTE[keys[((Number(n) || 1) - 1) % keys.length]],
    courseName: (s) => String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^-\s*/, ''),
    courseCode: (s) => (String(s || '').match(/\[([^\]]+)\]\s*$/) || [])[1] || '',
    debounce: (fn) => fn,
    uid: (() => { let i = 0; return () => 'u' + (++i); })(),
  },
  settings: {
    get: () => settings,
    set: async (p) => { Object.assign(settings, p); },
    course: (lu) => Object.assign({ nickname: '', color: null, hidden: false, pinned: false }, settings.courses.items[lu] || {}),
  },
  state: { get: () => state, set: async (p) => { Object.assign(state, p); } },
  i18n: { apiLang: () => 'nl' },
  net: { json: async (url, opts) => { netCalls.push({ url, opts }); return null; }, isSameOrigin: () => false },
};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/core/data.js'), 'utf8'), { filename: 'data.js' });
const D = globalThis.TP.data;
const T = D._test;

// ---- fixtures ------------------------------------------------------------
const LU_A = 'ULTRA-B-N50265-2627', LU_B = 'ULTRA-B-N50300-2627', LU_OLD = 'ULTRA-B-X1-2526';
function fixtures() {
  T._reset();
  T._put('enrollments', [
    { id: 11, learningUnitId: LU_A, title: 'Filmtaal 1 [N50265]', type: 'course', semester: 'SEMESTER1', academicYear: 2627, color: 1, favorite: false, available: true, link: 'https://x/a' },
    { id: 12, learningUnitId: LU_B, title: 'Montage [N50300]', type: 'course', semester: 'YEAR', academicYear: 2627, color: 2, favorite: true, available: true, link: 'https://x/b' },
    { id: 13, learningUnitId: LU_OLD, title: 'Oud vak [X1]', type: 'course', semester: 'SEMESTER2', academicYear: 2526, color: 3, favorite: false, available: true, link: '' },
    { id: 14, learningUnitId: 'COMM-1', title: 'Studentenraad', type: 'community', semester: 'UNKNOWN', academicYear: 0, color: 4, favorite: false, available: true, link: '' },
  ]);
  const ev = (id, sourceId, subType, title, date, extra = {}) => Object.assign({ id, title, source: sourceId === LU_A ? 'Filmtaal 1 [N50265]' : 'Montage [N50300]', sourceId, date, type: 'notifications', eventType: 'update', subType, read: false, seen: false, dismissed: false, url: 'https://e/' + id, color: 1 }, extra);
  T._put('events', [
    ev('e1', LU_A, 'content', 'slides week 3.pdf', NOW - 2 * 3600e3),
    ev('e2', LU_A, 'content', 'clip.mp4', NOW - 3 * 3600e3),
    ev('e3', LU_A, 'other', 'Opdracht 2', NOW - 4 * 3600e3),
    ev('e4', LU_B, 'content', 'Leeswijzer', NOW - 1 * 3600e3),
    ev('e5', LU_B, 'content', 'gelezen.pdf', NOW - 1 * 3600e3, { read: true }),
    ev('e6', LU_B, 'content', 'weg.pdf', NOW - 1 * 3600e3, { dismissed: true }),
    ev('e7', LU_A, 'course', 'Filmtaal 1', NOW - 1 * 3600e3),
    ev('e8', LU_A, 'announcement', 'Les verplaatst', NOW - 5 * 3600e3),
    ev('e9', LU_A, 'due', 'Scène 1 uploaden', NOW + 1 * DAY),
    ev('e10', LU_B, 'due', 'Montage-oefening', NOW + 10 * DAY),
    ev('adv', 'advalvas', 'advalvas', 'Sluiting campus', NOW - 1 * 3600e3, { type: 'advalvas', source: 'Ad Valvas' }),
  ]);
  T._put('ultraDeadlines', [
    // duplicate of e9 with slightly different spelling/time on the same day → deduped
    { id: 'c1', title: 'Scene 1 Uploaden!', due: NOW + 1 * DAY + 60e3, courseLuId: LU_A, courseTitle: 'Filmtaal 1 [N50265]', cid: '_1_1', url: 'https://ultra/1' },
    { id: 'c2', title: 'Reflectie', due: NOW + 5 * DAY, courseLuId: LU_B, courseTitle: 'Montage [N50300]', cid: '_2_1', url: null },
    { id: 'c3', title: 'Te ver', due: NOW + 100 * DAY, courseLuId: LU_B, courseTitle: 'Montage [N50300]', cid: null, url: null },
    { id: 'c4', title: 'Gisteren', due: NOW - 1 * DAY, courseLuId: LU_B, courseTitle: 'Montage [N50300]', cid: null, url: null },
    { id: 'c5', title: 'Lang geleden', due: NOW - 10 * DAY, courseLuId: LU_B, courseTitle: 'Montage [N50300]', cid: null, url: null },
  ]);
}

// ---- tests ---------------------------------------------------------------
test('parseCalendarName splits on the first colon', () => {
  assert.deepEqual(T.parseCalendarName('ULTRA-B-N50265-2627: Filmtaal 1 [N50265]'), { luId: 'ULTRA-B-N50265-2627', title: 'Filmtaal 1 [N50265]' });
  assert.deepEqual(T.parseCalendarName('X: a: b'), { luId: 'X', title: 'a: b' });
  assert.deepEqual(T.parseCalendarName('Persoonlijk'), { luId: '', title: 'Persoonlijk' });
  assert.deepEqual(T.parseCalendarName(undefined), { luId: '', title: '' });
});

test('mapCalendarItem maps a GradebookColumn calendar item', () => {
  const d = T.mapCalendarItem({ id: 'x', type: 'GradebookColumn', title: 'Taak', end: '2026-11-03T22:59:00.000Z', calendarId: '_200661_1', calendarName: 'ULTRA-B-N50265-2627: Filmtaal 1 [N50265]' });
  assert.equal(d.courseLuId, 'ULTRA-B-N50265-2627');
  assert.equal(d.due, Date.parse('2026-11-03T22:59:00.000Z'));
  assert.equal(d.url, 'https://ultra.edu.kuleuven.cloud/ultra/courses/_200661_1/outline');
  assert.equal(T.mapCalendarItem({ calendarId: 'PERSONAL', calendarName: 'x', end: 1 }).url, null);
});

test('hash and normTitle are stable', () => {
  assert.equal(T.hash('abc'), T.hash('abc'));
  assert.notEqual(T.hash('abc'), T.hash('abd'));
  assert.equal(T.normTitle('  Scène 1 — Uploaden! '), 'scene 1 uploaden');
});

test('courses: current year only, communities/hidden excluded, nickname + colors', () => {
  fixtures(); resetSettings();
  settings.courses.items[LU_B] = { nickname: 'Monteren', color: 'red', pinned: true };
  settings.courses.items[LU_A] = { color: '#123456' };
  const list = D.courses();
  assert.deepEqual(list.map((c) => c.luId), [LU_B, LU_A]); // pinned first
  assert.equal(list[0].name, 'Monteren');
  assert.equal(list[0].color, PALETTE.red);
  assert.equal(list[0].colorKey, 'red');
  assert.equal(list[1].color, '#123456');
  assert.equal(list[1].code, 'N50265');
  assert.equal(list[1].unread, 3); // e1,e2,e3 (announcement excluded by default, course/due excluded)
  assert.equal(D.courses({ currentOnly: false, includeCommunities: true }).length, 4);
  settings.courses.items[LU_A].hidden = true;
  assert.equal(D.courses().length, 1);
  assert.equal(D.courses({ includeHidden: true }).length, 2);
  assert.equal(D.course(LU_OLD).colorKey, keys[2]);
});

test('feed: rules, grouping, counts and ordering', () => {
  fixtures(); resetSettings();
  let f = D.feed();
  assert.deepEqual(f.map((g) => g.luId), [LU_A, LU_B]); // LU_A has a deadline ≤48h
  const a = f[0];
  assert.deepEqual(a.items.map((e) => e.id), ['e1', 'e2', 'e3']);
  assert.deepEqual(a.counts, { file: 1, video: 1, page: 0, assignment: 1, announcement: 0 });
  assert.equal(a.name, 'Filmtaal 1');
  assert.deepEqual(f[1].items.map((e) => e.id), ['e4']);
  assert.equal(f[1].counts.page, 1);

  settings.feed.includeAnnouncements = true;
  assert.equal(D.feed()[0].counts.announcement, 1);

  settings.courses.items[LU_B] = { pinned: true };
  assert.equal(D.feed()[0].luId, LU_B);

  settings.courses.items[LU_A] = { hidden: true };
  assert.deepEqual(D.feed().map((g) => g.luId), [LU_B]);

  resetSettings();
  state.feedSeenAt = NOW - 2.5 * 3600e3; // only e1 (−2h) and e4 (−1h) remain
  f = D.feed();
  assert.deepEqual(f.flatMap((g) => g.items.map((e) => e.id)).sort(), ['e1', 'e4']);
  state.feedSeenAt = 0;
});

test('deadlines: merge, dedupe, window, done, custom', () => {
  fixtures(); resetSettings();
  settings.custom = [{ id: 'my1', title: 'Scène 1 uploaden', courseLuId: LU_A, due: NOW + 1 * DAY }];
  let list = D.deadlines();
  const titles = list.map((d) => d.title);
  assert.deepEqual(titles, ['Gisteren', 'Scène 1 uploaden', 'Scène 1 uploaden', 'Reflectie', 'Montage-oefening']);
  const toledo = list.find((d) => d.source === 'toledo' && d.courseLuId === LU_A);
  assert.equal(toledo.url, 'https://e/e9'); // Toledo wins, Ultra duplicate dropped
  assert.equal(list.filter((d) => d.source === 'ultra').length, 2); // Reflectie + Gisteren
  assert.ok(list.find((d) => d.source === 'custom' && d.customId === 'my1'), 'custom never deduped away');
  assert.equal(toledo.courseName, 'Filmtaal 1');
  assert.ok(/^d[0-9a-z]+$/.test(toledo.key));
  // keys stable across calls
  assert.equal(D.deadlines()[1].key, list[1].key);
  // done
  state.done = { [toledo.key]: true };
  list = D.deadlines();
  assert.ok(!list.some((d) => d.key === toledo.key));
  assert.ok(D.deadlines({ includeDone: true }).find((d) => d.key === toledo.key).done);
  // horizon
  assert.ok(D.deadlines({ horizonDays: 200 }).some((d) => d.title === 'Te ver'));
  assert.ok(!D.deadlines({ horizonDays: 200 }).some((d) => d.title === 'Lang geleden'));
  state.done = {};
});

test('deadlineKey: same title/course/day → same key', () => {
  const t = new Date(2026, 10, 3, 9, 0).getTime();
  assert.equal(T.deadlineKey('Scène 1', 'L', t), T.deadlineKey('scene 1!', 'L', t + 3600e3));
  assert.notEqual(T.deadlineKey('Scène 1', 'L', t), T.deadlineKey('Scène 1', 'M', t));
  assert.notEqual(T.deadlineKey('Scène 1', 'L', t), T.deadlineKey('Scène 1', 'L', t + DAY));
});

test('announcements filters', () => {
  fixtures(); resetSettings();
  assert.deepEqual(D.announcements().map((e) => e.id), ['adv', 'e8']);
  assert.deepEqual(D.announcements({ filter: 'school' }).map((e) => e.id), ['adv']);
  assert.deepEqual(D.announcements({ filter: 'courses' }).map((e) => e.id), ['e8']);
});

test('kindOf for events and content nodes', () => {
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

test('ics: valid structure, CRLF, escaping, folding, alarm', () => {
  resetSettings();
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
  assert.ok(lines.includes('TRIGGER:-P1D'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 2);
  // unfold and check the long summary survived intact
  const unfolded = s.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:X: ' + 'é'.repeat(80) + '\r\n'));
  settings.deadlines.reminder = 'none';
  assert.ok(!D.ics([d]).includes('VALARM'));
  settings.deadlines.reminder = '1h';
  assert.ok(D.ics([d]).includes('TRIGGER:-PT1H'));
});

test('markRead: optimistic update; PATCH body when sync on; never throws', async () => {
  fixtures(); resetSettings();
  const e1 = D.peek('events').find((e) => e.id === 'e1');
  let changed = 0; const fn = () => changed++;
  D.on('change', fn);
  assert.equal(await D.markRead([e1]), true);
  assert.equal(D.peek('events').find((e) => e.id === 'e1').read, true);
  assert.equal(netCalls.length, 0);
  settings.sync.markReadInToledo = true;
  const e2 = D.peek('events').find((e) => e.id === 'e2');
  assert.equal(await D.markRead([e2]), true);
  assert.equal(netCalls.at(-1).opts.method, 'PATCH');
  assert.match(netCalls.at(-1).url, /\/portal\/api\/batch\/events$/);
  assert.deepEqual(netCalls.at(-1).opts.body, [{ id: 'e2', type: 'notifications', subType: 'content', read: true }]);
  const orig = TP.net.json;
  TP.net.json = async () => { throw Object.assign(new Error('x'), { status: 500 }); };
  const e3 = D.peek('events').find((e) => e.id === 'e3');
  assert.equal(await D.markRead([e3]), false);
  assert.equal(D.peek('events').find((e) => e.id === 'e3').read, true);
  TP.net.json = orig;
  D.off('change', fn);
  assert.ok(changed >= 3);
});

test('cache trimming keeps known keys and caps events', () => {
  const many = Array.from({ length: 900 }, (_, i) => ({ id: i, date: i }));
  const out = T.trimForStorage({ events: { v: many, t: 1 }, junk: { v: 1, t: 1 }, mail: { v: 3, t: 2 } });
  assert.equal(out.events.v.length, 600);
  assert.equal(out.events.v[0].id, 899);
  assert.ok(!('junk' in out));
  assert.equal(out.mail.v, 3);
});
