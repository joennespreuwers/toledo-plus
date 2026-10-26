/* Toledo+ — MV3 service worker.
   Only job: a cross-origin fetch relay between the two Toledo origins
   (toledo.kuleuven.be portal <-> ultra.edu.kuleuven.cloud Blackboard Ultra).
   Content scripts can only fetch their own origin with cookies; the extension can fetch
   both because of host_permissions. Nothing else is reachable through this relay. */
'use strict';

const TP_ALLOWED_ORIGINS = ['https://toledo.kuleuven.be', 'https://ultra.edu.kuleuven.cloud'];
const TP_ALLOWED_METHODS = ['GET', 'PATCH']; // all TP.net ever needs (reads + mark-read/favorite)
const TP_TIMEOUT = 15000;

function tpAllowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TP_ALLOWED_ORIGINS.includes(u.origin) && !u.username && !u.password;
  } catch (_) {
    return false;
  }
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
  if (!TP_ALLOWED_METHODS.includes(method)) return { ok: false, status: 0, data: null, error: 'blocked-method' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TP_TIMEOUT);
  try {
    const init = { method, credentials: 'include', headers: tpHeaders(msg.headers), signal: ctrl.signal, redirect: 'follow' };
    if (msg.body != null && method !== 'GET') init.body = typeof msg.body === 'string' ? msg.body : JSON.stringify(msg.body);
    const r = await fetch(url, init);
    // Redirects (e.g. an expired session bouncing to the SSO login) must not leave the allowed origins.
    if (r.url && !tpAllowed(r.url)) return { ok: false, status: r.status || 0, data: null, error: 'redirected' };
    const text = await r.text();
    let data = text;
    if (msg.as !== 'text') {
      if (!text) data = null;
      else {
        try { data = JSON.parse(text); } catch (_) { return { ok: false, status: r.status, data: null, error: 'parse' }; }
      }
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: ctrl.signal.aborted ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'tp-fetch') return false;
  // Only our own content scripts / pages may use the relay.
  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, status: 0, data: null, error: 'blocked-sender' });
    return false;
  }
  tpRelay(msg).then(sendResponse, (e) => sendResponse({ ok: false, status: 0, data: null, error: String(e) }));
  return true; // async response
});
