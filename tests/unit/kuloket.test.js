/* Unit tests for src/core/kuloket.js: Brussels time/DST, SAP date parsing, ICS parsing, course matching,
   caching (per ISO week, stale-while-revalidate), "not logged in" → iCal fallback, exams. */
'use strict';
process.env.TZ = 'Europe/Brussels';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');
const kmock = require('../helpers/kuloket-mock');

const H = 3600e3, DAY = 864e5;
const iso = (ms) => new Date(ms).toISOString();

/** Fresh TP.kuloket in its own sandbox with stubbed chrome.storage, TP.net and TP.data. */
async function make({ net, courses, store: initial } = {}) {
  const s = sandbox({ origin: 'https://toledo.kuleuven.be' });
  const store = Object.assign({}, initial || {});
  const calls = [];
  s.ctx.chrome = {
    storage: {
      local: {
        get: (keys, cb) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); cb(o); },
        set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); cb && cb(); },
        remove: (ks, cb) => { for (const k of [].concat(ks)) delete store[k]; cb && cb(); },
      },
      onChanged: { addListener() {} },
    },
  };
  s.load('src/core/util.js'); s.load('src/core/i18n.js'); s.load('src/i18n/kuloket.js');
  const TP = s.TP;
  TP.net = { text: async (url, opts) => { calls.push(url); return net ? net(url, opts) : ''; } };
  TP.data = { courses: () => courses || [] };
  s.load('src/core/kuloket.js');
  await TP.kuloket.ready();
  return { TP, K: TP.kuloket, T: TP.kuloket._test, store, calls };
}

const COURSES = [
  { luId: 'LU-FT', title: 'Filmtaal 1 [X10265]', code: 'X10265', year: 2627 },
  { luId: 'LU-RE', title: 'Regie 1 [X10300]', code: 'X10300', year: 2627 },
  { luId: 'LU-ST', title: 'Storytelling [X10354]', code: 'X10354', year: 2627 },
  { luId: 'LU-OLD', title: 'Filmtaal 1 [X10265]', code: 'X10265', year: 2526 },
];

/** OData + ICS responder built on the e2e mock data. */
function responder(state) {
  const fx = kmock.load();
  return (url) => {
    const u = new URL(url);
    if (u.origin === kmock.TIMEEDIT) { state.ics = (state.ics || 0) + 1; return kmock.icsFeed(fx); }
    if (state.loggedOut) return '<!doctype html><html><body>login</body></html>';
    const p = u.pathname.replace('/sap/opu/odata/sap/', '');
    if (p === 'ZC_EP_SCHEDULE_SRV/Events') { state.events = (state.events || 0) + 1; return JSON.stringify({ d: { results: kmock.odataEvents(fx, u.searchParams.get('$filter')) } }); }
    if (p === 'ZC_EP_ICAL_SRV/StudentSet') return JSON.stringify({ d: { results: [{ Schedulelink: fx.icsLink }] } });
    if (p === 'ZC_IER_SRV/EvaluationSet') {
      if (u.searchParams.get('$expand') && state.noExpand) { const e = new Error('400'); e.status = 400; throw e; }
      return JSON.stringify({ d: { results: [{ evaluationId: 'E1', moduleCode: 'X10265', moduleTitle: 'Filmtaal 1', evaluationText: 'Schriftelijk', examDate: `/Date(${Date.UTC(2027, 0, 12)})/`, examBegtime: 'PT09H00M00S', examEndtime: 'PT12H00M00S', groupInfo: '', toLocation: u.searchParams.get('$expand') ? { results: [{ roomName: 'A101' }] } : undefined, toStaff: u.searchParams.get('$expand') ? { results: [{ name: 'Docent A' }] } : undefined }] } });
    }
    throw Object.assign(new Error('404'), { status: 404 });
  };
}

