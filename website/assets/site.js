/* Toledo+ website — tiny progressive enhancement. No tracking, no cookies, no storage.
   Store URLs live in the inline `const STORE = {…}` at the top of each index.html. */
(function () {
  'use strict';
  var doc = document.documentElement;
  /* global STORE */
  var store = (typeof STORE === 'object' && STORE) || {};

  /* ---- store links: [data-href="chrome"] gets the store URL; [data-if="chrome !edge"] shows when all conditions hold */
  function has(key) { return typeof store[key] === 'string' && /^https:\/\//.test(store[key]); }
  document.querySelectorAll('[data-href]').forEach(function (a) {
    var key = a.getAttribute('data-href');
    if (has(key)) {
      a.href = store[key];
      a.rel = 'noopener';
      if (a.dataset.storeLabel) a.textContent = a.dataset.storeLabel;
    }
  });
  document.querySelectorAll('[data-if]').forEach(function (el) {
    var ok = el.getAttribute('data-if').split(/\s+/).every(function (c) {
      return c.charAt(0) === '!' ? !has(c.slice(1)) : has(c);
    });
    el.hidden = !ok;
  });

  /* ---- install tabs (WAI-ARIA APG tabs, automatic activation) */
  var tablist = document.querySelector('[role="tablist"]');
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute('aria-controls')); });
    var select = function (i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        select(i);
        if (history.replaceState) history.replaceState(null, '', '#' + panels[i].id);
      });
      t.addEventListener('keydown', function (e) {
        var n = tabs.length, k = e.key, to = null;
        if (k === 'ArrowRight' || k === 'ArrowDown') to = (i + 1) % n;
        else if (k === 'ArrowLeft' || k === 'ArrowUp') to = (i - 1 + n) % n;
        else if (k === 'Home') to = 0;
        else if (k === 'End') to = n - 1;
        if (to !== null) { e.preventDefault(); select(to, true); }
      });
    });
    var fromHash = function () {
      var id = location.hash.slice(1);
      var i = panels.findIndex(function (p) { return p && p.id === id; });
      if (i < 0) return false;
      select(i);
      var section = document.getElementById('install') || tablist;
      requestAnimationFrame(function () { section.scrollIntoView({ block: 'start' }); });
      return true;
    };
    var detect = function () {
      var ua = navigator.userAgent || '';
      var brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map(function (b) { return b.brand; }).join(' ');
      if (/Edg\//.test(ua) || /Edge/.test(brands)) return 'edge';
      if (/Firefox\//.test(ua)) return 'firefox';
      if (/OPR\/|Vivaldi|Brave/.test(ua + ' ' + brands) || (navigator.brave)) return 'chromium';
      if (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua)) return 'safari';
      return 'chrome';
    };
    if (!fromHash()) {
      var guess = panels.findIndex(function (p) { return p && p.id === detect(); });
      select(guess < 0 ? 0 : guess);
    }
    window.addEventListener('hashchange', fromHash);
  }

  /* ---- copy buttons for chrome://extensions etc. (cannot be linked from a web page) */
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.hidden = !(navigator.clipboard && window.isSecureContext);
    var label = b.textContent;
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
        b.textContent = b.getAttribute('data-copied') || '✓';
        setTimeout(function () { b.textContent = label; }, 1600);
      }, function () {});
    });
  });

  /* ---- reveal on scroll (CSS disables it under prefers-reduced-motion) */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }
})();
