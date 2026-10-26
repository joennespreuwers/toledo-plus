'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../helpers/sandbox');

process.env.TZ = 'Europe/Brussels';

function boot(opts) {
  const s = sandbox(opts);
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  try { s.load('src/i18n/core.js'); } catch (_) { /* strings optional for util tests */ }
  return s;
}

test('esc escapes HTML-significant characters', () => {
  const { TP } = boot();
  assert.equal(TP.util.esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(TP.util.esc(null), '');
  assert.equal(TP.util.esc(42), '42');
});

test('abs makes URLs absolute on the current origin (Ultra <base href> fix)', () => {
  const { TP } = boot({ origin: 'https://ultra.edu.kuleuven.cloud' });
  assert.equal(TP.util.abs('/learn/api/public/v1/x'), 'https://ultra.edu.kuleuven.cloud/learn/api/public/v1/x');
  assert.equal(TP.util.abs('learn/x'), 'https://ultra.edu.kuleuven.cloud/learn/x');
  assert.equal(TP.util.abs('https://toledo.kuleuven.be/portal/'), 'https://toledo.kuleuven.be/portal/');
  assert.ok(!TP.util.abs('/ultra/courses/_1_1/outline').includes('cdn'));
});

test('courseName / courseCode', () => {
  const { TP } = boot();
  assert.equal(TP.util.courseName('Filmtaal 1 [X10265]'), 'Filmtaal 1');
  assert.equal(TP.util.courseName('- infoLUCA@Campus Voorbeeld'), 'infoLUCA@Campus Voorbeeld');
  assert.equal(TP.util.courseName('Studentenvereniging Lichtbak'), 'Studentenvereniging Lichtbak');
  assert.equal(TP.util.courseCode('Filmtaal 1 [X10265]'), 'X10265');
  assert.equal(TP.util.courseCode('Studentenvereniging Lichtbak'), '');
});

test('colorForIndex maps Toledo colors 1..16 deterministically onto PALETTE', () => {
  const { TP } = boot();
  const values = new Set(Object.values(TP.util.PALETTE));
  for (let n = 1; n <= 16; n++) {
    const c = TP.util.colorForIndex(n);
    assert.ok(values.has(c), `color ${n} → ${c} not in PALETTE`);
    assert.equal(TP.util.colorForIndex(n), c);
  }
});

test('pool keeps order and bounds concurrency', async () => {
  const { TP } = boot();
  let active = 0; let peak = 0;
  const out = await TP.util.pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (x) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5 + (x % 3)));
    active--; return x * 2;
  });
  assert.deepEqual(Array.from(out), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.ok(peak <= 3, `peak concurrency ${peak}`);
});

test('debounce only fires once', async () => {
  const { TP } = boot();
  let n = 0; const d = TP.util.debounce(() => n++, 20);
  d(); d(); d();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(n, 1);
});

test('uid is unique', () => {
  const { TP } = boot();
  const s = new Set(Array.from({ length: 500 }, () => TP.util.uid()));
  assert.equal(s.size, 500);
});

test('fmt.dayKey / daysUntil use calendar days', () => {
  const { TP } = boot();
  const now = new Date(); const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(0, 30, 0, 0);
  assert.equal(TP.fmt.daysUntil(Date.now()), 0);
  assert.equal(TP.fmt.daysUntil(tomorrow.getTime()), 1);
  assert.match(TP.fmt.dayKey(Date.now()), /^\d{4}-\d{2}-\d{2}$/);
});

test('fmt.rel is localized', () => {
  const s = boot();
  s.setLanguage('nl'); const nl = s.TP.fmt.rel(Date.now());
  s.setLanguage('en'); const en = s.TP.fmt.rel(Date.now());
  s.setLanguage('fr'); const fr = s.TP.fmt.rel(Date.now());
  assert.ok(nl && en && fr);
  assert.notEqual(nl, en); assert.notEqual(en, fr);
  assert.ok(!/^fmt\./.test(nl), 'fmt.* strings must be registered');
});

test('i18n: interpolation, plurals, fallback, language resolution', () => {
  const s = boot({ language: 'fr-BE' });
  const { TP } = s;
  TP.i18n.add({ nl: { 'x.items.one': '{n} item', 'x.items.other': '{n} items', 'x.only': 'alleen nl' }, en: { 'x.items.one': '{n} item', 'x.items.other': '{n} items' }, fr: { 'x.items.one': '{n} élément', 'x.items.other': '{n} éléments' } });
  assert.equal(TP.i18n.lang(), 'fr'); // system → navigator
  assert.equal(TP.t('x.items', { n: 1 }), '1 élément');
  assert.equal(TP.t('x.items', { n: 3 }), '3 éléments');
  assert.equal(TP.t('x.only'), 'alleen nl');
  assert.equal(TP.t('x.missing'), 'x.missing');
  assert.equal(TP.i18n.apiLang(), 'en');
  s.setLanguage('nl');
  assert.equal(TP.i18n.lang(), 'nl'); assert.equal(TP.i18n.locale(), 'nl-BE'); assert.equal(TP.i18n.apiLang(), 'nl');
  s.setLanguage('en'); assert.equal(TP.i18n.locale(), 'en-GB');
});

test('i18n: unknown navigator language defaults to nl', () => {
  const s = boot({ language: 'de-DE' });
  assert.equal(s.TP.i18n.lang(), 'nl');
});
