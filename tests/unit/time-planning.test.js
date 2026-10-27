/* Bug bash — time, planning & export: one date formatter (TP.fmt.when / timeRange), calendar-day arithmetic over the
   DST days, the zone label, the one ICS writer (deadlines + exams + agenda lessons), own deadlines (edit, undo, bulk),
   and the agenda's pure helpers. Europe/Brussels; NOW pinned. */
'use strict';
process.env.TZ = 'Europe/Brussels';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../helpers/tp');
const { sandbox } = require('../helpers/sandbox');

const LU = 'ULTRA-B-X10265-2627';
const local = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

async function at(now, o = {}) {
  const b = await boot({ now, settings: { deadlines: { horizonDays: 42, urgentDays: 3, reminder: '1d' } }, ...o });
  b.s.load('src/i18n/agenda.js');
  b.TP.data._test._put('enrollments', [{ id: 1, learningUnitId: LU, title: 'Filmtaal 1 [X10265]', type: 'course', academicYear: 2627, color: 1 }]);
  b.TP.data._test._put('events', []);
  b.TP.data._test._put('ultraDeadlines', [], { range: { from: now - 14 * 864e5, until: now + 400 * 864e5 } });
  return b;
}
function fmtAt(now, lang = 'nl') {
  const s = sandbox({ now, language: lang === 'nl' ? 'nl-BE' : lang });
  s.load('src/core/util.js'); s.load('src/core/i18n.js');
  for (const f of ['core', 'agenda']) s.load(`src/i18n/${f}.js`);
  return s.TP;
}
function agenda(now) {
  const s = sandbox({ origin: 'https://toledo.kuleuven.be', now });
  s.load('src/core/util.js'); s.load('src/core/i18n.js'); s.load('src/i18n/agenda.js');
  s.load('src/core/settings.js'); s.load('src/core/data.js'); s.load('src/views/agenda.js');
  return s.TP;
}

// ---------------------------------------------------------------- TP.fmt (shared pattern 3)
test('TP.fmt.addDays / sod step calendar days over both DST switches (never + 24 h)', () => {
  const TP = fmtAt(local(2026, 10, 24));
  const sun = local(2026, 10, 25, 0, 30);
  assert.equal(TP.fmt.dayKey(TP.fmt.addDays(sun, 1)), '2026-10-26', '25 h day');
  assert.equal(TP.fmt.dayKey(sun + 864e5), '2026-10-25', 'the old "+ 24 h" stays on the same day');
  assert.equal(TP.fmt.dayKey(TP.fmt.addDays(local(2027, 3, 27, 23, 30), 1)), '2027-03-28', '23 h day');
  assert.equal(TP.fmt.sod(local(2026, 10, 25, 15)), local(2026, 10, 25, 0));
  assert.equal(TP.fmt.wallHours(local(2026, 10, 25, 9)), 9, 'wall clock, not elapsed');
});

test('TP.fmt.when: one spelling per style, the year only when it is not this year', () => {
  const TP = fmtAt(local(2026, 10, 27, 10));
  assert.equal(TP.fmt.when(local(2026, 10, 28, 23, 59)), 'wo 28 okt 23:59');
  assert.equal(TP.fmt.when(local(2026, 10, 28, 23, 59), 'long'), 'Woensdag 28 oktober · 23:59');
  assert.equal(TP.fmt.when(local(2026, 10, 28, 23, 59), 'day'), 'wo 28 okt');
  assert.match(TP.fmt.when(local(2030, 5, 1, 9)), /2030/);
  assert.equal(TP.fmt.when(local(2026, 10, 28, 23, 59), 'long', { zone: true }), 'Woensdag 28 oktober · 23:59', 'no zone label on Belgian time');
});

