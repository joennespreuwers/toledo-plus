/* Toledo+ website — tiny progressive enhancement. No tracking, no cookies, no storage. */
(function () {
  'use strict';

  /* Copy buttons for chrome://extensions etc. (browsers don't allow linking to those pages). */
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    if (!(navigator.clipboard && window.isSecureContext)) return;
    b.hidden = false;
    var label = b.textContent;
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
        b.textContent = b.getAttribute('data-copied') || '✓';
        setTimeout(function () { b.textContent = label; }, 1600);
      }, function () {});
    });
  });

  /* Reveal on scroll (CSS turns this off under prefers-reduced-motion). */
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && items.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }
})();
