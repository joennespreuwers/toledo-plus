/* Toledo+ website — progressive enhancement only (the site works without JS). No tracking, no cookies.
   1. theme toggle (Licht ⇄ Donker, follows the system until the first click): <html data-theme>, remembered in
      localStorage 'tp-theme' (also read by /demo/)
   2. copy buttons for chrome://extensions etc. (browsers don't allow linking to those pages), with a "Gekopieerd" pop
   3. scroll reveal of sections below the fold (IntersectionObserver; nothing is hidden unless this script ran)
   4. smooth wheel scrolling with Lenis (assets/vendor/lenis, MIT), loaded on demand — never under reduced motion,
      touch stays native; anchor links glide with the sticky-nav offset and move focus to their target.
   Motion follows the app's tokens (ui.css): ≤ 350 ms for UI, opacity/transform only. */
(function () {
  'use strict';
  var root = document.documentElement;
  var lang = (root.lang || 'nl').slice(0, 2);
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var me = document.currentScript && document.currentScript.src;
  var assets = me ? me.replace(/site\.js(\?.*)?$/, '') : 'assets/';

  // ---------------------------------------------------------------- 1. theme
  // Two states, Light ⇄ Dark. With nothing stored the page follows the system; the first click flips the theme you
  // *see* (system dark → light), so every click changes something. (The old System → Light → Dark cycle had a dead
  // click whenever the system already matched the next step: System(light) → Light looked like nothing happened.)
  var T = {
    nl: { light: 'Thema: licht', dark: 'Thema: donker', toLight: 'Schakel over naar licht', toDark: 'Schakel over naar donker' },
    en: { light: 'Theme: light', dark: 'Theme: dark', toLight: 'Switch to light', toDark: 'Switch to dark' },
    fr: { light: 'Thème : clair', dark: 'Thème : sombre', toLight: 'Passer au thème clair', toDark: 'Passer au thème sombre' },
  }[lang] || null;
  function stored() { try { var v = localStorage.getItem('tp-theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch (_) { return 'system'; } }
  function store(m) { try { localStorage.setItem('tp-theme', m); } catch (_) { /* private mode: still applied for this page */ } }
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  var mode = stored(); // 'system' | 'light' | 'dark' — what <html data-theme> says (system = no attribute)
  function effective() { return mode === 'system' ? (mqDark.matches ? 'dark' : 'light') : mode; }
  function paint(animate) {
    if (animate && !reduced) {
      root.classList.add('theme-anim');
      clearTimeout(paint.t);
      paint.t = setTimeout(function () { root.classList.remove('theme-anim'); }, 260);
    }
    if (mode === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    var eff = effective();
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (el) {
      if (mode === 'system') el.setAttribute('content', /dark/.test(el.getAttribute('media') || '') ? '#12151C' : '#F5F4F2');
      else el.setAttribute('content', eff === 'dark' ? '#12151C' : '#F5F4F2');
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('data-mode', eff); // icon = the theme you see now
      if (T) { b.setAttribute('aria-label', T[eff]); b.title = eff === 'dark' ? T.toLight : T.toDark; }
    });
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.hidden = false;
    b.addEventListener('click', function () {
      mode = effective() === 'dark' ? 'light' : 'dark';
      store(mode);
      paint(true);
    });
  });
  paint(false);
  // System theme changes while following the system → keep the icon/label honest.
  try { mqDark.addEventListener('change', function () { if (mode === 'system') paint(false); }); } catch (_) { /* old Safari */ }
  // Another tab (or the demo) changed the choice.
  window.addEventListener('storage', function (e) { if (e.key === 'tp-theme') { mode = stored(); paint(true); } });

  // ---------------------------------------------------------------- 2. copy buttons
  if (navigator.clipboard && window.isSecureContext) {
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      b.hidden = false;
      var label = b.textContent;
      b.addEventListener('click', function () {
        navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
          b.classList.remove('copied');
          void b.offsetWidth; // restart the pop when clicked twice
          b.classList.add('copied');
          b.textContent = b.getAttribute('data-copied') || '✓';
          clearTimeout(b.__t);
          b.__t = setTimeout(function () { b.classList.remove('copied'); b.textContent = label; }, 1600);
        }, function () {});
      });
    });
  }

  // ---------------------------------------------------------------- 3. scroll reveal
  if (!reduced && 'IntersectionObserver' in window) {
    var sel = '.section .section-title, .section .section-lead, .section .eyebrow, .feature, .download, .steps, .info > .card, .privacy, .faq details, .note';
    var vh = window.innerHeight;
    var els = [].slice.call(document.querySelectorAll(sel)).filter(function (el) { return el.getBoundingClientRect().top > vh * 0.92; });
    if (els.length) {
      els.forEach(function (el) {
        el.classList.add('reveal');
        // siblings in a grid come in one after another (≤ 5 steps of 60 ms)
        var p = el.parentElement, i = p ? [].indexOf.call(p.children, el) : 0;
        if (el.classList.contains('feature') || el.tagName === 'DETAILS') el.style.setProperty('--d', Math.min(i, 5) * 60 + 'ms');
      });
      root.classList.add('reveal-on');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
      els.forEach(function (el) { io.observe(el); });
      // find-in-page / focus / hash jumps: never leave something hidden that the student is looking for
      var showAll = function () { els.forEach(function (el) { el.classList.add('in'); }); };
      document.addEventListener('focusin', function (e) { var r = e.target.closest && e.target.closest('.reveal'); if (r) r.classList.add('in'); });
      window.addEventListener('hashchange', showAll);
      if (location.hash) showAll();
    }
  }

  // ---------------------------------------------------------------- 4. smooth scrolling (Lenis) + anchors
  var lenis = null;
  var navH = function () { var n = document.querySelector('.nav'); return (n ? n.offsetHeight : 56) + 16; };
  function focusTarget(t) {
    if (!t) return;
    if (!t.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(t.tagName)) t.setAttribute('tabindex', '-1');
    try { t.focus({ preventScroll: true }); } catch (_) { /* old browsers */ }
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href*="#"]');
    if (!a || a.classList.contains('skip-link')) return;
    var u; try { u = new URL(a.href); } catch (_) { return; }
    if (u.origin !== location.origin || u.pathname !== location.pathname || u.hash.length < 2) return;
    var t = u.hash === '#top' ? document.body : document.getElementById(decodeURIComponent(u.hash.slice(1)));
    if (!t || !lenis) return; // native smooth scroll + scroll-padding handle it
    e.preventDefault();
    if (location.hash !== u.hash) history.pushState(null, '', u.hash);
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
    // a number (not the element): Lenis would subtract html's scroll-padding-top on top of the offset
    var y = u.hash === '#top' ? 0 : Math.max(0, window.scrollY + t.getBoundingClientRect().top - navH());
    lenis.scrollTo(y, { onComplete: function () { focusTarget(t === document.body ? document.getElementById('main') : t); } });
  });

  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  if (!reduced && !coarse && !/\/demo\//.test(location.pathname)) {
    var s = document.createElement('script');
    s.src = assets + 'vendor/lenis/lenis.min.js';
    s.async = true;
    s.onload = function () {
      if (typeof window.Lenis !== 'function') return;
      try {
        lenis = new window.Lenis({
          lerp: 0.1, duration: 1.1, smoothWheel: true, syncTouch: false, autoRaf: true,
          // inner scroll areas (code, wide tables) keep their own wheel
          prevent: function (node) { return !!(node.closest && node.closest('pre, table, [data-lenis-prevent]')); },
        });
      } catch (err) { lenis = null; }
      // Turned on reduced motion while the page is open → back to native scrolling at once.
      try { window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (m) { if (m.matches && lenis) { lenis.destroy(); lenis = null; } }); } catch (_) { /* old */ }
    };
    document.head.appendChild(s);
  }
})();
