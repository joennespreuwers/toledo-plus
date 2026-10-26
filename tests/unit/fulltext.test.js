'use strict';
// Full-text search of course files: the pure engine (src/core/fulltext-engine.js) — normalisation, snippets with
// <mark> segments, the inverted index, zip/OOXML/PDF text extraction of generated fixtures, file types, change
// detection, the daily budget and back-off.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sandbox, ROOT } = require('../helpers/sandbox');
const F = require('../helpers/fixture-files');

function engine() {
  const s = sandbox({ globals: { TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, Int32Array, Map, Set, Number, String, Array, Object, Error, RegExp } });
  s.load('src/core/fulltext-engine.js');
  return s.ctx.TPFT;
}
const E = engine();
let pdfjs = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const warn = console.warn; const log = console.log;
  console.warn = () => {}; console.log = () => {}; // pdf.js in Node warns about canvas polyfills (not needed for text)
  try {
    globalThis.pdfjsWorker = await import(path.join(ROOT, 'src/vendor/pdfjs/pdf.worker.min.mjs'));
    pdfjs = await import(path.join(ROOT, 'src/vendor/pdfjs/pdf.min.mjs'));
  } finally { console.warn = warn; console.log = log; }
  return pdfjs;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('normalisation: case, accents, ligatures, NL/FR/EN words', () => {
  assert.equal(E.norm('  Scèneanalyse  Ça VA  ﬁlm '), 'sceneanalyse ca va film');
  assert.deepEqual(plain(E.terms('De mise-en-scène, de Mise en Scène! a 12 B')).sort(), ['12', 'de', 'en', 'mise', 'scene']);
  assert.deepEqual(plain(E.queryWords('Élève  élève café')), ['eleve', 'cafe']);
});

test('snippet: ± radius around the first match, word-start matches marked on the original characters', () => {
  const text = 'Inleiding. '.repeat(20) + 'De mise-en-scène bepaalt de scène; scenario is iets anders. ' + 'Slot. '.repeat(30);
  const sn = E.snippet(text, ['scene'], { radius: 80 });
  const joined = sn.segs.map((s) => s[0]).join('');
  assert.ok(joined.startsWith('…') && joined.endsWith('…'), joined);
  assert.ok(joined.length <= 80 * 2 + 4, `bounded: ${joined.length}`);
  const marked = plain(sn.segs).filter((s) => s[1]).map((s) => s[0]);
  assert.deepEqual(marked, ['scène', 'scène'], 'accented originals marked; "scenario" does not start with "scene"');
  // a word that only occurs inside another word is not a match
  assert.equal(E.snippet('bescheiden', ['scheiden']), null);
  // several query words; adjacent marks merge
  const two = E.snippet('Les twee: kadrering van het beeld', ['kadrer', 'beeld']);
  assert.deepEqual(plain(two.segs).filter((s) => s[1]).map((s) => s[0]), ['kadrer', 'beeld']);
  assert.equal(two.segs.map((s) => s[0]).join(''), 'Les twee: kadrering van het beeld');
});

test('inverted index: all words must match (exact or prefix), best page per file, removal and compaction', () => {
  const ix = E.createIndex();
  ix.add('a', [{ n: 1, terms: E.terms('Inleiding filmtaal') }, { n: 3, terms: E.terms('De kwartelkoning en de regel van derden') }]);
  ix.add('b', [{ n: 6, terms: E.terms('Dia over kwartels en kadrering') }]);
  // prefix: closer prefixes rank higher ("kwartels" before "kwartelkoning")
  assert.deepEqual(plain(ix.search(['kwartel'])).map((r) => [r.key, r.page]), [['b', 6], ['a', 3]]);
  const r = plain(ix.search(['kwartels']));
  assert.deepEqual(r.map((x) => [x.key, x.page]), [['b', 6]], 'exact word');
  assert.deepEqual(plain(ix.search(['kwartelkoning', 'derden'])).map((x) => x.key), ['a']);
  assert.deepEqual(plain(ix.search(['kwartel', 'filmtaal'])), [], 'words must co-occur on one page');
  // exact beats prefix
  ix.add('c', [{ n: 2, terms: E.terms('kwartel') }]);
  assert.equal(ix.search(['kwartel'])[0].key, 'c');
  // re-adding replaces; remove drops
  ix.add('c', [{ n: 9, terms: E.terms('iets anders') }]);
  assert.ok(!ix.search(['kwartel']).some((x) => x.key === 'c'));
  assert.equal(ix.remove('a'), true);
  assert.deepEqual(plain(ix.search(['derden'])), []);
  ix.compact();
  assert.deepEqual(plain(ix.search(['kadrering'])).map((x) => x.key), ['b']);
  assert.deepEqual(plain(ix.stats()), { files: 2, pages: 2, terms: ix.stats().terms });
  // one-letter query words do not expand to every term
  assert.deepEqual(plain(ix.search(['k'])), []);
});

