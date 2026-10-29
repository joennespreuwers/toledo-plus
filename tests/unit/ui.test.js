/* Unit tests for pure helpers in src/core/ui.js: course initials (rail avatars) and the "Bijgewerkt" stamp. */
'use strict';
process.env.TZ = 'Europe/Brussels';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox, noonToday } = require('../helpers/sandbox');

function boot(o = {}) {
  const s = sandbox(Object.assign({ now: noonToday() }, o));
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  s.load('src/i18n/core.js');
  s.load('src/core/ui.js');
  return s;
}

test('initials: letters only, function words skipped, trailing numbers kept, unique in one list (TP-008, TP-115)', () => {
  const { TP } = boot();
  const ini = (names) => [...TP.ui.initials(names)];
  assert.deepEqual(ini(['Inleiding tot de economie', 'Inleiding tot de bureaucratie']), ['IE', 'IB'], 'no "IT" twice');
  assert.deepEqual(ini(['Montage Technieken 1']), ['MT']);
  assert.deepEqual(ini(['Wiskunde I', 'Wiskunde II']), ['W1', 'W2'], 'roman numerals become digits');
  assert.deepEqual(ini(['Programmeren 2']), ['P2']);
  assert.deepEqual(ini(['<b>bold</b> & "quote" \'s']), ['BB'], 'no punctuation in avatars');
  assert.deepEqual(ini(['Filmtaal']), ['FI']);
  assert.deepEqual(ini(['Fysica', 'Fysiologie']), ['FY', 'FS'], 'single words: second letter that differs');
  assert.deepEqual(ini(['Économie']), ['EC'], 'diacritics stripped');
  assert.deepEqual(ini(['']), ['?']);
  for (const x of ini(['Statistiek', 'Statistiek', 'Statistiek'])) assert.equal(x.length, 2);
  assert.equal(new Set(ini(['Statistiek', 'Statistiek', 'Statistiek'])).size, 3, 'even identical names get distinct avatars');
});

test('updatedText: a time today, a date + time for an older stamp (TP-138)', () => {
  const s = boot();
  const { TP } = s;
  const now = Date.now();
  assert.equal(TP.ui.updatedText(now - 3600e3), `Bijgewerkt ${TP.fmt.time(now - 3600e3)}`);
  const old = now - 3 * 864e5;
  const txt = TP.ui.updatedText(old);
  assert.ok(txt.startsWith('Bijgewerkt '), txt);
  assert.ok(txt.includes(TP.fmt.date(old, { day: 'numeric' })), `has the day: ${txt}`);
  assert.ok(txt.endsWith(TP.fmt.time(old)), txt);
  assert.equal(TP.ui.updatedText(null), '');
});

test('undoToast without a mounted shell falls back to a plain toast and returns null', () => {
  const { TP } = boot();
  const said = [];
  TP.shell = { toast: (x) => said.push(x), app: null };
  assert.equal(TP.ui.undoToast('3 gelezen', () => {}), null);
  assert.deepEqual(said, ['3 gelezen']);
});
