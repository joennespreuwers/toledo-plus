/* Toledo+ website — tiny progressive enhancement: copy buttons for chrome://extensions etc.
   (browsers don't allow linking to those pages). No tracking, no cookies, no storage. */
(function () {
  'use strict';
  if (!(navigator.clipboard && window.isSecureContext)) return;
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.hidden = false;
    var label = b.textContent;
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
        b.textContent = b.getAttribute('data-copied') || '✓';
        setTimeout(function () { b.textContent = label; }, 1600);
      }, function () {});
    });
  });
})();
