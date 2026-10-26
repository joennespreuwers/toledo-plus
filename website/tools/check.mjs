#!/usr/bin/env node
// Checks the website and the demo in Chromium (dev-only, not deployed).
//
//   NODE_PATH=$(npm root -g) node website/tools/check.mjs [--shots]
//
// Site: every page × light/dark × 320/390/768/1440/2560 → no horizontal scroll, no console errors, no requests
// outside the site, images with alt + width/height that load, internal links and #anchors that resolve; every page
// uses its own language's og/hero images. Theme toggle: every click flips the visible theme (system light and dark).
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
const HOMES = { '/': 'nl', '/en/': 'en', '/fr/': 'fr' }; // home page → language of its screenshots
const LANG_OF = (p) => (/^\/(en|fr)\//.exec(p) || [, 'nl'])[1];
/** The hero screenshot the visitor sees right now (currentSrc: the WebP <source> when supported). */
const visibleShot = (page) => page.evaluate(() => { const v = [...document.querySelectorAll('img.shot')].find((i) => i.offsetParent !== null); return v && (v.currentSrc || v.src); });
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
        if (HOMES[p] && w === 1440) {
          const shot = await visibleShot(page);
          if (!shot || !shot.includes(`overview-${scheme}-${HOMES[p]}.`)) fail(`${tag}: hero screenshot is not the ${scheme}/${HOMES[p]} variant (${shot})`);
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

// ---------------------------------------------------------------- localized images (screens.mjs writes one set per language)
function checkLocalizedImages() {
  console.log('Localized images');
  const IMG = path.join(SITE, 'assets', 'img');
  for (const p of PAGES.filter((x) => x !== '/does-not-exist').concat(['/404.html'])) {
    const lang = LANG_OF(p);
    const file = path.join(SITE, p.endsWith('/') ? p + 'index.html' : p);
    const html = fs.readFileSync(file, 'utf8');
    const refs = [...html.matchAll(/assets\/img\/([\w.-]+\.(?:png|webp))/g)].map((m) => m[1]);
    for (const r of refs) {
      if (!fs.existsSync(path.join(IMG, r))) fail(`${p}: references missing image assets/img/${r}`);
      const m = /-(nl|en|fr)\.(png|webp)$/.exec(r);
      if (!m) fail(`${p}: unlocalized image assets/img/${r}`);
      else if (m[1] !== lang) fail(`${p}: references the ${m[1]} image ${r} (page is ${lang})`);
    }
    for (const meta of ['og:image', 'twitter:image']) {
      const m = html.match(new RegExp(`(?:property|name)="${meta}" content="([^"]+)"`));
      if (!m) fail(`${p}: no ${meta}`);
      else if (!m[1].endsWith(`/og-${lang}.png`)) fail(`${p}: ${meta} is ${m[1]} (expected og-${lang}.png)`);
    }
    if (HOMES[p]) {
      for (const want of [`overview-light-${lang}.webp`, `overview-dark-${lang}.webp`, `overview-light-${lang}.png`]) {
        if (!refs.includes(want)) fail(`${p}: does not use ${want}`);
      }
      if (!/<link rel="preload" as="image"[^>]*overview-light-/.test(html)) fail(`${p}: no preload for its light screenshot`);
    }
  }
  let total = 0;
  for (const f of fs.readdirSync(IMG)) total += fs.statSync(path.join(IMG, f)).size;
  if (total > 1500 * 1024) fail(`assets/img is ${(total / 1024).toFixed(0)} KB (> 1500 KB)`);
  console.log(`  own-language og/hero images on every page; assets/img ${(total / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------- brand, theme toggle, motion, Lenis
const hex = (rgb) => { const m = String(rgb).match(/\d+(\.\d+)?/g) || []; return m.slice(0, 3).map(Number); };
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

async function checkTheme(browser, origin) {
  console.log('Theme toggle, contrast, motion');
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(origin + '/', { waitUntil: 'load' });
    const tag = `theme ${scheme}`;
    const btn = page.locator('[data-theme-toggle]');
    if (!(await btn.isVisible())) { fail(`${tag}: theme toggle not visible`); await ctx.close(); continue; }
    const seen = [];
    const look = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    let before = await look();
    const initial = await page.evaluate(() => document.querySelector('[data-theme-toggle]').getAttribute('data-mode'));
    if (initial !== scheme) fail(`${tag}: before any click the toggle shows ${initial} (system is ${scheme})`);
    for (let i = 0; i < 4; i++) {
      await btn.click();
      await page.waitForTimeout(320);
      const now = await look();
      if (now === before) fail(`${tag}: click ${i + 1} did not change the theme (background stays ${now})`);
      before = now;
      const st = await page.evaluate(() => {
        const cs = (el) => getComputedStyle(el);
        const body = cs(document.body), lead = cs(document.querySelector('.lead')), link = cs(document.querySelector('.link-arrow, main a:not(.btn)'));
        const prim = cs(document.querySelector('.btn-primary'));
        const tg = document.querySelector('[data-theme-toggle]');
        const icon = [...tg.querySelectorAll('svg')].find((x) => getComputedStyle(x).display !== 'none');
        return { attr: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('tp-theme'), label: tg.getAttribute('aria-label'), mode: tg.getAttribute('data-mode'),
          icon: icon && icon.getAttribute('class'),
          bg: body.backgroundColor, fg: body.color, lead: lead.color, link: link.color, pbg: prim.backgroundColor, pfg: prim.color,
          tc: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content) };
      });
      seen.push(st.attr || 'system');
      for (const [what, fg, bg] of [['text', st.fg, st.bg], ['lead', st.lead, st.bg], ['link', st.link, st.bg], ['primary button', st.pfg, st.pbg]]) {
        const r = ratio(fg, bg);
        if (r < 4.5) fail(`${tag} → ${st.attr || 'system'}: ${what} contrast ${r.toFixed(2)}:1 (< 4.5)`);
      }
      if (st.attr === 'dark' && hex(st.bg).join() !== '18,21,28') fail(`${tag}: data-theme=dark but background ${st.bg}`);
      if (st.attr === 'light' && hex(st.bg).join() !== '255,255,255') fail(`${tag}: data-theme=light but background ${st.bg}`);
      if (st.attr && st.stored !== st.attr) fail(`${tag}: choice not stored (${st.stored})`);
      if (!st.label) fail(`${tag}: toggle without a label`);
      if (st.mode !== st.attr) fail(`${tag}: toggle shows ${st.mode} while the page is ${st.attr}`);
      if (!st.icon || !st.icon.includes(`ti-${st.attr}`)) fail(`${tag}: toggle icon ${st.icon} while the page is ${st.attr}`);
      if (st.label !== { light: 'Thema: licht', dark: 'Thema: donker' }[st.attr]) fail(`${tag}: toggle label "${st.label}" while the page is ${st.attr}`);
      const shot = await visibleShot(page);
      if (!shot || !shot.includes(`overview-${st.attr}-nl.`)) fail(`${tag} → ${st.attr}: hero screenshot ${shot}`);
    }
    const flip = scheme === 'light' ? ['dark', 'light'] : ['light', 'dark'];
    if (seen.join() !== [...flip, ...flip].join()) fail(`${tag}: toggle sequence was ${seen.join(' → ')} (expected ${[...flip, ...flip].join(' → ')})`);
    // EN/FR: the toggle swaps to their own dark/light screenshots.
    for (const [p, l] of [['/en/', 'en'], ['/fr/', 'fr']]) {
      await page.evaluate(() => localStorage.removeItem('tp-theme'));
      await page.goto(origin + p, { waitUntil: 'load' });
      for (let i = 0; i < 2; i++) {
        await page.locator('[data-theme-toggle]').click();
        await page.waitForTimeout(150);
        const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        const shot = await visibleShot(page);
        if (attr !== flip[i]) fail(`${tag} ${p}: click ${i + 1} → ${attr} (expected ${flip[i]})`);
        if (!shot || !shot.includes(`overview-${attr}-${l}.`)) fail(`${tag} ${p} → ${attr}: hero screenshot ${shot}`);
      }
    }
    // No flash: a stored choice is applied before the stylesheet paints (inline <head> script).
    await page.evaluate((v) => localStorage.setItem('tp-theme', v), scheme === 'light' ? 'dark' : 'light');
    await page.goto(origin + '/privacy.html', { waitUntil: 'commit' });
    await page.waitForSelector('body');
    const early = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.documentElement).backgroundColor }));
    if (early.attr !== (scheme === 'light' ? 'dark' : 'light')) fail(`${tag}: stored theme not applied before paint (${early.attr})`);
    // Lenis: on (desktop, motion allowed), anchors glide to the target under the sticky nav
    await page.goto(origin + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.classList.contains('lenis'), null, { timeout: 5000 }).catch(() => fail(`${tag}: Lenis did not start`));
    await page.locator('.nav a[href="#install"], .hero a[href="#install"]').first().click();
    await page.waitForTimeout(1800);
    const pos = await page.evaluate(() => ({ top: document.getElementById('install').getBoundingClientRect().top, nav: document.querySelector('.nav').offsetHeight, hash: location.hash, focus: document.activeElement && document.activeElement.id }));
    if (Math.abs(pos.top - (pos.nav + 16)) > 6) fail(`${tag}: #install landed at ${pos.top.toFixed(0)}px (expected ~${pos.nav + 16})`);
    if (pos.hash !== '#install') fail(`${tag}: anchor did not update the URL (${pos.hash})`);
    if (pos.focus !== 'install') fail(`${tag}: focus did not move to #install (${pos.focus})`);
    await page.keyboard.press('End'); await page.waitForTimeout(400);
    const atEnd = await page.evaluate(() => Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 4);
    if (!atEnd) fail(`${tag}: keyboard End did not scroll to the bottom with Lenis on`);
    if (errs.length) fail(`${tag}: console errors: ${errs.join(' | ')}`);
    await ctx.close();
  }
  // Reduced motion: no Lenis, no reveal/hiding, no running animations; everything visible.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const reqs = []; page.on('request', (r) => reqs.push(r.url()));
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const rm = await page.evaluate(() => ({
    lenis: document.documentElement.classList.contains('lenis'), reveal: document.documentElement.classList.contains('reveal-on'),
    anims: document.getAnimations().filter((a) => a.playState === 'running').length,
    hidden: [...document.querySelectorAll('main *')].filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).opacity) < 1).length,
  }));
  if (rm.lenis || reqs.some((u) => /lenis/.test(u))) fail('reduced motion: Lenis was loaded');
  if (rm.reveal) fail('reduced motion: scroll reveal is on');
  if (rm.anims) fail(`reduced motion: ${rm.anims} animation(s) running`);
  if (rm.hidden) fail(`reduced motion: ${rm.hidden} element(s) not fully visible`);
  await ctx.close();
  // Without JS: everything visible, native scrolling.
  const nojs = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const p2 = await nojs.newPage();
  await p2.goto(origin + '/', { waitUntil: 'load' });
  await p2.waitForTimeout(1200);
  const hid = await p2.locator('#features .feature').evaluateAll((l) => l.filter((e) => parseFloat(getComputedStyle(e).opacity) < 1).length);
  if (hid) fail(`no JS: ${hid} feature card(s) hidden`);
  await nojs.close();
  console.log('  toggle (every click flips the visible theme, icon/label follow), stored choice before paint, contrast, Lenis + anchors + keyboard, reduced motion, no-JS checked');
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
        // demo bar: "‹ Terug naar toledoplus.be" (home in this language) and the theme toggle driving the app's appearance
        const bar = await page.evaluate(() => {
          const a = document.querySelector('#demo-bar a.demo-back');
          const r = a && a.getBoundingClientRect();
          return a ? { href: a.getAttribute('href'), h: r.height, text: a.innerText.trim(), first: document.querySelector('#demo-bar').firstElementChild === a } : null;
        });
        const home = { nl: '../', en: '../en/', fr: '../fr/' }[lang];
        if (!bar) fail(`${tag}: no back link in the demo bar`);
        else {
          if (bar.href !== home) fail(`${tag}: back link goes to ${bar.href} (expected ${home})`);
          if (bar.h < 24) fail(`${tag}: back link target ${bar.h}px (< 24)`);
          if (!bar.first) fail(`${tag}: back link is not the first item of the demo bar`);
          if (!/‹/.test(bar.text)) fail(`${tag}: back link text "${bar.text}"`);
        }
        if (vp.width === 1440 || lang === 'nl') {
          const appearance = () => shadow(page, (sr) => sr && sr.querySelector('.tp-app') && sr.querySelector('.tp-app').dataset.appearance);
          const modes = [];
          const mode0 = await page.locator('#demo-bar [data-theme-toggle]').getAttribute('data-mode');
          if (mode0 !== scheme) fail(`${tag}: demo theme toggle shows ${mode0} before any click (system is ${scheme})`);
          for (let i = 0; i < 3; i++) {
            await page.locator('#demo-bar [data-theme-toggle]').click();
            await page.waitForTimeout(250);
            const m = await appearance();
            modes.push(m);
            const tg = await page.evaluate(() => { const b = document.querySelector('#demo-bar [data-theme-toggle]'); return { mode: b.getAttribute('data-mode'), label: b.getAttribute('aria-label') }; });
            if (tg.mode !== m) fail(`${tag}: demo theme toggle shows ${tg.mode} while the app is ${m}`);
            if (!tg.label) fail(`${tag}: demo theme toggle without a label`);
          }
          const want = scheme === 'light' ? 'dark,light,dark' : 'light,dark,light';
          if (modes.join() !== want) fail(`${tag}: demo theme toggle → app appearance ${modes.join(' → ')} (expected ${want.replace(/,/g, ' → ')})`);
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

// The demo bar at 320px: the back link shortens to "‹ Home", nothing scrolls sideways, Lenis is never loaded in /demo/.
async function checkDemoNarrow(browser, origin) {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 700 } });
  const page = await ctx.newPage();
  const reqs = []; page.on('request', (r) => reqs.push(r.url()));
  await page.goto(`${origin}/demo/?lang=nl`);
  await page.waitForSelector('#demo-bar a.demo-back');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ text: document.querySelector('#demo-bar a.demo-back').innerText.trim(), overflow: document.documentElement.scrollWidth - innerWidth,
    barH: document.querySelector('#demo-bar').getBoundingClientRect().height, motion: document.documentElement.getAttribute('data-tp-motion') }));
  if (!/Home/.test(r.text) || /toledoplus/.test(r.text)) fail(`demo 320: back link should read "‹ Home" (got "${r.text}")`);
  if (r.overflow > 0) fail(`demo 320: horizontal scroll (${r.overflow}px)`);
  if (r.barH > 84) fail(`demo 320: demo bar too tall (${r.barH}px)`);
  if (r.motion === 'off') fail('demo: the app runs with motion switched off');
  if (reqs.some((u) => /lenis/.test(u))) fail('demo: Lenis was loaded in /demo/');
  await ctx.close();
  console.log('  demo bar at 320px checked');
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
    checkLocalizedImages();
    await checkSite(browser, origin);
    await checkTheme(browser, origin);
    await checkDemo(browser, origin);
    await checkDemoNarrow(browser, origin);
  } finally {
    await browser.close(); srv.close();
  }
  console.log(`Site size (without demo/ext): ${(sizes() / 1024).toFixed(0)} KB`);
  if (problems.length) { console.log(`\n${problems.length} problem(s).`); process.exit(1); }
  console.log('\nAll good.');
})();
