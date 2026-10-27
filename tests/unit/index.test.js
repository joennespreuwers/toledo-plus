'use strict';
// TP.index: matching/ranking (case + diacritic insensitive, all words), flattening, ancestors, size cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');

function load() {
  const s = sandbox();
  s.ctx.chrome = { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() }, onChanged: { addListener() {} } }, runtime: {} };
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  s.load('src/i18n/palette.js');
  s.ctx.TP.data = {
    kindOf: (n) => (n.hasChildren ? 'folder' : /\.pdf$/.test(n.title) ? 'file' : 'page'),
    course: (lu) => ({ 'LU-A': { name: 'Regie 1', hidden: false, color: '#007AFF' }, 'LU-H': { name: 'Verborgen', hidden: true } })[lu] || null,
    on() {},
  };
  s.load('src/core/index.js');
  return s.ctx.TP;
}

test('score: words in any order, case/diacritic insensitive, rank prefix > word start > substring > path', () => {
  const TP = load();
  const sc = TP.index.score;
  assert.equal(sc('scene', 'Scèneanalyse', []), 3, 'prefix, diacritics ignored');
  assert.equal(sc('ANALYSE scène', 'Opdracht Scèneanalyse', []), 1, 'substring, all words');
  assert.equal(sc('analyse', 'Opdracht analyse', []), 2, 'word start');
  assert.equal(sc('regie reader', 'reader.pdf', ['Regie 1']), 0, 'one word only via course');
  assert.equal(sc('xyz', 'Regie', ['Week 3']), -1, 'no match');
  assert.equal(sc('', 'Regie', []), -1, 'empty query');
});

test('flatten → compact rows with folder path and parent; search skips hidden courses; ancestors', () => {
  const TP = load();
  const roots = [{ id: 'f1', title: 'Week 3', hasChildren: true, kids: [
    { id: 'f2', title: 'Opdrachten', hasChildren: true, kids: [{ id: 'd1', title: 'Draaiboek.pdf' }] },
  ] }];
  const rows = TP.index._test.flatten(roots);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    ['f1', 'Week 3', 'folder', '', ''],
    ['f2', 'Opdrachten', 'folder', 'Week 3', 'f1'],
    ['d1', 'Draaiboek.pdf', 'file', 'Week 3 › Opdrachten', 'f2'],
  ]);
  TP.index._test._set({
    _1: { luId: 'LU-A', name: 'Regie 1', t: 1, items: rows },
    _2: { luId: 'LU-H', name: 'Verborgen', t: 1, items: [['x', 'Draaiboek geheim.pdf', 'file', '', '']] },
  });
  const hits = TP.index.search('draaiboek');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].course, 'Regie 1');
  assert.equal(hits[0].path, 'Week 3 › Opdrachten');
  assert.equal(TP.index.search('opdrachten draaiboek').length, 1, 'word matched via path');
  assert.deepEqual([...TP.index.ancestors('_1', 'd1')], ['f1', 'f2']);
  assert.equal(TP.index.status().items, 4);
});

test('cap drops the oldest courses first', () => {
  const TP = load();
  const big = (t) => ({ luId: 'L' + t, name: 'n', t, items: Array.from({ length: 9000 }, (_, i) => ['_' + i + '_1', 'Een vrij lange titel nummer ' + i, 'file', 'Map › Submap', '']) });
  const o = { a: big(1), b: big(3), c: big(2), d: big(4), e: big(5) };
  const out = TP.index._test.cap(o);
  assert.ok(JSON.stringify(out).length <= 2e6);
  assert.ok(!('a' in out), 'oldest dropped');
  assert.ok('e' in out, 'newest kept');
});