// ------------------------------------------------------------------ time
test('Brussels wall time → UTC around the DST change of 25 Oct 2026', async () => {
  const { T } = await make();
  assert.equal(iso(T.bxl(2026, 9, 23, 9, 0)), '2026-10-23T07:00:00.000Z', 'Fri before: CEST (+2)');
  assert.equal(iso(T.bxl(2026, 9, 24, 23, 30)), '2026-10-24T21:30:00.000Z');
  assert.equal(iso(T.bxl(2026, 9, 25, 1, 30)), '2026-10-24T23:30:00.000Z', 'Sunday 01:30 still CEST');
  assert.equal(iso(T.bxl(2026, 9, 25, 2, 30)), '2026-10-25T00:30:00.000Z', 'ambiguous 02:30 → first (CEST)');
  assert.equal(iso(T.bxl(2026, 9, 25, 3, 0)), '2026-10-25T02:00:00.000Z', '03:00 is CET');
  assert.equal(iso(T.bxl(2026, 9, 25, 9, 0)), '2026-10-25T08:00:00.000Z');
  assert.equal(iso(T.bxl(2026, 9, 26, 9, 0)), '2026-10-26T08:00:00.000Z', 'Mon after: CET (+1)');
  assert.equal(iso(T.bxl(2026, 2, 28, 9, 0)), '2026-03-28T08:00:00.000Z');
  assert.equal(iso(T.bxl(2026, 2, 29, 9, 0)), '2026-03-29T07:00:00.000Z', 'spring forward 29 Mar 2026');
  // agrees with the platform's tz database (TZ=Europe/Brussels in tests)
  for (let d = 20; d <= 31; d++) for (const h of [0, 8, 13, 23]) {
    assert.equal(T.bxl(2026, 9, d, h, 15), new Date(2026, 9, d, h, 15).getTime(), `2026-10-${d} ${h}:15`);
  }
});

test('SAP /Date(ms)/ (UTC midnight) + PT duration → local Brussels times', async () => {
  const { T } = await make();
  const fri = `/Date(${Date.UTC(2026, 9, 23)})/`, mon = `/Date(${Date.UTC(2026, 9, 26)})/`;
  assert.equal(T.sapDate(fri), Date.UTC(2026, 9, 23));
  assert.equal(T.sapDate('/Date(1700000000000+0000)/'), 1700000000000);
  assert.deepEqual({ ...T.duration('PT09H30M00S') }, { h: 9, mi: 30, s: 0 });
  assert.equal(T.duration('garbage'), null);
  assert.equal(T.sapDateTime(fri, 'PT09H00M00S'), new Date(2026, 9, 23, 9, 0).getTime());
  assert.equal(T.sapDateTime(mon, 'PT09H00M00S'), new Date(2026, 9, 26, 9, 0).getTime());
  assert.equal(T.sapDateTime(`/Date(${Date.UTC(2026, 9, 25)})/`, 'PT14H00M00S'), new Date(2026, 9, 25, 14).getTime(), 'the DST day itself');
  // tolerate a Brussels-midnight encoding (22:00 UTC the day before)
  assert.equal(T.sapDateTime(`/Date(${Date.UTC(2026, 9, 22, 22)})/`, 'PT09H00M00S'), new Date(2026, 9, 23, 9).getTime());
  assert.equal(T.isoWeek(2026, 9, 26), '2026-W44');
  assert.equal(T.isoWeek(2027, 0, 1), '2026-W53');
  assert.equal(T.weekKeyOf(new Date(2026, 9, 25, 23, 30).getTime()), '2026-W43', 'Sunday 23:30 local stays in its own week');
});

test('mapEvent maps the live KU Loket shape (location, teachers, group)', async () => {
  const { T } = await make();
  const l = T.mapEvent({
    event_GUID: 'g1', eventID: '1', date: `/Date(${Date.UTC(2026, 9, 26)})/`, start_time: 'PT09H00M00S', end_time: 'PT12H00M00S',
    ola_description: 'Jaarwerk 1', ects_code: 'X10999', workFormDesc: 'Project', url_ects: 'https://example.edu/ects',
    groupinfo_general: 'Locatie: Proefweg 9, Vorst', groupinfo_detail: 'Jaarwerk 1 Groep E1 Fictie 2 Locatie: Proefweg 9, Vorst',
    EventLocationSet: { results: [{ roomName: 'B8300.83A (83A - leslokaal)', roomNumber: '83A', buildingName: 'Gebouw B', street: 'Proefweg 9', city: 'Vorst', mnemonic: 'B83', url_location: 'https://example.edu/r' }] },
    EventTeacherSet: { results: [{ name: 'Docent A' }, { name: 'Docent B' }] },
  });
  assert.equal(l.title, 'Jaarwerk 1');
  assert.equal(l.group, 'Groep E1 Fictie 2');
  assert.equal(l.kind, 'les');
  assert.equal(l.source, 'kuloket');
  assert.equal(l.location.room, 'B8300.83A (83A - leslokaal)');
  assert.equal(l.location.url, 'https://example.edu/r');
  assert.deepEqual([...l.teachers], ['Docent A', 'Docent B']);
  assert.equal(l.end - l.start, 3 * H);
  const noLoc = T.mapEvent({ date: `/Date(${Date.UTC(2026, 9, 26)})/`, start_time: 'PT13H00M00S', end_time: 'PT14H00M00S', ola_description: 'X', groupinfo_detail: 'X Locatie: Proefweg 9, Vorst', EventLocationSet: { results: [] } });
  assert.equal(noLoc.location.street, 'Proefweg 9, Vorst', 'falls back to "Locatie:" text');
  assert.equal(T.mapEvent({ date: 'nope' }), null);
  const js = T.mapEvent({ date: `/Date(${Date.UTC(2026, 9, 26)})/`, start_time: 'PT13H00M00S', end_time: 'PT14H00M00S', ola_description: 'X', url_ects: 'javascript:alert(1)' });
  assert.equal(js.url, '', 'only https links survive');
});

