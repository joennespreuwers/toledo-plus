'use strict';
// TP.util.sanitize needs a real DOMParser, so it is tested in Chromium (no extension needed).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('../helpers/pw');
const { ROOT } = require('../helpers/launch');

const VECTORS = [
  '<script>window.__x=1</script><p>ok</p>',
  '<img src=x onerror="window.__x=1">',
  '<a href="javascript:window.__x=1">j</a>',
  '<a href=" JaVaScRiPt:window.__x=1">j2</a>',
  '<iframe src="https://example.org"></iframe>',
  '<object data="x"></object><embed src="x">',
  '<form action="https://example.org"><input name=a><button>go</button></form>',
  '<style>body{display:none}</style><link rel=stylesheet href="https://example.org/x.css">',
  '<meta http-equiv="refresh" content="0;url=https://example.org"><base href="https://example.org/">',
  '<div style="position:fixed;inset:0" class="evil" id="tplus-root">overlay</div>',
  '<svg><script>window.__x=1</script><a xlink:href="javascript:alert(1)">s</a></svg>',
  '<p onclick="window.__x=1" onmouseover="window.__x=1">p</p>',
  '<a href="https://example.org/ok">safe</a>',
  '<math><mtext><table><mglyph><style><img src=x onerror=window.__x=1>',
];

describe('TP.util.sanitize', () => {
  let browser; let page;
  before(async () => {
    browser = await chromium.launch({ channel: 'chromium', headless: true });
    page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: path.join(ROOT, 'src/core/util.js') });
  });
  after(async () => { await browser?.close(); });

  it('strips active content, handlers, styles and dangerous URLs', async () => {
    const out = await page.evaluate((vs) => vs.map((v) => window.TP.util.sanitize(v)), VECTORS);
    const joined = out.join('\n');
    assert.ok(!/<script/i.test(joined), 'script');
    assert.ok(!/<(iframe|object|embed|form|input|button|style|link|meta|base)\b/i.test(joined), 'dangerous elements');
    assert.ok(!/\son\w+\s*=/i.test(joined), 'inline handlers');
    assert.ok(!/javascript:/i.test(joined), 'javascript: URL');
    assert.ok(!/\s(style|class|id)\s*=/i.test(joined), 'style/class/id attributes');
    assert.ok(joined.includes('<p>ok</p>'), 'harmless markup is kept');
    assert.match(out[12], /href="https:\/\/example\.org\/ok"/);
    assert.match(out[12], /target="_blank"/);
    assert.match(out[12], /rel="[^"]*noopener/);
  });

  it('nothing executes when the result is inserted', async () => {
    await page.evaluate((vs) => { for (const v of vs) { const d = document.createElement('div'); d.innerHTML = window.TP.util.sanitize(v); document.body.appendChild(d); } }, VECTORS);
    await page.waitForTimeout(200);
    for (const img of await page.$$('img')) await img.dispatchEvent('error');
    for (const p of await page.$$('p')) await p.dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.__x), undefined);
  });

  it('plain() returns text only', async () => {
    const t = await page.evaluate(() => window.TP.util.plain('<p>Hallo <b>wereld</b></p><script>x</script>'));
    assert.match(t, /Hallo wereld/);
    assert.ok(!t.includes('<'));
  });
});