test('file types and result units', () => {
  assert.equal(E.typeOf('Les 1.PDF'), 'pdf');
  assert.equal(E.typeOf('a.docx'), 'docx');
  assert.equal(E.typeOf('a.pptx'), 'pptx');
  assert.equal(E.typeOf('a.xlsx'), 'xlsx');
  assert.equal(E.typeOf('notes.md'), 'text');
  assert.equal(E.typeOf('x', 'application/pdf'), 'pdf');
  assert.equal(E.typeOf('film.mp4', 'video/mp4'), null);
  assert.equal(E.typeOf('scan.png'), null);
  assert.equal(E.typeOf('oud.doc'), null, 'binary Word is not supported');
  assert.equal(E.unitOf('pptx', 3), 'slide');
  assert.equal(E.unitOf('pdf', 1), 'page');
  assert.equal(E.unitOf('docx', 1), '');
});

test('DOCX: paragraphs, entities, page breaks → pages', async () => {
  const r = plain(await E.extract(new Uint8Array(F.makeDocx(['Titel & intro', ['Scène ', 'één'], '\fTweede pagina <b>'])), 'docx'));
  assert.deepEqual(r.pages.map((p) => p.n), [1, 2]);
  assert.match(r.pages[0].text, /Titel & intro\nScène één/);
  assert.equal(r.pages[1].text, 'Tweede pagina <b>');
});

