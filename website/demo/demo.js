/* Toledo+ demo loader — runs the real extension UI (demo/ext/, copied from the repo at build time) in a
   normal web page, with fictitious data and no network access outside this site.

   1. a small `chrome` shim: in-memory storage.sync/local, runtime.getURL/getManifest, and
      runtime.sendMessage answered by the mock router (demo/mock.js) instead of background.js;
   2. fetch() for Toledo/Ultra/KU Loket/TimeEdit/api.toledoplus.be is answered by the same router,
      any other cross-origin fetch is refused (the demo never leaves this origin);
   3. links/navigation to Toledo, Ultra or the course "journey" links are mapped to in-page routes
      ('#/home?tplus=course&id=<learningUnitId>'); anything else shows a short "not in the demo" toast;
   4. the content scripts are loaded in manifest.json order, exactly as the browser would.
   Nothing in src/ knows it runs in a demo. */
(function () {
  'use strict';

  var LANGS = ['nl', 'en', 'fr'];
  var TEXT = {
    nl: { back: 'Terug naar toledoplus.be', home: 'Home', home_href: '../', theme: { system: 'Thema: systeem', light: 'Thema: licht', dark: 'Thema: donker' }, demo: 'Demo met nepdata', install: 'Installeer Toledo+', lang: 'Taal', notInDemo: 'Dat werkt alleen in de echte Toledo, niet in de demo.', failed: 'De demo kon niet laden. Probeer de pagina te herladen.', site: 'https://toledoplus.be/' },
    en: { back: 'Back to toledoplus.be', home: 'Home', home_href: '../en/', theme: { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }, demo: 'Demo with fake data', install: 'Install Toledo+', lang: 'Language', notInDemo: 'That only works in the real Toledo, not in the demo.', failed: 'The demo could not load. Try reloading the page.', site: 'https://toledoplus.be/en/' },
    fr: { back: 'Retour à toledoplus.be', home: 'Accueil', home_href: '../fr/', theme: { system: 'Thème : système', light: 'Thème : clair', dark: 'Thème : sombre' }, demo: 'Démo avec de fausses données', install: 'Installer Toledo+', lang: 'Langue', notInDemo: 'Cela ne fonctionne que dans le vrai Toledo, pas dans la démo.', failed: 'La démo n’a pas pu se charger. Rechargez la page.', site: 'https://toledoplus.be/fr/' },
  };
  var JOURNEY = 'https://icts-p-toledo-journey.cloud.icts.kuleuven.be';
  var M = window.TPDemoMock;
  var base = new URL('ext/', document.baseURI);
  // Cache-busting: the Pages workflow replaces __BUILD__ with the commit sha.
  var BUILD = '__BUILD__';
  var qs = function (u) { return BUILD.indexOf('__') === 0 ? u : u + (u.indexOf('?') < 0 ? '?' : '&') + 'v=' + BUILD; };
  var router = null;
  var manifest = null;

  // ---------------------------------------------------------------- language
  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (LANGS.indexOf(q) >= 0) return q;
    var nav = String(navigator.language || 'nl').slice(0, 2).toLowerCase();
    return LANGS.indexOf(nav) >= 0 ? nav : 'nl';
  }
  var lang = pickLang();
  // Theme: shared with the website (localStorage 'tp-theme'); drives the app's own appearance setting.
  var THEMES = ['system', 'light', 'dark'];
  function storedTheme() { try { var v = localStorage.getItem('tp-theme'); return v === 'light' || v === 'dark' ? v : 'system'; } catch (_) { return 'system'; } }
  var theme = storedTheme();
  var tx = function (k) { return (TEXT[lang] || TEXT.nl)[k]; };

  // ---------------------------------------------------------------- chrome shim
  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  var changeListeners = [];
  function makeArea(name, seed) {
    var data = seed || {};
    function reply(cb, v) {
      if (typeof cb === 'function') { setTimeout(function () { cb(v); }, 0); return undefined; }
      return Promise.resolve(v);
    }
    function fire(changes) {
      if (!Object.keys(changes).length) return;
      setTimeout(function () { changeListeners.slice().forEach(function (fn) { try { fn(changes, name); } catch (e) { console.warn(e); } }); }, 0);
    }
    return {
      get: function (keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        var out = {};
        if (keys == null) out = clone(data);
        else if (typeof keys === 'string') { if (keys in data) out[keys] = clone(data[keys]); }
        else if (Array.isArray(keys)) keys.forEach(function (k) { if (k in data) out[k] = clone(data[k]); });
        else Object.keys(keys).forEach(function (k) { out[k] = k in data ? clone(data[k]) : keys[k]; });
        return reply(cb, out);
      },
      set: function (obj, cb) {
        var changes = {};
        Object.keys(obj || {}).forEach(function (k) { changes[k] = { oldValue: clone(data[k]), newValue: clone(obj[k]) }; data[k] = clone(obj[k]); });
        fire(changes);
        return reply(cb);
      },
      remove: function (keys, cb) {
        var changes = {};
        [].concat(keys || []).forEach(function (k) { if (k in data) { changes[k] = { oldValue: data[k] }; delete data[k]; } });
        fire(changes);
        return reply(cb);
      },
      clear: function (cb) { var all = {}; Object.keys(data).forEach(function (k) { all[k] = { oldValue: data[k] }; delete data[k]; }); fire(all); return reply(cb); },
    };
  }

  var latency = function () { return 90 + Math.random() * 160; };
  function relay(msg) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (!msg || msg.type !== 'tp-fetch') { resolve(undefined); return; }
        var r = router ? router.handle(msg) : { ok: false, status: 0, data: null };
        var data = r.ok ? r.data : null;
        if (data != null && msg.as === 'text' && typeof data !== 'string') data = JSON.stringify(data); // like background.js: raw body
        resolve({ ok: r.ok, status: r.status, data: data, retryAfter: null });
      }, latency());
    });
  }

  window.chrome = {
    runtime: {
      id: 'toledoplus-demo',
      lastError: undefined,
      // The Inter files live once on the site (assets/fonts/); everything else comes from demo/ext/.
      getURL: function (p) {
        var rel = String(p).replace(/^\//, '');
        if (/^fonts\//.test(rel)) return new URL('../assets/' + rel, document.baseURI).href;
        return qs(new URL(rel, base).href);
      },
      getManifest: function () { return manifest || { version: '0.0.0' }; },
      sendMessage: function (msg, cb) {
        var p = relay(msg);
        if (typeof cb === 'function') { p.then(function (r) { cb(r); }); return undefined; }
        return p;
      },
      onMessage: { addListener: function () {}, removeListener: function () {} },
    },
    storage: {
      sync: makeArea('sync', { settings: { language: lang, appearance: theme } }),
      // Welcome card already dismissed: the demo starts on a tidy overview.
      local: makeArea('local', { 'state:ui': { onboarded: true } }),
      onChanged: {
        addListener: function (fn) { changeListeners.push(fn); },
        removeListener: function (fn) { changeListeners = changeListeners.filter(function (x) { return x !== fn; }); },
      },
    },
  };

  // ---------------------------------------------------------------- network guard
  var MOCKED = [M.PORTAL, M.ULTRA, M.KULOKET, M.TIMEEDIT, M.API];
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var u; try { u = new URL(url, document.baseURI); } catch (_) { return realFetch(input, init); }
    if (u.origin === location.origin) return realFetch(input, init);
    if (MOCKED.indexOf(u.origin) >= 0 && router) {
      var r = router.handle({ url: u.href, method: (init && init.method) || 'GET', body: init && init.body });
      var body = r.data == null ? '' : typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      return new Promise(function (res) { setTimeout(function () { res(new Response(body, { status: r.status, headers: { 'content-type': r.contentType } })); }, latency()); });
    }
    return Promise.reject(new TypeError('Blocked in the Toledo+ demo: ' + u.origin));
  };

  // ---------------------------------------------------------------- navigation → in-page routes
  function notice() {
    try { if (window.TP && TP.shell && TP.shell.toast) { TP.shell.toast(tx('notInDemo')); return; } } catch (_) { /* fall through */ }
  }
  function courseHash(lu) { return lu ? '#/home?tplus=course&id=' + encodeURIComponent(lu) : null; }
  function luOfCid(cid) { var c = router && router.ultra.courses[cid]; return c ? c.courseId : null; }
  /** Toledo/Ultra URL → in-page hash, or null when the demo cannot show it. */
  function mapUrl(u) {
    if (u.origin === JOURNEY) return courseHash(u.searchParams.get('batchUid'));
    if (u.origin === M.PORTAL && /^\/portal\/?/.test(u.pathname)) return u.hash || '#/home';
    if (u.origin === M.ULTRA) {
      var m = /^\/ultra\/courses\/(_\d+_\d+)/.exec(u.pathname);
      var cid = (m && m[1]) || u.searchParams.get('courseId') || u.searchParams.get('course_id');
      return cid ? courseHash(luOfCid(cid)) : null;
    }
    return null;
  }
  function go(u) {
    var h = mapUrl(u);
    if (h) { if (location.hash !== h) location.hash = h; } else notice();
  }
  // Clicks (also inside the shadow root: composedPath() reaches into it).
  window.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0) return;
    var path = ev.composedPath ? ev.composedPath() : [ev.target];
    var a = null;
    for (var i = 0; i < path.length; i++) { if (path[i] && path[i].tagName === 'A' && path[i].href) { a = path[i]; break; } }
    if (!a) return;
    var u; try { u = new URL(a.href, document.baseURI); } catch (_) { return; }
    if (u.origin === location.origin || /^(mailto|tel):/.test(u.protocol)) return;
    if (a.closest && a.closest('#demo-bar')) return; // our own links
    ev.preventDefault();
    go(u);
  }, true);
  // Programmatic navigation (location.assign/href): the Navigation API can cancel it (Chromium).
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', function (e) {
      var u; try { u = new URL(e.destination.url); } catch (_) { return; }
      if (u.origin === location.origin || !e.cancelable) return;
      e.preventDefault();
      setTimeout(function () { go(u); }, 0);
    });
  }
  // window.open (file previews, downloads): a stand-in window that turns into a toast.
  window.open = function (url) {
    var fake = { closed: false, opener: null, close: function () { fake.closed = true; }, focus: function () {} };
    var loc = { assign: function (v) { if (v) go(new URL(v, document.baseURI)); }, replace: function (v) { loc.assign(v); } };
    Object.defineProperty(loc, 'href', { get: function () { return 'about:blank'; }, set: function (v) { loc.assign(v); } });
    fake.location = loc;
    if (url && url !== 'about:blank') setTimeout(function () { loc.assign(url); }, 0);
    return fake;
  };

  // ---------------------------------------------------------------- demo bar
  function buildBar() {
    var bar = document.createElement('div');
    bar.id = 'demo-bar';
    bar.setAttribute('role', 'region');
    document.documentElement.insertBefore(bar, document.body);
    bar.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('button[data-theme-toggle]')) { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); return; }
      var b = ev.target.closest && ev.target.closest('button[data-lang]');
      if (!b) return;
      setLang(b.getAttribute('data-lang'));
    });
    paintBar();
  }
  function paintBar() {
    var bar = document.getElementById('demo-bar');
    if (!bar) return;
    bar.setAttribute('lang', lang);
    bar.setAttribute('aria-label', tx('demo'));
    var langs = LANGS.map(function (l) {
      return '<button type="button" data-lang="' + l + '" lang="' + l + '" aria-pressed="' + (l === lang) + '">' + l.toUpperCase() + '</button>';
    }).join('');
    var th = tx('theme');
    var icons = '<svg class="ti-system" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>' +
      '<svg class="ti-light" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>' +
      '<svg class="ti-dark" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';
    bar.innerHTML = '<a class="demo-back" href="' + tx('home_href') + '"><span aria-hidden="true">‹&nbsp;</span><span class="long">' + tx('back') + '</span><span class="short">' + tx('home') + '</span></a>' +
      '<span class="demo-mid"><span class="demo-tag">' + tx('demo') + '</span> <span class="demo-sep" aria-hidden="true">·</span> ' +
      '<a href="' + tx('site') + '#install">' + tx('install') + ' ›</a></span>' +
      '<span class="demo-end"><span class="demo-langs" role="group" aria-label="' + tx('lang') + '">' + langs + '</span>' +
      '<button type="button" class="demo-theme" data-theme-toggle data-mode="' + theme + '" aria-label="' + th[theme] + '" title="' + th[theme] + '">' + icons + '</button></span>';
  }
  function setTheme(m, fromStorage) {
    if (THEMES.indexOf(m) < 0) return;
    theme = m;
    if (!fromStorage) { try { if (m === 'system') localStorage.removeItem('tp-theme'); else localStorage.setItem('tp-theme', m); } catch (_) { /* private mode */ } }
    if (m === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
    try { TP.settings.set({ appearance: m }); } catch (_) { /* not loaded yet: the seed above has it */ }
    var b = document.querySelector('#demo-bar [data-theme-toggle]');
    if (b) { var th = tx('theme'); b.setAttribute('data-mode', m); b.setAttribute('aria-label', th[m]); b.title = th[m]; }
  }
  window.addEventListener('storage', function (e) { if (e.key === 'tp-theme') setTheme(storedTheme(), true); });
  function setLang(l) {
    if (LANGS.indexOf(l) < 0 || l === lang) return;
    lang = l;
    document.documentElement.lang = l;
    paintBar();
    try { var q = new URLSearchParams(location.search); q.set('lang', l); history.replaceState(history.state, '', location.pathname + '?' + q + location.hash); } catch (_) { /* ignore */ }
    try { TP.settings.set({ language: l }); } catch (_) { /* not loaded yet */ }
    try { var f = document.querySelector('#demo-bar [data-lang="' + l + '"]'); if (f) f.focus(); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------- boot
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = qs(src); s.async = false;
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function getJson(p) { return realFetch(p, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); }); }
  function fail(e) {
    console.error('[Toledo+ demo]', e);
    var p = document.getElementById('demo-fallback');
    if (p) { p.hidden = false; p.textContent = tx('failed'); }
  }

  document.documentElement.lang = lang;
  if (!/^#\/home/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#/home');

  Promise.all([getJson(qs(new URL('manifest.json', base).href)), getJson(qs('data/portal.json')), getJson(qs('data/ultra.json')), getJson(qs('data/kuloket.json'))])
    .then(function (r) {
      manifest = r[0];
      router = M.create({ portal: r[1], ultra: r[2], kuloket: r[3] }, { version: manifest.version });
      var cs = (manifest.content_scripts || [])[0] || { js: [], css: [] };
      (cs.css || []).forEach(function (c) {
        var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(c, base).href; document.head.appendChild(l);
      });
      buildBar();
      // async=false: the browser fetches in parallel but executes in insertion (= manifest) order.
      return Promise.all(cs.js.map(function (f) { return loadScript(new URL(f, base).href); }));
    })
    .catch(fail);
})();
