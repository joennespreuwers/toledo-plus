'use strict';
// Launches Chromium with the unpacked extension, installs the mock network and
// collects console/page errors. One browser context per test file keeps tests fast;
// call `fresh()` style helpers (clearState) between tests when needed.
process.env.TZ = process.env.TZ || 'Europe/Brussels';
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('./pw');
const fixtures = require('./fixtures');
const mock = require('./mock');
const filesServer = require('./files-server');

const ROOT = path.resolve(__dirname, '..', '..');
// EXT_DIR lets you run the suite against another unpacked build (e.g. an extracted release zip).
const EXT = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : ROOT;
const ARTIFACTS = path.join(ROOT, 'tests', 'artifacts');
const HEADLESS = process.env.HEADED ? false : true;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// Console noise that is not the extension's fault.
const IGNORED_ERRORS = [
  /Failed to load resource: the server responded with a status of 404 .*cdn\.example\.invalid/, // asserted separately
  /net::ERR_BLOCKED_BY_CLIENT/, // foreign requests, asserted separately
];

/**
 * @param {object} o
 * @param {'light'|'dark'} [o.colorScheme]
 * @param {{width,height}} [o.viewport]
 * @param {object} [o.settings]  settings patch written to chrome.storage.sync before the first page loads
 * @param {object} [o.mock]      options for mock.install
 * @param {boolean} [o.motion]   keep animations on (default: off via <html data-tp-motion="off">)
 * @param {'reduce'|'no-preference'} [o.reducedMotion]
 */
async function launch(o = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tplus-e2e-'));
  const files = await filesServer.start();
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // "new" headless – required for extensions
    headless: HEADLESS,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check', ...(files ? files.chromeArgs : [])],
    ignoreHTTPSErrors: !!files,
    viewport: o.viewport || DESKTOP,
    colorScheme: o.colorScheme || 'light',
    reducedMotion: o.reducedMotion || 'no-preference',
    locale: o.locale || 'nl-BE',
    timezoneId: 'Europe/Brussels',
    acceptDownloads: true,
    serviceWorkers: 'allow',
    ...(o.recordVideo ? { recordVideo: o.recordVideo } : {}),
  });
  // Motion off unless a test asks for it (o.motion: true): animations finish instantly, so tests stay fast and
  // deterministic. TP.motion reads <html data-tp-motion="off"> (shared between page and content-script worlds).
  if (!o.motion) {
    await ctx.addInitScript(() => {
      const set = () => document.documentElement && document.documentElement.setAttribute('data-tp-motion', 'off');
      if (document.documentElement) set();
      else new MutationObserver((_, mo) => { if (document.documentElement) { set(); mo.disconnect(); } }).observe(document, { childList: true });
    });
  }
  const fx = fixtures.load();
  const rec = await mock.install(ctx, fx, { ...(o.mock || {}), files });
  const errors = [];
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_ERRORS.some((r) => r.test(m.text()))) errors.push(`[console] ${page.url()} ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[pageerror] ${page.url()} ${e.stack || e}`));
  };
  ctx.on('page', watch);

  const sw = await getServiceWorker(ctx);
  const extId = sw ? new URL(sw.url()).host : null;
  const h = {
    ctx, fx, rec, errors, sw, extId, userDataDir,
    page: null,
    async newPage() { const p = await ctx.newPage(); watch(p); h.page = p; return p; },
    async setSettings(patch) { return storage(h, 'sync', 'settings', patch); },
    async getSettings() { return storageGet(h, 'sync', 'settings'); },
    // TP.state keeps one chrome.storage.local item per key ('state:<key>', v1.2); these helpers hide that.
    async setState(patch) { return stateSet(h, patch); },
    async getState() { return stateGet(h); },
    async close() {
      await ctx.close().catch(() => {});
      await files?.close().catch(() => {});
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    },
  };
  if (o.settings) await h.setSettings(o.settings);
  // pages opened by ctx before our listener
  for (const p of ctx.pages()) { watch(p); h.page = p; }
  if (!h.page) await h.newPage();
  return h;
}

async function getServiceWorker(ctx) {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
  return sw;
}

