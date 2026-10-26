/* Toledo+ — MV3 service worker.
   Only job: a cross-origin fetch relay for our own content scripts
   (toledo.kuleuven.be portal <-> ultra.edu.kuleuven.cloud Blackboard Ultra, plus read-only KU Loket/TimeEdit and the Toledo+ API for the anonymous usage signal/feedback).
   Content scripts can only fetch their own origin with cookies; the extension can fetch
   the allowed origins because of host_permissions. Nothing else is reachable through this relay. */
'use strict';

// Per target origin: the methods the relay may use there.
const TP_ALLOWED = {
  'https://toledo.kuleuven.be': ['GET', 'PATCH'],      // portal API (reads + mark read)
  'https://ultra.edu.kuleuven.cloud': ['GET', 'PATCH'], // Blackboard REST
  'https://webwsp.aps.kuleuven.be': ['GET'],            // KU Loket (SAP OData: uurrooster, examenrooster, iCal-link)
  'https://cloud.timeedit.net': ['GET'],                // public TimeEdit iCal feed of the student's timetable
  'https://api.toledoplus.be': ['GET', 'POST'],         // Toledo+ API (exact paths: TP_API_PATHS)
};
// The Toledo+ API: only these exact method+path pairs, no query string, no cookies.
const TP_API = 'https://api.toledoplus.be';
const TP_API_PATHS = ['POST /v1/ping', 'POST /v1/forget', 'POST /v1/feedback', 'GET /v1/latest'];
const TP_ALLOWED_ORIGINS = Object.keys(TP_ALLOWED);
// Pages whose content scripts may use the relay (besides the extension's own pages).
const TP_SENDER_ORIGINS = ['https://toledo.kuleuven.be', 'https://ultra.edu.kuleuven.cloud'];
const tpCfg = { timeout: 15000 }; // mutable for tests

function tpOrigin(url) {
  try { return new URL(url).origin; } catch (_) { return ''; }
}

function tpAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TP_ALLOWED_ORIGINS.includes(u.origin) && !u.username && !u.password;
  } catch (_) {
    return false;
  }
}

/** The message must come from this extension: one of our content scripts on an allowed page, or our own pages. */
function tpSenderOk(sender) {
  if (!sender) return false;
  const self = chrome.runtime.id;
  if (sender.id && sender.id !== self) return false;
  const origin = sender.origin || tpOrigin(sender.url || (sender.tab && sender.tab.url) || '');
  if (!origin) return false;
  return TP_SENDER_ORIGINS.includes(origin) || origin === `chrome-extension://${self}`;
}

function tpHeaders(h) {
  const out = {};
  if (h && typeof h === 'object') {
    for (const [k, v] of Object.entries(h)) {
      if (typeof k === 'string' && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v);
    }
  }
  return out;
}

async function tpRelay(msg) {
  const url = String(msg.url || '');
  if (!tpAllowed(url)) return { ok: false, status: 0, data: null, error: 'blocked-url' };
  const method = String(msg.method || 'GET').toUpperCase();
  if (!(TP_ALLOWED[tpOrigin(url)] || []).includes(method)) return { ok: false, status: 0, data: null, error: 'blocked-method' };
  if (tpOrigin(url) === TP_API) {
    const u = new URL(url);
    if (u.search || u.hash || !TP_API_PATHS.includes(`${method} ${u.pathname}`)) return { ok: false, status: 0, data: null, error: 'blocked-url' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), tpCfg.timeout);
  try {
    const init = { method, credentials: tpOrigin(url) === TP_API ? 'omit' : 'include', headers: tpHeaders(msg.headers), signal: ctrl.signal, redirect: 'follow' };
    if (msg.body != null && method !== 'GET') init.body = typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body);
    const r = await fetch(url, init);
    // Redirects (e.g. an expired session bouncing to the SSO login) must not leave the allowed origins.
    if (r.url && !tpAllowed(r.url)) return { ok: false, status: r.status || 0, data: null, error: 'redirected' };
    const retryAfter = (r.headers && r.headers.get && r.headers.get('retry-after')) || null;
    const text = await r.text();
    let data = text;
    if (msg.as !== 'text') {
      if (!text) data = null;
      else {
        try { data = JSON.parse(text); } catch (_) {
          const type = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
          // An HTML page where JSON was expected = a login page (session expired).
          const html = /text\/html/i.test(type) || /^\s*</.test(text);
          return { ok: false, status: r.status, data: null, error: html ? 'html' : 'parse' };
        }
      }
    }
    return { ok: r.ok, status: r.status, data, retryAfter };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: ctrl.signal.aborted ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tp-fetch') return false;
  if (!tpSenderOk(sender)) {
    sendResponse({ ok: false, status: 0, data: null, error: 'blocked-sender' });
    return false;
  }
  tpRelay(msg).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, data: null, error: String(e) }));
  return true; // async response
});