// ---------------------------------------------------------------- one matcher for every search surface (bug bash)
const NOW = new Date(2026, 9, 27, 10, 0).getTime(); // Tuesday 27 Oct 2026, 10:00 local
function loadAt(lang = 'nl') {
  const s = sandbox({ now: NOW, settings: { language: lang } });
  s.ctx.chrome = { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() }, onChanged: { addListener() {} } }, runtime: {} };
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  s.load('src/i18n/palette.js');
  s.ctx.TP.settings = { get: () => ({ language: lang }) };
  s.ctx.TP.data = { kindOf: () => 'file', course: (lu) => ({ 'LU-C': { name: 'Algemene chemie', code: 'ZX1003', hidden: false } })[lu] || null, on() {} };
  s.load('src/core/index.js');
  return s.ctx.TP;
}
const at = (d, h = 12) => new Date(2026, 9, d, h).getTime();

test('matcher: accents both ways, any word order, punctuation, course codes with/without a space', () => {
  const I = loadAt().index;
  const h = I.hay(['Laboverslag 3 · Économie', 'Algemene chemie', 'ZX1003']);
  const yes = (q) => assert.ok(I.matcher(q)(h), `should match: ${q}`);
  const no = (q) => assert.ok(!I.matcher(q)(h), `should not match: ${q}`);
  ['economie', 'économie', 'ECONOMIE', 'chemie verslag', 'verslag chemie', 'zx1003', 'zx 1003', 'ZX-1003', 'labo-verslag', 'slag 3'].forEach(yes);
  ['chemie wiskunde', 'zx1004', 'ö'].forEach(no);
  assert.ok(I.matcher('zx1003')(I.hay(['Statistiek', 'ZX 1003'])), 'a query code without the space finds the code with one');
  assert.ok(I.matcher('slides les')(I.hay(['Slides_les1_FINAL.pdf'])), 'underscores separate words');
});

test('matcher: punctuation-only queries are empty; one-letter words only match at a word start', () => {
  const I = loadAt().index;
  for (const q of ['[', '-', '  ', '…']) assert.equal(I.matcher(q).empty, true, `"${q}" has no words`);
  const m1 = I.matcher('1');
  assert.ok(m1(I.hay(['Les 1'])) && m1(I.hay(['les1.pdf'])), '"1" starts a word (also after letters)');
  assert.ok(!m1(I.hay(['Week 21'])), '"1" inside a number does not match');
  assert.ok(!I.matcher('ï')(I.hay(['Wiskunde'])), '"ï" only matches a word starting with i');
  assert.ok(I.matcher('ï')(I.hay(['Inleiding'])));
});

test('matcher: dates in the UI language ("morgen", "28 okt", "vr 30 okt", "30/10", weekday) match the item’s day', () => {
  const I = loadAt('nl').index;
  const due = I.hay(['Opdracht 2', 'Wiskunde'], [at(28, 23)]);   // Wednesday 28 Oct, 23:00
  const lab = I.hay(['Laboverslag', 'Chemie'], [at(30, 9)]);       // Friday 30 Oct
  const ok = (q, h) => assert.ok(I.matcher(q)(h), `"${q}" should match`);
  const ko = (q, h) => assert.ok(!I.matcher(q)(h), `"${q}" should not match`);
  ok('morgen', due); ko('morgen', lab); ok('overmorgen', I.hay(['x'], [at(29)]));
  ok('tomorrow', due); ok('28 okt', due); ok('okt 28', due); ok('28 oktober', due); ok('wo 28 okt', due); ok('28/10', due); ok('28-10-2026', due);
  ok('woensdag', due); ok('vrijdag', lab); ok('fri 30 oct', lab); ok('30 oct', lab); ok('vr 30 okt', lab);
  ok('morgen wiskunde', due); ko('morgen chemie', due);
  ko('30 okt', due); ko('vandaag', due);
  ok('Opdracht', due);
  ko('2026', due); ko('20261028', due);
  assert.equal(I._test.parseDate(['jan']), null, 'a month alone is not a date (Jan is also a name)');
  assert.equal(I._test.parseDate(['30']), null, 'a number alone is not a date');
  assert.equal(I._test.parseDate(['we']), null, 'two-letter weekdays only count next to a day and month');
  const fr = loadAt('fr').index;
  assert.ok(fr.matcher('demain')(fr.hay(['x'], [at(28)])));
  assert.ok(fr.matcher('mer. 28 oct.')(fr.hay(['x'], [at(28)])));
  assert.ok(fr.matcher('aujourd’hui')(fr.hay(['x'], [at(27)])));
});

