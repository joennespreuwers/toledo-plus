/* Toledo+ — TP.util (small helpers) and TP.fmt (localized date formatting).
   Loaded first; no dependencies at load time. TP.fmt uses TP.i18n/TP.t lazily at call time. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

  // Absolute URL on the current origin (Ultra sets <base href> to a CDN, so never rely on relative URLs).
  function abs(path) {
    const s = String(path ?? '');
    if (/^https?:\/\//i.test(s)) return s;
    if (s.startsWith('//')) return location.protocol + s;
    return location.origin + (s.startsWith('/') ? s : '/' + s);
  }

  // Remote HTML → safe HTML string. DOMParser documents never run scripts; we still strip
  // everything active or layout-breaking before the result is inserted anywhere.
  // Elements: a denylist of active/embedding elements is removed with their content. Attributes: an ALLOWLIST
  // (pattern 8 / TP-177): anything not listed — handlers, style/class/id, ping, referrerpolicy, srcset/sizes, autoplay,
  // poster, background, loading, crossorigin, usemap, data-*/aria-* … — is dropped. Remote images stay (teachers embed
  // them) but load lazily with referrerpolicy="no-referrer"; audio/video never autoplay and fetch nothing until played.
  const DROP = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,option,link,meta,base,svg,math,template,noscript,portal,track';
  const KEEP_ATTR = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'headers', 'scope', 'abbr', 'span',
    'start', 'reversed', 'type', 'value', 'lang', 'dir', 'datetime', 'cite', 'open', 'controls', 'muted', 'loop', 'align', 'valign',
    'border', 'cellpadding', 'cellspacing', 'summary', 'color', 'name']);
  const BAD_URL = /^\s*(javascript|vbscript|data):/i;
  // The URL parser drops ASCII tab/newline anywhere and leading C0 controls/space, so
  // "java\tscript:" or "\x01javascript:" still run: test the value the browser will actually see.
  const urlView = (v) => String(v).replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+/, '');
  const REL_OK = /^\s*([a-z][a-z0-9+.-]*:|#)/i; // already absolute (any scheme) or in-page anchor
  const IMG_DATA = /^\s*data:image\/(png|jpe?g|gif|webp);/i;
  // Remote bodies come from Ultra (course documents, announcements): a relative link means Ultra, also when it is
  // shown on the portal (TP-093). Ad Valvas bodies are absolutized against their own page before they get here.
  const ULTRA_BASE = 'https://ultra.edu.kuleuven.cloud/';
  /** sanitize(html, {base}) — base: what relative URLs resolve against (default: the Ultra origin). */
  function sanitize(html, opts = {}) {
    if (!html) return '';
    const base = (opts && opts.base) || ULTRA_BASE;
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll(DROP).forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value;
        if (!KEEP_ATTR.has(n)) { el.removeAttribute(a.name); continue; }
        if (n === 'href' || n === 'src') {
          const pv = urlView(v);
          if (BAD_URL.test(pv) && !(n === 'src' && el.tagName === 'IMG' && IMG_DATA.test(pv))) el.removeAttribute(a.name);
          else if (v && !REL_OK.test(pv)) {
            // Absolutize relative URLs: on Ultra a relative src would resolve against the CDN <base href>.
            try {
              const abs = new URL(v, base).href;
              if (BAD_URL.test(abs)) el.removeAttribute(a.name); else el.setAttribute(a.name, abs);
            } catch (_) { el.removeAttribute(a.name); }
          }
        }
      }
      const tag = el.tagName;
      if (tag === 'A') {
        // In-page anchors stay in the page (TP-092); every other link opens in a new tab without a referrer.
        if (/^\s*#/.test(el.getAttribute('href') || '')) return;
        el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer');
      } else if (tag === 'IMG') {
        el.setAttribute('referrerpolicy', 'no-referrer'); el.setAttribute('loading', 'lazy'); el.setAttribute('decoding', 'async');
      } else if (tag === 'VIDEO' || tag === 'AUDIO') {
        el.setAttribute('preload', 'none'); el.setAttribute('controls', '');
      }
    });
    return doc.body.innerHTML;
  }

  // HTML → plain text with collapsed whitespace.
  function plain(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('script,style,template,noscript').forEach((n) => n.remove());
    doc.querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,tr').forEach((n) => n.append(' '));
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // "Filmtaal 1 [N50265]" → "Filmtaal 1" ; "- Ad Valvas" → "Ad Valvas"
  const courseName = (s) => String(s ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^\s*-\s*/, '').trim();
  const courseCode = (s) => (String(s ?? '').match(/\[([^\]]+)\]\s*$/) || [])[1] || '';

  // Bounded-concurrency map. Results keep input order. A failing item yields undefined
  // (it never rejects the whole pool), so one broken folder can't sink a tree walk.
  async function pool(items, n, fn) {
    const list = Array.from(items || []);
    const out = new Array(list.length);
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const k = i++;
        try { out[k] = await fn(list[k], k); } catch (_) { out[k] = undefined; }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n || 1, list.length)) }, worker));
    return out;
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    return d;
  }

  let seq = 0;
  const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 7);

  // 'brand' = the Toledo+ accent (brand orange, v1.6 default). Accent only: never handed out as a course colour.
  const PALETTE = {
    brand: '#EE8B35', blue: '#007AFF', purple: '#AF52DE', pink: '#FF2D55', red: '#FF3B30', orange: '#FF9500', yellow: '#FFCC00',
    green: '#34C759', mint: '#00C7BE', teal: '#30B0C7', cyan: '#32ADE6', indigo: '#5856D6', brown: '#A2845E', graphite: '#8E8E93',
  };
  // Toledo color numbers 1..16 → palette keys (deterministic; graphite reserved for "no course").
  const COLOR_ORDER = ['blue', 'green', 'indigo', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow', 'mint', 'cyan', 'brown'];
  const staticKey = (n) => COLOR_ORDER[(Math.max(1, Math.floor(Number(n) || 1)) - 1) % COLOR_ORDER.length];
  // Accent colours: red and pink are reserved for "te laat" (N7) and never offered as accent.
  const NO_ACCENT = ['red', 'pink'];
  const ACCENTS = Object.keys(PALETTE).filter((k) => !NO_ACCENT.includes(k));
  const accentKey = (k) => (PALETTE[k] && !NO_ACCENT.includes(k) ? k : 'brand');
  /** Palette keys offered as course colours (everything except the brand accent). */
  const COURSE_COLORS = Object.keys(PALETTE).filter((k) => k !== 'brand');
  // Brand-specified text colours (brandguide: orange text on white = #C2410C; on ink the lighter orange).
  const ACCENT_TEXT = { brand: { l: '#C2410C', d: '#F5A35F' } };
  // Free colours for duplicates: red/pink last (they read as "overdue").
  const SPARE = ['blue', 'green', 'indigo', 'orange', 'purple', 'teal', 'yellow', 'mint', 'cyan', 'brown', 'pink', 'red'];

  // Unique default course colours (N7). Toledo colour numbers 1..16 fold onto 12 palette keys, so two current
  // courses can end up with the same colour (e.g. 4 and 16 → orange). For the current courses we hand out
  // keys so that no two get the same one: keep the static colour when it is still free, otherwise take the
  // next unused key. Courses with an own colour (settings) reserve theirs first. Computed lazily from
  // TP.data / TP.settings at call time (util.js loads first), cached per enrollments array + colour choices.
  let cmemo = { en: null, sig: '', byIdx: null, byLu: null };
  function colorMaps() {
    let en = null;
    try { en = TP.data && TP.data.peek ? TP.data.peek('enrollments') : null; } catch (_) { en = null; }
    if (!Array.isArray(en) || !en.length) return null;
    const own = (lu) => { try { return (TP.settings && TP.settings.course ? TP.settings.course(lu) : null)?.color || null; } catch (_) { return null; } };
    const courses = en.filter((e) => e && e.learningUnitId && (e.type || 'course') === 'course');
    const year = Math.max(0, ...courses.map((e) => Number(e.academicYear) || 0));
    const cur = courses.filter((e) => (Number(e.academicYear) || 0) === year)
      .sort((a, b) => (Number(a.color) || 0) - (Number(b.color) || 0) || String(a.learningUnitId).localeCompare(String(b.learningUnitId)));
    const sig = cur.map((e) => `${e.learningUnitId}:${e.color}:${own(e.learningUnitId) || ''}`).join('|');
    if (cmemo.en === en && cmemo.sig === sig) return cmemo;
    const used = new Set(cur.map((e) => own(e.learningUnitId)).filter((k) => PALETTE[k]));
    const byIdx = new Map(); const byLu = new Map();
    for (const e of cur) {
      if (own(e.learningUnitId)) continue;
      const idx = Number(e.color) || 1;
      let k = staticKey(idx);
      if (used.has(k) || k === 'red') k = SPARE.find((x) => !used.has(x)) || k;
      used.add(k);
      byLu.set(e.learningUnitId, k);
      if (!byIdx.has(idx)) byIdx.set(idx, k);
    }
    cmemo = { en, sig, byIdx, byLu };
    return cmemo;
  }
  /** Palette key for a Toledo colour number (unique among the current courses when TP.data is loaded). */
  const colorKeyForIndex = (n) => {
    const m = colorMaps();
    const k = m && m.byIdx.get(Number(n) || 1);
    return k || staticKey(n);
  };
  const colorForIndex = (n) => PALETTE[colorKeyForIndex(n)];
  /** Per-course default colour key: unique among the current courses even when two share a Toledo colour. */
  const courseColorKey = (luId, n) => {
    const m = colorMaps();
    return (m && m.byLu.get(luId)) || colorKeyForIndex(n);
  };

  // Only allow safe color syntaxes in style attributes.
  const safeColor = (c, fallback = PALETTE.graphite) => {
    const s = String(c ?? '').trim();
    if (PALETTE[s]) return PALETTE[s];
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|var\(--[\w-]+\))$/i.test(s) ? s : fallback;
  };

  // ---- WCAG contrast helpers (used by the shell to derive --tint-text) ----
  function hexToRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  // Mix `hex` toward black (toward='dark') or white until contrast with `bg` ≥ ratio.
  function ensureContrast(hex, bg, ratio = 4.5, toward = 'dark') {
    const base = hexToRgb(hex);
    const target = toward === 'dark' ? [0, 0, 0] : [255, 255, 255];
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const c = rgbToHex(base.map((v, i) => v + (target[i] - v) * t));
      if (contrast(c, bg) >= ratio) return c;
    }
    return toward === 'dark' ? '#000000' : '#FFFFFF';
  }

  TP.util = {
    esc, abs, sanitize, plain, courseName, courseCode, pool, debounce, uid,
    PALETTE, ACCENTS, COURSE_COLORS, ACCENT_TEXT, accentKey, colorForIndex, colorKeyForIndex, courseColorKey, safeColor, contrast, ensureContrast,
  };

  // ---------------- TP.fmt ----------------
  const DAY = 864e5;
  const locale = () => TP.i18n?.locale?.() || 'nl-BE';
  const t = (k, v) => (TP.t ? TP.t(k, v) : k);
  const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysUntil = (ms) => Math.round((midnight(ms) - midnight(Date.now())) / DAY); // calendar days (DST: round)
  const valid = (ms) => ms != null && ms !== '' && !Number.isNaN(new Date(ms).getTime());

  const cache = new Map();
  const dtf = (opts) => {
    const key = locale() + JSON.stringify(opts);
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale(), opts));
    return cache.get(key);
  };

  function date(ms, opts) {
    if (!valid(ms)) return '';
    const o = opts || { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) };
    return dtf(o).format(new Date(ms));
  }
  const time = (ms) => (valid(ms) ? dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) : '');

  // Calendar-day relative: vandaag / morgen / gisteren / over 3 d / 3 d geleden
  function rel(ms) {
    if (!valid(ms)) return '';
    const n = daysUntil(ms);
    if (n === 0) return t('fmt.today');
    if (n === 1) return t('fmt.tomorrow');
    if (n === -1) return t('fmt.yesterday');
    return n > 0 ? t('fmt.inDays', { n }) : t('fmt.daysAgo', { n: -n });
  }

  // Past timestamps: time today, "gisteren", weekday within a week, else short date.
  function ago(ms) {
    if (!valid(ms)) return '';
    const n = -daysUntil(ms);
    if (n <= 0) return time(ms);
    if (n === 1) return t('fmt.yesterday');
    if (n < 7) return date(ms, { weekday: 'long' });
    return date(ms);
  }

  const dayKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // ---- calendar-day arithmetic (DST-safe: wall-clock days, never "+ 24 h") ----
  /** Local midnight of the day `ms` falls on. */
  const sod = midnight;
  /** Same wall-clock time `n` calendar days later (23 h or 25 h on the DST days). */
  const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  /** Hours since local midnight on the wall clock (09:00 → 9, also on the DST days). */
  const wallHours = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };

  // ---- time zone: lessons, exams and Toledo deadlines happen on Belgian time ----
  const BXL = 'Europe/Brussels';
  const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } };
  let bxlDtf = null;
  /** Europe/Brussels offset from UTC in minutes at `ms` (+60 / +120). */
  function bxlOffset(ms) {
    try {
      bxlDtf ||= new Intl.DateTimeFormat('en-US', { timeZone: BXL, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      const p = Object.fromEntries(bxlDtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
      return Math.round((wall - Math.floor(ms / 60e3) * 60e3) / 60e3);
    } catch (_) { return null; }
  }
  /** '' when this device shows Belgian time at `ms` (Brussels, or a zone with the same clock then); else a short
   *  zone label for the device clock ("GMT+9"), so a student abroad can tell which clock a time is on. */
  function zone(ms = Date.now()) {
    if (!valid(ms)) return '';
    const z = deviceZone();
    if (!z || z === BXL) return '';
    const dev = -new Date(ms).getTimezoneOffset();
    const b = bxlOffset(ms);
    if (b == null || dev === b) return '';
    try {
      const part = dtf({ timeZoneName: 'short' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName');
      if (part && part.value) return part.value;
    } catch (_) { /* fall through */ }
    const h = dev / 60;
    return `GMT${h >= 0 ? '+' : '−'}${Math.abs(h)}`;
  }

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  /**
   * One way to write a moment (TP-230). style:
   *  'short' (default) → "wo 28 okt 23:59" (rows) · 'long' → "Woensdag 28 oktober · 23:59" (sheets) · 'day' → "wo 28 okt".
   * The year is added when it is not this year. opts.zone → " (GMT+9)" when the device is not on Belgian time.
   */
  function when(ms, style = 'short', opts = {}) {
    if (!valid(ms)) return '';
    const other = new Date(ms).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {};
    const z = opts.zone ? zone(ms) : '';
    const zs = z ? ` (${z})` : '';
    if (style === 'long') return `${cap(date(ms, { weekday: 'long', day: 'numeric', month: 'long', ...other }))} · ${time(ms)}${zs}`;
    const d = date(ms, { weekday: 'short', day: 'numeric', month: 'short', ...other });
    return style === 'day' ? d : `${d} ${time(ms)}${zs}`;
  }
  /** "09:00–11:00"; "22:00–00:00 (+1)" when the end falls on a later calendar day (TP-222). */
  function timeRange(start, end) {
    if (!valid(start)) return '';
    if (!valid(end) || end <= start) return time(start);
    const n = Math.round((sod(end - 1) - sod(start)) / DAY);
    return `${time(start)}–${time(end)}${n > 0 ? ` (+${n})` : ''}`;
  }

  TP.fmt = { date, time, rel, ago, dayKey, daysUntil, sod, addDays, wallHours, when, timeRange, zone, BXL };
})();
