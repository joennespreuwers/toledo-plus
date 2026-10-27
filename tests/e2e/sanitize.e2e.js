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
  // URL-parser normalisation tricks: tab/newline inside the scheme, leading C0 control characters.
  '<a href="java&#9;script:window.__x=1">tab</a>',
  '<a href="java\nscript:window.__x=1">nl</a>',
  '<a href="&#1;javascript:window.__x=1">c0</a>',
  '<img srcset="x.png 1x, javascript:window.__x=1 2x">',
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

  it('tracking attributes are stripped, images kept with no-referrer, media never autoplay (TP-177)', async () => {
    const html = '<img src="https://evil.test/pixel.gif?u=student1" referrerpolicy="unsafe-url" srcset="https://evil.test/a.png 2x" sizes="10px" loading="eager" crossorigin="use-credentials">'
      + '<audio src="https://evil.test/a.mp3" autoplay></audio><video src="https://evil.test/v.mp4" poster="https://evil.test/p.png" autoplay preload="auto"><source src="https://evil.test/v.webm"><track src="https://evil.test/t.vtt" default></video>'
      + '<a href="https://evil.test/dest" ping="https://evil.test/ping" referrerpolicy="unsafe-url" data-x="1" aria-hidden="true">link</a>'
      + '<table background="https://evil.test/bg.png"><tr><td background="https://evil.test/td.png">x</td></tr></table><picture><source srcset="https://evil.test/s.webp"><img src="/bbcswebdav/pid-1/img.png" alt="diagram"></picture>';
    const out = await page.evaluate((h) => window.TP.util.sanitize(h), html);
    for (const bad of ['referrerpolicy="unsafe-url"', 'srcset', 'sizes=', 'autoplay', 'poster', 'ping=', 'background', 'crossorigin', '<track', 'data-x', 'aria-hidden', 'preload="auto"', 'loading="eager"']) {
      assert.ok(!out.includes(bad), `${bad} survived: ${out}`);
    }
    assert.match(out, /<img src="https:\/\/evil\.test\/pixel\.gif\?u=student1" referrerpolicy="no-referrer" loading="lazy"/, 'remote image kept, no referrer, lazy');
    assert.match(out, /<audio src="https:\/\/evil\.test\/a\.mp3" preload="none" controls="">/);
    assert.match(out, /<video src="https:\/\/evil\.test\/v\.mp4" preload="none" controls="">/);
    assert.match(out, /<a href="https:\/\/evil\.test\/dest" target="_blank" rel="noopener noreferrer">/);
    assert.match(out, /src="https:\/\/ultra\.edu\.kuleuven\.cloud\/bbcswebdav\/pid-1\/img\.png"/, 'relative src resolves against Ultra');
    // Inserting it loads nothing but the (lazy, referrer-less) image — no audio/video/poster/ping requests.
    const reqs = [];
    const onReq = (r) => { if (/evil\.test/.test(r.url())) reqs.push(r.url()); };
    page.on('request', onReq);
    await page.route('https://evil.test/**', (r) => r.fulfill({ status: 204, body: '' }));
    await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = window.TP.util.sanitize(h); document.body.prepend(d); }, html);
    await page.waitForTimeout(400);
    page.off('request', onReq);
    assert.ok(!reqs.some((u) => /\.(mp3|mp4|webm|vtt)$|p\.png|bg\.png|td\.png|\/ping|s\.webp|a\.png/.test(u)), 'unexpected requests: ' + reqs.join(', '));
  });

  it('in-page anchors stay in the page; relative links go to Ultra, also from the portal (TP-092, TP-093)', async () => {
    const out = await page.evaluate(() => window.TP.util.sanitize('<a href="#frag">a</a><a href="/ultra/courses/_900661_1/outline">b</a><a href="x.pdf">c</a>'));
    assert.match(out, /<a href="#frag">a<\/a>/);
    assert.match(out, /<a href="https:\/\/ultra\.edu\.kuleuven\.cloud\/ultra\/courses\/_900661_1\/outline" target="_blank"/);
    assert.match(out, /href="https:\/\/ultra\.edu\.kuleuven\.cloud\/x\.pdf"/);
    const own = await page.evaluate(() => window.TP.util.sanitize('<a href="/a">a</a>', { base: 'https://icts-p-toledo-valvas.cloud.icts.kuleuven.be/student/' }));
    assert.match(own, /href="https:\/\/icts-p-toledo-valvas\.cloud\.icts\.kuleuven\.be\/a"/);
  });

  it('plain() returns text only', async () => {
    const t = await page.evaluate(() => window.TP.util.plain('<p>Hallo <b>wereld</b></p><script>x</script>'));
    assert.match(t, /Hallo wereld/);
    assert.ok(!t.includes('<'));
  });
});
