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