// chrome.storage access from inside the extension (service worker, or an extension page as fallback).
async function inExtension(h, fn, arg) {
  if (h.sw) return h.sw.evaluate(fn, arg);
  throw new Error('No extension service worker found – is background.js registered in manifest.json?');
}
async function storage(h, area, key, patch) {
  return inExtension(h, async ({ area, key, patch }) => {
    const merge = (a, b) => {
      if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
      const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
      for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
      return out;
    };
    const cur = (await chrome.storage[area].get(key))[key] || {};
    const next = merge(cur, patch);
    await chrome.storage[area].set({ [key]: next });
    return next;
  }, { area, key, patch });
}
async function stateSet(h, patch) {
  return inExtension(h, async (patch) => {
    const merge = (a, b) => {
      if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
      const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
      for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
      return out;
    };
    const keys = Object.keys(patch).map((k) => 'state:' + k);
    const cur = await chrome.storage.local.get(keys);
    const next = {};
    for (const k of Object.keys(patch)) next['state:' + k] = merge(cur['state:' + k], patch[k]);
    await chrome.storage.local.set(next);
    return patch;
  }, patch);
}
async function stateGet(h) {
  return inExtension(h, async () => {
    const all = await chrome.storage.local.get(null);
    const out = { ...(all.state && typeof all.state === 'object' ? all.state : {}) };
    for (const [k, v] of Object.entries(all)) if (k.startsWith('state:')) out[k.slice(6)] = v;
    return Object.keys(out).length ? out : null;
  });
}
async function storageGet(h, area, key) {
  return inExtension(h, async ({ area, key }) => (await chrome.storage[area].get(key))[key] || null, { area, key });
}

// ---------- page helpers ----------

/** Wait until the Toledo+ shell has rendered real content inside its shadow root. */
async function waitForShell(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(() => {
    const host = document.querySelector('#tplus-root');
    const sr = host && host.shadowRoot;
    if (!sr) return false;
    const main = sr.querySelector('main, [role="main"]');
    return !!(main && main.textContent.trim().length > 20);
  }, null, { timeout, polling: 100 });
}

/** Wait until the current view has no skeleton/loading rows left. */
async function waitForIdle(page, { timeout = 10000 } = {}) {
  await page.waitForFunction(() => {
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    if (!sr) return false;
    return !sr.querySelector('main .skeleton, main [aria-busy="true"]');
  }, null, { timeout, polling: 100 }).catch(() => { /* views may keep a busy marker for background refresh; not fatal */ });
}

/** Resolve once the shell's shadow DOM has had no mutations for `quiet` ms (data loaded + rendered). */
async function waitForQuiet(page, { quiet = 400, timeout = 8000 } = {}) {
  await page.evaluate(({ quiet, timeout }) => new Promise((resolve) => {
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    if (!sr) return resolve(false);
    let timer = setTimeout(done, quiet);
    const hard = setTimeout(done, timeout);
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    mo.observe(sr, { subtree: true, childList: true, attributes: true, characterData: true });
    function done() { mo.disconnect(); clearTimeout(timer); clearTimeout(hard); resolve(true); }
  }), { quiet, timeout });
}

/** Evaluate inside the shadow root: fn(shadowRoot, arg). */
function inShadow(page, fn, arg) {
  return page.evaluate(([src, a]) => {
    const sr = document.querySelector('#tplus-root')?.shadowRoot;
    // eslint-disable-next-line no-new-func
    return new Function('sr', 'arg', `return (${src})(sr, arg);`)(sr, a);
  }, [fn.toString(), arg]);
}

/** Locator scoped to the shell (Playwright CSS pierces open shadow roots). */
const shell = (page) => page.locator('#tplus-root');

async function screenshot(page, name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

/** Wait for a predicate on the mock recorder. */
async function waitFor(pred, { timeout = 5000, interval = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await pred(); if (v) return v; await new Promise((r) => setTimeout(r, interval)); }
  return pred();
}

module.exports = { EXT, launch, waitForShell, waitForIdle, waitForQuiet, inShadow, shell, screenshot, waitFor, ROOT, ARTIFACTS, DESKTOP, PHONE,
  PORTAL_HOME: 'https://toledo.kuleuven.be/portal/#/home',
  portalRoute: (r, p) => `https://toledo.kuleuven.be/portal/#/home?tplus=${r}${p ? '&id=' + encodeURIComponent(p) : ''}`,
  COURSE_URL: 'https://ultra.edu.kuleuven.cloud/ultra/courses/_900661_1/outline',
};
