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
