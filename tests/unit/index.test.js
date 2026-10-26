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
