/* Toledo+ — TP.feedback: the in-extension feedback sheet.
   TP.feedback.open({page, opener}) → <dialog> (modal; inside the shell's shadow root, or its own shadow host when the
   shell isn't mounted, e.g. under the deep bar). Kind (Idee/Probleem/Iets anders), message with counter, optional
   contact, "send version/browser/language/page" (default on), a honeypot field. Sends via TP.telemetry.sendFeedback — also
   when the usage signal is off: sending feedback is explicit consent. The install id is never sent with feedback. Never throws. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const MIN = 10;
  const MAX = 4000;
  const CONTACT_MAX = 200;
  const KINDS = ['idea', 'bug', 'other'];
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);

  const CSS = `
.tp-sheet.tp-fb { overflow: auto; overscroll-behavior: contain; }
@media (min-width: 700px) {
  .tp-sheet.tp-fb { inset: 0; margin: auto; height: fit-content; width: min(92vw, 520px); max-height: min(88vh, 760px);
    border-radius: var(--r-pop); padding: 8px 20px 20px; }
}
.tp-fb-form, .tp-fb-done { display: flex; flex-direction: column; gap: 14px; }
.tp-fb-form[hidden], .tp-fb-done[hidden] { display: none; }
.tp-fb p { margin: 0; }
.tp-fb-intro, .tp-fb-note, .tp-fb-public, .tp-fb-count { color: var(--label-2); font-size: var(--fs-subhead); line-height: var(--lh-subhead); }
.tp-fb-field { display: flex; flex-direction: column; gap: 6px; }
.tp-fb-label { font-weight: 600; }
.tp-fb-input {
  box-sizing: border-box; width: 100%; margin: 0; padding: 10px 12px; font: inherit; color: var(--label);
  background: var(--bg-2); border: var(--hairline) solid var(--separator-strong); border-radius: var(--r-control);
}
textarea.tp-fb-input { min-height: 132px; resize: vertical; }
.tp-fb-input::placeholder { color: var(--label-2); opacity: .8; }
.tp-fb-input:focus-visible { outline: 2px solid var(--tint); outline-offset: 1px; }
.tp-fb-input[aria-invalid="true"] { border-color: var(--red); }
.tp-fb-count { align-self: flex-end; font-variant-numeric: tabular-nums; font-size: var(--fs-footnote); line-height: var(--lh-footnote); }
.tp-fb-count.tp-fb-over { color: var(--red); }
.tp-fb-hp { position: absolute !important; left: -10000px; top: auto; width: 1px; height: 1px; overflow: hidden; }
.tp-fb-error { color: var(--red); font-size: var(--fs-subhead); line-height: var(--lh-subhead); }
.tp-fb-error:empty { display: none; }
.tp-fb-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.tp-fb-done { align-items: center; text-align: center; padding: 20px 8px 8px; }
.tp-fb-done .tp-fb-check { color: var(--green); }
.tp-fb-done h3 { margin: 0; font: 700 var(--fs-title2, 1.375rem)/var(--lh-title2, 1.75rem) var(--font-display); }
.tp-fb .tp-segmented { width: 100%; }
@media (prefers-reduced-motion: reduce) { .tp-sheet.tp-fb[open] { animation: none; } }
`;

  let dlg = null;
  let opener = null;
  let fallbackHost = null;
  // An unsent message survives Escape, Cancel, ✕ and a failed send: the next open starts from it (TP-142). Memory only.
  let draft = null;

  /** Add the sheet's stylesheet to the root (constructable sheet: not subject to the page CSP). Re-checked on every
      open, because the shell assigns adoptedStyleSheets wholesale when it mounts. */
  let sheet = null;
  function style(root) {
    if (!root) return;
    try {
      if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); }
      const list = root.adoptedStyleSheets || [];
      if (!list.includes(sheet)) root.adoptedStyleSheets = [...list, sheet];
    } catch (_) {
      if (root.querySelector && root.querySelector('style[data-tp-fb]')) return;
      const el = document.createElement('style');
      el.dataset.tpFb = '';
      el.textContent = CSS;
      (root.nodeType === 11 ? root : document.head).appendChild(el);
    }
  }

  /** Where the dialog lives: the shell app, or a small shadow host of our own with ui.css + theme. */
  function container() {
    const app = TP.shell && TP.shell.app;
    if (app && app.isConnected) return app;
    if (fallbackHost && fallbackHost.isConnected) return fallbackHost.shadowRoot.querySelector('.tp-theme');
    fallbackHost = document.createElement('div');
    fallbackHost.id = 'tplus-feedback-host';
    const shadow = fallbackHost.attachShadow({ mode: 'open' });
    try {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = chrome.runtime.getURL('ui.css');
      shadow.appendChild(l);
    } catch (_) { /* no stylesheet: the browser's dialog defaults still work */ }
    const theme = document.createElement('div');
    theme.className = 'tp-theme';
    const s = (TP.settings && TP.settings.get && TP.settings.get()) || {};
    theme.dataset.appearance = ['light', 'dark'].includes(s.appearance) ? s.appearance : 'system';
    theme.dataset.density = 'standard';
    try { theme.setAttribute('lang', TP.i18n.lang()); } catch (_) { /* default */ }
    shadow.appendChild(theme);
    (document.body || document.documentElement).appendChild(fallbackHost);
    return theme;
  }

  function version() { try { return chrome.runtime.getManifest().version; } catch (_) { return ''; } }
  function metaDetails(page) {
    const b = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', other: '' }[TP.telemetry?.browser?.() || 'other'];
    return [`Toledo+ ${version()}`, b, (TP.i18n?.lang?.() || 'nl').toUpperCase(), page ? t('feedback.meta.page', { page }) : ''].filter(Boolean).join(' · ');
  }

  function markup(uid, page) {
    const ui = TP.ui;
    const kinds = KINDS.map((k) => ({ value: k, label: t('feedback.kind.' + k) }));
    return `
<div class="tp-sheet-head"><h2 id="${uid}-title">${esc(t('feedback.title'))}</h2>
  ${ui.button('', { icon: 'xmark', kind: 'gray', attrs: { 'data-fb': 'close', 'aria-label': t('common.close') } })}</div>
<form class="tp-fb-form" novalidate>
  <p class="tp-fb-intro">${esc(t('feedback.intro'))}</p>
  ${ui.segmented('tp-fb-kind', kinds, 'idea', { label: t('feedback.kind.label') })}
  <div class="tp-fb-field">
    <label class="tp-fb-label" for="${uid}-text">${esc(t('feedback.text.label'))}</label>
    <textarea class="tp-fb-input" id="${uid}-text" name="text" rows="6" required
      aria-describedby="${uid}-count ${uid}-public" placeholder="${esc(t('feedback.text.placeholder.idea'))}"></textarea>
    <span class="tp-fb-count" id="${uid}-count">${esc(t('feedback.text.count', { n: 0, max: MAX }))}</span>
  </div>
  <div class="tp-fb-field">
    <label class="tp-fb-label" for="${uid}-contact">${esc(t('feedback.contact.label'))}</label>
    <input class="tp-fb-input" id="${uid}-contact" name="contact" type="text" maxlength="${CONTACT_MAX}" autocomplete="email"
      spellcheck="false" aria-describedby="${uid}-note">
    <p class="tp-fb-note" id="${uid}-note">${esc(t('feedback.contact.note'))}</p>
  </div>
  ${ui.group(ui.toggle('tp-fb-meta', true, t('feedback.meta.label'), { description: t('feedback.meta.desc', { details: metaDetails(page) }) }))}
  <div class="tp-fb-hp" aria-hidden="true"><label>Website <input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
  <p class="tp-fb-public" id="${uid}-public">${esc(t('feedback.public'))}</p>
  <p class="tp-fb-error" role="alert" aria-live="assertive"></p>
  <div class="tp-fb-actions">
    ${ui.button(t('common.cancel'), { kind: 'plain', attrs: { 'data-fb': 'close' } })}
    ${ui.button(t('feedback.send'), { kind: 'filled', attrs: { type: 'submit', 'data-fb': 'send' } })}
  </div>
</form>
<div class="tp-fb-done" role="status" hidden>
  <span class="tp-fb-check">${ui.icon('checkCircle', { size: 44 })}</span>
  <h3>${esc(t('feedback.done.title'))}</h3>
  <p class="tp-fb-intro">${esc(t('feedback.done.body'))}</p>
  ${ui.button(t('common.close'), { kind: 'filled', attrs: { 'data-fb': 'close' } })}
</div>`;
  }

  const cpLen = (s) => [...String(s)].length;

  function wire(d, page) {
    const $ = (s) => d.querySelector(s);
    const form = $('.tp-fb-form');
    const ta = $('textarea[name="text"]');
    const count = $('.tp-fb-count');
    const err = $('.tp-fb-error');
    const send = $('[data-fb="send"]');
    let sending = false;

    const updateCount = () => {
      const n = cpLen(ta.value.trim());
      count.textContent = t('feedback.text.count', { n, max: MAX });
      count.classList.toggle('tp-fb-over', n > MAX);
      if (n >= MIN && n <= MAX && ta.getAttribute('aria-invalid') === 'true') { ta.removeAttribute('aria-invalid'); err.textContent = ''; }
    };
    const fields = () => ({
      text: ta.value,
      contact: $('input[name="contact"]').value,
      kind: (form.querySelector('input[name="tp-fb-kind"]:checked') || {}).value || 'idea',
      meta: $('input[name="tp-fb-meta"]').checked,
    });
    // restore an unsent draft
    if (draft) {
      ta.value = draft.text || '';
      $('input[name="contact"]').value = draft.contact || '';
      const k = form.querySelector(`input[name="tp-fb-kind"][value="${draft.kind}"]`);
      if (k) { k.checked = true; ta.placeholder = t('feedback.text.placeholder.' + draft.kind); }
      $('input[name="tp-fb-meta"]').checked = draft.meta !== false;
      updateCount();
    }
    const showError = (msg) => { err.textContent = ''; setTimeout(() => { err.textContent = msg; }, 30); };
    const busy = (on) => {
      sending = on;
      send.disabled = on;
      form.setAttribute('aria-busy', on ? 'true' : 'false');
      const label = send.querySelector('span');
      if (label) label.textContent = t(on ? 'feedback.sending' : 'feedback.send');
    };

    async function submit() {
      if (sending) return;
      const text = ta.value.trim();
      if (cpLen(text) < MIN || cpLen(text) > MAX) {
        ta.setAttribute('aria-invalid', 'true');
        showError(cpLen(text) > MAX ? t('feedback.text.long', { max: MAX, n: cpLen(text) - MAX }) : t('feedback.text.short', { min: MIN }));
        ta.focus();
        return;
      }
      // An updated/reloaded extension can't send from this tab: say so (retrying never works), keep the text (TP-145).
      if (TP.net && TP.net.isStale && TP.net.isStale()) { draft = fields(); showError(t('feedback.error.stale')); return; }
      busy(true);
      const sentFrom = fields();
      const kind = (form.querySelector('input[name="tp-fb-kind"]:checked') || {}).value || 'other';
      let r = { ok: false, error: 'network' };
      try {
        if (TP.telemetry && TP.telemetry.sendFeedback) {
          r = await TP.telemetry.sendFeedback({
            kind, text, page,
            contact: $('input[name="contact"]').value,
            includeMeta: $('input[name="tp-fb-meta"]').checked,
            website: $('input[name="website"]').value,
          });
        }
      } catch (_) { /* sendFeedback never throws; belt and braces */ }
      busy(false);
      const key = r && r.ok ? '' : ({ rate: 'feedback.error.rate', invalid: 'feedback.error.invalid', network: 'feedback.error.network', stale: 'feedback.error.stale' }[r && r.error] || 'feedback.error.server');
      // Closed while "Versturen…": the outcome still reaches the student, as a toast (TP-143); a failure keeps the text.
      if (!d.isConnected || !d.open) {
        if (r && r.ok) draft = null; else draft = sentFrom;
        try { TP.shell?.toast?.(r && r.ok ? t('feedback.done.title') : t(key)); } catch (_) { /* no shell */ }
        return;
      }
      if (r && r.ok) {
        draft = null;
        form.hidden = true;
        const done = $('.tp-fb-done');
        done.hidden = false;
        done.querySelector('[data-fb="close"]').focus();
        try { TP.shell?.announce?.(t('feedback.done.title')); } catch (_) { /* optional */ }
        return;
      }
      showError(t(key));
    }

    d.addEventListener('input', (ev) => { if (ev.target === ta) updateCount(); });
    d.addEventListener('change', (ev) => {
      if (ev.target.name === 'tp-fb-kind') ta.placeholder = t('feedback.text.placeholder.' + ev.target.value);
    });
    d.addEventListener('submit', (ev) => { ev.preventDefault(); submit(); });
    d.addEventListener('click', (ev) => {
      if (ev.target === d) { // backdrop: only close when nothing would be lost
        if (!ta.value.trim() || form.hidden) d.close();
        return;
      }
      const b = ev.target.closest && ev.target.closest('[data-fb]');
      if (!b) return;
      if (b.dataset.fb === 'close') { ev.preventDefault(); d.close(); }
    });
    d.addEventListener('keydown', (ev) => {
      // ⌘↵ / Ctrl+↵ sends from the textarea.
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && ev.target === ta) { ev.preventDefault(); submit(); }
      ev.stopPropagation(); // keep the shell's shortcuts (/, ⌘\) out of the form
    });
    d.addEventListener('close', () => {
      if (!form.hidden && !sending) draft = ta.value.trim() || $('input[name="contact"]').value.trim() ? fields() : null;
      const back = opener;
      opener = null;
      if (dlg === d) dlg = null;
      d.remove();
      try { if (back && back.isConnected && typeof back.focus === 'function') back.focus(); } catch (_) { /* ignore */ }
    });
  }

  /** Open the feedback sheet. opts: {page: route name, opener: element to refocus}. → the dialog element, or null. */
  function open(opts = {}) {
    try {
      if (dlg && dlg.isConnected) { dlg.querySelector('textarea')?.focus(); return dlg; }
      const host = container();
      if (!host) return null;
      style(host.getRootNode ? host.getRootNode() : null);
      const root = host.getRootNode ? host.getRootNode() : document;
      opener = opts.opener || (root && root.activeElement) || null;
      const uid = 'tp-fb-' + (TP.util.uid ? TP.util.uid() : Date.now().toString(36));
      const d = document.createElement('dialog');
      d.className = 'tp-sheet tp-glass tp-fb';
      d.setAttribute('aria-labelledby', `${uid}-title`);
      const page = typeof opts.page === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(opts.page) ? opts.page : (TP.shell?.route?.route || undefined);
      d.innerHTML = markup(uid, page);
      wire(d, page);
      host.appendChild(d);
      dlg = d;
      try { d.showModal(); } catch (_) { d.setAttribute('open', ''); }
      d.querySelector('textarea').focus();
      return d;
    } catch (e) {
      console.warn('[Toledo+] feedback', e);
      return null;
    }
  }

  function close() { try { if (dlg && dlg.open) dlg.close(); } catch (_) { /* ignore */ } }

  TP.feedback = { open, close, isOpen: () => !!(dlg && dlg.open), MIN, MAX };
})();
