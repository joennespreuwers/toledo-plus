/* Toledo+ — TPFT: the pure, DOM-free part of full-text search of course files (no storage, no network).
   Loaded three ways: as a content script (before fulltext.js: file types, budget, backoff), and as a
   side-effect module import in the extension frame (src/core/fulltext-host.mjs: normalisation, the inverted
   index, snippets) and in its worker (src/core/fulltext-worker.mjs: zip/OOXML/PDF text extraction).
   Unit-tested in Node (tests/unit/fulltext.test.js). Assigns globalThis.TPFT; no imports, no `this`. */
(() => {
  'use strict';

  const MB = 1024 * 1024;
  const LIMITS = {
    maxFileBytes: 25 * MB,     // larger files are skipped (never downloaded when the size is known up front)
    dayBytes: 300 * MB,        // download budget per day for indexing (opened/downloaded files cost nothing extra)
    maxPages: 2000,            // pages/slides per file
    maxPageChars: 50000,       // text per page
    maxFileChars: 2e6,         // text per file
    capChars: 100e6,           // whole store (~200 MB as UTF-16) → least recently used files are evicted
    minTextChars: 16,          // a PDF with less text than this is a scan (no OCR) → skipped
  };

  // ---------------------------------------------------------------- normalisation
  const COMBINING = /[\u0300-\u036f]/g;
  /** Lowercase, no diacritics (é → e, ç → c), ligatures folded (ﬁ → fi), single spaces. */
  function norm(s) {
    return String(s || '').normalize('NFKD').replace(COMBINING, '').toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim();
  }
  const TOKEN = /[\p{L}\p{N}]+/gu;
  const MIN_TOKEN = 2;
  const MAX_TOKEN = 40;
  /** Unique index terms of a text (normalised words of 2–40 characters). */
  function terms(text) {
    const out = new Set();
    for (const m of norm(text).matchAll(TOKEN)) {
      const w = m[0];
      if (w.length >= MIN_TOKEN && w.length <= MAX_TOKEN) out.add(w);
    }
    return [...out];
  }
  /** Query → normalised words (any length ≥ 1, deduplicated, longest first is NOT applied: order kept). */
  function queryWords(q) {
    const out = [];
    for (const m of norm(q).matchAll(TOKEN)) if (!out.includes(m[0])) out.push(m[0].slice(0, MAX_TOKEN));
    return out;
  }

  /**
   * Normalise with a map back to the original: → { s, map } where map[i] = index in `text` of normalised char i.
   * Used for snippets, so highlights land on the original (accented) characters.
   */
  function normMap(text) {
    const src = String(text || '');
    let s = '';
    const map = [];
    for (let i = 0; i < src.length; i++) {
      let ch = src[i];
      const code = src.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < src.length) { ch += src[i + 1]; }
      let n = /[\s\u00a0]/.test(ch) ? ' ' : ch.normalize('NFKD').replace(COMBINING, '').toLowerCase();
      if (ch.length === 2) { for (let k = 0; k < n.length; k++) { s += n[k]; map.push(i); } i++; continue; }
      for (let k = 0; k < n.length; k++) { s += n[k]; map.push(i); }
    }
    return { s, map };
  }

  const isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

  /**
   * Snippet around the first match: ± `radius` characters of the original text, cut at word boundaries,
   * with every query-word occurrence that starts a word marked. → { segs: [[text, marked]], start } | null.
   * Rendering escapes each segment and wraps marked ones in <mark>.
   */
  function snippet(text, words, { radius = 80 } = {}) {
    const src = String(text || '');
    const ws = (words || []).filter(Boolean);
    if (!src || !ws.length) return null;
    const { s, map } = normMap(src);
    // all word-start matches (prefix): [from, to) in normalised coordinates
    const hits = [];
    for (const w of ws) {
      let i = s.indexOf(w);
      while (i >= 0) {
        if (!isWordChar(s[i - 1])) hits.push([i, i + w.length]);
        i = s.indexOf(w, i + 1);
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    // window around the first hit (in original coordinates)
    const first = map[hits[0][0]];
    let from = Math.max(0, first - radius);
    let to = Math.min(src.length, first + radius);
    if (from > 0) { const sp = src.indexOf(' ', from); if (sp >= 0 && sp < first) from = sp + 1; }
    if (to < src.length) { const sp = src.lastIndexOf(' ', to); if (sp > first) to = sp; }
    // merge marks inside the window
    const marks = [];
    for (const [a, b] of hits) {
      const oa = map[a]; const ob = (map[b - 1] ?? map[a]) + 1;
      if (oa < from || ob > to) continue;
      const last = marks[marks.length - 1];
      if (last && oa <= last[1]) last[1] = Math.max(last[1], ob); else marks.push([oa, ob]);
    }
    const segs = [];
    let at = from;
    const clean = (x) => x.replace(/[\s\u00a0]+/g, ' ');
    if (from > 0) segs.push(['…', false]);
    for (const [a, b] of marks) {
      if (a > at) segs.push([clean(src.slice(at, a)), false]);
      segs.push([clean(src.slice(a, b)), true]);
      at = b;
    }
    if (to > at) segs.push([clean(src.slice(at, to)), false]);
    if (to < src.length) segs.push(['…', false]);
    return { segs, start: from };
  }

  // ---------------------------------------------------------------- inverted index (in memory)
  /**
   * Pages (docs) are numbered; postings map term → array of doc numbers. Removal tombstones docs; compact()
   * rebuilds when a third is dead. Prefix search over a lazily sorted vocabulary (binary search).
   */
  function createIndex() {
    let docs = [];            // n → { key, page, alive }
    let post = new Map();     // term → number[]
    let byKey = new Map();    // file key → [doc numbers]
    let dead = 0;
    let vocab = null;         // sorted terms (null = dirty)

    function add(key, pages) {
      remove(key);
      const ids = [];
      for (const p of pages || []) {
        const n = docs.length;
        docs.push({ key, page: p.n, alive: true });
        ids.push(n);
        const ts = Array.isArray(p.terms) ? p.terms : String(p.terms || '').split(' ');
        for (const t of ts) {
          if (!t) continue;
          let l = post.get(t);
          if (!l) { l = []; post.set(t, l); vocab = null; }
          l.push(n);
        }
      }
      byKey.set(key, ids);
    }

    function remove(key) {
      const ids = byKey.get(key);
      if (!ids) return false;
      for (const n of ids) { if (docs[n].alive) { docs[n].alive = false; dead++; } }
      byKey.delete(key);
      if (dead > 2000 && dead > docs.length / 3) compact();
      return true;
    }

    function compact() {
      const old = docs; const oldPost = post;
      const remap = new Int32Array(old.length).fill(-1);
      docs = [];
      for (let i = 0; i < old.length; i++) if (old[i].alive) { remap[i] = docs.length; docs.push(old[i]); }
      post = new Map();
      for (const [t, l] of oldPost) {
        const nl = [];
        for (const n of l) if (remap[n] >= 0) nl.push(remap[n]);
        if (nl.length) post.set(t, nl);
      }
      const nk = new Map();
      for (const [k, ids] of byKey) nk.set(k, ids.map((n) => remap[n]).filter((n) => n >= 0));
      byKey = nk; dead = 0; vocab = null;
    }

    function sorted() {
      if (!vocab) vocab = [...post.keys()].sort();
      return vocab;
    }

    /** Terms starting with `w` (exact first), at most `cap`. */
    function expand(w, cap = 300) {
      const v = sorted();
      let lo = 0; let hi = v.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (v[mid] < w) lo = mid + 1; else hi = mid; }
      const out = [];
      for (let i = lo; i < v.length && out.length < cap && v[i].startsWith(w); i++) out.push(v[i]);
      return out;
    }

    /**
     * words: query words (normalised). Every word must occur in the page (as a word or a word prefix; a 1-letter
     * word only as a whole word). → best page per file: [{ key, page, score }] best first (≤ limit).
     */
    function search(words, { limit = 8, boost } = {}) {
      const ws = (words || []).filter(Boolean);
      if (!ws.length || !docs.length) return [];
      let acc = null; // doc → score
      for (const w of ws) {
        const cand = w.length < MIN_TOKEN ? [] : expand(w);
        const hit = new Map();
        for (const t of cand) {
          const sc = t === w ? 3 : 1 + Math.min(1, w.length / t.length); // exact 3, prefix 1..2
          for (const n of post.get(t) || []) if (docs[n].alive && (hit.get(n) || 0) < sc) hit.set(n, sc);
        }
        if (acc === null) acc = hit;
        else { const next = new Map(); for (const [n, s] of acc) { const h = hit.get(n); if (h) next.set(n, s + h); } acc = next; }
        if (!acc.size) return [];
      }
      const best = new Map(); // key → {key, page, score}
      for (const [n, s] of acc) {
        const d = docs[n];
        const sc = s + (boost ? boost(d.key) : 0);
        const cur = best.get(d.key);
        if (!cur || sc > cur.score || (sc === cur.score && d.page < cur.page)) best.set(d.key, { key: d.key, page: d.page, score: sc });
      }
      return [...best.values()].sort((a, b) => b.score - a.score || a.page - b.page || (a.key < b.key ? -1 : 1)).slice(0, limit);
    }

    return {
      add, remove, search, expand, compact,
      has: (key) => byKey.has(key),
      clear() { docs = []; post = new Map(); byKey = new Map(); dead = 0; vocab = null; },
      stats: () => ({ files: byKey.size, pages: docs.length - dead, terms: post.size }),
    };
  }

  // ---------------------------------------------------------------- file types
  const EXT = {
    pdf: 'pdf', docx: 'docx', docm: 'docx', pptx: 'pptx', pptm: 'pptx', ppsx: 'pptx', xlsx: 'xlsx', xlsm: 'xlsx',
    txt: 'text', md: 'text', markdown: 'text', csv: 'text', tsv: 'text', rtf: null, html: 'html', htm: 'html',
  };
  const MIME = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text', 'text/html': 'html',
  };
  /** 'pdf'|'docx'|'pptx'|'xlsx'|'text'|'html'|null (unknown → not indexed, never downloaded for indexing). */
  function typeOf(fileName, mime) {
    const m = /\.([a-z0-9]{1,9})$/i.exec(String(fileName || '').trim());
    if (m && Object.prototype.hasOwnProperty.call(EXT, m[1].toLowerCase())) return EXT[m[1].toLowerCase()];
    const mt = String(mime || '').toLowerCase().split(';')[0].trim();
    return MIME[mt] || null;
  }
  /** Unit for result labels: 'slide' (pptx) | 'page' (pdf, docx with page breaks) | '' (no meaningful position). */
  function unitOf(type, pages) {
    if (type === 'pptx') return 'slide';
    if (type === 'pdf') return 'page';
    if (type === 'docx' && pages > 1) return 'page';
    return '';
  }

  // ---------------------------------------------------------------- zip (central directory) + OOXML
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /** → [{name, method, csize, usize, offset}] from the central directory (no zip64, no encryption). Throws on garbage. */
  function zipEntries(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { end = i; break; }
    }
    if (end < 0) throw Object.assign(new Error('not a zip'), { skip: 'unreadable' });
    const count = u16(b, end + 10);
    let off = u32(b, end + 16);
    const out = [];
    for (let k = 0; k < count; k++) {
      if (u32(b, off) !== 0x02014b50) throw Object.assign(new Error('bad central directory'), { skip: 'unreadable' });
      const flags = u16(b, off + 8);
      const method = u16(b, off + 10);
      const csize = u32(b, off + 20); const usize = u32(b, off + 24);
      const n = u16(b, off + 28); const x = u16(b, off + 30); const c = u16(b, off + 32);
      const local = u32(b, off + 42);
      const name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + n));
      out.push({ name, method, csize, usize, offset: local, encrypted: !!(flags & 1) });
      off += 46 + n + x + c;
    }
    return out;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') throw Object.assign(new Error('no DecompressionStream'), { skip: 'unsupported' });
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** Read the entries whose name passes `want(name)` → Map name → string (UTF-8). Capped at maxBytes uncompressed. */
  async function unzipText(bytes, want, { maxBytes = 64 * MB } = {}) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const out = new Map();
    let total = 0;
    for (const e of zipEntries(b)) {
      if (!want(e.name)) continue;
      if (e.encrypted) throw Object.assign(new Error('encrypted'), { skip: 'encrypted' });
      total += e.usize;
      if (total > maxBytes) throw Object.assign(new Error('too large'), { skip: 'large' });
      const lo = e.offset;
      if (u32(b, lo) !== 0x04034b50) throw Object.assign(new Error('bad local header'), { skip: 'unreadable' });
      const start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
      const data = b.subarray(start, start + e.csize);
      let raw;
      if (e.method === 0) raw = data;
      else if (e.method === 8) raw = await inflateRaw(data);
      else throw Object.assign(new Error('zip method ' + e.method), { skip: 'unreadable' });
      out.set(e.name, new TextDecoder().decode(raw));
    }
    return out;
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decodeXml(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch (_) { return ' '; }
      }
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    });
  }
  const tidy = (s) => s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  /** word/document.xml → pages split at explicit page breaks and Word's rendered page breaks. */
  function docxPages(xml) {
    const pages = [];
    let cur = '';
    const body = String(xml).replace(/<w:(del|instrText)\b[^>]*>[\s\S]*?<\/w:\1>/g, '');
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b([^>]*)\/>|<w:lastRenderedPageBreak\s*\/>|<\/w:p>|<w:cr\s*\/>/g;
    let m;
    const flush = () => { const t = tidy(cur); if (t || pages.length) pages.push(t); cur = ''; };
    while ((m = re.exec(body))) {
      const tag = m[0];
      if (m[1] !== undefined) cur += decodeXml(m[1]);
      else if (tag.startsWith('<w:tab')) cur += ' ';
      else if (tag.startsWith('<w:br')) { if (/w:type="page"/.test(m[2] || '')) flush(); else cur += '\n'; }
      else if (tag.startsWith('<w:lastRenderedPageBreak')) flush();
      else cur += '\n';
    }
    const t = tidy(cur);
    if (t || !pages.length) pages.push(t);
    // drop empty pages but keep numbering
    return pages.map((text, i) => ({ n: i + 1, text })).filter((p) => p.text);
  }

  /** a slide's XML → its text (paragraph per line). */
  function slideText(xml) {
    let s = '';
    const re = /<a:t>([\s\S]*?)<\/a:t>|<a:t\s[^>]*>([\s\S]*?)<\/a:t>|<\/a:p>|<a:br\b[^>]*\/>/g;
    let m;
    while ((m = re.exec(String(xml)))) {
      if (m[1] !== undefined || m[2] !== undefined) s += decodeXml(m[1] !== undefined ? m[1] : m[2]);
      else s += '\n';
    }
    return tidy(s);
  }

  function sharedStrings(xml) {
    const out = [];
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(String(xml)))) {
      const parts = []; const r = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let x;
      while ((x = r.exec(m[1]))) parts.push(decodeXml(x[1]));
      out.push(parts.join(''));
    }
    return out;
  }

  /** HTML → text (no DOM: also runs in workers). */
  function htmlText(html) {
    return tidy(decodeXml(String(html)
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')));
  }

  function capPages(pages) {
    const out = [];
    let total = 0;
    for (const p of pages) {
      if (out.length >= LIMITS.maxPages || total >= LIMITS.maxFileChars) break;
      const text = p.text.slice(0, Math.min(LIMITS.maxPageChars, LIMITS.maxFileChars - total));
      total += text.length;
      if (text) out.push({ n: p.n, text });
    }
    return out;
  }

  // ---------------------------------------------------------------- PDF (pdf.js passed in: the worker loads it)
  /** pdf.js text items of one page → text with line breaks. */
  function pdfItemsText(items) {
    let s = '';
    for (const it of items || []) {
      if (typeof it.str !== 'string') continue;
      s += it.str;
      if (it.hasEOL) s += '\n';
      else if (it.str && !/\s$/.test(it.str)) s += '';
    }
    return tidy(s);
  }

  /** Extract a PDF page by page (bounded memory: each page is cleaned up). → pages | throws {skip}. */
  async function extractPdf(pdfjs, bytes, { onPage } = {}) {
    const task = pdfjs.getDocument({
      data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, disableStream: true,
      useWorkerFetch: false, useWasm: false, stopAtErrors: false, verbosity: 0,
    });
    let doc;
    try {
      doc = await task.promise;
    } catch (e) {
      try { await task.destroy(); } catch (_) { /* ignore */ }
      const n = (e && e.name) || '';
      throw Object.assign(new Error(n || 'pdf'), { skip: n === 'PasswordException' ? 'encrypted' : 'unreadable' });
    }
    const pages = [];
    let chars = 0;
    try {
      const count = Math.min(doc.numPages, LIMITS.maxPages);
      for (let i = 1; i <= count && chars < LIMITS.maxFileChars; i++) {
        const page = await doc.getPage(i);
        try {
          const tc = await page.getTextContent({ disableNormalization: false });
          const text = pdfItemsText(tc.items);
          if (text) { pages.push({ n: i, text }); chars += text.length; }
          if (onPage) onPage(i, count);
        } finally { try { page.cleanup(); } catch (_) { /* ignore */ } }
      }
    } finally { try { await task.destroy(); } catch (_) { /* ignore */ } }
    if (chars < LIMITS.minTextChars) throw Object.assign(new Error('no text'), { skip: 'notext' });
    return capPages(pages);
  }

  /**
   * bytes + type → { pages: [{n, text}] } or { skipped: 'notext'|'encrypted'|'unreadable'|'large'|'unsupported' }.
   * opts.pdfjs: the pdf.js module (only needed for PDFs).
   */
  async function extract(bytes, type, opts = {}) {
    try {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (b.length > LIMITS.maxFileBytes) return { skipped: 'large' };
      if (type === 'pdf') {
        if (!opts.pdfjs) return { skipped: 'unsupported' };
        return { pages: await extractPdf(opts.pdfjs, b, opts) };
      }
      if (type === 'docx') {
        const files = await unzipText(b, (n) => n === 'word/document.xml');
        const xml = files.get('word/document.xml');
        if (xml == null) return { skipped: 'unreadable' };
        return nonEmpty(capPages(docxPages(xml)));
      }
      if (type === 'pptx') {
        const files = await unzipText(b, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
        const pages = [...files].map(([name, xml]) => ({ n: Number(/slide(\d+)\.xml$/.exec(name)[1]), text: slideText(xml) }))
          .sort((a, c) => a.n - c.n).filter((p) => p.text);
        return nonEmpty(capPages(pages));
      }
      if (type === 'xlsx') {
        const files = await unzipText(b, (n) => n === 'xl/sharedStrings.xml');
        const text = tidy(sharedStrings(files.get('xl/sharedStrings.xml') || '').join('\n'));
        return nonEmpty(capPages([{ n: 1, text }]));
      }
      if (type === 'text' || type === 'html') {
        const raw = new TextDecoder().decode(b);
        if (/\u0000/.test(raw.slice(0, 2000))) return { skipped: 'unreadable' };
        const text = type === 'html' ? htmlText(raw) : tidy(raw);
        return nonEmpty(capPages([{ n: 1, text }]));
      }
      return { skipped: 'unsupported' };
    } catch (e) {
      return { skipped: (e && e.skip) || 'unreadable' };
    }
  }
  const nonEmpty = (pages) => (pages.length && pages.some((p) => p.text.length >= 2) ? { pages } : { skipped: 'notext' });

  // ---------------------------------------------------------------- throttling (used by the content script)
  /** 'YYYY-MM-DD' (local) of ms. */
  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  /** Daily budget: → { day, bytes, left, ok } after (optionally) spending `add` bytes. A new day resets. */
  function budget(state, now, add = 0, limit = LIMITS.dayBytes) {
    const day = dayKey(now);
    const used = state && state.day === day ? Number(state.bytes) || 0 : 0;
    const bytes = used + Math.max(0, add || 0);
    return { day, bytes, left: Math.max(0, limit - bytes), ok: bytes < limit };
  }
  /** Back-off after the n-th consecutive 429/5xx (1-based): Retry-After (s) wins; else 5 s × 2ⁿ⁻¹, max 5 min. */
  function backoff(n, retryAfter) {
    const ra = Number(retryAfter);
    if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 10 * 60e3);
    return Math.min(5000 * 2 ** Math.max(0, n - 1), 5 * 60e3);
  }
  /** Should a stored record be re-indexed? (new attachment, or the item's `modified` changed; size when known) */
  function changed(rec, { attId, modified, size } = {}) {
    if (!rec) return true;
    if (attId && rec.attId && rec.attId !== attId) return true;
    if (modified && rec.modified && rec.modified !== modified) return true;
    if (size && rec.size && rec.size !== size) return true;
    return false;
  }

  globalThis.TPFT = {
    LIMITS, norm, terms, queryWords, normMap, snippet, createIndex, typeOf, unitOf,
    zipEntries, unzipText, docxPages, slideText, sharedStrings, htmlText, decodeXml, pdfItemsText, extractPdf, extract,
    dayKey, budget, backoff, changed,
  };
})();
