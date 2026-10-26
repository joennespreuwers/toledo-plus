/* Toledo+ — the tab always shows the Toledo+ icon (not Toledo's or Blackboard's), on the portal and in Ultra.
   Toledo/Ultra (re)insert their own <link rel="icon"> on navigation, so a small observer keeps ours in place. */
(() => {
  'use strict';
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="4" y="4" width="120" height="120" rx="28" fill="#1F2430"/><path d="M44 50H36A14 14 0 0 0 36 78H44Z" fill="#E3285A"/><path d="M84 50H92A14 14 0 0 1 92 78H84Z" fill="#E3285A"/><rect x="50" y="22" width="28" height="84" rx="14" fill="#EE8B35"/></svg>';
  const HREF = 'data:image/svg+xml,' + encodeURIComponent(SVG);
  const SEL = 'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]';
  let busy = false;
  function apply() {
    const head = document.head;
    if (!head || busy) return;
    busy = true;
    try {
      for (const l of head.querySelectorAll(SEL)) if (l.dataset.tplus !== '1') l.remove();
      let ours = head.querySelector('link[data-tplus="1"]');
      if (!ours) {
        ours = document.createElement('link');
        ours.rel = 'icon'; ours.type = 'image/svg+xml'; ours.dataset.tplus = '1'; ours.href = HREF;
        head.appendChild(ours);
      }
    } finally { busy = false; }
  }
  function start() {
    apply();
    try { new MutationObserver(() => { if (document.head && document.head.querySelector(SEL + ':not([data-tplus="1"])')) apply(); }).observe(document.documentElement, { childList: true, subtree: true }); } catch (_) { /* ignore */ }
  }
  if (document.head) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  globalThis.TP = globalThis.TP || {};
  globalThis.TP.favicon = { apply, HREF };
})();
