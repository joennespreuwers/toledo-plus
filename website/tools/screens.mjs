#!/usr/bin/env node
// Regenerates the website screenshots from the REAL extension with fictitious data.
//
//   NODE_PATH=$(npm root -g) node website/tools/screens.mjs
//
// What it does:
//   1. loads the unpacked extension (repo root) in Playwright's Chromium,
//   2. answers every Toledo / Ultra / KU Loket / TimeEdit / api.toledoplus.be request from website/demo/data/*.json
//      through website/demo/mock.js (the same mock the online demo uses); everything else is blocked,
//   3. opens the overview (welcome card dismissed, banners/toasts hidden) in light and dark at 1440×900 @2x,
//   4. writes website/assets/img/overview-{light,dark}.webp, overview-light.png (fallback) and og.png (1200×630),
//   5. writes the version from manifest.json into index.html, en/index.html and fr/index.html,
//   6. copies the extension into website/demo/ext/ (gitignored) so the demo works locally.
// Dev-only: website/tools/ is not deployed. Uses `sharp` for smaller PNGs when it is installed, else Chromium's encoder.
process.env.TZ = process.env.TZ || 'Europe/Brussels';
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'; // let routes see the extension's background fetches

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { ROOT, syncExt } from './sync-ext.mjs';

const require = createRequire(import.meta.url);
const SITE = path.join(ROOT, 'website');
const IMG = path.join(SITE, 'assets', 'img');
const DATA = path.join(SITE, 'demo', 'data');
const BUDGET = 800 * 1024;
const VIEW = { width: 1440, height: 900 };

function load(name) {
  try { return require(name); } catch (_) { /* fall through */ }
  const roots = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* no npm */ }
  for (const r of roots) { try { return require(path.join(r, name)); } catch (_) { /* next */ } }
  return null;
}
const pw = load('playwright');
if (!pw) { console.error('Playwright not found. Run with NODE_PATH=$(npm root -g) or `npm install` in the repo.'); process.exit(1); }
const sharp = process.env.NO_SHARP ? null : load('sharp'); // NO_SHARP=1 forces the Chromium encoder
const Mock = require(path.join(SITE, 'demo', 'mock.js'));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const router = Mock.create({ portal: readJson('portal.json'), ultra: readJson('ultra.json'), kuloket: readJson('kuloket.json') }, { version: manifest.version });

const PORTAL_HTML = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Toledo</title></head><body><div id="app"><p>Toledo (mock)</p></div></body></html>';
const ULTRA_HTML = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Blackboard Learn</title></head><body><div id="site-wrap"></div></body></html>';
const MOCKED = new Set([Mock.PORTAL, Mock.ULTRA, Mock.KULOKET, Mock.TIMEEDIT, Mock.API]);

