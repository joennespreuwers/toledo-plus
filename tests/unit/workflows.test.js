/* Guards for the CI/release workflows (F11): Node 22 everywhere, releases run the tests and need release notes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../helpers/sandbox');

test('Node 22 in the workflows and package.json engines', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    const versions = [...read(f).matchAll(/node-version:\s*['"]?(\d+)/g)].map((m) => m[1]);
    assert.ok(versions.length, `${f}: no setup-node`);
    for (const v of versions) assert.equal(v, '22', `${f}: node-version ${v}`);
  }
  assert.equal(JSON.parse(read('package.json')).engines.node, '>=22');
});

test('release.yml runs unit + e2e before packing and rejects an empty CHANGELOG section', () => {
  const y = read('.github/workflows/release.yml');
  const at = (s) => { const i = y.indexOf(s); assert.ok(i >= 0, `release.yml lacks "${s}"`); return i; };
  const unit = at('npm run test:unit'), e2e = at('npm run test:e2e'), pack = at('npm run pack'), rel = at('action-gh-release');
  assert.ok(unit < pack && e2e < pack && pack < rel, 'tests → pack → release');
  assert.match(y, /RELEASE_NOTES\.md[\s\S]*grep -q '\[\^\[:space:\]\]' RELEASE_NOTES\.md[\s\S]*exit 1/, 'empty-notes check');
});
