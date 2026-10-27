/* Toledo+ — TP.ui: HTML-string component helpers. Views compose these and wire behaviour with
   data-action + one delegated listener on ctx.root.
   Convention: `title`, `subtitle`, `leading`, `trailing`, `body`, `label` in row/section/disclosure are
   HTML strings — callers escape text with TP.util.esc. Plain-text params (badge label, button label,
   option labels, aria labels) are escaped here. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const esc = (s) => TP.util.esc(s);
  const t = (k, v) => TP.t(k, v);
  const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

  // ---------------- icons (24×24, stroke, currentColor) ----------------
  const P = {
    overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    courses: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 1 4 17z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 17z"/>',
    deadlines: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 2"/><path d="M9.5 2.5h5M12 2.5v3"/>',
    kuloket: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M3 20h18"/>',
    planning: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    agenda: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/>',
    announcements: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    megaphone: '<path d="M3.5 10.5v3a1.5 1.5 0 0 0 1.5 1.5h1.5l9.5 5V4L6.5 9H5a1.5 1.5 0 0 0-1.5 1.5z"/><path d="M7 15l1.5 5.5h3L10 15.8"/><path d="M19 9.5a3 3 0 0 1 0 5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    chevronLeft: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.8 2.7L16 9.5"/>',
    circle: '<circle cx="12" cy="12" r="8.5"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9 5 3-5 3z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L7 19.5"/>',
    page: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6l-2 .4-7.4 7.4a2.1 2.1 0 0 1-3-3L16 10l.4-2z"/><path d="M14.7 6.3 17.4 3.6a4 4 0 0 0-5 5"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7.5 8.5 6 8.5-6"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    starFill: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeSlash: '<path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.5 7.2C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3.5 3.5l17 17"/>',
    xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    arrowUp: '<path d="M12 19.5V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 4.5V19M6 13l6 6 6-6"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
    sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15M5.5 8.5h1.5M5.5 11.5h1.5"/>',
    ellipsis: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    // extras (superset of the contract)
    person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    logout: '<path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-12.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    warning: '<path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 16.8v.2"/>',
    grip: '<circle cx="9" cy="6.5" r="1.2" fill="currentColor"/><circle cx="15" cy="6.5" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="17.5" r="1.2" fill="currentColor"/><circle cx="15" cy="17.5" r="1.2" fill="currentColor"/>',
    location: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    exam: '<path d="M7 3.5h7.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14.5 3.5V8H19M9 13l2 2 4-4.5"/>',
    sparkle: '<path d="M12 3.5 13.8 10 20.5 12l-6.7 2L12 20.5 10.2 14 3.5 12l6.7-2z"/>',
    sidebarAdd: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15M15.25 9.5v5M12.75 12h5"/>',
    sidebarRemove: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15M12.75 12h5"/>',
    pencil: '<path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z"/><path d="m13.5 6.5 4 4"/>',
    classic: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 9h18M7 6.8h.01M9.5 6.8h.01"/>',
  };
  const ICONS = Object.keys(P);

  function icon(name, opts = {}) {
    const size = opts.size || 17;
    const sw = opts.strokeWidth || 1.8;
    const cls = opts.cls ? ` class="tp-ic ${esc(opts.cls)}"` : ' class="tp-ic"';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.circle}</svg>`;
  }

  // ---------------- brand (docs/brand/logo/*.svg — geometry copied verbatim; never recolour, rotate, shadow or glow) ----------------
  // tile  = primary icon on the ink tile (always below 32 px) · glyph = the woven plus alone (≥ 32 px, light or dark ground)
  // mono  = one-colour plus (currentColor) for tiny decorative uses. Orange always lies on top of magenta.
  const LOGO = {
    tile: '<rect x="4" y="4" width="120" height="120" rx="28" fill="#1F2430"/><path d="M44 50H36A14 14 0 0 0 36 78H44Z" fill="#E3285A"/><path d="M84 50H92A14 14 0 0 1 92 78H84Z" fill="#E3285A"/><rect x="50" y="22" width="28" height="84" rx="14" fill="#EE8B35"/>',
    glyph: '<path d="M39 46H28A18 18 0 0 0 28 82H39Z" fill="#E3285A"/><path d="M89 46H100A18 18 0 0 1 100 82H89Z" fill="#E3285A"/><rect x="46" y="10" width="36" height="108" rx="18" fill="#EE8B35"/>',
    mono: '<rect x="10" y="46" width="108" height="36" rx="18" fill="currentColor"/><rect x="46" y="10" width="36" height="108" rx="18" fill="currentColor"/>',
  };
  /** Toledo+ logo as inline SVG. o.variant 'tile'|'glyph'|'mono' (below 32 px a glyph request falls back to the tile),
   *  o.size px (default 28), o.title → role=img + accessible name (otherwise decorative), o.cls extra class. */
  function logo(o = {}) {
    const size = Math.max(8, Number(o.size) || 28);
    let v = LOGO[o.variant] ? o.variant : 'tile';
    if (v === 'glyph' && size < 32) v = 'tile';
    const a11y = o.title ? ` role="img" aria-label="${esc(o.title)}"` : ' aria-hidden="true" focusable="false"';
    return `<svg class="tp-logo tp-logo-${v}${o.cls ? ' ' + esc(o.cls) : ''}" width="${size}" height="${size}" viewBox="0 0 128 128"${a11y}>${LOGO[v]}</svg>`;
  }
  /** "Toledo+" wordmark (Inter ExtraBold, tight tracking); the plus in brand orange. Text stays real text. */
  const wordmark = (o = {}) => `<span class="tp-wordmark${o.cls ? ' ' + esc(o.cls) : ''}">Toledo<span class="tp-wordmark-plus">+</span></span>`;
  /** Empty-state illustration: three soft pills (the logo's shapes, loosely stacked — not the logo). Decorative. */
  // Empty-state art: the logo glyph itself (true proportions: two magenta half-pills, orange pill on top), in soft tints.
  const emptyArt = (size = 40) => `<svg class="tp-empty-art" width="${size}" height="${size}" viewBox="0 0 128 128" aria-hidden="true" focusable="false"><path class="b" d="M39 46H28A18 18 0 0 0 28 82H39Z"/><path class="b" d="M89 46H100A18 18 0 0 1 100 82H89Z"/><rect class="a" x="46" y="10" width="36" height="108" rx="18"/></svg>`;

  // Attributes object → string. true → bare attribute; false/null/undefined → skipped.
  function attrs(obj) {
    if (!obj) return '';
    let s = '';
    for (const [k, v] of Object.entries(obj)) {
      if (v === false || v == null) continue;
      if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k)) continue;
      s += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
    }
    return s;
  }

  // ---------------- structure ----------------
  function section({ id, title, count, actions, body, footer, cls } = {}) {
    const hid = `tp-h-${esc(id || TP.util.uid())}`;
    // The count is not part of the heading's name ("Week van 16 nov 1" read as a date): shown, but announced as
    // ", 1 item" (headings list / region name stay readable).
    const cnt = count != null && count !== '' && count !== 0
      ? ` <span class="tp-count" aria-hidden="true">${esc(count)}</span><span class="tp-sr">${esc(typeof count === 'number' ? t('common.items', { n: count }) : `, ${count}`)}</span>` : '';
    const acts = (actions || []).map((a) => button(a.label, { action: a.action, icon: a.icon, kind: 'plain', attrs: a.attrs })).join('');
    return `<section class="tp-section${cls ? ' ' + esc(cls) : ''}"${id ? ` data-section="${esc(id)}"` : ''} aria-labelledby="${hid}">
  <div class="tp-sec-head"><h2 id="${hid}" class="tp-sec-title">${title ?? ''}${cnt}</h2>${acts ? `<div class="tp-sec-actions">${acts}</div>` : ''}</div>
  ${body ?? ''}
  ${footer ? `<p class="tp-sec-foot">${footer}</p>` : ''}
</section>`;
  }

  const group = (inner, opts = {}) => `<div class="tp-group${opts.cls ? ' ' + esc(opts.cls) : ''}">${inner ?? ''}</div>`;

  function rowInner({ leading, title, subtitle, trailing, chevron, strong }) {
    const tt = strip(title);
    return `${leading ? `<span class="tp-row-lead">${leading}</span>` : ''}<span class="tp-row-main"><span class="tp-row-title${strong ? ' strong' : ''}"${tt ? ` title="${tt}"` : ''}>${title ?? ''}</span>${subtitle ? `<span class="tp-row-sub">${subtitle}</span>` : ''}</span>${trailing ? `<span class="tp-row-trail">${trailing}</span>` : ''}${chevron ? `<span class="tp-chev">${icon('chevronRight', { size: 14, strokeWidth: 2.2 })}</span>` : ''}`;
  }

  function row(o = {}) {
    const cls = `tp-row${o.leading ? ' has-lead' : ''}${o.cls ? ' ' + esc(o.cls) : ''}`;
    const q = o.q != null ? ` data-q="${esc(String(o.q).toLowerCase())}"` : '';
    const a = attrs(o.attrs);
    const inner = rowInner(o);
    if (o.href) return `<a class="${cls}" href="${esc(o.href)}"${o.action ? ` data-action="${esc(o.action)}"` : ''}${q}${a}>${inner}</a>`;
    if (o.action) return `<button type="button" class="${cls}" data-action="${esc(o.action)}"${q}${a}>${inner}</button>`;
    return `<div class="${cls}"${q}${a}>${inner}</div>`;
  }

  function disclosure({ id, open, summary = {}, body, q, cls, attrs: at } = {}) {
    const qa = q != null ? ` data-q="${esc(String(q).toLowerCase())}"` : '';
    return `<details class="tp-disclosure${summary.leading ? ' has-lead' : ''}${cls ? ' ' + esc(cls) : ''}"${id != null ? ` data-id="${esc(id)}"` : ''}${open ? ' open' : ''}${qa}${attrs(at)}>
<summary class="tp-row tp-summary${summary.leading ? ' has-lead' : ''}">${rowInner({ ...summary, chevron: false })}<span class="tp-chev tp-disc">${icon('chevronRight', { size: 14, strokeWidth: 2.2 })}</span></summary>
<div class="tp-disclosure-body">${body ?? ''}</div>
</details>`;
  }

  // ---------------- small pieces ----------------
  function badge(n, opts = {}) {
    if (n == null || n === '' || n === 0) return '';
    const tone = ['tint', 'red', 'gray'].includes(opts.tone) ? opts.tone : 'tint';
    const cap = opts.cap === false ? Infinity : (opts.cap || 99);
    const shown = typeof n === 'number' && n > cap ? `${cap}+` : String(n);
    const label = opts.label ?? (typeof n === 'number' ? t('common.new', { n }) : String(n));
    return `<span class="tp-badge tp-badge-${tone}" role="img" aria-label="${esc(label)}">${esc(shown)}</span>`;
  }

  function dot(color, label) {
    const c = TP.util.safeColor(color);
    return label
      ? `<span class="tp-dot" style="--dot:${c}" role="img" aria-label="${esc(label)}"></span>`
      : `<span class="tp-dot" style="--dot:${c}" aria-hidden="true"></span>`;
  }

  function dateTile(ms, opts = {}) {
    const tone = ['normal', 'urgent', 'overdue', 'muted'].includes(opts.tone) ? opts.tone : 'normal';
    const d = TP.fmt.date(ms, { day: 'numeric' });
    const m = TP.fmt.date(ms, { month: 'short' }).replace(/\.$/, '');
    const full = TP.fmt.date(ms, { weekday: 'long', day: 'numeric', month: 'long' });
    return `<span class="tp-datetile tp-dt-${tone}"><span class="tp-dt-d" aria-hidden="true">${esc(d)}</span><span class="tp-dt-m" aria-hidden="true">${esc(m)}</span><span class="tp-sr">${esc(full)}</span></span>`;
  }

  function empty(text, opts = {}) {
    let ts = '';
    if (opts.timestamp) {
      const ms = opts.timestamp === true ? TP.data?.lastUpdated?.() : opts.timestamp;
      if (ms) ts = `<p class="tp-empty-ts">${esc(t('common.updated', { time: TP.fmt.time(ms) }))}</p>`;
    }
    const art = opts.art === false ? '' : emptyArt();
    return `<div class="tp-empty">${art}<p>${esc(text)}</p>${ts}</div>`;
  }

  // debounced like the shell's result count, so typing doesn't make the screen reader stutter
  let nrTimer = 0;
  const sayNoResults = (q) => {
    clearTimeout(nrTimer);
    nrTimer = setTimeout(() => { try { TP.shell?.announce?.(t('common.noResults', { q })); } catch (_) { /* no shell */ } }, 700);
  };
  /** Search empty state (Apple style): centered magnifier, "Geen resultaten", "voor “x”". One per view. */
  // a pasted essay is not echoed back in full (TP-082)
  const clip = (q) => { const s = String(q ?? ''); return s.length > 60 ? s.slice(0, 59).trimEnd() + '…' : s; };
  function noResults(q) {
    // role=status inserted together with its text is often not read (NVDA/VoiceOver): say it via the shell's live region too
    sayNoResults(q);
    return `<div class="tp-noresults-state" role="status">${icon('search', { size: 32 })}`
      + `<p class="tp-nr-title">${esc(t('common.noResults.title'))}</p>`
      + `<p class="tp-nr-sub">${esc(t('common.noResults.for', { q: clip(q) }))}</p></div>`;
  }

  /** Loading placeholder with real row geometry, inside an inset group (B1). opts.lead: 'tile'|'date'|'dot'|'none'. */
  function skeleton(rows = 3, opts = {}) {
    const lead = ['tile', 'date', 'dot', 'none'].includes(opts.lead) ? opts.lead : 'tile';
    const r = Array.from({ length: Math.max(1, rows) }, (_, i) =>
      `<div class="tp-skel-row${lead === 'date' ? ' tp-skel-tall' : ''}">${lead === 'none' ? '' : `<span class="tp-skel-lead tp-skel-${lead}"></span>`}<span class="tp-skel-lines"><span class="tp-skel-line" style="width:${[72, 56, 64, 48, 60][i % 5]}%"></span><span class="tp-skel-line short"></span></span></div>`).join('');
    return `<div class="tp-group tp-skeleton${opts.cls ? ' ' + esc(opts.cls) : ''}" role="status" aria-label="${esc(t('common.loading'))}">${r}</div>`;
  }

  /** Inline per-section error row with a retry button (B1). opts.attrs → extra attributes on the retry button. */
  const errorRow = (text, retryAction = 'retry', opts = {}) =>
    `<div class="tp-error-row" role="alert">${icon('warning', { size: 17 })}<span class="tp-error-text">${esc(text)}</span>${retryAction ? button(t('common.retry'), { action: retryAction, kind: 'plain', attrs: opts.attrs }) : ''}</div>`;

  function button(label, o = {}) {
    const kind = ['filled', 'tinted', 'plain', 'gray'].includes(o.kind) ? o.kind : 'plain';
    const iconOnly = !label && o.icon;
    const cls = `tp-btn tp-btn-${kind}${iconOnly ? ' tp-btn-icon' : ''}${o.cls ? ' ' + esc(o.cls) : ''}`;
    const inner = `${o.icon ? icon(o.icon) : ''}${label ? `<span>${esc(label)}</span>` : ''}`;
    const at = { ...(o.attrs || {}) };
    const act = o.action ? ` data-action="${esc(o.action)}"` : '';
    if (at.href) {
      const href = at.href; delete at.href;
      return `<a class="${cls}" href="${esc(href)}"${act}${attrs(at)}>${inner}</a>`;
    }
    const type = at.type || 'button'; // attrs.type may override (e.g. 'submit')
    delete at.type;
    return `<button type="${esc(type)}" class="${cls}"${act}${attrs(at)}>${inner}</button>`;
  }

  // ---------------- form controls ----------------
  function segmented(name, options, value, o = {}) {
    const segs = (options || []).map((opt) =>
      `<label class="tp-seg"><input type="radio" name="${esc(name)}" value="${esc(opt.value)}"${String(opt.value) === String(value) ? ' checked' : ''}><span>${esc(opt.label)}</span></label>`).join('');
    // The pill (last child, so .tp-seg:nth-child(n) is the n-th option) slides under the checked label (ui.css).
    const n = Math.max(1, (options || []).length);
    return `<div class="tp-segmented" role="radiogroup"${o.label ? ` aria-label="${esc(o.label)}"` : ''} style="--n:${n}">${segs}<span class="tp-seg-pill" aria-hidden="true"></span></div>`;
  }

  function toggle(name, checked, label, o = {}) {
    // The switch is named by its title only (aria-labelledby); the help text is its description, not part of the name
    // (screen readers, voice control). The whole row stays the <label> hit target.
    const uid = TP.util.uid();
    const lid = `tp-l-${uid}`, did = o.description ? `tp-d-${uid}` : '';
    return `<label class="tp-toggle"><span class="tp-toggle-text"><span class="tp-toggle-label" id="${lid}">${esc(label)}</span>${o.description ? `<span class="tp-toggle-desc" id="${did}">${esc(o.description)}</span>` : ''}</span><input type="checkbox" role="switch" class="tp-switch" name="${esc(name)}"${checked ? ' checked' : ''} aria-labelledby="${lid}"${did ? ` aria-describedby="${did}"` : ''}${attrs(o.attrs)}></label>`;
  }

  function select(name, options, value, o = {}) {
    const opts = (options || []).map((opt) =>
      `<option value="${esc(opt.value)}"${String(opt.value) === String(value) ? ' selected' : ''}>${esc(opt.label)}</option>`).join('');
    const sel = `<span class="tp-select"><select name="${esc(name)}"${!o.label && o.ariaLabel ? ` aria-label="${esc(o.ariaLabel)}"` : ''}>${opts}</select>${icon('chevronDown', { size: 13, strokeWidth: 2.2 })}</span>`;
    return o.label ? `<label class="tp-field"><span class="tp-field-label">${esc(o.label)}</span>${sel}</label>` : sel;
  }

  function swatches(name, options, value) {
    const items = (options || []).map((opt) => {
      const c = TP.util.safeColor(opt.color);
      return `<label class="tp-swatch" title="${esc(opt.label)}"><input type="radio" name="${esc(name)}" value="${esc(opt.value)}"${String(opt.value) === String(value) ? ' checked' : ''} aria-label="${esc(opt.label)}"><span class="tp-swatch-c" style="--sw:${c}" aria-hidden="true">${icon('check', { size: 13, strokeWidth: 3 })}</span></label>`;
    }).join('');
    return `<div class="tp-swatches" role="radiogroup">${items}</div>`;
  }

  /** Roving focus in a grid of buttons (APG date picker): one tab stop (tabindex=0, the rest -1); ←/→ ±1, ↑/↓ ±one row,
   *  Home/End start/end of the row, PageUp/PageDown press the container's [data-roving-prev]/[data-roving-next].
   *  Markup: a container [data-roving="<columns>"] around buttons [data-roving-item]. Call from a keydown handler
   *  (the shell does it for the whole app); → true when the key was handled. */
  function rovingKey(ev) {
    const tg = (ev.composedPath && ev.composedPath()[0]) || ev.target;
    const item = tg && tg.closest && tg.closest('[data-roving-item]');
    const box = item && item.closest('[data-roving]');
    if (!box || ev.altKey || ev.ctrlKey || ev.metaKey) return false;
    const items = [...box.querySelectorAll('[data-roving-item]')];
    const cols = Math.max(1, Number(box.getAttribute('data-roving')) || items.length);
    const i = items.indexOf(item);
    const k = ev.key;
    let j = null;
    if (k === 'ArrowRight') j = i + 1;
    else if (k === 'ArrowLeft') j = i - 1;
    else if (k === 'ArrowDown') j = i + cols;
    else if (k === 'ArrowUp') j = i - cols;
    else if (k === 'Home') j = i - (i % cols);
    else if (k === 'End') j = i - (i % cols) + cols - 1;
    else if (k === 'PageUp' || k === 'PageDown') {
      const b = box.querySelector(k === 'PageUp' ? '[data-roving-prev]' : '[data-roving-next]');
      if (!b) return false;
      ev.preventDefault();
      b.click();
      // the grid repaints (other month): put focus on its tab stop once it is there
      const doc = box.getRootNode();
      let n = 0;
      const again = () => {
        const to = box.isConnected ? null : doc.querySelector('[data-roving] [data-roving-item][tabindex="0"]');
        if (to) to.focus(); else if (++n < 12) setTimeout(again, 40);
      };
      setTimeout(again, 0);
      return true;
    } else return false;
    ev.preventDefault();
    const to = items[Math.max(0, Math.min(items.length - 1, j))];
    if (to && to !== item) {
      items.forEach((x) => x.setAttribute('tabindex', x === to ? '0' : '-1'));
      to.focus();
    }
    return true;
  }

  const cols = (mainHtml, sideHtml) =>
    `<div class="tp-cols"><div class="tp-col-main">${mainHtml ?? ''}</div>${sideHtml ? `<div class="tp-col-side">${sideHtml}</div>` : ''}</div>`;

  /** Undo after a destructive or bulk action (shared pattern): a toast `label` with an "Ongedaan maken" button that
   *  calls restore(). Generic on purpose: any view can use it. → the toast element (or null without a shell). */
  function undoToast(label, restore) {
    try { return TP.shell.toast(label, { action: { label: t('common.undo'), hint: t('common.undoHint'), onClick: restore } }); } catch (_) { return null; }
  }

  TP.ui = {
    icon, ICONS, logo, wordmark, emptyArt, attrs, section, group, row, disclosure, badge, dot, dateTile, empty, noResults, skeleton, errorRow,
    button, segmented, toggle, select, swatches, cols, undoToast, rovingKey,
  };
})();
