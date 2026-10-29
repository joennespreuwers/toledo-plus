'use strict';
// Every string key must exist in nl, en and fr, be non-empty and use the same {placeholders}.
// Every literal TP.t('key') used in src/ must be registered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sandbox, list, read, ROOT } = require('../helpers/sandbox');

function loadAll() {
  const s = sandbox();
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  for (const f of list('src/i18n', /\.js$/)) s.load(f);
  return s.TP;
}

const placeholders = (str) => [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const pluralBase = (k) => k.replace(/\.(zero|one|two|few|many|other)$/, '');

test('i18n files exist', () => {
  assert.ok(list('src/i18n', /\.js$/).length > 0, 'no src/i18n/*.js files');
});

test('all keys exist in nl, en and fr', () => {
  const TP = loadAll();
  const t = TP.i18n._table;
  const all = new Set([...Object.keys(t.nl), ...Object.keys(t.en), ...Object.keys(t.fr)]);
  const missing = [];
  for (const k of all) {
    for (const l of ['nl', 'en', 'fr']) {
      if (t[l][k] != null) continue;
      // plural forms may legitimately differ per language (e.g. fr has no '.zero'), but base must have some form
      const b = pluralBase(k);
      if (b !== k && Object.keys(t[l]).some((x) => pluralBase(x) === b && x !== b)) continue;
      missing.push(`${l}: ${k}`);
    }
  }
  assert.deepEqual(missing, [], `Missing translations:\n${missing.join('\n')}`);
});

test('no empty strings and matching placeholders', () => {
  const TP = loadAll();
  const t = TP.i18n._table;
  const problems = [];
  for (const k of Object.keys(t.nl)) {
    for (const l of ['nl', 'en', 'fr']) {
      const v = t[l][k];
      if (v == null) continue;
      // intentionally empty strings are fine only if empty in every language
      if (typeof v !== 'string') problems.push(`${l}: ${k} is not a string`);
      else if (!v.trim() && ['nl', 'en', 'fr'].some((x) => String(t[x][k] ?? '').trim())) problems.push(`${l}: ${k} is empty`);
    }
    if (t.en[k] != null && placeholders(t.nl[k]) !== placeholders(t.en[k])) problems.push(`en: ${k} placeholders {${placeholders(t.en[k])}} ≠ nl {${placeholders(t.nl[k])}}`);
    if (t.fr[k] != null && placeholders(t.nl[k]) !== placeholders(t.fr[k])) problems.push(`fr: ${k} placeholders {${placeholders(t.fr[k])}} ≠ nl {${placeholders(t.nl[k])}}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('every literal TP.t("key") used in src/ is registered', () => {
  const TP = loadAll();
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(path.join(ROOT, d))) { const r = `${d}/${f}`; if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (f.endsWith('.js')) files.push(r); } };
  walk('src');
  const missing = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/\b(?:TP\.)?t\(\s*'([a-zA-Z][\w.-]*\.[\w.-]+)'/g)) {
      if (m[1].endsWith('.')) continue; // prefix of a dynamic key: 'courses.sem.' + x
      if (!TP.i18n.has(m[1]) && !Object.keys(TP.i18n._table.nl).some((k) => pluralBase(k) === m[1])) missing.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], `Unregistered keys:\n${[...new Set(missing)].join('\n')}`);
});

test('keyboard modifier follows the platform: ⌘ on macOS (userAgentData "macOS" or platform "MacIntel"), Ctrl+ elsewhere', () => {
  const load = (navigator) => { const s = sandbox({ globals: { navigator: { language: 'nl-BE', languages: ['nl-BE'], ...navigator } } }); s.load('src/core/util.js'); s.load('src/core/i18n.js'); for (const f of list('src/i18n', /\.js$/)) s.load(f); return s.TP; };
  const mac1 = load({ userAgentData: { platform: 'macOS' } });
  const mac2 = load({ platform: 'MacIntel' });
  const win = load({ userAgentData: { platform: 'Windows' }, platform: 'Win32' });
  const lin = load({ platform: 'Linux x86_64' });
  for (const T of [mac1, mac2]) { assert.equal(T.i18n.isMac, true); assert.equal(T.i18n.mod, '⌘'); assert.match(T.t('settings.search.indexDesc'), /⌘K/); }
  for (const T of [win, lin]) {
    assert.equal(T.i18n.isMac, false); assert.equal(T.i18n.mod, 'Ctrl+');
    assert.match(T.t('settings.search.indexDesc'), /Ctrl\+K/); assert.doesNotMatch(T.t('settings.search.indexDesc'), /⌘/);
    assert.equal(T.t('fulltext.course.done', { n: 2 }).includes('Ctrl+K'), true);
  }
});

// Bug bash (TP-053, TP-056, TP-122, TP-123, TP-124, TP-126, TP-055, TP-166, TP-054, TP-058): one wording per idea.
test('copy consistency: day plurals, action labels, one "new tab" phrase, one classic label, greeting at night', () => {
  const s = sandbox();
  s.load('src/core/util.js'); s.load('src/core/i18n.js');
  for (const f of list('src/i18n', /\.js$/)) s.load(f);
  const { TP } = s;
  const T = TP.i18n._table;
  // TP-053: no bare "d"/"j" day abbreviation; singular and plural forms
  s.setLanguage('nl');
  assert.equal(TP.t('fmt.inDays', { n: 1 }), 'over 1 dag');
  assert.equal(TP.t('fmt.daysAgo', { n: 3 }), '3 dagen geleden');
  assert.equal(TP.t('va.overdueBy', { n: 1 }), '1 dag te laat');
  s.setLanguage('en');
  assert.equal(TP.t('fmt.inDays', { n: 3 }), 'in 3 days');
  assert.equal(TP.t('va.overdueBy', { n: 1 }), '1 day overdue');
  s.setLanguage('fr');
  assert.equal(TP.t('fmt.daysAgo', { n: 2 }), 'il y a 2 jours');
  for (const l of ['nl', 'en', 'fr']) {
    for (const [k, v] of Object.entries(T[l])) if (/^(fmt\.(inDays|daysAgo)|va\.overdueBy)/.test(k)) assert.doesNotMatch(v, /\{n\} [dj]\b/, `${l} ${k}: ${v}`);
  }
  // TP-056: past dates within a week read "N dagen geleden", never a weekday next to "gisteren"
  s.setLanguage('nl');
  const d = new Date(); d.setDate(d.getDate() - 3); d.setHours(12, 0, 0, 0);
  assert.equal(TP.fmt.ago(d.getTime()), '3 dagen geleden');
  // TP-126: "Mark all read" is an action, not a status
  assert.equal(T.nl['announcements.readAll'], 'Alles als gelezen markeren');
  assert.equal(T.nl['overview.new.readAll'], 'Alles als gelezen markeren');
  // TP-123: one word for "done" in NL
  assert.equal(T.nl['courses.done'], T.nl['common.done']);
  // TP-122: a Toledo deadline's source is not a "melding" (notification)
  assert.doesNotMatch(T.nl['va.source.toledo'], /melding/i);
  // TP-124: one NL phrasing for "opens in a new tab"
  const newTab = Object.entries(T.nl).filter(([k]) => /newTab$/.test(k)).map(([, v]) => v.replace(/[()]/g, ''));
  assert.ok(newTab.length >= 4);
  assert.deepEqual([...new Set(newTab)], ['opent in een nieuw tabblad']);
  // TP-055: the footer and the account menu name classic Toledo the same way
  for (const l of ['nl', 'en', 'fr']) {
    assert.equal(T[l]['brand.classicShort'], T[l]['shell.classic'], l);
    assert.equal(T[l]['brand.classicTitle'], T[l]['shell.classicHint'], l);
  }
  // TP-166: the night greeting is a greeting, not a goodbye
  assert.doesNotMatch(T.nl['overview.greet.night'], /nacht/i);
  assert.doesNotMatch(T.en['overview.greet.night'], /night/i);
  assert.doesNotMatch(T.fr['overview.greet.night'], /nuit/i);
  // TP-054: EN/FR explain "Ad Valvas"
  for (const l of ['en', 'fr']) assert.match(T[l]['announcements.school'], /Ad Valvas \(.+\)/, l);
  // TP-058: "ICS" is explained as a file
  for (const l of ['nl', 'en', 'fr']) assert.match(T[l]['settings.dl.reminder'], /\.ics/, l);
});
