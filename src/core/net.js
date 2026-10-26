/* Toledo+ — TP.net: fetch helpers.
   Same-origin requests go straight to fetch() (absolute URLs: Ultra sets <base href> to a CDN).
   Cross-origin requests (portal <-> Ultra) go through the background relay (background.js).
   Every error thrown carries .status (0 = network/timeout/relay failure). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const PORTAL = 'https://toledo.kuleuven.be';
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const TIMEOUT = 15000;

  const here = () => (typeof location !== 'undefined' && location.origin) || '';

  // Resolve a path to an absolute URL. Known API prefixes map to their own origin, so callers
  // can write '/portal/api/events' or '/learn/api/…' from either origin.
  function resolve(url) {
    const s = String(url || '');
    if (/^https?:\/\//i.test(s)) return s;
    const p = s.startsWith('/') ? s : '/' + s;
    if (p.startsWith('/portal/')) return PORTAL + p;
    if (p.startsWith('/learn/') || p.startsWith('/ultra/')) return ULTRA + p;
    return (here() || PORTAL) + p;
  }

  function originOf(url) {
    try { return new URL(url).origin; } catch (_) { return ''; }
  }

  function fail(msg, status, extra) {
    const e = new Error(msg);
    e.status = status || 0;
    if (extra) Object.assign(e, extra);
    return e;
  }

  function buildHeaders(url, headers, hasBody) {
    const h = { Accept: 'application/json' };
    if (hasBody) h['Content-Type'] = 'application/json';
    try {
      const u = new URL(url);
      if (u.origin === PORTAL && u.pathname.startsWith('/portal/api/')) {
        const lang = TP.i18n && typeof TP.i18n.apiLang === 'function' ? TP.i18n.apiLang() : 'nl';
        h['Toledo-Language'] = lang || 'nl';
      }
    } catch (_) { /* resolve() always gives a valid URL */ }
    return Object.assign(h, headers || {});
  }

  function relay(msg) {
    return new Promise((res, rej) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          rej(fail('relay unavailable', 0)); return;
        }
        chrome.runtime.sendMessage(msg, (reply) => {
          const le = chrome.runtime.lastError;
          if (le || !reply) { rej(fail('relay: ' + ((le && le.message) || 'no reply'), 0)); return; }
          res(reply);
        });
      } catch (e) {
        // "Extension context invalidated" after an update/reload.
        rej(fail('relay: ' + ((e && e.message) || e), 0));
      }
    });
  }

  async function direct(url, init, timeoutHeadersOnly) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      if (timeoutHeadersOnly) clearTimeout(timer);
      return { r, ctrl, timer };
    } catch (e) {
      clearTimeout(timer);
      throw fail(ctrl.signal.aborted ? 'timeout: ' + url : 'network: ' + ((e && e.message) || e), 0, { url });
    }
  }

  /**
   * JSON request. opts: {method='GET', body (object|string), headers}.
   * Returns parsed JSON (null for an empty body, e.g. 204). Throws Error with .status.
   */
  async function json(url, opts = {}) {
    const abs = resolve(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const hasBody = opts.body != null && method !== 'GET';
    const body = hasBody ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined;
    const headers = buildHeaders(abs, opts.headers, hasBody);

    if (originOf(abs) === here()) {
      const { r, timer } = await direct(abs, { method, body, headers, credentials: 'include' });
      try {
        const text = await r.text();
        if (!r.ok) throw fail(`${method} ${abs}: ${r.status}`, r.status, { url: abs });
        if (!text) return null;
        try { return JSON.parse(text); } catch (_) { throw fail(`${method} ${abs}: invalid JSON`, r.status, { url: abs }); }
      } finally {
        clearTimeout(timer);
      }
    }

    const reply = await relay({ type: 'tp-fetch', url: abs, method, body, headers, as: 'json' });
    if (!reply.ok) throw fail(`${method} ${abs}: ${reply.status || reply.error || 'relay failed'}`, reply.status || 0, { url: abs, relay: true });
    return reply.data;
  }

  /** Text request (same rules as json). */
  async function text(url, opts = {}) {
    const abs = resolve(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});
    if (originOf(abs) === here()) {
      const { r, timer } = await direct(abs, { method, headers, credentials: 'include' });
      try {
        if (!r.ok) throw fail(`${method} ${abs}: ${r.status}`, r.status, { url: abs });
        return await r.text();
      } finally { clearTimeout(timer); }
    }
    const reply = await relay({ type: 'tp-fetch', url: abs, method, headers, as: 'text' });
    if (!reply.ok) throw fail(`${method} ${abs}: ${reply.status || reply.error || 'relay failed'}`, reply.status || 0, { url: abs, relay: true });
    return reply.data;
  }

  /**
   * Binary download with DEFAULT credentials (Ultra download endpoints 302 to signed S3 URLs;
   * S3 rejects credentialed CORS). Only works for the current origin's own endpoints: from the
   * other origin there is no session cookie, so callers should fall back to window.open().
   * The 15 s timeout covers time-to-headers only, so large files can still finish.
   */
  async function blob(url) {
    const abs = resolve(url);
    const { r } = await direct(abs, { method: 'GET' }, true);
    if (!r.ok) throw fail(`GET ${abs}: ${r.status}`, r.status, { url: abs });
    return r.blob();
  }

  TP.net = { json, text, blob, resolve, PORTAL, ULTRA, isSameOrigin: (u) => originOf(resolve(u)) === here() };
})();
