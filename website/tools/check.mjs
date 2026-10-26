#!/usr/bin/env node
// Checks the website and the demo in Chromium (dev-only, not deployed).
//
//   NODE_PATH=$(npm root -g) node website/tools/check.mjs [--shots]
//
// Site: every page × light/dark × 320/390/768/1440/2560 → no horizontal scroll, no console errors, no requests
// outside the site, images with alt + width/height that load, internal links and #anchors that resolve.
// Demo: overview, deadlines, courses, a course page, agenda, KU Loket, announcements, settings and the ⌘K palette
// render with no console errors and no requests outside the page origin.
// --shots writes screenshots to website/.screens/ (gitignored) for a visual pass.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { ROOT, syncExt } from './sync-ext.mjs';

const require = createRequire(import.meta.url);
function load(name) {
  try { return require(name); } catch (_) { /* fall through */ }
  const roots = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
  try { roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (_) { /* no npm */ }
  for (const r of roots) { try { return require(path.join(r, name)); } catch (_) { /* next */ } }
  console.error(`${name} not found (NODE_PATH=$(npm root -g))`); process.exit(1);
}
const { chromium } = load('playwright');
const SITE = path.join(ROOT, 'website');
const SHOTS = process.argv.includes('--shots') ? path.join(SITE, '.screens') : null;
const PAGES = ['/', '/en/', '/fr/', '/privacy.html', '/en/privacy.html', '/fr/privacy.html', '/does-not-exist'];
const WIDTHS = [320, 390, 768, 1440, 2560];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const EXCLUDED = /^\/(tools|\.screens)(\/|$)|^\/README\.md$/; // not deployed

const problems = [];
const fail = (m) => { problems.push(m); console.log('  ✗ ' + m); };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(SITE, p);
      if (!f.startsWith(SITE) || EXCLUDED.test(p)) f = '';
      if (f && fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!f || !fs.existsSync(f)) { res.writeHead(404, { 'content-type': TYPES['.html'] }); res.end(fs.readFileSync(path.join(SITE, '404.html'))); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(f));
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function checkSite(browser, origin) {
  console.log('Site');
  const linkCache = new Map();
  for (const scheme of ['light', 'dark']) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      for (const p of PAGES) {
        const page = await ctx.newPage();
        const errs = []; const foreign = [];
        page.on('console', (m) => { if (m.type() === 'error' && !(p === '/does-not-exist' && /404/.test(m.text()))) errs.push(m.text()); });
        page.on('pageerror', (e) => errs.push(e.message));
        page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:')) foreign.push(r.url()); });
        await page.goto(origin + p, { waitUntil: 'load' });
        const tag = `${p} ${scheme} ${w}`;
        const r = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          lang: document.documentElement.lang,
          h1: document.querySelectorAll('h1').length,
          imgs: [...document.images].map((i) => ({ src: i.currentSrc || i.src, alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), ok: i.complete && i.naturalWidth > 0, lazy: i.loading === 'lazy' })),
          links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
          ids: [...document.querySelectorAll('[id]')].map((e) => e.id),
          noName: [...document.querySelectorAll('a, button')].filter((e) => !e.hidden && e.offsetParent !== null && !(e.getAttribute('aria-label') || e.textContent.trim())).length,
        }));
        if (r.overflow > 0) fail(`${tag}: horizontal scroll (${r.overflow}px)`);
        if (!r.lang) fail(`${tag}: no <html lang>`);
        if (r.h1 !== 1) fail(`${tag}: ${r.h1} <h1> elements`);
        if (r.noName) fail(`${tag}: ${r.noName} link(s)/button(s) without a name`);
        for (const i of r.imgs) {
          if (i.alt === null) fail(`${tag}: image without alt: ${i.src}`);
          if (!i.w || !i.h) fail(`${tag}: image without width/height: ${i.src}`);
          if (!i.ok && !i.lazy) fail(`${tag}: image did not load: ${i.src}`);
        }
        if (p === '/' && w === 1440) {
          const shot = r.imgs.find((i) => /overview-/.test(i.src));
          if (!shot || !shot.src.includes(`overview-${scheme}`)) fail(`${tag}: hero screenshot is not the ${scheme} variant (${shot && shot.src})`);
        }
        if (errs.length) fail(`${tag}: console errors: ${errs.join(' | ')}`);
        if (foreign.length) fail(`${tag}: external requests: ${foreign.join(', ')}`);
        if (scheme === 'light' && w === 1440) {
          for (const href of r.links) {
            const u = new URL(href);
            if (u.origin !== origin) continue;
            const key = u.pathname;
            if (key === new URL(origin + p).pathname) { // same page: check the anchor against this DOM
              if (u.hash.length > 1 && !u.hash.startsWith('#/') && !r.ids.includes(decodeURIComponent(u.hash.slice(1)))) fail(`${p}: missing anchor ${u.hash}`);
              continue;
            }
            if (!linkCache.has(key)) {
              const res = await fetch(origin + key);
              const body = res.ok ? await res.text() : '';
              const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
              linkCache.set(key, { status: res.status, ids, is404: body.includes('class="notfound"') });
            }
            const t = linkCache.get(key);
            if (t.status !== 200 || t.is404) fail(`${p}: broken link ${key}`);
            if (u.hash && u.hash.length > 1 && !u.hash.startsWith('#/') && !t.ids.has(decodeURIComponent(u.hash.slice(1)))) fail(`${p}: missing anchor ${key}${u.hash}`);
          }
        }
        if (SHOTS && (w === 390 || w === 1440)) await page.screenshot({ path: path.join(SHOTS, `${p.replace(/\W+/g, '_')}-${scheme}-${w}.png`), fullPage: true });
        await page.close();
      }
      await ctx.close();
    }
  }
  console.log(`  ${PAGES.length} pages × 2 schemes × ${WIDTHS.length} widths checked`);
}

