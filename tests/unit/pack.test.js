/* scripts/pack.mjs: the release zip contains exactly the manifest-referenced files (+ LICENSE). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, read } = require('../helpers/sandbox');

const load = () => import(path.join(ROOT, 'scripts/pack.mjs'));

test('packs every manifest-referenced file and nothing else', async () => {
  const { packFiles } = await load();
  const files = packFiles(ROOT);
  const m = JSON.parse(read('manifest.json'));
  const need = new Set(['manifest.json', 'LICENSE', m.background.service_worker, ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]), 'ui.css']);
  for (const f of need) assert.ok(files.includes(f), `${f} missing from the zip`);
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} does not exist`);
    assert.ok(!/^(tests|docs|legacy|scripts|dist|node_modules|\.github)\//.test(f), `${f} must not ship`);
    assert.ok(!/(^|\/)\./.test(f), `dotfile ${f}`);
    assert.ok(!/\.md$/i.test(f) && f !== 'package.json', `${f} must not ship`);
  }
  const allJs = new Set(m.content_scripts.flatMap((c) => c.js));
  for (const f of files.filter((x) => x.endsWith('.js'))) assert.ok(allJs.has(f) || f === m.background.service_worker, `${f} is packed but not loaded by the manifest`);
});

test('a missing referenced file fails the pack; stray files are left out', async () => {
  const { packFiles } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-pack-'));
  try {
    const w = (rel, s = '') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };
    w('manifest.json', JSON.stringify({ manifest_version: 3, version: '9.9.9', background: { service_worker: 'bg.js' },
      content_scripts: [{ js: ['a.js'], css: ['p.css'] }], icons: { 16: 'i/16.png' }, web_accessible_resources: [{ resources: ['v/*.css'] }] }));
    w('bg.js'); w('a.js'); w('p.css'); w('i/16.png'); w('v/x.css'); w('v/x.js'); w('old.js'); w('LICENSE'); w('.env', 'SECRET=1'); w('notes.md');
    assert.deepEqual(packFiles(dir), ['LICENSE', 'a.js', 'bg.js', 'i/16.png', 'manifest.json', 'p.css', 'v/x.css']);
    fs.rmSync(path.join(dir, 'a.js'));
    assert.throws(() => packFiles(dir), /missing file: a\.js/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the built-in zip writer produces a zip with exactly those entries', async () => {
  const { packFiles } = await load();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-zip-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/pack.mjs'), '--out', out, '--node'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const zip = fs.readFileSync(path.join(out, fs.readdirSync(out)[0]));
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(end + 10);
    let off = zip.readUInt32LE(end + 16);
    const names = [];
    for (let i = 0; i < count; i++) {
      const n = zip.readUInt16LE(off + 28), x = zip.readUInt16LE(off + 30), c = zip.readUInt16LE(off + 32);
      names.push(zip.toString('utf8', off + 46, off + 46 + n));
      off += 46 + n + x + c;
    }
    assert.deepEqual(names, packFiles(ROOT));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
