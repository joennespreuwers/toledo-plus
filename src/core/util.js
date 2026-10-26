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
  const DROP = 'script,style,iframe,frame,frameset,object,embed,applet,form,input,button,textarea,select,option,link,meta,base,svg,math,template,noscript,portal';
  const BAD_URL = /^\s*(javascript|vbscript|data):/i;
  const REL_OK = /^\s*([a-z][a-z0-9+.-]*:|#)/i; // already absolute (any scheme) or in-page anchor
  const IMG_DATA = /^\s*data:image\/(png|jpe?g|gif|webp);/i;
  function sanitize(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll(DROP).forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value;
        if (n.startsWith('on') || n === 'style' || n === 'class' || n === 'id' || n === 'formaction' || n === 'srcdoc') {
          el.removeAttribute(a.name);
        } else if (n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'poster' || n === 'background') {
          if (BAD_URL.test(v) && !(n === 'src' && el.tagName === 'IMG' && IMG_DATA.test(v))) el.removeAttribute(a.name);
          else if ((n === 'href' || n === 'src') && v && !REL_OK.test(v)) {
            // Absolutize relative URLs: on Ultra a relative src would resolve against the CDN <base href>.
            try { el.setAttribute(a.name, new URL(v, location.href).href); } catch (_) { el.removeAttribute(a.name); }
          }
        } else if (n === 'srcset' && BAD_URL.test(v)) {
          el.removeAttribute(a.name);
        }
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
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

  const PALETTE = {
    blue: '#007AFF', purple: '#AF52DE', pink: '#FF2D55', red: '#FF3B30', orange: '#FF9500', yellow: '#FFCC00',
    green: '#34C759', mint: '#00C7BE', teal: '#30B0C7', cyan: '#32ADE6', indigo: '#5856D6', brown: '#A2845E', graphite: '#8E8E93',
  };
  // Toledo color numbers 1..16 → palette keys (deterministic; graphite reserved for "no course").
  const COLOR_ORDER = ['blue', 'green', 'indigo', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow', 'mint', 'cyan', 'brown'];
  const colorKeyForIndex = (n) => COLOR_ORDER[(Math.max(1, Math.floor(Number(n) || 1)) - 1) % COLOR_ORDER.length];
  const colorForIndex = (n) => PALETTE[colorKeyForIndex(n)];

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
    PALETTE, colorForIndex, colorKeyForIndex, safeColor, contrast, ensureContrast,
  };

  // ---------------- TP.fmt ----------------
  const DAY = 864e5;
  const locale = () => TP.i18n?.locale?.() || 'nl-BE';
  const t = (k, v) => (TP.t ? TP.t(k, v) : k);
  const midnight = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysUntil = (ms) => Math.round((midnight(ms) - midnight(Date.now())) / DAY);
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

  TP.fmt = { date, time, rel, ago, dayKey, daysUntil };
})();