test('matcher: one typo for words of 5+ letters, only when nothing matches exactly', () => {
  const I = loadAt().index;
  const hays = ['Programmeren 1', 'Statistiek', 'Lessen'].map((x) => I.hay([x]));
  const m = I.matcher('programeren', hays);
  assert.equal(m.fuzzy, true);
  assert.ok(m(hays[0]) && !m(hays[1]));
  assert.ok(I.matcher('statistik', hays)(hays[1]), 'missing letter');
  assert.ok(I.matcher('statsitiek', hays)(hays[1]), 'swapped letters');
  assert.equal(I.matcher('progr', hays).fuzzy, false, 'exact prefix: no typo tolerance needed');
  assert.equal(I.matcher('lesen', hays)(hays[2]), true);
  assert.equal(I.matcher('lesn', hays)(hays[2]), false, 'short words stay exact');
  assert.equal(I.matcher('lessen', [I.hay(['Lessen']), I.hay(['Lessons'])]).fuzzy, false, 'an exact hit anywhere keeps it exact');
  assert.equal(I.score('programeren', 'Programmeren 1', []), -1);
  assert.equal(I.score('programeren', 'Programmeren 1', [], { fuzzy: true }), 0);
  assert.ok(I._test.near1('abcd', 'abdc') && I._test.near1('abc', 'abxc') && !I._test.near1('abc', 'axyc'));
});

test('hayOf: the same fields everywhere (title, course, code, sender, date); search skips course-name-only documents', () => {
  const TP = loadAt();
  const I = TP.index;
  const d = I.hayOf.deadline({ title: 'Laboverslag 3', courseName: 'Algemene chemie', courseLuId: 'LU-C', due: at(30, 9) });
  assert.ok(I.matcher('zx1003')(d), 'deadline found by course code');
  assert.ok(I.matcher('vr 30 okt')(d), 'deadline found by date');
  const a = I.hayOf.announcement({ title: 'Lokaalwijziging', source: 'Algemene chemie [ZX1003]', sourceId: 'LU-C', author: 'Docent A', date: at(26) });
  assert.ok(I.matcher('docent a')(a) && I.matcher('gisteren')(a) && I.matcher('zx1003')(a) && I.matcher('algemene')(a));
  assert.ok(I.matcher('voorbeeld')(I.hayOf.course({ name: 'Statistiek', code: 'ZX1003', teachers: ['Prof. A. Voorbeeld'] })), 'course found by teacher');
  I._test._set({ c1: { luId: 'LU-C', name: 'Algemene chemie', t: 1, items: [
    ['a', 'Syllabus.pdf', 'file', '', ''], ['b', 'Les 1', 'folder', '', ''], ['c', 'Chemie-oefeningen.pdf', 'file', 'Les 1', 'b'],
  ] } });
  assert.deepEqual([...I.search('chemie').map((x) => x.id)], ['c'], 'a course-name-only match does not list every file of the course');
  assert.deepEqual([...I.search('chemie syllabus').map((x) => x.id)], ['a'], 'a title word + a course word still works');
  const total = {};
  I.search('pdf', { limit: 1, total });
  assert.equal(total.n, 2, 'total counts the hits beyond the limit');
});

test('highlight ranges: accent-insensitive, mapped back to the original text, merged', () => {
  const I = loadAt().index;
  const r = (s, ws) => JSON.parse(JSON.stringify(I._test.ranges(s, ws)));
  assert.deepEqual(r('Économie & Écologie', ['eco']), [[0, 3], [11, 14]]);
  assert.deepEqual(r('Laboverslag', ['labo', 'bover']), [[0, 7]]);
  assert.deepEqual(r('Les 1 en 11', ['1']), [[4, 5], [9, 10]]);
});