test('TP.fmt.timeRange marks an end on a later calendar day (TP-222)', () => {
  const TP = fmtAt(local(2026, 10, 27, 10));
  assert.equal(TP.fmt.timeRange(local(2026, 11, 26, 9), local(2026, 11, 26, 11)), '09:00–11:00');
  assert.equal(TP.fmt.timeRange(local(2026, 11, 26, 22), local(2026, 11, 27, 0, 0)), '22:00–00:00', 'ending exactly at midnight is not +1');
  assert.equal(TP.fmt.timeRange(local(2026, 11, 26, 23), local(2026, 11, 27, 1)), '23:00–01:00 (+1)');
});

test('TP.fmt.zone: empty on Belgian time, a short label elsewhere (TP-217)', () => {
  const TP = fmtAt(local(2026, 10, 27, 10));
  assert.equal(TP.fmt.zone(), '');
  const was = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Tokyo';
    assert.match(TP.fmt.zone(Date.UTC(2026, 9, 27, 10)), /GMT\+9|JST/);
    process.env.TZ = 'Europe/Amsterdam'; // same clock as Brussels: no label
    assert.equal(TP.fmt.zone(Date.UTC(2026, 9, 27, 10)), '');
  } finally { process.env.TZ = was; }
});

// ---------------------------------------------------------------- deadlines: calendar days (TP-219)
test('ageDays and "N d te laat" count calendar days: a Tuesday deadline is 1 day late all of Wednesday', async () => {
  for (const [now, n] of [[local(2026, 10, 28, 0, 30), 1], [local(2026, 10, 28, 8), 1], [local(2026, 10, 28, 23, 30), 1]]) {
    const { TP } = await at(now);
    await TP.data.addCustomDeadline({ title: 'Di', courseLuId: '', due: local(2026, 10, 27, 23, 59) });
    await TP.data.addCustomDeadline({ title: 'Ma', courseLuId: '', due: local(2026, 10, 26, 23, 59) });
    const by = Object.fromEntries(TP.data.deadlines().map((d) => [d.title, d.ageDays]));
    assert.equal(by.Di, n, `Tue 23:59 at ${new Date(now).toString()}`);
    assert.equal(by.Ma, 2);
  }
});

// ---------------------------------------------------------------- own deadlines (TP-015, TP-207, TP-208, TP-159)
test('own deadlines: edit keeps id, key and done mark; remove returns the item and re-adding it restores the key', async () => {
  const { TP } = await at(local(2026, 10, 20));
  const item = await TP.data.addCustomDeadline({ title: 'Hoofdstuk 4', courseLuId: LU, due: local(2026, 11, 3, 17) });
  const d0 = TP.data.deadlines().find((d) => d.customId === item.id);
  await TP.data.toggleDone(d0.key);
  const up = await TP.data.updateCustomDeadline(item.id, { title: 'Hoofdstuk 4 en 5', courseLuId: '', due: local(2026, 11, 4, 9) });
  assert.equal(up.id, item.id);
  const d1 = TP.data.deadlines({ includeDone: true }).find((d) => d.customId === item.id);
  assert.equal(d1.key, d0.key, 'same key');
  assert.equal(d1.title, 'Hoofdstuk 4 en 5');
  assert.equal(d1.due, local(2026, 11, 4, 9));
  assert.equal(d1.courseLuId, '');
  assert.equal(d1.done, true, 'done mark survives the edit');
  assert.equal(await TP.data.updateCustomDeadline('nope', { title: 'x' }), null);
  const gone = await TP.data.removeCustomDeadline(item.id);
  assert.equal(gone.id, item.id);
  assert.equal(TP.data.deadlines({ includeDone: true }).some((d) => d.customId === item.id), false);
  await TP.data.addCustomDeadline(gone); // Undo
  const d2 = TP.data.deadlines({ includeDone: true }).find((d) => d.customId === item.id);
  assert.equal(d2.key, d0.key);
  assert.equal(d2.done, true, 'Undo brings the done mark back too');
});