test('PPTX: slide numbers kept (sorted numerically); stored (uncompressed) zips work too', async () => {
  const slides = Array.from({ length: 11 }, (_, i) => [`Dia ${i + 1}`, i === 5 ? 'Montage en ritme' : 'tekst']);
  const r = plain(await E.extract(new Uint8Array(F.makePptx(slides)), 'pptx'));
  assert.deepEqual(r.pages.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(r.pages[5].text, 'Dia 6\nMontage en ritme');
  const stored = plain(await E.extract(new Uint8Array(F.makeZip({ 'ppt/slides/slide2.xml': '<a:p><a:r><a:t>Alleen dia twee</a:t></a:r></a:p>' }, { store: true })), 'pptx'));
  assert.deepEqual(stored.pages, [{ n: 2, text: 'Alleen dia twee' }]);
});

test('XLSX shared strings, plain text and HTML', async () => {
  assert.equal((await E.extract(new Uint8Array(F.makeXlsx(['Planning', 'Week 3: montage'])), 'xlsx')).pages[0].text, 'Planning\nWeek 3: montage');
  assert.equal((await E.extract(new TextEncoder().encode('Hallo\n\n\n\nwereld'), 'text')).pages[0].text, 'Hallo\n\nwereld');
  assert.equal((await E.extract(new TextEncoder().encode('<p>Een &amp; twee</p><script>x()</script><div>drie</div>'), 'html')).pages[0].text, 'Een & twee\ndrie');
});

test('unreadable, empty, too large and unknown files are skipped (no exceptions)', async () => {
  assert.equal((await E.extract(new TextEncoder().encode('MOCK FILE x.docx'), 'docx')).skipped, 'unreadable');
  assert.equal((await E.extract(new Uint8Array(F.makeDocx(['  '])), 'docx')).skipped, 'notext');
  assert.equal((await E.extract(new Uint8Array(10), 'mp4')).skipped, 'unsupported');
  const big = new Uint8Array(E.LIMITS.maxFileBytes + 1);
  assert.equal((await E.extract(big, 'pdf', {})).skipped, 'large');
});

test('PDF via the vendored pdf.js: text per page with page numbers; scans and garbage are skipped', async () => {
  const lib = await loadPdfjs();
  const pdf = F.makePdf([['Les 2 - Kadrering', 'Inleiding.'], ['Totaalshot en close-up.'], ['De regel van derden en de kwartelkoning.', 'Mise-en-scène']]);
  const r = plain(await E.extract(new Uint8Array(pdf), 'pdf', { pdfjs: lib }));
  assert.deepEqual(r.pages.map((p) => p.n), [1, 2, 3]);
  assert.match(r.pages[2].text, /kwartelkoning/);
  assert.match(r.pages[2].text, /Mise-en-scène/, 'WinAnsi è decoded');
  // page numbers survive empty pages; a PDF without text (a scan) is skipped
  const sparse = plain(await E.extract(new Uint8Array(F.makePdf(['', 'Alleen pagina twee heeft tekst hier.'])), 'pdf', { pdfjs: lib }));
  assert.deepEqual(sparse.pages.map((p) => p.n), [2]);
  assert.equal((await E.extract(new Uint8Array(F.makePdf(['', ''])), 'pdf', { pdfjs: lib })).skipped, 'notext');
  assert.equal((await E.extract(new TextEncoder().encode('MOCK FILE x.pdf'), 'pdf', { pdfjs: lib })).skipped, 'unreadable');
});

test('change detection: new attachment, modified date or size → re-index', () => {
  const rec = { attId: 'a1', modified: '2026-10-01T10:00:00Z', size: 100 };
  assert.equal(E.changed(null, {}), true);
  assert.equal(E.changed(rec, { attId: 'a1', modified: '2026-10-01T10:00:00Z' }), false);
  assert.equal(E.changed(rec, { attId: 'a2' }), true);
  assert.equal(E.changed(rec, { attId: 'a1', modified: '2026-10-02T10:00:00Z' }), true);
  assert.equal(E.changed(rec, { size: 101 }), true);
  assert.equal(E.changed({ attId: 'a1', modified: '' }, { attId: 'a1', modified: '2026-10-02T10:00:00Z' }), false, 'a file indexed on download (no date yet) is adopted');
});

test('daily budget resets per local day; back-off grows and honours Retry-After', () => {
  const t = new Date(2026, 9, 26, 12).getTime();
  const MB = 1024 * 1024;
  let b = E.budget(null, t, 100 * MB);
  assert.equal(b.ok, true); assert.equal(b.day, '2026-10-26');
  b = E.budget(b, t, 250 * MB);
  assert.equal(b.ok, false); assert.equal(b.left, 0);
  assert.equal(E.budget(b, t + 864e5).bytes, 0, 'next day starts fresh');
  assert.deepEqual([1, 2, 3, 10].map((n) => E.backoff(n)), [5000, 10000, 20000, 300000]);
  assert.equal(E.backoff(1, '30'), 30000);
});

test('search over a typical index (312 files × 20 pages) answers well within 50 ms', () => {
  const ix = E.createIndex();
  const vocab = Array.from({ length: 6000 }, (_, i) => `woord${i.toString(36)}`);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let f = 0; f < 312; f++) {
    const pages = [];
    for (let p = 1; p <= 20; p++) {
      const ws = new Set();
      for (let k = 0; k < 250; k++) ws.add(vocab[Math.floor(rnd() ** 2 * vocab.length)]);
      if (f === 200 && p === 14) ws.add('kwartelkoning');
      pages.push({ n: p, terms: [...ws].join(' ') });
    }
    ix.add('f' + f, pages);
  }
  const qs = [['kwartelkoning'], ['woord1', 'woord2'], ['woorda'], ['woord'], ['woord3', 'woordz']];
  ix.search(['warmup']);
  const t0 = process.hrtime.bigint();
  for (const q of qs) ix.search(q, { limit: 8 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / qs.length;
  assert.deepEqual(plain(ix.search(['kwartelkoning'])).map((r) => [r.key, r.page]), [['f200', 14]]);
  assert.ok(ms < 50, `average ${ms.toFixed(1)} ms per query`);
});

test('packaging: host page, worker, engine and pdf.js (+ its licence) ship; no new permissions; no eval in our modules', async () => {
  const fs = require('fs');
  const { read, exists } = require('../helpers/sandbox');
  const m = JSON.parse(read('manifest.json'));
  assert.deepEqual(m.permissions, ['storage'], 'no offscreen/unlimitedStorage permission needed');
  const { packFiles } = await import(path.join(ROOT, 'scripts/pack.mjs'));
  const files = packFiles(ROOT);
  for (const f of ['src/core/fulltext-host.html', 'src/core/fulltext-host.mjs', 'src/core/fulltext-worker.mjs', 'src/core/fulltext-engine.js', 'src/core/fulltext.js',
    'src/i18n/fulltext.js', 'src/vendor/pdfjs/pdf.min.mjs', 'src/vendor/pdfjs/pdf.worker.min.mjs', 'src/vendor/pdfjs/LICENSE']) assert.ok(files.includes(f), `${f} not packed`);
  // the frame loads exactly these files (relative module imports)
  assert.match(read('src/core/fulltext-host.html'), /<script type="module" src="fulltext-host\.mjs"><\/script>/);
  for (const f of ['src/core/fulltext-host.mjs', 'src/core/fulltext-worker.mjs']) {
    const s = read(f);
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(|importScripts|https?:\/\/(?!toledo\.kuleuven\.be|ultra\.edu\.kuleuven\.cloud)/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')), `${f}: no eval / remote code`);
    for (const [, dep] of s.matchAll(/import\s*(?:[^'"]*from\s*)?\(?\s*'([^']+)'/g)) assert.ok(exists(path.join('src/core', dep)), `${f} imports missing ${dep}`);
  }
  assert.ok(fs.statSync(path.join(ROOT, 'src/vendor/pdfjs/pdf.worker.min.mjs')).size < 2 * 1024 * 1024);
});
