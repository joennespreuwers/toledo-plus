/* Toledo+ — TP.telemetry: anonymous usage signal, update check and feedback transport.
   Talks only to https://api.toledoplus.be (through the background relay, TP.net.json).

   Privacy contract:
   - Usage ping (settings.privacy.telemetry, default ON, opt-out in Settings): at most once per 24 h, portal origin only,
     payload exactly {id, v, browser, lang}: a random install id (crypto.randomUUID, stored in chrome.storage.local
     'telemetry:id'), the extension version, a browser family and the UI language. No names, student numbers, courses,
     URLs or other Toledo data. Opting out asks the server to forget the id, then deletes it locally; opting in again
     creates a new, unrelated id.
   - Update check (settings.privacy.updateCheck, default ON): GET /v1/latest at most every 12 h; nothing is sent.
   - Feedback: only what the user typed (+ version/browser/language when they leave that box ticked). Works with
     telemetry off (explicit consent); the install id is only attached while telemetry is on.
   Nothing here ever throws or rejects. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const API = 'https://api.toledoplus.be';
  const PORTAL = 'https://toledo.kuleuven.be';
  const RELEASES = 'https://github.com/joennespreuwers/toledo-plus/releases/latest';
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;
  const K = { id: 'telemetry:id', ping: 'telemetry:lastPing', upd: 'telemetry:lastUpdateCheck', latest: 'telemetry:latest', dismissed: 'telemetry:dismissedUpdate' };
  // Tunables (tests shrink them).
  const cfg = { api: API, pingEvery: DAY, retryAfterFail: HOUR, updateEvery: 12 * HOUR, idleDelay: 8000 };
  const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const PAGE = /^[a-z][a-z0-9-]{0,31}$/;

  // ---------------------------------------------------------------- small helpers
  const now = () => Date.now();
  const settings = () => { try { return (TP.settings && TP.settings.get && TP.settings.get()) || {}; } catch (_) { return {}; } };
  const enabled = () => settings().privacy?.telemetry !== false;
  const updatesEnabled = () => settings().privacy?.updateCheck !== false;
  const local = () => { try { return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null; } catch (_) { return null; } };
  const stale = () => { try { return typeof chrome !== 'undefined' && !!chrome.runtime && !chrome.runtime.id; } catch (_) { return true; } };

  const sget = (key) => new Promise((res) => {
    const a = local();
    if (!a || stale()) { res(undefined); return; }
    try { a.get(key, (v) => { void chrome.runtime?.lastError; res(v ? v[key] : undefined); }); } catch (_) { res(undefined); }
  });
  const sset = (obj) => new Promise((res) => {
    const a = local();
    if (!a || stale()) { res(); return; }
    try { a.set(obj, () => { void chrome.runtime?.lastError; res(); }); } catch (_) { res(); }
  });
  const sremove = (keys) => new Promise((res) => {
    const a = local();
    if (!a || stale()) { res(); return; }
    try { a.remove(keys, () => { void chrome.runtime?.lastError; res(); }); } catch (_) { res(); }
  });

  function version() {
    try { return chrome.runtime.getManifest().version; } catch (_) { return '0.0.0'; }
  }

  /** Browser family only: chrome | edge | brave | opera | other. */
  function browser() {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : {};
      const brands = ((nav.userAgentData && nav.userAgentData.brands) || []).map((b) => String(b.brand));
      if (brands.some((b) => /Edge/i.test(b))) return 'edge';
      if (brands.some((b) => /Brave/i.test(b)) || (nav.brave && typeof nav.brave.isBrave === 'function')) return 'brave';
      if (brands.some((b) => /Opera/i.test(b))) return 'opera';
      const ua = String(nav.userAgent || '');
      if (/\bEdg\//.test(ua)) return 'edge';
      if (/\bOPR\//.test(ua)) return 'opera';
      if (brands.some((b) => /Google Chrome/i.test(b)) || /\bChrome\//.test(ua)) return 'chrome';
    } catch (_) { /* fall through */ }
    return 'other';
  }

  function lang() {
    try { const l = TP.i18n && TP.i18n.lang && TP.i18n.lang(); return ['nl', 'en', 'fr'].includes(l) ? l : 'nl'; } catch (_) { return 'nl'; }
  }

  const onPortal = () => { try { return location.origin === PORTAL; } catch (_) { return false; } };

  /** Semver-ish compare of x.y.z (pre-release suffix sorts before the release). */
  function cmp(a, b) {
    const parse = (v) => { const [main, pre] = String(v || '').split('-'); return { n: main.split('.').map((x) => parseInt(x, 10) || 0), pre: pre || '' }; };
    const x = parse(a); const y = parse(b);
    for (let i = 0; i < 3; i++) { const d = (x.n[i] || 0) - (y.n[i] || 0); if (d) return d < 0 ? -1 : 1; }
    if (x.pre === y.pre) return 0;
    if (!x.pre) return 1;
    if (!y.pre) return -1;
    return x.pre < y.pre ? -1 : 1;
  }

  // ---------------------------------------------------------------- events
  const listeners = { update: new Set() };
  let pending = null; // last 'update' payload, for late subscribers
  function on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => off(evt, fn); }
  function off(evt, fn) { listeners[evt] && listeners[evt].delete(fn); }
  function emit(evt, payload) {
    if (evt === 'update') pending = payload;
    for (const fn of [...(listeners[evt] || [])]) { try { fn(payload); } catch (e) { console.warn('[Toledo+] telemetry listener', e); } }
  }

  async function post(path, body) {
    return TP.net.json(cfg.api + path, { method: 'POST', body });
  }

  // ---------------------------------------------------------------- usage ping
  async function installId(create) {
    const cur = await sget(K.id);
    if (typeof cur === 'string' && UUID4.test(cur)) return cur;
    if (!create) return null;
    let id = '';
    try { id = crypto.randomUUID(); } catch (_) { return null; }
    await sset({ [K.id]: id });
    return id;
  }

  /** The exact ping payload — nothing else is ever sent by ping(). */
  async function payload() {
    const id = await installId(true);
    return id ? { id, v: version(), browser: browser(), lang: lang() } : null;
  }

  let inflight = null;
  /** → 'sent' | 'off' | 'origin' | 'throttled' | 'error'. Never rejects. */
  function ping(opts) {
    if (inflight) return inflight;
    const p = doPing(opts || {});
    inflight = p;
    p.then(() => { if (inflight === p) inflight = null; });
    return p;
  }

  async function doPing({ force = false }) {
    try {
      if (!enabled()) return 'off';
      if (!onPortal()) return 'origin';
      if (!TP.net || stale()) return 'error';
      const last = Number(await sget(K.ping)) || 0;
      if (!force && last && now() - last < cfg.pingEvery && last <= now()) return 'throttled';
      const body = await payload();
      if (!body) return 'error';
      // Claim the slot first so concurrent tabs don't all ping (the server dedupes per day anyway).
      await sset({ [K.ping]: now() });
      try {
        await post('/v1/ping', body);
        return 'sent';
      } catch (_) {
        await sset({ [K.ping]: now() - cfg.pingEvery + cfg.retryAfterFail }); // retry in ~1 h
        return 'error';
      }
    } catch (_) {
      return 'error';
    }
  }

  /** Opt-out: ask the server to forget this id (best effort), then delete it locally. */
  async function forget() {
    try {
      const id = await installId(false);
      await sremove([K.id, K.ping]);
      if (id && TP.net && !stale()) { try { await post('/v1/forget', { id }); } catch (_) { /* best effort */ } }
      return true;
    } catch (_) { return false; }
  }

  // ---------------------------------------------------------------- update check
  const safeUrl = (u) => (typeof u === 'string' && /^https:\/\/(github\.com\/joennespreuwers\/toledo-plus\/|(www\.)?toledoplus\.be\/)/.test(u) ? u : RELEASES);

  function normalizeLatest(x) {
    if (!x || typeof x !== 'object' || typeof x.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(x.version)) return null;
    return { version: x.version, url: safeUrl(x.url), notes: typeof x.notes === 'string' ? x.notes.slice(0, 500) : '' };
  }

  async function maybeEmit(latest) {
    if (!latest || cmp(latest.version, version()) <= 0) return null;
    if ((await sget(K.dismissed)) === latest.version) return null;
    emit('update', latest);
    return latest;
  }

  /** GET /v1/latest at most every 12 h; emits 'update' {version,url,notes} when newer (also from cache). → info|null. */
  async function checkUpdate({ force = false } = {}) {
    try {
      if (!updatesEnabled() || !TP.net || stale()) return null;
      const last = Number(await sget(K.upd)) || 0;
      let latest = normalizeLatest(await sget(K.latest));
      if (force || !last || now() - last >= cfg.updateEvery || last > now()) {
        await sset({ [K.upd]: now() });
        try {
          const fresh = normalizeLatest(await TP.net.json(cfg.api + '/v1/latest'));
          latest = fresh;
          if (fresh) await sset({ [K.latest]: fresh }); else await sremove(K.latest);
        } catch (_) { /* keep the cached value */ }
      }
      return await maybeEmit(latest);
    } catch (_) { return null; }
  }

  /** The user closed the banner for this version: don't show it again until a newer one. */
  async function dismissUpdate(v) {
    const ver = v || (pending && pending.version);
    if (ver) await sset({ [K.dismissed]: ver });
    pending = null;
  }

  // ---------------------------------------------------------------- feedback
  /**
   * sendFeedback({kind, text, contact?, page?, includeMeta=true, website?}) →
   *   {ok:true} | {ok:false, error:'invalid'|'rate'|'network'|'server', retryAfter?}. Never rejects.
   */
  async function sendFeedback(o = {}) {
    try {
      const kind = ['idea', 'bug', 'other'].includes(o.kind) ? o.kind : 'other';
      const text = String(o.text || '').trim();
      const len = [...text].length;
      if (len < 10 || len > 4000) return { ok: false, error: 'invalid', field: 'text' };
      const body = { kind, text, website: String(o.website || '') };
      const contact = String(o.contact || '').trim();
      if (contact) body.contact = contact.slice(0, 200);
      if (o.page && PAGE.test(String(o.page))) body.page = String(o.page);
      if (o.includeMeta !== false) Object.assign(body, { v: version(), browser: browser(), lang: lang() });
      if (enabled()) { const id = await installId(false); if (id) body.id = id; }
      if (!TP.net || stale()) return { ok: false, error: 'network' };
      await post('/v1/feedback', body);
      return { ok: true };
    } catch (e) {
      const s = (e && e.status) || 0;
      if (s === 429) return { ok: false, error: 'rate' };
      if (s === 400 || s === 413 || s === 415 || s === 422) return { ok: false, error: 'invalid' };
      if (!s) return { ok: false, error: 'network' };
      return { ok: false, error: 'server' };
    }
  }

  // ---------------------------------------------------------------- wiring
  let scheduled = false;
  let unsub = null;
  let wasEnabled = null;

  /** Boot hook: ping + update check once the page is idle. Also watches the opt-out setting. Safe to call twice. */
  function schedule() {
    if (!unsub && TP.settings && TP.settings.subscribe) {
      wasEnabled = enabled();
      unsub = TP.settings.subscribe((s, keys) => {
        if (keys && !keys.includes('privacy')) return;
        const on = enabled();
        if (on === wasEnabled) return;
        wasEnabled = on;
        if (!on) forget(); else ping();
      });
    }
    if (scheduled) return;
    scheduled = true;
    const run = () => { ping(); checkUpdate(); };
    const later = () => {
      try {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 30000 });
        else run();
      } catch (_) { run(); }
    };
    setTimeout(later, cfg.idleDelay);
  }

  TP.telemetry = {
    ping, forget, checkUpdate, dismissUpdate, sendFeedback, schedule, on, off,
    enabled, pendingUpdate: () => pending, browser, compareVersions: cmp,
    API, KEYS: K, _cfg: cfg,
  };
})();