test('allCustom lists an own deadline beyond the horizon (TP-015); setDone marks several at once', async () => {
  const { TP } = await at(local(2026, 10, 20));
  await TP.data.addCustomDeadline({ title: 'Ver weg', courseLuId: '', due: local(2030, 5, 1) });
  assert.equal(TP.data.deadlines({ horizonDays: 366 }).some((d) => d.title === 'Ver weg'), false);
  assert.equal(TP.data.deadlines({ horizonDays: 366, allCustom: true }).some((d) => d.title === 'Ver weg'), true);
  await TP.data.addCustomDeadline({ title: 'A', courseLuId: '', due: local(2026, 10, 1) });
  await TP.data.addCustomDeadline({ title: 'B', courseLuId: '', due: local(2026, 10, 2) });
  const keys = TP.data.deadlines().filter((d) => d.title === 'A' || d.title === 'B').map((d) => d.key);
  assert.equal(keys.length, 2);
  await TP.data.setDone(keys, true);
  assert.equal(TP.data.deadlines({ includeDone: true, pastDays: 60 }).filter((d) => keys.includes(d.key) && d.done).length, 2);
  await TP.data.setDone(keys, false);
  assert.equal(TP.data.deadlines().filter((d) => keys.includes(d.key) && !d.done).length, 2, 'undo');
});

// ---------------------------------------------------------------- ICS (TP-104, TP-105, TP-106, TP-107, TP-017, TP-176)
const unfold = (s) => s.replace(/\r\n /g, '');
test('one ICS file holds deadlines and exams; exams are titled "Examen: …" and get the reminder', async () => {
  const { TP } = await at(local(2026, 10, 20));
  const exam = { id: 'EV1', start: local(2026, 11, 23, 9), end: local(2026, 11, 23, 12), title: 'Wiskunde I', courseCode: 'ZX1001', text: 'Schriftelijk',
    location: { room: 'Aula A', building: 'Campus Voorbeeld', street: '', city: 'Leuven', url: 'https://example.edu/a' }, teachers: ['Docent A'] };
  const s = TP.data.ics([{ key: 'd1', title: 'Opdracht 2', courseName: 'Filmtaal 1', due: local(2026, 10, 28, 23, 59) }], { exams: [exam] });
  const lines = unfold(s).split('\r\n');
  assert.equal(lines.filter((l) => l === 'BEGIN:VEVENT').length, 2);
  assert.ok(lines.includes('SUMMARY:Examen: Wiskunde I'));
  assert.ok(lines.includes('LOCATION:Aula A\\, Campus Voorbeeld\\, Leuven'));
  assert.ok(lines.includes('TRIGGER;RELATED=END:-P1D'), 'deadline alarm relative to the due time');
  assert.ok(lines.includes('TRIGGER:-P1D'), 'exam alarm before the start');
  assert.ok(lines.includes('DTSTART:20261123T080000Z'));
  assert.ok(lines.includes('PRODID:-//Toledo+//Toledo+//NL'));
  await TP.settings.set({ language: 'en' });
  assert.ok(TP.data.ics([], { exams: [exam] }).includes('PRODID:-//Toledo+//Toledo+//EN'), 'PRODID follows the UI language');
});

test('ICS text: a bare CR never starts a line; control characters dropped; URLs must be plain http(s) (TP-176)', async () => {
  const { TP } = await at(local(2026, 10, 20));
  const s = TP.data.icsEvents([{ uid: 'x@t', start: local(2026, 11, 9, 13), end: local(2026, 11, 9, 15), summary: 'Les\u0007',
    location: 'Room 1\rBEGIN:VALARM\rTRIGGER:-PT1M', description: 'Prof X\rATTENDEE:mailto:evil@example.test', url: 'https://ok.example/x\rX-EVIL:1' }]);
  assert.ok(!/\r(?!\n)/.test(s), 'every CR is part of a CRLF');
  const lines = unfold(s).split('\r\n');
  assert.ok(lines.includes('LOCATION:Room 1\\nBEGIN:VALARM\\nTRIGGER:-PT1M'));
  assert.ok(lines.includes('DESCRIPTION:Prof X\\nATTENDEE:mailto:evil@example.test'));
  assert.ok(lines.includes('SUMMARY:Les'));
  assert.equal(lines.filter((l) => l.startsWith('BEGIN:VALARM')).length, 0);
  assert.equal(lines.some((l) => l.startsWith('URL:')), false, 'a URL with a CR is dropped');
});

