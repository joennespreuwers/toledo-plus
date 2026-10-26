/* Toledo+ — skip Toledo's landing page. https://toledo.kuleuven.be/ only shows an "Inloggen met Toledo" button whose target is
   /portal/ (which starts the SSO login when needed), so we go there straight away — unless the student turned it off
   (settings.wrap.skipLanding === false), just logged out (so SSO doesn't sign them back in), or we already bounced in the
   last 30 s (loop guard). Standalone content script (document_start), matched only on the landing URL — not on /portal/*.
   No network, no TP namespace: reads chrome.storage directly. The decision is a pure function, exported for unit tests. */
(() => {
  'use strict';
  const PORTAL = 'https://toledo.kuleuven.be/portal/';
  const LOGOUT_MS = 5 * 60e3;
  const BOUNCE_MS = 30e3;
  const LOGOUT_RE = /logout|logged.?out|shibboleth\.sso|slo\b/i;

  /**
   * → { go: boolean, reason } — reason: 'off' | 'logout' | 'loop' | 'path' | 'skip'
   * o = { url, referrer, settings (sync 'settings'), settingsLocal (local fallback), loggedOutAt (ms), bouncedAt (ms), now }
   */
  function decide(o = {}) {
    const now = o.now || Date.now();
    let u;
    try { u = new URL(o.url); } catch (_) { return { go: false, reason: 'path' }; }
    if (u.origin !== 'https://toledo.kuleuven.be' || !/^\/(index\.html?)?$/i.test(u.pathname)) return { go: false, reason: 'path' };
    const off = (s) => !!(s && typeof s === 'object' && s.wrap && s.wrap.skipLanding === false);
    if (off(o.settings) || off(o.settingsLocal)) return { go: false, reason: 'off' };
    if (LOGOUT_RE.test(o.referrer || '')) return { go: false, reason: 'logout' };
    for (const [k, v] of u.searchParams) if (/logout|loggedout|error/i.test(k) || /logout|error/i.test(v)) return { go: false, reason: 'logout' };
    if (/logout|error/i.test(u.hash)) return { go: false, reason: 'logout' };
    const lo = Number(o.loggedOutAt) || 0;
    if (lo && now - lo >= 0 && now - lo < LOGOUT_MS) return { go: false, reason: 'logout' };
    const b = Number(o.bouncedAt) || 0;
    if (b && now - b >= 0 && now - b < BOUNCE_MS) return { go: false, reason: 'loop' };
    return { go: true, reason: 'skip' };
  }

  globalThis.TPLanding = { decide, PORTAL };

  // ---------------------------------------------------------------- run (only in the extension's content-script world)
  if (typeof chrome === 'undefined' || !chrome.storage || typeof location === 'undefined') return;
  const ss = (k) => { try { return Number(sessionStorage.getItem(k)) || 0; } catch (_) { return 0; } };
  try {
    chrome.storage.sync.get('settings', (syn) => {
      void chrome.runtime.lastError;
      chrome.storage.local.get(['settingsLocal', 'tp:loggedOutAt', 'tp:landingBounceAt'], (loc) => {
        void chrome.runtime.lastError;
        const now = Date.now();
        const d = decide({
          url: location.href, referrer: document.referrer, now,
          settings: syn && syn.settings, settingsLocal: loc && loc.settingsLocal,
          loggedOutAt: Math.max(Number(loc && loc['tp:loggedOutAt']) || 0, ss('tp:loggedOutAt')),
          bouncedAt: Math.max(Number(loc && loc['tp:landingBounceAt']) || 0, ss('tp:landingBounceAt')),
        });
        if (!d.go) return;
        try { sessionStorage.setItem('tp:landingBounceAt', String(now)); } catch (_) { /* ignore */ }
        chrome.storage.local.set({ 'tp:landingBounceAt': now }, () => { void chrome.runtime.lastError; location.replace(PORTAL); });
      });
    });
  } catch (_) { /* extension context gone: leave the page as it is */ }
})();