async function checkDemo(browser, origin) {
  console.log('Demo');
  const shadow = (page, fn, arg) => page.evaluate(([src, a]) => new Function('sr', 'arg', `return (${src})(sr, arg);`)(document.querySelector('#tplus-root')?.shadowRoot, a), [fn.toString(), arg]);
  const mainText = (page) => shadow(page, (sr) => (sr && sr.querySelector('main') ? sr.querySelector('main').innerText : ''));
  const until = async (page, pred, what, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (await pred()) return true; await page.waitForTimeout(150); }
    fail(`demo: timed out waiting for ${what}`); return false;
  };
  for (const scheme of ['light', 'dark']) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const lang of ['nl', 'en', 'fr']) {
        if (vp.width === 390 && lang !== 'nl') continue;
        const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
        const page = await ctx.newPage();
        const errs = []; const foreign = [];
        page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
        page.on('pageerror', (e) => errs.push(e.message));
        page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
        const tag = `demo ${lang} ${scheme} ${vp.width}`;
        await page.goto(`${origin}/demo/?lang=${lang}`);
        const routes = { overview: 'Wiskunde I', deadlines: 'Opdracht 2', courses: 'Inleiding tot de bureaucratie', agenda: '', kuloket: 'Geschiedenis van het moderne denken', announcements: '200C', settings: '' };
        for (const [route, expect] of Object.entries(routes)) {
          await page.evaluate((r) => { location.hash = `#/home?tplus=${r}`; }, route);
          const ok = await until(page, async () => { const t = await mainText(page); return t.length > 40 && (!expect || t.includes(expect)); }, `${tag} ${route}${expect ? ` ("${expect}")` : ''}`);
          if (ok) await page.waitForTimeout(400);
          if (SHOTS && ok) await page.screenshot({ path: path.join(SHOTS, `demo-${route}-${lang}-${scheme}-${vp.width}.png`) });
        }
        // Course page: click a course card on Vakken (journey link → in-page course route).
        await page.evaluate(() => { location.hash = '#/home?tplus=courses'; });
        await until(page, async () => (await mainText(page)).includes('Wiskunde I'), `${tag} courses list`);
        const clicked = await shadow(page, (sr) => {
          const a = [...sr.querySelectorAll('main a[href]')].find((x) => /Wiskunde I/.test(x.textContent));
          if (!a) return false; a.click(); return true;
        });
        if (!clicked) fail(`${tag}: no course link found`);
        else {
          const ok = await until(page, async () => /tplus=course&/.test(await page.evaluate(() => location.hash)) && (await mainText(page)).includes('Les 4'), `${tag} course page with its content tree`);
          if (ok && SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, `demo-course-${lang}-${scheme}-${vp.width}.png`) }); }
        }
        // ⌘K palette
        if (vp.width === 1440) {
          await page.evaluate(() => { location.hash = '#/home?tplus=overview'; });
          await until(page, async () => (await mainText(page)).includes('Wiskunde I'), `${tag} overview again`);
          await page.waitForTimeout(6500); // the document index is built ~5 s after boot
          await page.keyboard.press('Control+k');
          await page.waitForTimeout(400);
          await page.keyboard.type('slides', { delay: 30 });
          const ok = await until(page, async () => shadow(page, (sr) => /Slides_les4/i.test(sr ? sr.textContent : '')), `${tag} ⌘K results for "slides"`);
          if (ok && SHOTS) await page.screenshot({ path: path.join(SHOTS, `demo-palette-${lang}-${scheme}.png`) });
          await page.keyboard.press('Escape');
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 0) fail(`${tag}: horizontal scroll (${overflow}px)`);
        if (errs.length) fail(`${tag}: console errors: ${[...new Set(errs)].join(' | ')}`);
        if (foreign.length) fail(`${tag}: requests outside the page origin: ${[...new Set(foreign)].join(', ')}`);
        await ctx.close();
      }
    }
  }
  console.log('  routes, course page and ⌘K checked');
}

const sizes = () => {
  let total = 0; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const rel = path.relative(SITE, '/' + path.relative(SITE, p)); if (EXCLUDED.test('/' + path.relative(SITE, p)) || /demo\/ext/.test(p)) continue; const s = fs.statSync(p); if (s.isDirectory()) walk(p); else total += s.size; void rel; } };
  walk(SITE); return total;
};

(async () => {
  syncExt();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    await checkSite(browser, origin);
    await checkDemo(browser, origin);
  } finally {
    await browser.close(); srv.close();
  }
  console.log(`Site size (without demo/ext): ${(sizes() / 1024).toFixed(0)} KB`);
  if (problems.length) { console.log(`\n${problems.length} problem(s).`); process.exit(1); }
  console.log('\nAll good.');
})();