// ------------------------------------------------------------------ ICS
test('parseIcs: unfolding, TZID/Z/all-day, escapes, weekly RRULE across DST, EXDATE, cancelled', async () => {
  const { T } = await make();
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=Europe/Brussels:20261023T090000', 'DTEND;TZID=Europe/Brussels:20261023T110000',
    'SUMMARY:Filmtaal 1 (X10265)', 'LOCATION:C207\\, Campus', 'DESCRIPTION:Docent: Docent A\\, Docent B\\nGroep: A', ' 1', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'DTSTART:20261026T080000Z', 'DTEND:20261026T090000Z', 'SUMMARY:UTC event', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20261030', 'SUMMARY:Hele dag', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'DTSTART;TZID=Europe/Brussels:20261019T160000', 'DTEND;TZID=Europe/Brussels:20261019T170000',
    'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/Brussels:20261102T160000', 'SUMMARY:Wekelijks', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:e', 'DTSTART:20261027T080000Z', 'STATUS:CANCELLED', 'SUMMARY:Geschrapt', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ev = T.parseIcs(ics);
  const a = ev.find((e) => e.uid === 'a');
  assert.equal(a.start, new Date(2026, 9, 23, 9).getTime());
  assert.equal(a.location, 'C207, Campus');
  assert.equal(a.description, 'Docent: Docent A, Docent B\nGroep: A1', 'folded line joined, escapes undone');
  assert.equal(ev.find((e) => e.uid === 'b').start, Date.UTC(2026, 9, 26, 8));
  const c = ev.find((e) => e.uid === 'c');
  assert.ok(c.allDay); assert.equal(c.start, new Date(2026, 9, 30).getTime()); assert.equal(c.end - c.start, DAY);
  const weekly = [...ev.filter((e) => e.uid === 'd').map((e) => new Date(e.start))];
  assert.equal(weekly.length, 3, 'COUNT=4 minus one EXDATE');
  assert.deepEqual(weekly.map((d) => d.getHours()), [16, 16, 16], 'wall-clock time kept across the DST change');
  assert.deepEqual(weekly.map((d) => d.getDate()), [19, 26, 9]);
  assert.ok(!ev.some((e) => e.uid === 'e'), 'cancelled events dropped');
  const l = T.mapIcs(a);
  assert.equal(l.title, 'Filmtaal 1');
  assert.equal(l.courseCode, 'X10265');
  assert.deepEqual([...l.teachers], ['Docent A', 'Docent B']);
  assert.equal(l.group, 'A1');
  assert.equal(l.location.room, 'C207, Campus');
  assert.equal(l.source, 'ics');
});

// ------------------------------------------------------------------ matching
test('course matching: code, current year first, code prefix, name fallback', async () => {
  const { T } = await make({ courses: COURSES });
  assert.equal(T.matchCourse({ courseCode: 'X10265', title: 'iets anders' }), 'LU-FT', 'code wins; current year (2627) over 2526');
  assert.equal(T.matchCourse({ courseCode: 'x10300', title: '' }), 'LU-RE', 'case-insensitive');
  assert.equal(T.matchCourse({ courseCode: 'X10354A', title: '' }), 'LU-ST', 'suffix on the code');
  assert.equal(T.matchCourse({ courseCode: '', title: 'Regie 1' }), 'LU-RE', 'name fallback');
  assert.equal(T.matchCourse({ courseCode: '', title: 'storytelling' }), 'LU-ST');
  assert.equal(T.matchCourse({ courseCode: 'X99999', title: 'Workshop Lichtontwerp' }), null);
});

