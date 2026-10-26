/* Toledo+ — TP.shell: mounts the app shell in a shadow root, routes, renders views,
   search, theme, toasts/live region, the "deep bar" for non-wrapped pages and the classic-mode pill.
   Views register at load time with TP.shell.register(route, view); boot.js calls TP.shell.start(). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const esc = (s) => TP.util.esc(s);
  const t = (k, v) => TP.t(k, v);
  const icon = (n, o) => TP.ui.icon(n, o);

  const PORTAL = 'https://toledo.kuleuven.be';
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const PORTAL_HOME = PORTAL + '/portal/';
  const ROUTES = ['overview', 'courses', 'course', 'deadlines', 'agenda', 'announcements', 'kuloket', 'settings'];
  const ROUTE_ALIASES = { planning: 'agenda' }; // old links keep working
  const START_PAGES = ['overview', 'courses', 'deadlines', 'agenda'];
  const NAV = ['overview', 'courses', 'deadlines', 'agenda', 'announcements', 'kuloket'];
  const TABS = ['overview', 'courses', 'deadlines', 'agenda'];
  const OUTLINE = /^\/ultra\/courses\/(_\d+_\d+)\/outline\/?$/;
  const ULTRA_CID = /^\/ultra\/courses\/(_\d+_\d+)(\/|$)/;
  const CSS_FILES = ['ui.css', 'src/views/overview.css', 'src/views/deadlines.css', 'src/views/agenda.css',
    'src/views/announcements.css', 'src/views/courses.css', 'src/views/course.css', 'src/views/settings.css', 'src/views/kuloket.css'];

  const IS_MAC = (() => { try { return /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || ''); } catch (_) { return false; } })();
  const MOD = IS_MAC ? '⌘' : 'Ctrl ';

  const views = {};
  let origin = 'portal';
  let host = null, shadow = null, app = null;
  let deepHost = null, deepShadow = null;
  let mode = 'none';              // 'shell' | 'deep' | 'classic' | 'none'
  let current = null;             // { route, params, key, view, ctx, root, title, subtitle, actions }
  let started = false, firstView = true, renderSeq = 0;
  let searchQ = '';
  let refreshing = false;
  let lastPath = '';
  let titleObserver = null;

  const settings = () => TP.settings?.get?.() || TP.settings?.DEFAULTS || {};
  const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

  // ---------------- location → route ----------------
  // Portal URL scheme: '#/home?tplus=<route>[&id=<param>]'. The portal's AngularJS router rewrites
  // every unknown hash path (incl. our old '#/tplus/<route>') to '#/home', but keeps the query on
  // '#/home', so our route lives in that query. Plain '#/home' = the configured start page.
  const isHomeHash = (h) => !h || h === '#' || h === '#/' || /^#\/home(\/|\?|$)/.test(h);
  const LEGACY = /^#\/tplus\/([a-z]+)(?:\/([^?]*))?/;
  const isLegacyHash = (h) => /^#\/tplus(\/|$)/.test(h || '');
  function mkRoute(route, p) {
    if (!ROUTES.includes(route)) return null;
    const params = {};
    if (p) { if (route === 'course') params.luId = p; else params.id = p; }
    return { route, params };
  }
  function parseHash(h) {
    h = h || '';
    const legacy = LEGACY.exec(h);
    if (legacy) return mkRoute(legacy[1], legacy[2] ? safe(() => decodeURIComponent(legacy[2]), legacy[2]) : '');
    const m = /^#\/home\/?\?(.*)$/.exec(h);
    if (!m) return null;
    const q = safe(() => new URLSearchParams(m[1]), null);
    const route = q && q.get('tplus');
    return route ? mkRoute(route, q.get('id') || '') : null;
  }
  const startRoute = () => (START_PAGES.includes(settings().startPage) ? settings().startPage : 'overview');

  // Decide what to show for the current URL.
  function resolve() {
    const s = settings();
    const wrap = s.wrap || {};
    if (origin === 'portal') {
      const h = location.hash;
      const tp = parseHash(h);
      if (tp || isHomeHash(h) || isLegacyHash(h)) {
        const r = tp || { route: startRoute(), params: {} };
        return { mode: wrap.portal !== false ? 'shell' : 'classic', ...r };
      }
      return { mode: wrap.deepBar !== false ? 'deep' : 'none' };
    }
    const m = OUTLINE.exec(location.pathname);
    if (m) return { mode: wrap.courses !== false ? 'shell' : 'classic', route: 'course', params: { cid: m[1] } };
    return { mode: wrap.deepBar !== false ? 'deep' : 'none' };
  }

  // Synchronous early guess (before settings load) so the host page never flashes.
  function preflight() {
    origin = /ultra\.edu\.kuleuven\.cloud$/.test(location.hostname) ? 'ultra' : 'portal';
    // Before the portal's router boots (document_start), or it bounces the old form to '#/home'.
    safe(upgradeLegacyHash);
    const wraps = origin === 'portal'
      ? (isHomeHash(location.hash) || isLegacyHash(location.hash))
      : OUTLINE.test(location.pathname);
    if (wraps) document.documentElement.classList.add('tplus-on');
  }

  // ---------------- URLs + navigation ----------------
  function paramOf(params) {
    if (!params) return '';
    const v = params.id ?? params.luId ?? params.cid ?? params.param;
    return v != null && v !== '' ? '&id=' + encodeURIComponent(v) : '';
  }
  const hashFor = (route, params) => `#/home?tplus=${encodeURIComponent(route)}${paramOf(params)}`;

  function href(route, params = {}) {
    if (route === 'course') {
      if (params.cid) return `${ULTRA}/ultra/courses/${encodeURIComponent(params.cid)}/outline`;
      if (params.luId) {
        const c = safe(() => TP.data?.course?.(params.luId), null);
        let link = c?.link;
        if (!link) {
          const enr = safe(() => TP.data?.peek?.('enrollments'), null);
          link = Array.isArray(enr) ? enr.find((e) => e.learningUnitId === params.luId)?.link : null;
        }
        return link || PORTAL_HOME + hashFor('courses');
      }
      return PORTAL_HOME + hashFor('courses');
    }
    if (!ROUTES.includes(route)) route = 'overview';
    return PORTAL_HOME + hashFor(route, params);
  }

  function navigate(route, params = {}) {
    const inPlace = origin === 'portal' && route !== 'course' && ROUTES.includes(route);
    if (inPlace) {
      const h = hashFor(route, params);
      if (location.hash === h) { onLocation(true); return; }
      location.hash = h; // → hashchange → onLocation
      return;
    }
    location.assign(href(route, params));
  }

  // ---------------- registration ----------------
  function register(route, view) {
    if (!ROUTES.includes(route)) console.warn('[Toledo+] unknown route registered:', route);
    views[route] = view;
    if (started && current?.route === route && !current.view) onLocation(true);
  }

  // ---------------- styles ----------------
  const sheetCache = new Map();
  function getSheet(file) {
    if (!sheetCache.has(file)) {
      sheetCache.set(file, fetch(chrome.runtime.getURL(file))
        .then((r) => (r.ok ? r.text() : ''))
        .catch(() => '')
        .then((txt) => { const s = new CSSStyleSheet(); s.replaceSync(txt); return s; }));
    }
    return sheetCache.get(file);
  }
  // Constructable stylesheets (not subject to the page's CSP); fall back to <link> elements.
  async function styleRoot(root, files) {
    try {
      root.adoptedStyleSheets = await Promise.all(files.map(getSheet));
      return;
    } catch (_) { /* fall through */ }
    await Promise.all(files.map((f) => new Promise((res) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = chrome.runtime.getURL(f);
      l.onload = l.onerror = res;
      root.prepend(l);
      setTimeout(res, 1500);
    })));
  }

  // ---------------- theme ----------------
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  function themeVars() {
    const s = settings();
    const P = TP.util.PALETTE;
    const tint = P[s.accent] || P.blue;
    const U = TP.util;
    // Text-on-background variants: stricter of card and page backgrounds per theme.
    const textL = U.ensureContrast(tint, '#F2F2F7', 4.5, 'dark');
    const textD = U.ensureContrast(tint, '#2C2C2E', 4.5, 'light');
    // Filled controls: light tints keep the color with black text; others darken until white text passes.
    const blackOk = U.contrast('#000000', tint) >= 7;
    const fill = blackOk ? tint : U.ensureContrast(tint, '#FFFFFF', 4.5, 'dark');
    const onTint = blackOk ? '#000000' : '#FFFFFF';
    return { '--tint': tint, '--tint-text-l': textL, '--tint-text-d': textD, '--tint-fill': fill, '--on-tint': onTint };
  }
  const isDark = () => {
    const a = settings().appearance;
    return a === 'dark' || (a !== 'light' && mqDark.matches);
  };
  function applyTheme(el) {
    if (!el) return;
    const s = settings();
    el.dataset.appearance = ['light', 'dark'].includes(s.appearance) ? s.appearance : 'system';
    el.dataset.density = ['compact', 'standard', 'comfortable'].includes(s.density) ? s.density : 'standard';
    el.setAttribute('lang', TP.i18n.lang());
    for (const [k, v] of Object.entries(themeVars())) el.style.setProperty(k, v);
  }
  function applyThemeAll() {
    applyTheme(app);
    applyTheme(deepShadow?.querySelector('.tp-theme'));
    const html = document.documentElement;
    html.classList.toggle('tplus-dark', isDark());
    html.classList.toggle('tplus-light', !isDark());
  }
  try { mqDark.addEventListener('change', applyThemeAll); } catch (_) { /* old browsers */ }

  // ---------------- mount ----------------
  function whenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function mount() {
    if (host && host.isConnected) return;
    if (host) { document.body.prepend(host); return; } // the page removed us; put it back
    host = document.createElement('div');
    host.id = 'tplus-root';
    shadow = host.attachShadow({ mode: 'open' });
    app = document.createElement('div');
    app.className = 'tp-app tp-theme';
    app.hidden = true; // until styles are in
    shadow.appendChild(app);
    buildChrome();
    applyThemeAll();
    styleRoot(shadow, CSS_FILES).then(() => { app.hidden = false; });
    shadow.addEventListener('click', onShellClick);
    shadow.addEventListener('input', onShellInput);
    shadow.addEventListener('keydown', onShellKeydown);
    document.body.prepend(host);
  }

  // Static chrome (rebuilt on language change). The current view root is preserved.
  function buildChrome() {
    const keepRoot = current?.root || null;
    const collapsed = !!TP.state?.get?.()?.ui?.sidebarCollapsed;
    app.classList.toggle('sb-collapsed', collapsed);
    app.classList.toggle('sb-rail', isRail());
    app.innerHTML = `
<a class="tp-skip" href="#tp-main" data-shell="skip">${esc(t('shell.skip'))}</a>
<div class="tp-scrim" data-shell="scrim" hidden></div>
<nav class="tp-sidebar tp-glass" id="tp-sidebar" aria-label="${esc(t('nav.label'))}">
  <div class="tp-sb-brand">
    <a class="tp-brand" href="${esc(href('overview'))}" data-route="overview" title="Toledo+"><span class="tp-mark" aria-hidden="true">T+</span><span class="tp-brand-name">Toledo+</span></a>
  </div>
  <div class="tp-sb-scroll" data-shell-region="sb-main"></div>
  <div class="tp-sb-foot" data-shell-region="sb-foot"></div>
</nav>
<div class="tp-body">
  <header class="tp-toolbar tp-glass">
    <button type="button" class="tp-tb-btn tp-sb-toggle" data-shell="sidebar" aria-controls="tp-sidebar" aria-expanded="${!isRail()}" aria-label="${esc(t('shell.toggleSidebar'))}" title="${esc(t('shell.toggleSidebar'))} (${MOD}\\)">${icon('sidebar', { size: 20 })}</button>
    <div class="tp-tb-title" aria-hidden="true"></div>
    <div class="tp-tb-spacer"></div>
    <div class="tp-search" role="search">
      <label class="tp-search-field">
        ${icon('search', { size: 15, strokeWidth: 2.2 })}
        <span class="tp-sr">${esc(t('shell.searchLabel'))}</span>
        <input type="search" data-shell="search" autocomplete="off" spellcheck="false" enterkeyhint="search" value="${esc(searchQ)}">
      </label>
      <button type="button" class="tp-kbd" data-shell="palette" aria-haspopup="dialog" aria-label="${esc(t('palette.open'))} (${MOD}K)" title="${esc(t('palette.open'))} (${MOD}K)"><kbd>${MOD}K</kbd></button>
      <button type="button" class="tp-search-clear" data-shell="search-clear" aria-label="${esc(t('shell.searchClear'))}" hidden>${icon('xmark', { size: 13, strokeWidth: 2.4 })}</button>
    </div>
    <button type="button" class="tp-tb-btn tp-search-open" data-shell="search-open" aria-label="${esc(t('shell.searchOpen'))}">${icon('search', { size: 20 })}</button>
    <button type="button" class="tp-tb-btn tp-refresh" data-shell="refresh" aria-label="${esc(t('shell.refresh'))}" title="${esc(t('shell.refresh'))}">${icon('refresh', { size: 20 })}</button>
    <div class="tp-account">
      <button type="button" class="tp-tb-btn tp-avatar" data-shell="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="tp-account-menu" aria-label="${esc(t('shell.account'))}">${icon('person', { size: 20 })}<span class="tp-avatar-dot" hidden></span></button>
      <div class="tp-menu tp-glass" id="tp-account-menu" role="menu" aria-label="${esc(t('shell.account'))}" hidden></div>
    </div>
  </header>
  <main id="tp-main" class="tp-main" tabindex="-1">
    <div class="tp-head">
      <div class="tp-head-text">
        <h1 class="tp-large-title" tabindex="-1"></h1>
        <p class="tp-subtitle" hidden></p>
        <p class="tp-updated" hidden></p>
      </div>
      <div class="tp-head-actions"></div>
    </div>
    <div class="tp-view-wrap"></div>
    <div class="tp-noresults" hidden></div>
  </main>
</div>
<nav class="tp-tabbar tp-glass" aria-label="${esc(t('nav.tabs'))}" data-shell-region="tabbar"></nav>
<dialog class="tp-sheet tp-glass" aria-labelledby="tp-sheet-title">
  <div class="tp-sheet-head"><h2 id="tp-sheet-title">${esc(t('nav.more'))}</h2>
    <button type="button" class="tp-tb-btn" data-shell="sheet-close" aria-label="${esc(t('shell.close'))}">${icon('xmark', { size: 18 })}</button></div>
  <div class="tp-sheet-body" data-shell-region="sheet"></div>
</dialog>
<div class="tp-toast" aria-hidden="true"></div>
<div class="tp-live tp-sr" role="status" aria-live="polite" aria-atomic="true"></div>`;
    const wrap = app.querySelector('.tp-view-wrap');
    if (keepRoot) wrap.appendChild(keepRoot);
    if (titleObserver) titleObserver.disconnect();
    titleObserver = new IntersectionObserver(([e]) => {
      app.querySelector('.tp-toolbar')?.classList.toggle('tp-scrolled', !e.isIntersecting);
    }, { rootMargin: '-56px 0px 0px 0px' });
    titleObserver.observe(app.querySelector('.tp-large-title'));
    renderNav();
    renderMenu();
    updateSearchUi();
  }
  const $ = (sel) => app?.querySelector(sel);

  // ---------------- nav (sidebar, tab bar, sheet) ----------------
  function navCounts() {
    const c = { overview: '', deadlines: '', overdue: 0, announcements: '' };
    safe(() => {
      const feed = TP.data?.feed?.() || [];
      const n = feed.reduce((a, g) => a + (g.items?.length || 0), 0);
      if (n) c.overview = n;
    });
    safe(() => {
      const list = (TP.data?.deadlines?.({}) || []).filter((d) => !d.done);
      const now = Date.now();
      c.overdue = list.filter((d) => d.due < now).length;
      if (list.length) c.deadlines = list.length;
    });
    safe(() => {
      const n = (TP.data?.announcements?.({ filter: 'unread' }) || []).length;
      if (n) c.announcements = n;
    });
    return c;
  }

  const activeNav = () => {
    const r = current?.route;
    return r === 'course' ? 'courses' : r;
  };

  function navItem(route, counts) {
    const active = activeNav() === route;
    let trail = '';
    if (route === 'deadlines' && counts.overdue) {
      trail = TP.ui.badge(counts.overdue, { tone: 'red', label: t('shell.overdue', { n: counts.overdue }) });
    } else if (counts[route]) {
      const label = route === 'deadlines' ? t('shell.open', { n: counts[route] }) : t('shell.unread', { n: counts[route] });
      trail = `<span class="tp-sb-count"><span aria-hidden="true">${esc(counts[route] > 99 ? '99+' : counts[route])}</span><span class="tp-sr">${esc(label)}</span></span>`;
    }
    const tip = isRail() ? ` title="${esc(t('nav.' + route))}"` : '';
    return `<li><a class="tp-sb-item${active ? ' active' : ''}" href="${esc(href(route))}" data-route="${route}"${active ? ' aria-current="page"' : ''}${tip}>${icon(route, { size: 20 })}<span class="tp-sb-label">${esc(t('nav.' + route))}</span>${trail}</a></li>`;
  }

  // Rail: pinned courses as coloured circles with two initials ("Montage Technieken 1" → "MT").
  function initials(c) {
    const w = String(c.name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[\s\-_/]+/).filter((x) => /^[a-z]/i.test(x));
    const txt = (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || c.name || '?').slice(0, 2)).toUpperCase();
    const fg = safe(() => (TP.util.contrast('#FFFFFF', c.color) >= 4.5 ? '#FFFFFF' : '#000000'), '#FFFFFF');
    return `<span class="tp-sb-initials" aria-hidden="true" style="--c:${esc(TP.util.safeColor ? TP.util.safeColor(c.color) : c.color)};--fg:${fg}">${esc(txt)}</span>`;
  }

  function renderNav() {
    if (!app) return;
    const counts = navCounts();
    const main = app.querySelector('[data-shell-region="sb-main"]');
    const pinned = safe(() => (TP.data?.courses?.({}) || []).filter((c) => c.pinned), []);
    if (main) {
      main.innerHTML = `<ul class="tp-sb-list">${NAV.map((r) => navItem(r, counts)).join('')}</ul>
${pinned.length ? `<h2 class="tp-sb-heading" id="tp-sb-pinned">${esc(t('nav.pinned'))}</h2>
<ul class="tp-sb-list" aria-labelledby="tp-sb-pinned">${pinned.map((c) => `<li><a class="tp-sb-item tp-sb-course" href="${esc(href('course', { luId: c.luId }))}" title="${esc(c.name)}">${TP.ui.dot(c.color)}${initials(c)}<span class="tp-sb-label">${esc(c.name)}</span>${c.unread ? `<span class="tp-sb-count"><span aria-hidden="true">${esc(c.unread)}</span><span class="tp-sr">${esc(t('shell.unread', { n: c.unread }))}</span></span>` : ''}</a></li>`).join('')}</ul>` : ''}`;
    }
    const foot = app.querySelector('[data-shell-region="sb-foot"]');
    if (foot) foot.innerHTML = `<ul class="tp-sb-list">${navItem('settings', counts)}</ul>`;

    const tabbar = app.querySelector('[data-shell-region="tabbar"]');
    if (tabbar) {
      const act = activeNav();
      const moreActive = act === 'announcements' || act === 'settings';
      tabbar.innerHTML = `<ul class="tp-tabs">${TABS.map((r) => {
        const a = act === r;
        const dotHtml = r === 'deadlines' && counts.overdue ? `<span class="tp-tab-dot" aria-hidden="true"></span><span class="tp-sr">${esc(t('shell.overdue', { n: counts.overdue }))}</span>` : '';
        return `<li><a class="tp-tab${a ? ' active' : ''}" href="${esc(href(r))}" data-route="${r}"${a ? ' aria-current="page"' : ''}>${icon(r, { size: 22 })}<span class="tp-tab-label">${esc(t('nav.' + r))}</span>${dotHtml}</a></li>`;
      }).join('')}<li><button type="button" class="tp-tab${moreActive ? ' active' : ''}" data-shell="more" aria-haspopup="dialog"${moreActive ? ' aria-current="page"' : ''}>${icon('ellipsis', { size: 22 })}<span class="tp-tab-label">${esc(t('nav.more'))}</span></button></li></ul>`;
    }
    const sheet = app.querySelector('[data-shell-region="sheet"]');
    if (sheet) {
      sheet.innerHTML = TP.ui.group(TP.ui.row({
        action: 'palette', attrs: { 'data-shell': 'palette', 'aria-haspopup': 'dialog' },
        leading: `<span class="tp-tile">${icon('search', { size: 17 })}</span>`, title: esc(t('palette.open')),
      })) + TP.ui.group(['announcements', 'settings'].map((r) => TP.ui.row({
        href: href(r), attrs: { 'data-route': r, 'aria-current': activeNav() === r ? 'page' : null },
        leading: `<span class="tp-tile">${icon(r, { size: 17 })}</span>`, title: esc(t('nav.' + r)),
        trailing: r === 'announcements' && counts.announcements ? `<span class="tp-sb-count">${esc(counts.announcements)}</span>` : '', chevron: true,
      })).join(''));
    }
  }

  function mailCount() {
    const m = safe(() => TP.data?.peek?.('mail'), null);
    const n = typeof m === 'number' ? m : Number(m?.value);
    return Number.isFinite(n) ? n : 0;
  }

  function renderMenu() {
    const menu = $('.tp-menu');
    if (!menu) return;
    const mail = mailCount();
    const notif = safe(() => TP.data?.link?.('NOTIFICATION-SETTINGS-ULTRA'), null);
    const logout = safe(() => TP.data?.link?.('LOGOUT'), null) || PORTAL + '/Shibboleth.sso/Logout';
    const item = (inner, attrs) => `<a class="tp-menu-item" role="menuitem" tabindex="-1"${attrs}>${inner}</a>`;
    menu.innerHTML = `
${item(`${icon('mail')}<span class="tp-menu-label">${esc(t('shell.mail'))}</span>${mail ? TP.ui.badge(mail, { tone: 'red', label: t('shell.mailUnread', { n: mail }) }) : ''}${icon('external', { size: 13, cls: 'tp-menu-ext' })}`,
    ` href="https://outlook.office.com/mail/" target="_blank" rel="noopener" aria-description="${esc(t('common.newTab'))}"`)}
${notif ? item(`${icon('bell')}<span class="tp-menu-label">${esc(t('shell.notifSettings'))}</span>`, ` href="${esc(notif)}"`) : ''}
${item(`${icon('settings')}<span class="tp-menu-label">${esc(t('nav.settings'))}</span>`, ` href="${esc(href('settings'))}" data-route="settings"`)}
<button type="button" class="tp-menu-item" role="menuitem" tabindex="-1" data-shell="classic">${icon('classic')}<span class="tp-menu-label">${esc(t('shell.classic'))}<small>${esc(t('shell.classicHint'))}</small></span></button>
<div class="tp-menu-sep" role="separator"></div>
${item(`${icon('logout')}<span class="tp-menu-label">${esc(t('shell.logout'))}</span>`, ` href="${esc(logout)}"`)}`;
    const dot = $('.tp-avatar-dot');
    if (dot) dot.hidden = !mail;
    const btn = $('.tp-avatar');
    if (btn) btn.setAttribute('aria-label', mail ? `${t('shell.account')}, ${t('shell.mailUnread', { n: mail })}` : t('shell.account'));
  }

  // ---------------- menu / sheet / sidebar behaviour ----------------
  function openMenu(focusFirst = true) {
    const menu = $('.tp-menu'), btn = $('.tp-avatar');
    if (!menu) return;
    renderMenu();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    if (focusFirst) menu.querySelector('.tp-menu-item')?.focus();
  }
  function closeMenu(returnFocus) {
    const menu = $('.tp-menu'), btn = $('.tp-avatar');
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
    return true;
  }
  document.addEventListener('pointerdown', (ev) => {
    if (!app) return;
    const acct = $('.tp-account');
    if (acct && !ev.composedPath().includes(acct)) closeMenu(false);
  }, true);

  function openSheet() {
    const d = $('.tp-sheet');
    if (d && !d.open) { renderNav(); d.showModal(); }
  }
  function closeSheet() { const d = $('.tp-sheet'); if (d?.open) { d.close(); return true; } return false; }

  // Sidebar modes (≥700px): expanded (240px) or an icon-only rail (~64px).
  //  ≥900px: the student's choice (state.ui.sidebarCollapsed), toggled with ⌘\ or the toolbar button.
  //  700–899px: the rail by default; toggling expands the full sidebar as an overlay (scrim, Esc closes).
  //  <700px: tab bar (sidebar hidden by CSS).
  const mqWide = window.matchMedia('(min-width: 900px)');
  const wide = () => mqWide.matches;
  function isRail() {
    if (!app) return false;
    return wide() ? app.classList.contains('sb-collapsed') : !app.classList.contains('sb-open');
  }
  function syncSidebar() {
    if (!app) return;
    const rail = isRail();
    const changed = app.classList.contains('sb-rail') !== rail;
    app.classList.toggle('sb-rail', rail);
    $('.tp-sb-toggle')?.setAttribute('aria-expanded', String(!rail));
    if (changed) renderNav();
  }
  function toggleSidebar() {
    if (!app) return;
    if (wide()) {
      const c = !app.classList.contains('sb-collapsed');
      app.classList.toggle('sb-collapsed', c);
      safe(() => TP.state?.set?.({ ui: { sidebarCollapsed: c } }));
      syncSidebar();
      announce(t(c ? 'shell.sidebarRail' : 'shell.sidebarExpanded'));
    } else {
      setOverlay(!app.classList.contains('sb-open'));
    }
  }
  function setOverlay(open) {
    app.classList.toggle('sb-open', open);
    const scrim = $('.tp-scrim');
    if (scrim) scrim.hidden = !open;
    syncSidebar();
    if (open) $('.tp-sidebar .tp-sb-item')?.focus();
  }
  safe(() => mqWide.addEventListener('change', () => { if (app?.classList.contains('sb-open')) setOverlay(false); else syncSidebar(); }));

  // ---------------- toast + live region ----------------
  let toastTimer = null;
  function toast(text) {
    const el = $('.tp-toast') || deepShadow?.querySelector('.tp-toast');
    announce(text);
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }
  function announce(text) {
    const live = $('.tp-live');
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = String(text ?? ''); }, 60);
  }

  // ---------------- head (title/subtitle/actions/updated) ----------------
  function viewTitle() {
    if (!current) return '';
    if (current.title) return current.title;
    const v = current.view;
    return safe(() => (typeof v?.title === 'function' ? v.title(current.ctx) : v?.title), '') || t('nav.' + current.route);
  }
  function updateHead() {
    if (!app || !current) return;
    const title = viewTitle();
    const h1 = $('.tp-large-title');
    if (h1 && h1.textContent !== title) h1.textContent = title;
    const tb = $('.tp-tb-title');
    if (tb) tb.textContent = title;
    const sub = $('.tp-subtitle');
    if (sub) { sub.innerHTML = current.subtitle || ''; sub.hidden = !current.subtitle; }
    const up = $('.tp-updated');
    const ms = safe(() => TP.data?.lastUpdated?.(), null);
    if (up) {
      // Non-blocking error state: keep cached data visible, offer a retry. On Ultra the portal data
      // arrives via the best-effort relay and isn't the view's primary data: stay silent there.
      const failed = origin === 'portal' && ['enrollments', 'events'].some((k) => safe(() => TP.data?.status?.(k)?.error, null));
      // Views can opt out of the "Bijgewerkt hh:mm" line (view.showUpdated === false, e.g. settings);
      // a load error is still shown.
      const showStamp = current.view?.showUpdated !== false;
      const stamp = ms && showStamp ? esc(t('common.updated', { time: TP.fmt.time(ms) })) : '';
      up.innerHTML = failed
        ? `${stamp ? stamp + ' · ' : ''}<span class="tp-updated-err">${icon('warning', { size: 13 })}${esc(t('shell.loadError'))}</span> · <button type="button" class="tp-link-btn" data-shell="refresh">${esc(t('common.retry'))}</button>`
        : stamp;
      // Views may already show the timestamp in their subtitle; don't repeat it.
      const dup = !failed && stamp && $('.tp-subtitle')?.textContent.includes(TP.fmt.time(ms));
      up.hidden = (!failed && !stamp) || !!dup;
    }
    const acts = $('.tp-head-actions');
    if (acts) {
      acts.innerHTML = (current.actions || []).map((a, i) =>
        TP.ui.button(a.label, { icon: a.icon, kind: 'tinted', attrs: { 'data-shell': 'view-action', 'data-index': i, 'data-id': a.id } })).join('');
    }
    if (mode === 'shell') document.title = `${title} · Toledo+`;
  }

  // ---------------- search ----------------
  function placeholder() {
    const v = current?.view;
    if (!v?.searchPlaceholder) return '';
    return safe(() => (typeof v.searchPlaceholder === 'function' ? v.searchPlaceholder(current.ctx) : v.searchPlaceholder), '') || t('shell.search');
  }
  function updateSearchUi() {
    if (!app) return;
    const ph = placeholder();
    const box = $('.tp-search');
    const open = $('.tp-search-open');
    const input = $('[data-shell="search"]');
    if (box) box.hidden = !ph;
    if (open) open.hidden = !ph;
    if (input) { input.placeholder = ph || t('shell.search'); if (input.value !== searchQ) input.value = searchQ; }
    const clear = $('.tp-search-clear');
    if (clear) clear.hidden = !searchQ;
    const kbd = $('.tp-kbd');
    if (kbd) kbd.hidden = !!searchQ;
  }

  function applySearch() {
    if (!current?.root) return;
    const q = searchQ;
    const nores = $('.tp-noresults');
    if (current.view?.onSearch) {
      safe(() => current.view.onSearch(current.ctx, q));
      if (nores) nores.hidden = true;
      return;
    }
    const n = defaultFilter(current.root, q);
    if (nores) {
      nores.hidden = !q || n > 0;
      nores.innerHTML = q && n === 0 ? TP.ui.noResults(q) : '';
    }
    if (q) announceResults(n);
  }
  const announceResults = TP.util.debounce((n) => announce(n ? t('shell.results', { n }) : t('common.noResults', { q: searchQ })), 700);

  // Default filter: hide [data-q] that don't match (a matching ancestor or descendant keeps it),
  // open disclosures that contain matches, hide sections/groups left empty. Returns visible match count.
  function defaultFilter(root, q) {
    const els = [...root.querySelectorAll('[data-q]')];
    root.querySelectorAll('[data-tp-hidden]').forEach((el) => { el.hidden = false; el.removeAttribute('data-tp-hidden'); });
    root.querySelectorAll('details[data-tp-sopen]').forEach((d) => { d.open = false; d.removeAttribute('data-tp-sopen'); });
    if (!q) return els.length;
    const matched = new Set(els.filter((el) => (el.dataset.q || '').includes(q)));
    const keep = new Set();
    for (const m of matched) {
      keep.add(m);
      for (let p = m.parentElement; p && p !== root; p = p.parentElement) {
        if (p.hasAttribute('data-q')) keep.add(p);
        if (p.tagName === 'DETAILS' && !p.open) { p.open = true; p.setAttribute('data-tp-sopen', ''); }
      }
    }
    for (const el of els) {
      if (keep.has(el)) continue;
      let anc = false;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (matched.has(p)) { anc = true; break; }
      if (!anc) { el.hidden = true; el.setAttribute('data-tp-hidden', ''); }
    }
    // Containers that had searchable children but now show none.
    root.querySelectorAll('section, .tp-group, .tp-section').forEach((box) => {
      const rows = box.querySelectorAll('[data-q]');
      if (rows.length && ![...rows].some((r) => !r.hidden && !r.closest('[data-tp-hidden]'))) { box.hidden = true; box.setAttribute('data-tp-hidden', ''); }
    });
    return matched.size;
  }

  const runSearch = TP.util.debounce(() => applySearch(), 90);
  function setSearch(q, immediate) {
    searchQ = String(q || '').trim().toLowerCase();
    updateSearchUi();
    if (immediate) applySearch(); else runSearch();
  }
  function focusSearch() {
    if (!placeholder()) return;
    $('.tp-toolbar')?.classList.add('tp-search-active');
    const input = $('[data-shell="search"]');
    input?.focus();
    input?.select();
  }

  // ---------------- view rendering ----------------
  function makeCtx(route, params, root) {
    const ctx = {
      root, params, route, origin,
      setActions(list) { if (current?.ctx === ctx) { current.actions = Array.isArray(list) ? list : []; updateHead(); } },
      setTitle(text) { if (current?.ctx === ctx) { current.title = text == null ? '' : String(text); updateHead(); } },
      setSubtitle(html) { if (current?.ctx === ctx) { current.subtitle = html == null ? '' : String(html); updateHead(); } },
      navigate: (r, p) => navigate(r, p),
      href: (r, p) => href(r, p),
      get query() { return searchQ; },
    };
    return ctx;
  }

  function captureFocus() {
    const a = shadow?.activeElement;
    if (!a || !current?.root?.contains(a)) return null;
    let sel = null;
    if (a.id) sel = '#' + CSS.escape(a.id);
    else if (a.name) sel = `[name="${CSS.escape(a.name)}"]` + (a.type === 'radio' ? `[value="${CSS.escape(a.value)}"]` : '');
    else if (a.dataset.action) sel = `[data-action="${CSS.escape(a.dataset.action)}"]` + (a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : '');
    if (!sel) return null;
    return { sel, start: safe(() => a.selectionStart, null), end: safe(() => a.selectionEnd, null) };
  }
  function restoreFocus(f) {
    if (!f || !current?.root) return;
    const el = safe(() => current.root.querySelector(f.sel), null);
    if (!el || el === shadow.activeElement) return;
    el.focus({ preventScroll: true });
    if (f.start != null) safe(() => el.setSelectionRange(f.start, f.end));
  }

  async function renderView() {
    const cur = current;
    if (!cur || mode !== 'shell') return;
    const seq = ++renderSeq;
    if (!cur.view) {
      cur.root.innerHTML = TP.ui.group(TP.ui.empty(t('shell.viewMissing'))) +
        `<p class="tp-center">${TP.ui.button(t('shell.toOverview'), { kind: 'tinted', attrs: { href: href('overview'), 'data-route': 'overview' } })}</p>`;
      updateHead();
      return;
    }
    const focus = safe(captureFocus, null);
    try {
      await cur.view.render(cur.ctx);
    } catch (e) {
      console.warn('[Toledo+] render failed', cur.route, e);
      if (cur === current) cur.root.innerHTML = TP.ui.group(TP.ui.errorRow(t('shell.renderError'), 'tp-retry-view'));
    }
    if (seq !== renderSeq || cur !== current) return;
    updateHead();
    restoreFocus(focus);
    if (searchQ) applySearch();
  }
  // Debounced full refresh of nav + current view, with a guard against render→change→render loops.
  let burst = { at: 0, n: 0, warned: false };
  const rerender = TP.util.debounce(() => {
    const now = Date.now();
    if (now - burst.at > 2000) burst = { at: now, n: 0, warned: burst.warned };
    if (++burst.n > 12) {
      if (!burst.warned) { console.warn('[Toledo+] rerender loop detected; throttling'); burst.warned = true; }
      return;
    }
    renderNav(); renderMenu(); updateHead(); renderView();
  }, 60);

  function switchView(route, params) {
    if (current?.view?.destroy) safe(() => current.view.destroy(current.ctx));
    const root = document.createElement('div');
    root.className = 'tp-view';
    root.dataset.route = route;
    const wrap = $('.tp-view-wrap');
    wrap.replaceChildren(root);
    const view = views[route] || null;
    current = { route, params, key: route + JSON.stringify(params || {}), view, root, title: '', subtitle: '', actions: [] };
    current.ctx = makeCtx(route, params, root);
    searchQ = '';
    $('.tp-toolbar')?.classList.remove('tp-search-active');
    const nores = $('.tp-noresults');
    if (nores) nores.hidden = true;
    if (app.classList.contains('sb-open')) setOverlay(false);
    closeMenu(false);
    closeSheet();
    updateSearchUi();
    renderNav();
    updateHead();
    renderView();
    if (!firstView) {
      window.scrollTo(0, 0);
      $('.tp-large-title')?.focus({ preventScroll: true });
      announce(t('shell.navigated', { title: viewTitle() }));
    }
    firstView = false;
  }

  // ---------------- classic pill ----------------
  function setPill(show) {
    whenBody(() => {
      let b = document.getElementById('tplus-switch');
      if (!show) { b?.remove(); return; }
      if (!b) {
        b = document.createElement('button');
        b.id = 'tplus-switch';
        b.type = 'button';
        if (origin === 'ultra') b.className = 'left';
        b.addEventListener('click', () => {
          safe(() => TP.settings.set({ wrap: origin === 'ultra' ? { courses: true } : { portal: true } }));
        });
        document.body.appendChild(b);
      }
      b.textContent = t('shell.pill');
      b.title = t('shell.pillTitle');
      b.classList.toggle('dark', isDark());
    });
  }

  // ---------------- deep bar ----------------
  const courseNames = new Map();
  async function deepCourseName(cid) {
    if (courseNames.has(cid)) return courseNames.get(cid);
    let name = '';
    try {
      const c = await TP.net?.json?.(TP.util.abs(`/learn/api/public/v3/courses/${encodeURIComponent(cid)}`));
      name = TP.util.courseName(c?.name || '');
      if (c?.courseId) {
        const local = safe(() => TP.data?.course?.(c.courseId), null);
        if (local?.name) name = local.name;
      }
    } catch (_) { /* best effort */ }
    courseNames.set(cid, name);
    return name;
  }

  function renderDeep() {
    whenBody(() => {
      if (!deepHost) {
        deepHost = document.createElement('div');
        deepHost.id = 'tplus-deep';
        deepShadow = deepHost.attachShadow({ mode: 'open' });
        const root = document.createElement('div');
        root.className = 'tp-theme tp-deep-root';
        root.hidden = true;
        deepShadow.appendChild(root);
        styleRoot(deepShadow, ['ui.css']).then(() => { root.hidden = false; });
      }
      if (!deepHost.isConnected) document.documentElement.appendChild(deepHost);
      const root = deepShadow.querySelector('.tp-deep-root');
      applyTheme(root);
      const cid = origin === 'ultra' ? (ULTRA_CID.exec(location.pathname) || [])[1] : null;
      const known = cid ? courseNames.get(cid) : '';
      const backLabel = known || t('deep.course');
      root.innerHTML = `<nav class="tp-deep tp-glass" aria-label="${esc(t('deep.label'))}">
  <a class="tp-deep-mark" href="${esc(href('overview'))}" aria-label="${esc(t('deep.home'))}"><span class="tp-mark" aria-hidden="true">T+</span><span class="tp-deep-name">Toledo+</span></a>
  ${cid ? `<a class="tp-deep-back" href="${esc(href('course', { cid }))}">${icon('chevronLeft', { size: 16, strokeWidth: 2.4 })}<span class="tp-deep-back-label">${esc(backLabel)}</span><span class="tp-sr">${esc(t('deep.back', { course: backLabel }))}</span></a>` : ''}
  <span class="tp-deep-spacer"></span>
  <a class="tp-deep-link" href="${esc(href('deadlines'))}">${icon('deadlines', { size: 16 })}<span>${esc(t('deep.deadlines'))}</span></a>
  <a class="tp-deep-link" href="${esc(href('overview'))}">${icon('overview', { size: 16 })}<span>${esc(t('deep.overview'))}</span></a>
</nav><div class="tp-toast" aria-hidden="true"></div>`;
      if (cid && !courseNames.has(cid)) {
        deepCourseName(cid).then((name) => { if (name && mode === 'deep') renderDeep(); });
      }
    });
  }
  function removeDeep() { deepHost?.remove(); }

  // ---------------- apply location ----------------
  function onLocation(force) {
    if (!started) return;
    const html = document.documentElement;
    const r = resolve();
    const prevMode = mode;
    mode = r.mode;
    html.classList.toggle('tplus-on', mode === 'shell');
    html.classList.toggle('tplus-deep', mode === 'deep');
    setPill(mode === 'classic');
    if (mode === 'deep') renderDeep(); else removeDeep();
    if (mode !== 'shell') return;
    backgroundRefresh();
    whenBody(() => {
      mount();
      const key = r.route + JSON.stringify(r.params || {});
      if (!current || current.key !== key || (force && !current.view && views[r.route])) switchView(r.route, r.params);
      else if (prevMode !== 'shell' || force) { renderNav(); updateHead(); renderView(); }
    });
  }

  // Old '#/tplus/<route>[/<p>]' links (bookmarks, v1.0 builds) → the form the portal router keeps.
  function upgradeLegacyHash() {
    if (origin !== 'portal' || !isLegacyHash(location.hash)) return;
    const r = parseHash(location.hash);
    const h = r ? hashFor(r.route, r.params) : '#/home';
    history.replaceState(history.state, '', location.pathname + location.search + h);
  }

  // Both popstate and hashchange fire for one hash navigation; onLocation is idempotent.
  function onHashChange() {
    upgradeLegacyHash();
    onLocation();
  }

  // ---------------- events ----------------
  const plainClick = (ev) => ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;

  function onShellClick(ev) {
    if (ev.target === $('.tp-sheet')) { closeSheet(); return; } // backdrop click
    if (ev.target.closest?.('[data-action="tp-retry-view"]')) { renderView(); return; } // render-error row
    const el = ev.target.closest?.('[data-shell], a[data-route], a[href]');
    if (!el) return;
    const act = el.dataset?.shell;
    if (act) {
      switch (act) {
        case 'skip': ev.preventDefault(); $('#tp-main')?.focus(); return;
        case 'scrim': setOverlay(false); return;
        case 'sidebar': toggleSidebar(); return;
        case 'search-open': focusSearch(); return;
        case 'palette': { const fromSheet = !!el.closest('.tp-sheet'); closeSheet(); openPalette(fromSheet ? $('[data-shell="more"]') : el); return; }
        case 'search-clear': setSearch('', true); $('[data-shell="search"]')?.focus(); return;
        case 'refresh': doRefresh(); return;
        case 'menu': { const m = $('.tp-menu'); if (m?.hidden) openMenu(ev.detail === 0); else closeMenu(false); return; }
        case 'classic':
          closeMenu(false);
          safe(() => TP.settings.set({ wrap: origin === 'ultra' ? { courses: false } : { portal: false } }));
          return;
        case 'more': openSheet(); return;
        case 'sheet-close': closeSheet(); return;
        case 'view-action': {
          const a = current?.actions?.[Number(el.dataset.index)];
          if (a?.onClick) Promise.resolve().then(() => a.onClick(ev, current.ctx)).catch((e) => console.warn('[Toledo+] action', e));
          return;
        }
        default: break;
      }
    }
    // Internal links: navigate in place when possible (keeps modifier-clicks / new tabs working).
    if (el.tagName === 'A' && !ev.defaultPrevented && plainClick(ev) && !el.target) {
      if (el.dataset.route && origin === 'portal' && el.dataset.route !== 'course') {
        ev.preventDefault();
        closeMenu(false); closeSheet();
        navigate(el.dataset.route);
        return;
      }
      const u = safe(() => new URL(el.href), null);
      if (u && origin === 'portal' && u.origin === location.origin && u.pathname === location.pathname && parseHash(u.hash)) {
        ev.preventDefault();
        const p = parseHash(u.hash);
        closeMenu(false); closeSheet();
        navigate(p.route, p.params);
      } else if (el.closest('.tp-menu, .tp-sheet')) {
        closeMenu(false); closeSheet();
      }
    }
  }

  function onShellInput(ev) {
    if (ev.target?.dataset?.shell === 'search') setSearch(ev.target.value);
  }

  function onShellKeydown(ev) {
    // Roving focus inside the account menu.
    const menu = $('.tp-menu');
    if (menu && !menu.hidden && menu.contains(ev.target)) {
      const items = [...menu.querySelectorAll('.tp-menu-item')];
      const i = items.indexOf(ev.target);
      const go = (k) => { ev.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
      if (ev.key === 'ArrowDown') return go(i + 1);
      if (ev.key === 'ArrowUp') return go(i - 1);
      if (ev.key === 'Home') return go(0);
      if (ev.key === 'End') return go(items.length - 1);
      if (ev.key === 'Tab') { closeMenu(false); return; }
    }
    if (ev.target?.dataset?.shell === 'menu' && (ev.key === 'ArrowDown' || ev.key === 'Enter' || ev.key === ' ')) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); openMenu(true); }
    }
    if (ev.target?.dataset?.shell === 'search' && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      if (searchQ || ev.target.value) setSearch('', true);
      else { ev.target.blur(); $('.tp-toolbar')?.classList.remove('tp-search-active'); }
    }
  }

  // ⌘K palette (src/core/palette.js); falls back to the in-view search field.
  function openPalette(opener) {
    if (TP.palette?.open) { closeMenu(false); TP.palette.open({ opener: opener || shadow?.activeElement || null }); }
    else focusSearch();
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  // Global shortcuts (only while the shell is visible).
  function onWindowKey(ev) {
    if (mode !== 'shell' || !app) return;
    const target = ev.composedPath?.()[0] || ev.target;
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && !ev.altKey && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); ev.stopPropagation(); openPalette(); return; }
    if (safe(() => TP.palette?.isOpen?.(), false)) return; // the palette handles its own keys
    if (mod && ev.key === '\\') { ev.preventDefault(); toggleSidebar(); return; }
    if (ev.key === '/' && !mod && !ev.altKey && !isEditable(target)) { ev.preventDefault(); openPalette(); return; }
    if (ev.key === 'Escape') {
      if (closeMenu(true)) { ev.preventDefault(); return; }
      if (app.classList.contains('sb-open')) { ev.preventDefault(); setOverlay(false); $('.tp-sb-toggle')?.focus(); }
    }
  }

  // Stale-while-revalidate: views render from cache immediately; refresh silently when stale.
  let bgAt = 0;
  function backgroundRefresh() {
    if (refreshing || !TP.data?.refresh) return;
    const last = safe(() => TP.data.lastUpdated?.(), null) || 0;
    const now = Date.now();
    if (now - last < 60000 || now - bgAt < 60000) return;
    bgAt = now;
    refreshing = true;
    $('.tp-refresh')?.classList.add('spinning');
    Promise.resolve().then(() => TP.data.refresh())
      .catch((e) => console.warn('[Toledo+] background refresh failed', e))
      .finally(() => { refreshing = false; $('.tp-refresh')?.classList.remove('spinning'); rerender(); });
  }

  async function doRefresh() {
    if (refreshing || !TP.data?.refresh) return;
    refreshing = true;
    const btn = $('.tp-refresh');
    btn?.classList.add('spinning');
    btn?.setAttribute('aria-busy', 'true');
    announce(t('shell.refreshing'));
    const before = navCounts().overview || 0;
    try {
      await TP.data.refresh();
      const after = navCounts().overview || 0;
      const diff = Math.max(0, after - before);
      toast(diff ? t('shell.refreshedNew', { n: diff }) : `${t('shell.refreshed')} ${TP.fmt.time(Date.now())}`);
    } catch (e) {
      console.warn('[Toledo+] refresh failed', e);
      toast(t('shell.loadError'));
    } finally {
      refreshing = false;
      const b = $('.tp-refresh');
      b?.classList.remove('spinning');
      b?.removeAttribute('aria-busy');
      rerender();
    }
  }

  // ---------------- start ----------------
  function start() {
    if (started) return;
    started = true;
    origin = /ultra\.edu\.kuleuven\.cloud$/.test(location.hostname) ? 'ultra' : 'portal';
    upgradeLegacyHash();

    window.addEventListener('keydown', onWindowKey, true);

    // Settings → theme, chrome, current view.
    safe(() => TP.settings.subscribe((s, keys = []) => {
      applyThemeAll();
      if (keys.includes('wrap') || keys.includes('startPage')) { onLocation(true); }
      if (keys.includes('language')) {
        if (app) buildChrome();
        if (mode === 'deep') renderDeep();
        setPill(mode === 'classic');
      }
      if (mode === 'shell') rerender();
    }));
    safe(() => TP.state?.subscribe?.((st, keys = []) => {
      // These keys are written during renders/interaction inside a view; reacting to them would loop or reset UI.
      if (mode === 'shell' && keys.some((k) => !['ui', 'cache', 'visits', 'openFolders', 'recent', 'focus'].includes(k))) rerender();
    }));
    safe(() => TP.data?.on?.('change', () => { if (mode === 'shell') rerender(); }));
    let lastErrToast = 0;
    safe(() => TP.data?.on?.('error', () => {
      if (mode !== 'shell') return;
      rerender();
      if (origin === 'portal' && !refreshing && Date.now() - lastErrToast > 60000) { lastErrToast = Date.now(); toast(t('shell.loadError')); }
    }));

    if (origin === 'portal') {
      window.addEventListener('hashchange', onHashChange);
      window.addEventListener('popstate', onHashChange);
      onLocation();
    } else {
      lastPath = location.pathname;
      onLocation();
      // Ultra routes client-side: follow URL changes and re-attach if the page drops our host.
      setInterval(() => {
        if (location.pathname !== lastPath) { lastPath = location.pathname; onLocation(); return; }
        if (mode === 'shell' && host && !host.isConnected) whenBody(() => document.body.prepend(host));
        if (mode === 'deep' && deepHost && !deepHost.isConnected) document.documentElement.appendChild(deepHost);
      }, 400);
    }
  }

  TP.shell = {
    CSS: CSS_FILES, ROUTES,
    register, navigate, href, toast, announce,
    rerender: () => rerender(),
    start, preflight,
    get route() { return current ? { route: current.route, params: current.params } : null; },
    get origin() { return origin; },
    get app() { return mode === 'shell' ? app : null; },
    get mod() { return MOD; },
    isRail: () => isRail(),
    _views: views,
  };
})();
