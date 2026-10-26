/* Toledo+ — TP.net: fetch helpers.
   Same-origin requests go straight to fetch() (absolute URLs: Ultra sets <base href> to a CDN).
   Cross-origin requests (portal <-> Ultra, KU Loket) go through the background relay (background.js).
   Every error thrown carries .status (0 = network/timeout/relay failure) and, when it applies:
     .auth  = true  → the session expired (401/403, an HTML login page instead of JSON, redirected away)
     .stale = true  → the extension was updated/reloaded; this page's content script is orphaned
   GET requests are retried on 429/5xx (Retry-After or exponential backoff, max 2 retries). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const PORTAL = 'https://toledo.kuleuven.be';
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  // Tunables (tests shrink the delays).
  const cfg = { timeout: 15000, retries: 2, retryBaseMs: 600, retryMaxMs: 8000 };

  const here = () => (typeof location !== 'undefined' && location.origin) || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  /** True when this content script outlived its extension (update/reload): chrome.runtime.id is gone. */
  function isStale() {
    try { return typeof chrome !== 'undefined' && !!chrome.runtime && !chrome.runtime.id; } catch (_) { return true; }
  }
  const staleError = () => fail('extension context invalidated', 0, { stale: true });

  const LOGIN_URL = /\/(Shibboleth\.sso|idp\/|saml|login|wayf|sso\/)|[?&](SAMLRequest|RelayState)=/i;
  const looksHtml = (text, type) => /text\/html/i.test(type || '') || /^\s*</.test(text || '');

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
      if (isStale()) { rej(staleError()); return; }
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          rej(fail('relay unavailable', 0)); return;
        }
        chrome.runtime.sendMessage(msg, (reply) => {
          const le = chrome.runtime.lastError;
          if (le || !reply) {
            const m = (le && le.message) || 'no reply';
            rej(fail('relay: ' + m, 0, /context invalidated/i.test(m) || isStale() ? { stale: true } : { relayDown: true }));
            return;
          }
          res(reply);
        });
      } catch (e) {
        // "Extension context invalidated" after an update/reload.
        const m = (e && e.message) || String(e);
        rej(fail('relay: ' + m, 0, /context invalidated/i.test(m) || isStale() ? { stale: true } : { relayDown: true }));
      }
    });
  }

  async function direct(url, init, timeoutHeadersOnly) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeout);
    try {
      const r = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      if (timeoutHeadersOnly) clearTimeout(timer);
      return { r, ctrl, timer };
    } catch (e) {
      clearTimeout(timer);
      throw fail(ctrl.signal.aborted ? 'timeout: ' + url : 'network: ' + ((e && e.message) || e), 0, { url, timeout: ctrl.signal.aborted });
    }
  }

  /** Retry-After header (seconds or HTTP date) → ms, or null. */
  function retryAfterMs(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, n * 1000);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
  }
  const retryable = (s) => s === 429 || (s >= 500 && s <= 599);
  const backoff = (attempt, hint) => Math.min(cfg.retryMaxMs, hint != null ? hint : cfg.retryBaseMs * 2 ** attempt);

  /** One same-origin JSON request → {ok, data} | {ok:false, status, retryAfter} or throws (auth/parse/network). */
  async function directJson(abs, method, init) {
    const { r, timer } = await direct(abs, init);
    try {
      const text = await r.text();
      const type = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      const redirectedAway = r.redirected && r.url && (originOf(r.url) !== originOf(abs) || LOGIN_URL.test(r.url));
      if (r.status === 401 || r.status === 403 || redirectedAway) throw fail(`${method} ${abs}: ${r.status} (session)`, r.status, { url: abs, auth: true });
      if (!r.ok) return { ok: false, status: r.status, retryAfter: r.headers && r.headers.get ? r.headers.get('retry-after') : null };
      if (!text || r.status === 204) return { ok: true, data: null };
      try { return { ok: true, data: JSON.parse(text) }; } catch (_) {
        if (looksHtml(text, type)) throw fail(`${method} ${abs}: login page instead of JSON (session)`, r.status, { url: abs, auth: true });
        throw fail(`${method} ${abs}: invalid JSON`, r.status, { url: abs });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** One relayed JSON request → {ok, data} | {ok:false, status, retryAfter} or throws. */
  async function relayJson(abs, method, msg) {
    const reply = await relay(msg);
    const s = reply.status || 0;
    if (s === 401 || s === 403 || reply.error === 'redirected' || reply.error === 'html') {
      throw fail(`${method} ${abs}: ${s || reply.error} (session)`, s, { url: abs, relay: true, auth: true });
    }
    if (reply.error === 'blocked-url' || reply.error === 'blocked-method' || reply.error === 'blocked-sender') {
      throw fail(`${method} ${abs}: ${reply.error}`, 0, { url: abs, relay: true, blocked: true });
    }
    if (!reply.ok) {
      if (retryable(s)) return { ok: false, status: s, retryAfter: reply.retryAfter };
      throw fail(`${method} ${abs}: ${s || reply.error || 'relay failed'}`, s, { url: abs, relay: true, timeout: reply.error === 'timeout' });
    }
    return { ok: true, data: reply.data === undefined ? null : reply.data };
  }

  /**
   * JSON request. opts: {method='GET', body (object|string), headers, keepalive}.
   * Returns parsed JSON (null for an empty body, e.g. 204). Throws Error with .status (+ .auth/.stale).
   */
  async function json(url, opts = {}) {
    if (isStale()) throw staleError();
    const abs = resolve(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const hasBody = opts.body != null && method !== 'GET';
    const body = hasBody ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined;
    const headers = buildHeaders(abs, opts.headers, hasBody);
    const same = originOf(abs) === here();
    const maxTries = method === 'GET' ? cfg.retries + 1 : 1;

    for (let attempt = 0; ; attempt++) {
      const res = same
        ? await directJson(abs, method, { method, body, headers, credentials: 'include', keepalive: !!opts.keepalive })
        : await relayJson(abs, method, { type: 'tp-fetch', url: abs, method, body, headers, as: 'json', keepalive: !!opts.keepalive });
      if (res.ok) return res.data;
      // Non-OK status.
      if (retryable(res.status) && attempt + 1 < maxTries) {
        await sleep(backoff(attempt, retryAfterMs(res.retryAfter)));
        continue;
      }
      throw fail(`${method} ${abs}: ${res.status}`, res.status, { url: abs, relay: !same });
    }
  }

  /** Text request (same rules as json, no retries). Used for non-JSON feeds (e.g. the TimeEdit iCal feed). */
  async function text(url, opts = {}) {
    if (isStale()) throw staleError();
    const abs = resolve(url);
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = Object.assign({}, opts.headers || {});
    if (originOf(abs) === here()) {
      const { r, timer } = await direct(abs, { method, headers, credentials: 'include' });
      try {
        if (r.status === 401 || r.status === 403) throw fail(`${method} ${abs}: ${r.status} (session)`, r.status, { url: abs, auth: true });
        if (!r.ok) throw fail(`${method} ${abs}: ${r.status}`, r.status, { url: abs });
        return await r.text();
      } finally { clearTimeout(timer); }
    }
    const reply = await relay({ type: 'tp-fetch', url: abs, method, headers, as: 'text' });
    if (reply.error === 'redirected' || reply.status === 401 || reply.status === 403) throw fail(`${method} ${abs}: session`, reply.status || 0, { url: abs, relay: true, auth: true });
    if (!reply.ok) throw fail(`${method} ${abs}: ${reply.status || reply.error || 'relay failed'}`, reply.status || 0, { url: abs, relay: true });
    return reply.data;
  }

  /**
   * Binary download with DEFAULT credentials (Ultra download endpoints 302 to signed S3 URLs;
   * S3 rejects credentialed CORS). Only works for the current origin's own endpoints: from the
   * other origin there is no session cookie, so callers should fall back to window.open().
   * The timeout covers time-to-headers only, so large files can still finish.
   */
  async function blob(url) {
    const abs = resolve(url);
    const { r } = await direct(abs, { method: 'GET' }, true);
    if (!r.ok) throw fail(`GET ${abs}: ${r.status}`, r.status, { url: abs, auth: r.status === 401 || r.status === 403 });
    return r.blob();
  }

  TP.net = {
    json, text, blob, resolve, isStale, PORTAL, ULTRA,
    isSameOrigin: (u) => originOf(resolve(u)) === here(),
    _cfg: cfg,
  };
})();