// ------------------------------------------------------------------ caching + sources
test('lessons(): fetches once per week, caches per ISO week, matches courses, then serves from cache', async () => {
  const st = {};
  const { K, T, store, calls } = await make({ net: responder(st), courses: COURSES });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = from.getTime() + DAY;
  assert.equal(K.peekLessons({ from: from.getTime(), to }), null, 'nothing cached yet');
  const a = await K.lessons({ from: from.getTime(), to });
  assert.ok(a.length >= 3, 'today has 3 fixture lessons');
  const ft = a.find((l) => l.title === 'Filmtaal 1');
  assert.equal(ft.courseLuId, 'LU-FT');
  assert.equal(new Date(ft.start).getHours(), 9);
  assert.equal(ft.location.room, 'C207 (2.07 - leslokaal)');
  const wk = T.weekKeyOf(from.getTime());
  assert.ok(store['kuloket:lessons:' + wk], 'week cached in chrome.storage.local');
  assert.ok(store['kuloket:lessons:' + wk].t > 0);
  assert.ok(store['kuloket:meta'].weeks.includes(wk));
  const n = st.events;
  const b = await K.lessons({ from: from.getTime(), to });
  assert.equal(st.events, n, 'second call served from cache');
  assert.equal(b.length, a.length);
  assert.ok(K.peekLessons({ from: from.getTime(), to }).length === a.length);
  assert.equal(K.status().lessons.source, 'kuloket');
  assert.equal(K.status().lessons.ok, true);
  // after a successful KU Loket call the iCal link is remembered (never exposed in full)
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(store['kuloket:icsUrl'], 'iCal link stored');
  assert.equal(K.status().icsUrl, true);
  assert.ok(!K.getIcsUrlMasked().includes('0000000000mock'), 'masked link hides the token');
  assert.ok(calls.every((u) => u.startsWith('https://webwsp.aps.kuleuven.be/') || u.startsWith('https://cloud.timeedit.net/')), 'only KU Loket/TimeEdit');
});

test('stale cache (> 6 h) is returned immediately and revalidated in the background', async () => {
  const st = {};
  const { K, T } = await make({ net: responder(st), courses: COURSES });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const r = { from: from.getTime(), to: from.getTime() + DAY };
  await K.lessons(r);
  const n = st.events;
  const wk = T.weekKeyOf(r.from);
  T.mem.weeks.get(wk).t = Date.now() - 7 * H;
  T.lastTry.clear();
  let changed = 0; K.on('change', () => changed++);
  const peek = K.peekLessons(r);
  assert.ok(peek && peek.length, 'stale data still served');
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(st.events, n + 1, 'background refresh happened');
  assert.ok(changed >= 1, 'change emitted');
  assert.ok(Date.now() - T.mem.weeks.get(wk).t < 5000, 'timestamp renewed');
});

test('ranges are fetched in chunks of at most 6 weeks', async () => {
  const st = {};
  const { K, calls } = await make({ net: responder(st) });
  const from = new Date(2026, 8, 21).getTime(); // Monday
  await K.lessons({ from, to: from + 10 * 7 * DAY });
  const ev = calls.filter((u) => u.includes('ZC_EP_SCHEDULE_SRV/Events'));
  assert.equal(ev.length, 2, '10 weeks → 6 + 4');
  const f = decodeURIComponent(ev[0]);
  assert.match(f, /date ge datetime'2026-09-21T00:00:00' and date le datetime'2026-11-01T00:00:00'/);
  assert.match(f, /sap-client=200/); assert.match(f, /\$format=json/); assert.match(f, /\$expand=EventTeacherSet,EventLocationSet/);
});