test('agenda icsFor: octet folding (no split UTF-8 / surrogate pair), exam title + alarm (TP-105, TP-106)', () => {
  const TP = agenda(local(2026, 10, 20));
  const room = 'Lokaal ' + 'é'.repeat(30) + ' 🎓🎓🎓 ' + 'ü'.repeat(20);
  const it = { key: 'x:1', type: 'exam', title: 'Wiskunde I', start: local(2026, 11, 23, 9), end: local(2026, 11, 23, 12),
    data: { id: 'EV1', courseCode: 'ZX1001', location: { room } } };
  const s = TP.agenda.icsFor(it, Date.UTC(2026, 9, 26, 12));
  for (const l of s.split('\r\n')) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `≤ 75 octets: ${l}`);
  assert.ok(!s.includes('�') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s), 'no lone surrogate');
  assert.ok(unfold(s).includes(`LOCATION:${room}\r\n`));
  assert.ok(s.includes('SUMMARY:Examen: Wiskunde I'));
});

test('icsName: file names cut at a word boundary (TP-017)', async () => {
  const { TP } = await at(local(2026, 10, 20));
  assert.equal(TP.data.icsName('Opdracht 2 (nieuwe versie, negeer de vorige)'), 'opdracht-2-nieuwe-versie-negeer-de-vorige');
  const n = TP.data.icsName('Een heel lange titel met veel woorden die nooit eindigt, echt helemaal nooit hoor');
  assert.equal(n, 'een-heel-lange-titel-met-veel-woorden-die-nooit-eindigt-echt', 'whole words, ≤ 60');
  assert.equal(TP.data.icsName('', 'x'), 'x');
});

// ---------------------------------------------------------------- agenda helpers (TP-215, TP-026, TP-080)
test('agenda blocks use wall-clock hours on the DST days: 09:00 sits on the 09:00 line (TP-215)', () => {
  const TP = agenda(local(2026, 10, 25, 12));
  for (const [y, m, d] of [[2026, 10, 24], [2026, 10, 25], [2027, 3, 28]]) {
    const day = local(y, m, d, 0);
    const g = TP.agenda.blockGeom(local(y, m, d, 9), local(y, m, d, 11), day);
    assert.equal(g.top, 9, `${y}-${m}-${d}`);
    assert.equal(g.hours, 2);
  }
  const day = local(2026, 10, 25, 0);
  const late = TP.agenda.blockGeom(local(2026, 10, 25, 23), local(2026, 10, 26, 0), day);
  assert.equal(late.top, 23, 'inside the column, not on the 24 h line');
  assert.equal(late.hours, 1);
});

test('agenda parseDay rejects impossible dates; clampAnchor keeps j/k within two years (TP-026, TP-080, TP-200)', () => {
  const TP = agenda(local(2026, 10, 27, 12));
  assert.equal(TP.agenda.parseDay('2026-11-09'), local(2026, 11, 9, 0));
  assert.equal(TP.agenda.parseDay('2026-02-30'), null);
  assert.equal(TP.agenda.parseDay(''), null);
  assert.equal(TP.agenda.parseDay('09-11-2026'), null);
  const far = local(2031, 10, 1, 0);
  assert.ok(TP.agenda.clampAnchor(far) < far);
  assert.equal(TP.agenda.clampAnchor(local(2027, 1, 1, 0)), local(2027, 1, 1, 0));
});