async function main() {
  console.log('Toledo+', manifest.version, '— screenshots with fictitious data');
  const blocked = [];
  const errors = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-screens-'));
  const ctx = await pw.chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // new headless: required for extensions
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
    viewport: VIEW, deviceScaleFactor: 2, colorScheme: 'light', locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'allow',
  });
  try {
    await ctx.route(/^https?:\/\//, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (!MOCKED.has(u.origin)) { blocked.push(u.href); return route.abort('blockedbyclient'); }
      const isApi = u.origin !== Mock.PORTAL && u.origin !== Mock.ULTRA ? true : /^\/(portal\/api|learn\/api)\//.test(u.pathname);
      if (!isApi) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: u.origin === Mock.PORTAL ? PORTAL_HTML : ULTRA_HTML });
      const r = router.handle({ url: u.href, method: req.method(), body: req.postData() });
      const body = r.data == null ? '' : typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      return route.fulfill({ status: r.status, contentType: r.contentType, body });
    });

    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    // Start like a student who already closed the welcome card; Dutch UI; system appearance.
    await sw.evaluate(async () => {
      await chrome.storage.sync.set({ settings: { language: 'nl', appearance: 'system' } });
      await chrome.storage.local.set({ 'state:ui': { onboarded: true } });
    });

    const shots = {};
    for (const scheme of ['light', 'dark']) {
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${scheme}] ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[${scheme}] ${e.message}`));
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(`${Mock.PORTAL}/portal/#/home?tplus=overview`);
      await waitForShell(page);
      await settle(page);
      await page.waitForTimeout(1500); // second wave (KU Loket, index) + re-render
      await settle(page);
      await hideChrome(page);
      await page.waitForTimeout(300);
      shots[scheme] = await page.screenshot({ type: 'png' });
      await page.close();
    }
    for (const [scheme, buf] of Object.entries(shots)) fs.writeFileSync(path.join(os.tmpdir(), `tplus-overview-${scheme}.png`), buf);

    // ---------- encode
    const enc = await ctx.newPage();
    await enc.goto('about:blank');
    fs.mkdirSync(IMG, { recursive: true });
    const out = {};
    out['overview-light.webp'] = await toWebp(enc, shots.light, 2400, 0.8);
    out['overview-dark.webp'] = await toWebp(enc, shots.dark, 2400, 0.8);
    out['overview-light.png'] = await toPng(enc, shots.light, 1440);
    out['og.png'] = await ogImage(ctx, shots.light);
    await enc.close();

    let total = 0;
    for (const [name, buf] of Object.entries(out)) {
      fs.writeFileSync(path.join(IMG, name), buf);
      total += buf.length;
      console.log(`  assets/img/${name.padEnd(20)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB`);
    }
    console.log(`  total ${(total / 1024).toFixed(0)} KB (budget ${BUDGET / 1024} KB)${total > BUDGET ? '  ← over budget!' : ''}`);
    // Images that are no longer used by the pages.
    for (const f of fs.readdirSync(IMG)) if (!(f in out)) console.log(`  note: assets/img/${f} is not generated by this script (unused?)`);

    setVersion(manifest.version);
    console.log('  demo/ext ←', path.relative(ROOT, syncExt()));
    if (errors.length) console.warn('Console errors on the extension page:\n  ' + errors.join('\n  '));
    if (blocked.length) console.warn('Blocked requests (not mocked):\n  ' + [...new Set(blocked)].join('\n  '));
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- page helpers (layout-agnostic on purpose)
async function waitForShell(page) {
  await page.waitForFunction(() => {
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    const main = sr && sr.querySelector('main, [role="main"]');
    return !!(main && main.textContent.trim().length > 40);
  }, null, { timeout: 20000, polling: 100 });
}
/** Resolves once the shadow DOM has had no mutations for 500 ms (max 8 s). */
function settle(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    if (!sr) return resolve();
    let t = setTimeout(done, 500);
    const hard = setTimeout(done, 8000);
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 500); });
    mo.observe(sr, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() { mo.disconnect(); clearTimeout(hard); clearTimeout(t); resolve(); }
  }));
}
/** Hide anything transient: banners, toasts, onboarding, focus rings, spinners, carets. */
async function hideChrome(page) {
  await page.evaluate(() => {
    const css = `[class*="banner"], [class*="toast"], [class*="onboard"], [data-banner] { display: none !important; }
      *, *::before, *::after { caret-color: transparent !important; animation: none !important; transition: none !important; }
      :focus, :focus-visible { outline: none !important; }`;
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    for (const root of [sr, document]) {
      if (!root) continue;
      const s = new CSSStyleSheet(); s.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, s];
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
}

// ---------------------------------------------------------------- image encoding (Chromium canvas; sharp when available)
async function canvasEncode(page, buf, width, type, quality) {
  const b64 = await page.evaluate(async ({ src, width, type, quality }) => {
    const img = new Image(); img.src = src; await img.decode();
    const h = Math.round(img.naturalHeight * width / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = width; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, width, h);
    return c.toDataURL(type, quality).split(',')[1];
  }, { src: 'data:image/png;base64,' + buf.toString('base64'), width, type, quality });
  return Buffer.from(b64, 'base64');
}
async function toWebp(page, buf, width, q) {
  if (sharp) return sharp(buf).resize({ width }).webp({ quality: Math.round(q * 100), effort: 6 }).toBuffer();
  return canvasEncode(page, buf, width, 'image/webp', q);
}
async function toPng(page, buf, width) {
  if (sharp) return sharp(buf).resize({ width }).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
  return canvasEncode(page, buf, width, 'image/png');
}
async function ogImage(ctx, shot) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  const icon = fs.readFileSync(path.join(SITE, 'assets', 'icon128.png')).toString('base64');
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,"Segoe UI",Roboto,sans-serif}
    body{background:linear-gradient(160deg,#eef4ff 0%,#f5f5f7 55%,#e9f0fb 100%);position:relative}
    .brand{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:16px;font-weight:700;font-size:44px;letter-spacing:-.02em;color:#1d1d1f}
    .brand img{width:64px;height:64px;border-radius:15px;box-shadow:0 10px 24px -10px rgba(0,113,227,.6)}
    .win{position:absolute;left:64px;top:150px;width:1072px;border-radius:14px;overflow:hidden;background:#e8e8ed;
      box-shadow:0 30px 60px -20px rgba(16,24,40,.35),0 0 0 .5px rgba(0,0,0,.12)}
    .bar{height:30px;display:flex;align-items:center;gap:7px;padding:0 12px;border-bottom:.5px solid rgba(0,0,0,.1)}
    .bar i{width:11px;height:11px;border-radius:50%;background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
    .win img{display:block;width:100%}
  </style></head><body>
    <div class="brand"><img src="data:image/png;base64,${icon}" alt="">Toledo+</div>
    <div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/png;base64,${shot.toString('base64')}" alt=""></div>
  </body></html>`);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  let png = await page.screenshot({ type: 'png', scale: 'css' }); // 1200×630 regardless of the context's @2x
  await page.close();
  if (sharp) png = await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
  return png;
}

// ---------------------------------------------------------------- version text in the pages
function setVersion(v) {
  for (const rel of ['index.html', 'en/index.html', 'fr/index.html']) {
    const f = path.join(SITE, rel);
    const before = fs.readFileSync(f, 'utf8');
    const after = before
      .replace(/((?:Versie|Version) )\d+\.\d+\.\d+/g, `$1${v}`)
      .replace(/(Toledo\+ )\d+\.\d+\.\d+(<\/h3>)/g, `$1${v}$2`)
      .replace(/("softwareVersion": ")[^"]*(")/g, `$1${v}$2`);
    if (after !== before) { fs.writeFileSync(f, after); console.log(`  ${rel}: version → ${v}`); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