test('not logged in (HTML login page) → status auth, no throw; with an iCal link → ICS fallback', async () => {
  const st = { loggedOut: true };
  const { K, store } = await make({ net: responder(st), courses: COURSES });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const r = { from: from.getTime(), to: from.getTime() + 7 * DAY };
  const a = await K.lessons(r);
  assert.deepEqual([...a], []);
  assert.equal(K.status().lessons.ok, false);
  assert.equal(K.status().lessons.error, 'auth');
  assert.equal(K.status().icsUrl, false);
  assert.equal(await K.setIcsUrl('https://evil.example.com/x.ics'), false, 'only TimeEdit links accepted');
  assert.equal(await K.setIcsUrl('webcal://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=7&value=secret123'), true);
  assert.equal(store['kuloket:icsUrl'], 'https://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=7&value=secret123');
  assert.ok(!K.getIcsUrlMasked().includes('secret123'));
  const b = await K.lessons(r);
  assert.ok(st.ics >= 1, 'ICS downloaded');
  assert.ok(b.length >= 4, 'lessons from ICS');
  assert.ok(b.every((l) => l.source === 'ics'));
  assert.equal(b.find((l) => l.title === 'Filmtaal 1').courseLuId, 'LU-FT');
  assert.equal(K.status().lessons.source, 'ics');
  assert.equal(K.status().lessons.ok, true);
  await K.setIcsUrl('');
  assert.equal(store['kuloket:icsUrl'], undefined);
});

test('signed out: one KU Loket request, then a shared 30-min pause (no SSO cookie pile-up); "Try again" resumes', async () => {
  const st = { loggedOut: true };
  const { K, T, store, calls } = await make({ net: responder(st), courses: COURSES });
  const kl = () => calls.filter((u) => u.startsWith('https://webwsp.aps.kuleuven.be/')).length;
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const wk = (n) => ({ from: day0.getTime() + n * 7 * DAY, to: day0.getTime() + (n + 1) * 7 * DAY });
  await K.lessons(wk(0));
  const first = kl();
  assert.equal(first, 1, 'one request finds out we are signed out');
  assert.equal(K.status().lessons.error, 'auth');
  // agenda browsing, neighbour prefetch, exams, overview: none of it may hit KU Loket while paused
  for (let n = 1; n <= 10; n++) await K.lessons(wk(n));
  await K.exams(); K.peekExams(); K.peekLessons(wk(20));
  T.lastTry.clear(); // even after the per-week retry window
  await K.lessons(wk(0)); await K.exams();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(kl(), first, 'no new requests while paused');
  assert.ok(store['kuloket:authAt'] > 0, 'pause is shared via chrome.storage.local');
  // another tab / a reload honours the same pause
  const other = await make({ net: responder(st), courses: COURSES, store });
  await other.K.lessons(wk(3)); await other.K.exams();
  assert.equal(other.calls.filter((u) => u.startsWith('https://webwsp.aps.kuleuven.be/')).length, 0);
  // the student signs in and presses "Try again"
  st.loggedOut = false;
  await K.refresh(wk(0));
  assert.ok(kl() > first, 'asks KU Loket again');
  assert.equal(K.status().lessons.ok, true);
  assert.equal(store['kuloket:authAt'], 0, 'pause cleared');
  assert.equal(T.paused(), false);
});

test('network failure keeps cached data and reports offline', async () => {
  const st = {};
  let down = false;
  const ok = responder(st);
  const { K, T } = await make({ net: (u, o) => { if (down) throw Object.assign(new Error('relay'), { status: 0 }); return ok(u, o); } });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const r = { from: from.getTime(), to: from.getTime() + DAY };
  const a = await K.lessons(r);
  down = true; T.lastTry.clear();
  const b = await K.lessons({ ...r, force: true });
  assert.equal(b.length, a.length, 'cache kept');
  assert.equal(K.status().lessons.error, 'network');
});

test('exams(): $expand when supported, falls back without it, cached', async () => {
  const st = { noExpand: true };
  const { K, calls, store } = await make({ net: responder(st), courses: COURSES });
  const ex = await K.exams();
  assert.equal(ex.length, 1);
  assert.equal(ex[0].title, 'Filmtaal 1');
  assert.equal(ex[0].courseLuId, 'LU-FT');
  assert.equal(ex[0].start, new Date(2027, 0, 12, 9).getTime());
  assert.equal(ex[0].text, 'Schriftelijk');
  const ev = calls.filter((u) => u.includes('EvaluationSet'));
  assert.equal(ev.length, 2, 'retried without $expand');
  assert.ok(store['kuloket:exams'].items.length === 1);
  await K.exams();
  assert.equal(calls.filter((u) => u.includes('EvaluationSet')).length, 2, 'served from cache');
  assert.equal(K.peekExams().length, 1);

  const st2 = {};
  const k2 = await make({ net: responder(st2) });
  const ex2 = await k2.K.exams();
  assert.equal(ex2[0].location.room, 'A101');
  assert.deepEqual([...ex2[0].teachers], ['Docent A']);
});

