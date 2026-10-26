/* Time zone / DST edge cases (Europe/Brussels): DST ends 2026-10-25 03:00 → 02:00, starts 2027-03-28.
   NOW is pinned, so these never depend on when the suite runs. */
'use strict';
process.env.TZ = 'Europe/Brussels';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../helpers/tp');

const LU = 'ULTRA-B-X10265-2627';
const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const due = (id, title, ms, extra = {}) => Object.assign({ id, title, source: 'Filmtaal 1 [X10265]', sourceId: LU, date: ms, type: 'notifications', subType: 'due', read: false, dismissed: false }, extra);

async function at(now, evs = [], ultra = []) {
  const b = await boot({ now });
  b.TP.data._test._put('enrollments', [{ id: 1, learningUnitId: LU, title: 'Filmtaal 1 [X10265]', type: 'course', academicYear: 2627, color: 1 }]);
  b.TP.data._test._put('events', evs);
  b.TP.data._test._put('ultraDeadlines', ultra, { range: { from: now - 14 * 864e5, until: now + 400 * 864e5 } });
  return b.TP;
}

test('the suite runs in Europe/Brussels', () => {
  assert.equal(new Date(local(2026, 10, 24)).getTimezoneOffset(), -120, 'CEST');
  assert.equal(new Date(local(2026, 10, 26)).getTimezoneOffset(), -60, 'CET');
});

test('ageDays over the October DST switch (49 h) is 2', async () => {
  const TP = await at(local(2026, 10, 26, 12), [due('a', 'Taak', local(2026, 10, 24, 12))]);
  const d = TP.data.deadlines()[0];
  assert.equal(d.overdue, true);
  assert.equal(d.ageDays, 2);
  assert.equal(TP.fmt.daysUntil(d.due), -2, 'calendar days');
});

test('dedupe ±2 h works across midnight on the DST night (23:59 vs 00:00)', async () => {
  const TP = await at(local(2026, 10, 23, 12), [due('t1', 'Paper', local(2026, 10, 24, 23, 59))],
    [{ id: 'u1', title: 'paper', due: local(2026, 10, 25, 0, 0), courseLuId: LU, courseTitle: '', cid: null, url: null }]);
  assert.equal(TP.data.deadlines().length, 1);
});

test('a 25-hour day: 2 h before vs after the switch is still one deadline; 3 h is not', async () => {
  const before = local(2026, 10, 25, 1, 30); // CEST
  const after = before + 2 * 36e5;           // 02:30 CET (wall clock only +1 h)
  const TP = await at(local(2026, 10, 24, 12), [due('t1', 'Scène', before)],
    [{ id: 'u1', title: 'Scène', due: after, courseLuId: LU, courseTitle: '', cid: null, url: null },
      { id: 'u2', title: 'Scène', due: before + 3 * 36e5 + 1, courseLuId: LU, courseTitle: '', cid: null, url: null }]);
  assert.equal(TP.data.deadlines().length, 2);
});

test('legacy keys (day based) for 23:59 and 00:30 on the spring-forward night differ; source keys do not care', async () => {
  const TP = await at(local(2027, 3, 27, 12));
  const T = TP.data._test;
  assert.notEqual(T.legacyKey('X', LU, local(2027, 3, 27, 23, 59)), T.legacyKey('X', LU, local(2027, 3, 28, 0, 30)));
  assert.equal(T.legacyKey('X', LU, local(2027, 3, 28, 1, 0)), T.legacyKey('X', LU, local(2027, 3, 28, 3, 30)), 'same local day');
  assert.equal(T.toledoKey({ id: 'e1', title: 'X', sourceId: LU, date: 1 }), T.toledoKey({ id: 'e1', title: 'Y', sourceId: LU, date: 9e12 }));
});

test('ICS times are UTC on both sides of the switch', async () => {
  const TP = await at(local(2026, 10, 20, 12));
  const s = TP.data.ics([
    { key: 'd1', title: 'A', courseName: '', due: local(2026, 10, 24, 23, 59) },
    { key: 'd2', title: 'B', courseName: '', due: local(2026, 10, 26, 23, 59) },
  ]);
  assert.ok(s.includes('DTEND:20261024T215900Z'), 'CEST = UTC+2');
  assert.ok(s.includes('DTEND:20261026T225900Z'), 'CET = UTC+1');
});

test('calendar windows over the DST switch stay ≤ 60 × 24 h', async () => {
  const TP = await at(local(2026, 10, 1, 12));
  for (const [a, b] of TP.data._test.calWindows(local(2026, 9, 1), local(2027, 4, 30))) assert.ok(b - a <= 60 * 864e5);
});

test('schedule groups lessons by local day around the switch', async () => {
  const TP = await at(local(2026, 10, 24, 12));
  TP.data._test._put('upcoming', [
    { start: local(2026, 10, 25, 0, 30), end: local(2026, 10, 25, 1, 30), name: 'Nacht', source: { learningUnitId: LU } },
    { start: local(2026, 10, 24, 23, 30), end: local(2026, 10, 24, 23, 45), name: 'Laat', source: { learningUnitId: LU } },
  ]);
  const s = TP.data.schedule();
  assert.deepEqual(Object.keys(s).sort(), ['2026-10-24', '2026-10-25']);
});
