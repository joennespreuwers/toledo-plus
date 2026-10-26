/* Toledo+ — boot: runs last (document_start) on both origins.
   1. hide the host page right away when this URL will be wrapped (no flash),
   2. load settings + cached data,
   3. hand over to the shell (routing, mounting, deep bar, classic pill). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  if (TP.__booted || window.top !== window) return; // once, top frame only
  TP.__booted = true;

  try { TP.shell.preflight(); } catch (_) { /* never block the page */ }

  (async () => {
    try { await TP.settings.load(); } catch (e) { console.warn('[Toledo+] settings load failed, using defaults', e); }
    try { await TP.data?.init?.(); } catch (e) { console.warn('[Toledo+] data init failed', e); }
    try {
      TP.shell.start();
    } catch (e) {
      // Fail open: show the original page rather than a blank screen.
      document.documentElement.classList.remove('tplus-on', 'tplus-deep');
      console.warn('[Toledo+] shell failed to start', e);
    }
  })();
})();