test('cache survives a reload (read from chrome.storage.local) and old weeks are pruned', async () => {
  const st = {};
  const first = await make({ net: responder(st) });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const r = { from: from.getTime(), to: from.getTime() + DAY };
  await first.K.lessons(r);
  const store = { ...first.store, 'kuloket:lessons:2020-W01': { t: 1, source: 'kuloket', items: [] } };
  store['kuloket:meta'] = { ...store['kuloket:meta'], weeks: [...store['kuloket:meta'].weeks, '2020-W01'] };
  const second = await make({ net: () => { throw new Error('should not fetch'); }, store });
  const peek = second.K.peekLessons(r);
  assert.ok(peek && peek.length >= 3, 'first paint from storage');
  assert.equal(second.store['kuloket:lessons:2020-W01'], undefined, 'old week removed');
});

test('links(): KU Loket apps in six groups with localized titles and deep links', async () => {
  const { K, TP } = await make();
  const links = K.links();
  assert.equal(links.length, 28);
  assert.deepEqual([...new Set(links.map((l) => l.group))], ['study', 'enrol', 'agenda', 'survey', 'safety', 'support']);
  for (const l of links) {
    assert.match(l.url, /^https:\/\/webwsp\.aps\.kuleuven\.be\/sap\/bc\/ui2\/flp\?sap-language=(NL|EN|FR)#zr_\d{4}-display$/);
    assert.ok(l.title && !l.title.startsWith('kuloket.'), `title for ${l.id}`);
    assert.ok(l.desc && !l.desc.startsWith('kuloket.'), `desc for ${l.id}`);
  }
  TP.settings = { get: () => ({ language: 'en' }) };
  assert.equal(K.links().find((l) => l.id === 'zr_0363').title, 'Exam timetable');
  assert.match(K.links()[0].url, /sap-language=EN/);
});

test('session expires → automatic iCal fallback keeps KU Loket details, says so (needsLogin), reuses the feed', async () => {
  const st = {};
  const { K, T, calls } = await make({ net: responder(st), courses: COURSES });
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const r = { from: from.getTime(), to: from.getTime() + DAY };
  const a = await K.lessons(r);
  assert.equal(a.find((l) => l.title === 'Filmtaal 1').location.street, 'Voorbeeldstraat 1');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(K.status().icsUrl, true, 'link learned while signed in');
  assert.equal(K.status().lessons.needsLogin, false);
  // the SSO session expires; the cached week is stale
  st.loggedOut = true;
  const wk = T.weekKeyOf(r.from);
  T.mem.weeks.get(wk).t = Date.now() - 7 * H;
  T.lastTry.clear();
  const b = await K.lessons({ ...r, force: true });
  assert.ok(st.ics >= 1, 'feed downloaded automatically');
  assert.ok(b.length >= 3 && b.every((l) => l.source === 'ics'));
  const ft = b.find((l) => l.title === 'Filmtaal 1');
  assert.equal(ft.detailsFrom, 'kuloket', 'enriched from the earlier KU Loket week');
  assert.equal(ft.location.street, 'Voorbeeldstraat 1');
  assert.equal(ft.location.url, 'https://example.edu/rooms/c207');
  assert.equal(ft.group, 'Groep A1');
  assert.deepEqual([...ft.teachers], ['Docent A']);
  const s = K.status().lessons;
  assert.equal(s.ok, true); assert.equal(s.source, 'ics'); assert.equal(s.needsLogin, true);
  const info = K.peekRange(r);
  assert.equal(info.source, 'ics'); assert.ok(info.t > 0); assert.equal(info.complete, true); assert.ok(info.items.length >= 3);
  assert.deepEqual(K.peekRange({ from: r.from + 400 * DAY, to: r.from + 401 * DAY }).items, null, 'nothing cached → null (loading, not empty)');
  // a far week right after: no new KU Loket round trip, no second download
  const ev0 = calls.filter((u) => u.includes('ZC_EP_SCHEDULE_SRV')).length; const ics0 = st.ics;
  const far = from.getTime() + 70 * DAY;
  const c = await K.lessons({ from: far, to: far + DAY });
  assert.deepEqual([...c], []);
  assert.equal(calls.filter((u) => u.includes('ZC_EP_SCHEDULE_SRV')).length, ev0, 'KU Loket skipped right after "not signed in"');
  assert.equal(st.ics, ics0, 'parsed feed reused');
  assert.equal(K.peekRange({ from: far, to: far + DAY }).items.length, 0, 'empty after a successful (feed) fetch');
  // signing in again: refresh() asks KU Loket again
  st.loggedOut = false;
  await K.refresh(r);
  assert.equal(K.status().lessons.source, 'kuloket');
  assert.equal(K.status().lessons.needsLogin, false);
  assert.ok(K.peekLessons(r).every((l) => l.source === 'kuloket'));
});

test('the iCal link is stored automatically and re-read after 7 days, never logged', async () => {
  const fx = kmock.load();
  const old = 'https://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=7&value=oldlink';
  const logs = [];
  const warn = console.warn; console.warn = (...a) => { logs.push(a.join(' ')); };
  try {
    const st = {};
    const { K, store, calls } = await make({ net: responder(st), store: { 'kuloket:icsUrl': old, 'kuloket:icsUrlT': Date.now() - 8 * DAY } });
    const from = new Date(); from.setHours(0, 0, 0, 0);
    await K.lessons({ from: from.getTime(), to: from.getTime() + DAY });
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(calls.filter((u) => u.includes('ZC_EP_ICAL_SRV/StudentSet')).length, 1, 're-read');
    assert.equal(store['kuloket:icsUrl'], fx.icsLink, 'new link stored');
    assert.ok(Date.now() - store['kuloket:icsUrlT'] < 5000);
    const fresh = await make({ net: responder({}), store: { 'kuloket:icsUrl': old, 'kuloket:icsUrlT': Date.now() - DAY } });
    await fresh.K.lessons({ from: from.getTime(), to: from.getTime() + DAY });
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(fresh.calls.filter((u) => u.includes('StudentSet')).length, 0, 'fresh link not re-read');
  } finally { console.warn = warn; }
  assert.ok(!logs.some((l) => /timeedit|s\.ics/i.test(l)), 'link never logged');
});

// ---------------------------------------------------------------- agenda view helpers (src/views/agenda.js → TP.agenda)
function agendaHelpers() {
  const s = sandbox({ origin: 'https://toledo.kuleuven.be' });
  s.load('src/core/util.js'); s.load('src/core/i18n.js'); s.load('src/i18n/agenda.js');
  s.load('src/core/settings.js'); s.load('src/core/data.js'); // icsFor writes through TP.data.icsEvents
  s.load('src/views/agenda.js'); // no TP.shell in the sandbox: only the pure helpers are set up
  return s.TP.agenda;
}
const at = (h, m = 0, day = 0) => new Date(2026, 10, 9 + day, h, m).getTime(); // Mon 9 Nov 2026

test('agenda layout(): Google-style column packing with widening to the right', () => {
  const A = agendaHelpers();
  const ev = (id, s, e) => ({ id, start: s, end: e });
  const out = A.layout([
    ev('prod', at(9), at(12)), ev('mont', at(9), at(10)), ev('eng', at(9, 30), at(10, 30)),
    ev('scen', at(10), at(11)), ev('beeld', at(11, 30), at(12, 30)), ev('hist', at(14), at(16)),
  ]);
  const by = Object.fromEntries(out.map((e) => [e.id, e]));
  assert.deepEqual([by.prod.col, by.mont.col, by.eng.col, by.scen.col, by.beeld.col], [0, 1, 2, 1, 1]);
  assert.ok(['prod', 'mont', 'eng', 'scen', 'beeld'].every((k) => by[k].n === 3), 'one cluster of 3 columns');
  assert.equal(by.prod.span, 1); assert.equal(by.mont.span, 1); assert.equal(by.eng.span, 1);
  assert.equal(by.scen.span, 1, 'eng (until 10:30) blocks column 2');
  assert.equal(by.beeld.span, 2, 'nothing in column 2 at 11:30 → widens');
  assert.deepEqual([by.hist.col, by.hist.span, by.hist.n], [0, 1, 1], 'separate cluster, full width');
  // back-to-back events don't overlap; very short ones count as 20 minutes
  const b = A.layout([ev('a', at(9), at(10)), ev('b', at(10), at(11))]);
  assert.ok(b.every((e) => e.n === 1 && e.col === 0));
  const c = A.layout([ev('a', at(9), at(9, 5)), ev('b', at(9, 10), at(10))]);
  assert.deepEqual(c.map((e) => [e.col, e.n]), [[0, 2], [1, 2]]);
  // identical start: longer one first (left)
  const d = A.layout([ev('short', at(9), at(10)), ev('long', at(9), at(12))]);
  assert.equal(d[0].id, 'long'); assert.equal(d[0].col, 0);
});

test('agenda rangeFor()/stepAnchor(): day, week, work week, 6-week month', () => {
  const A = agendaHelpers();
  const wed = at(15, 0, 2);
  const w = A.rangeFor('week', wed, {});
  assert.equal(new Date(w.from).getDay(), 1); assert.equal(w.days, 7);
  assert.equal(w.to, new Date(2026, 10, 16).getTime());
  const ww = A.rangeFor('week', wed, { workweek: true });
  assert.equal(ww.days, 5); assert.equal(ww.to, new Date(2026, 10, 14).getTime());
  const d = A.rangeFor('day', wed, {});
  assert.equal(d.from, new Date(2026, 10, 11).getTime()); assert.equal(d.to, new Date(2026, 10, 12).getTime());
  const m = A.rangeFor('month', wed, {});
  assert.equal(m.days, 42); assert.equal(new Date(m.from).getDay(), 1);
  assert.equal(m.from, new Date(2026, 9, 26).getTime(), 'November 2026 grid starts Mon 26 Oct');
  assert.equal(m.to, new Date(2026, 11, 7).getTime(), '… 42 days, also across the DST change');
  assert.equal(m.month, new Date(2026, 10, 1).getTime());
  assert.equal(A.stepAnchor('month', new Date(2027, 0, 31).getTime(), 1), new Date(2027, 1, 28).getTime(), 'Jan 31 + 1 month → Feb 28');
  assert.equal(A.stepAnchor('week', wed, -1), at(15, 0, -5));
  assert.equal(A.stepAnchor('day', wed, 1), at(15, 0, 3));
  assert.equal(A.isoWeekNo(at(12)), 46);
});

test('agenda scrollHour(): ~1 h before the first event, or now; default 08:00; stays within 00–24', () => {
  const A = agendaHelpers();
  const r = A.rangeFor('week', at(12), {});
  const ev = (s, e) => ({ start: s, end: e });
  const before = at(12, 0, -14);
  assert.equal(A.scrollHour([], r, before), 8);
  assert.equal(A.scrollHour([ev(at(9), at(11))], r, before), 8);
  assert.equal(A.scrollHour([ev(at(6, 30), at(8)), ev(at(13), at(14))], r, before), 5);
  assert.equal(A.scrollHour([ev(at(13), at(14, 0, 2))], r, before), 0, 'spans midnight → the next day starts at 00:00');
  assert.equal(A.scrollHour([ev(at(9), at(11))], r, at(21)), 13, 'today, 21:00 → latest possible start (13:00 + 11 h)');
  assert.equal(A.scrollHour([ev(at(9), at(11))], r, at(15)), 8, 'now already in view');
  assert.equal(A.scrollHour([ev(at(10), at(11))], r, at(7, 30)), 6, 'now before the first lesson');
});

test('agenda icsFor(): one VEVENT, UTC times, escaped text, folded lines', () => {
  const A = agendaHelpers();
  const it = { key: 'l:abc', title: 'Regie 1, groep; R2', start: at(13), end: at(16),
    data: { id: 'abc/1', courseCode: 'X10300', form: 'Practicum', group: 'Groep R2', teachers: ['Docent B', 'Docent C'],
      location: { room: 'C207 (2.07 - leslokaal)', building: 'Campus Voorbeeld', street: 'Voorbeeldstraat 1', city: 'Leuven', url: 'https://example.edu/rooms/c207' } } };
  const ics = A.icsFor(it, Date.UTC(2026, 9, 26, 12));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.match(ics, /DTSTART:20261109T120000Z/, '13:00 Brussels (CET) = 12:00 UTC');
  assert.match(ics, /DTEND:20261109T150000Z/);
  const BS = String.fromCharCode(92);
  assert.ok(ics.includes(`SUMMARY:Regie 1${BS}, groep${BS}; R2\r\n`), 'commas and semicolons escaped');
  assert.match(ics, /UID:abc1@toledoplus/);
  assert.match(ics.replace(/\r\n /g, ''), /LOCATION:C207 \(2\.07 - leslokaal\)\\, Campus Voorbeeld\\, Voorbeeldstraat 1\\, Leuven/);
  assert.match(ics.replace(/\r\n /g, ''), /DESCRIPTION:X10300\\nPracticum\\nGroep R2\\nDocent B\\, Docent C/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines folded at 75 octets');
});
