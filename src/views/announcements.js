/* Toledo+ — Announcements view (course announcements + Ad Valvas) and the announcement sheet (TP.annSheet).
   Every announcement row in Toledo+ (this view, the overview, the course page, ⌘K) opens TP.annSheet: the shell's
   detail sheet with the full text, prev/next through the list it came from, "open in Ultra/Ad Valvas" and read state. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);
  const VA = () => TP.viewsA;
  const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };

  /* ------------------------------------------------------------------ */
  /* TP.annSheet                                                          */
  /* ------------------------------------------------------------------ */
  // Item = { key, kind:'course'|'school', title, source, color, author, date, url, event|null, html|null, cid, aid, read }
  const isSchool = (e) => !!e && (e.subType === 'advalvas' || e.type === 'advalvas');

  /** Portal announcement event → sheet item. */
  function fromEvent(e) {
    const school = isSchool(e);
    const course = !school && e.sourceId ? safe(() => TP.data.course(e.sourceId), null) : null;
    return {
      key: String(e.id),
      kind: school ? 'school' : 'course',
      title: e.title || '',
      source: school ? t('announcements.school') : (course ? course.name : TP.util.courseName(e.source || '')),
      color: school ? 'var(--label-3)' : (course ? course.color : safe(() => TP.util.colorForIndex(e.color), null)),
      author: e.author || '',
      date: VA() ? VA().ms(e.date) : Number(e.date) || 0,
      url: e.url ? TP.util.abs(e.url) : null,
      event: e,
      html: null,
      read: !!e.read,
    };
  }

  /** Ultra REST announcement of a course ({id, title, body, created}) → sheet item (matched to its portal event when known). */
  function fromUltra(a, c = {}) {
    const ms = VA() ? VA().ms(a.created) : 0;
    const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const ev = safe(() => (TP.data.announcements({ filter: 'all' }) || []).find((e) => !isSchool(e) && (
      (TP.data.annIds && TP.data.annIds(e).aid === a.id) || (c.luId && e.sourceId === c.luId && norm(e.title) === norm(a.title)))), null);
    const url = `${TP.net && TP.net.ULTRA || 'https://ultra.edu.kuleuven.cloud'}/ultra/courses/${encodeURIComponent(c.cid)}/announcements/announcement-detail?courseId=${encodeURIComponent(c.cid)}&announcementId=${encodeURIComponent(a.id)}`;
    return {
      key: ev ? String(ev.id) : 'cv:' + a.id,
      kind: 'course',
      title: a.title || '',
      source: c.name || '',
      color: c.color || null,
      author: ev ? ev.author || '' : '',
      date: ms,
      url: ev && ev.url ? TP.util.abs(ev.url) : url,
      event: ev,
      html: a.body || '',
      cid: c.cid, aid: a.id,
      read: ev ? !!ev.read : true,
    };
  }

  const SH = {
    list: [],          // items
    i: 0,
    opener: null,
    hooks: {},         // {onRead(item), onUnread(item), rowFor(item) → element|null}
    body: new Map(),   // key → {state:'loading'|'ok'|'login'|'error'|'noid', data?}
    seq: 0,
  };

  const cur = () => SH.list[SH.i] || null;

  function metaRow(ic, label, valueHtml) {
    return TP.ui.row({ leading: `<span class="tp-tile">${icon(ic, { size: 16 })}</span>`, title: valueHtml, subtitle: esc(label) });
  }
  function actionRow(action, ic, label, extra = '') {
    return `<button type="button" class="tp-row has-lead" data-detail-action="${esc(action)}"${extra}><span class="tp-row-lead"><span class="tp-tile">${icon(ic, { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(label)}</span></span></button>`;
  }
  function linkRow(href, ic, label, action) {
    return `<a class="tp-row has-lead" href="${esc(href)}" target="_blank" rel="noopener"${action ? ` data-detail-action="${esc(action)}"` : ''}><span class="tp-row-lead"><span class="tp-tile">${icon(ic, { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(label)}</span></span><span class="va-sr">${esc(t('va.newTab'))}</span>${icon('external', { size: 14, cls: 'an-ext' })}</a>`;
  }
  const fullDate = (ms) => (ms ? `${VA().capitalize(TP.fmt.date(ms, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · ${TP.fmt.time(ms)}` : '');

  function sheetHtml() {
    const it = cur();
    if (!it) return '';
    const b = SH.body.get(it.key) || { state: 'loading' };
    const d = b.state === 'ok' ? b.data || {} : {};
    const n = SH.list.length;
    const nav = n > 1 ? `<div class="an-nav" role="group" aria-label="${esc(t('annsheet.nav'))}">
        <button type="button" class="tp-btn tp-btn-gray tp-btn-icon" data-detail-action="an-prev" aria-label="${esc(t('annsheet.prev'))}" title="${esc(t('annsheet.prev'))} (k)"${SH.i <= 0 ? ' aria-disabled="true"' : ''}>${icon('arrowUp', { size: 16 })}</button>
        <span class="an-pos">${esc(t('annsheet.pos', { i: SH.i + 1, n }))}</span>
        <button type="button" class="tp-btn tp-btn-gray tp-btn-icon" data-detail-action="an-next" aria-label="${esc(t('annsheet.next'))}" title="${esc(t('annsheet.next'))} (j)"${SH.i >= n - 1 ? ' aria-disabled="true"' : ''}>${icon('arrowDown', { size: 16 })}</button>
      </div>` : '';

    const school = it.kind === 'school';
    const meta = [
      metaRow(school ? 'bell' : 'courses', t(school ? 'annsheet.source' : 'annsheet.course'), `${TP.ui.dot(it.color || 'var(--label-3)')} ${esc(it.source || t('va.noCourse'))}`),
      (d.from || it.author) ? metaRow('person', t('annsheet.from'), esc(d.from || it.author)) : '',
      d.to ? metaRow('mail', t('annsheet.to'), esc(d.to)) : '',
      (d.date || it.date) ? metaRow('clock', t('annsheet.date'), esc(fullDate(d.date || it.date))) : '',
    ].filter(Boolean).join('');

    let body;
    if (b.state === 'ok') {
      body = d.html && TP.util.plain(d.html).trim()
        ? TP.ui.group(`<div class="tp-detail-desc tp-prose an-body">${TP.util.sanitize(d.html)}</div>`)
        : TP.ui.group(`<p class="tp-detail-desc va-muted">${esc(t('annsheet.noText'))}</p>`);
    } else if (b.state === 'login') {
      body = TP.ui.group(`<div class="tp-detail-desc an-state" role="status">
        <p class="an-state-title">${icon('person', { size: 16 })}<strong>${esc(t('annsheet.login.title'))}</strong></p>
        <p class="va-muted">${esc(t('annsheet.login.text'))}</p>
        <p class="an-state-actions">${TP.ui.button(t('annsheet.login.open'), { kind: 'filled', icon: 'external', attrs: { href: it.url || '#', target: '_blank', rel: 'noopener', 'data-detail-action': 'an-login' } })}
        ${TP.ui.button(t('annsheet.retry'), { kind: 'gray', attrs: { type: 'button', 'data-detail-action': 'an-retry' } })}</p></div>`);
    } else if (b.state === 'error') {
      body = TP.ui.group(`<div class="tp-detail-desc an-state" role="status"><p>${esc(t('announcements.bodyFailed'))}</p>
        <p class="an-state-actions">${TP.ui.button(t('annsheet.retry'), { kind: 'gray', attrs: { type: 'button', 'data-detail-action': 'an-retry' } })}</p></div>`);
    } else if (b.state === 'noid') {
      body = TP.ui.group(`<p class="tp-detail-desc va-muted">${esc(t(school ? 'annsheet.noid.school' : 'annsheet.noid.course'))}</p>`);
    } else {
      body = `<div class="an-loading" aria-busy="true">${TP.ui.skeleton(3, { lead: 'none' })}</div>`;
    }

    const att = (d.attachments || []).map((a) => linkRow(a.url, 'doc', a.name)).join('');
    const atts = att ? `<section class="an-atts" aria-label="${esc(t('annsheet.attachments'))}"><h3 class="an-h">${esc(t('annsheet.attachments'))}</h3>${TP.ui.group(att)}</section>` : '';

    const actions = [
      it.url ? linkRow(it.url, 'external', t(school ? 'annsheet.openValvas' : TP.shell.origin === 'ultra' || /ultra\.edu/.test(it.url) ? 'annsheet.openUltra' : 'announcements.openInToledo'), 'an-ext') : '',
      it.event ? actionRow(it.read ? 'an-unread' : 'an-read', it.read ? 'circle' : 'checkCircle', t(it.read ? 'annsheet.markUnread' : 'annsheet.markRead')) : '',
    ].filter(Boolean).join('');

    return `${nav}${TP.ui.group(meta, { cls: 'tp-detail-meta' })}${body}${atts}${actions ? TP.ui.group(actions, { cls: 'tp-detail-actions' }) : ''}`;
  }

  function paint() { if (TP.annSheet.isOpen()) TP.shell.detail.update(sheetHtml()); }

  function markShownRead(it) {
    if (!it || !it.event || it.read) return;
    it.read = true;
    safe(() => SH.hooks.onRead && SH.hooks.onRead(it));
    Promise.resolve().then(() => TP.data.markRead([it.event])).catch(() => {});
  }

  /** Load the body of `it` (once; force → again). Paints when it is still the item shown. */
  function load(it, force) {
    const have = SH.body.get(it.key);
    if (!force && have && (have.state === 'ok' || have.state === 'loading' || have.state === 'noid')) return;
    if (it.html != null && !force) { SH.body.set(it.key, { state: 'ok', data: { html: it.html } }); return; }
    let p = null;
    if (it.kind === 'school') {
      if (!TP.data.advalvasId || !TP.data.advalvasId(it.event || { url: it.url })) { SH.body.set(it.key, { state: 'noid' }); return; }
      p = TP.data.advalvasMessage(it.event || { url: it.url }, { force });
    } else if (it.event && TP.data.announcementBody) {
      p = TP.data.announcementBody(it.event);
    } else if (it.cid && it.aid) {
      p = TP.data.ultraAnnouncement(it.cid, it.aid).then((a) => ({ html: a.body }));
    } else { SH.body.set(it.key, { state: 'noid' }); return; }
    SH.body.set(it.key, { state: 'loading' });
    const seq = ++SH.seq;
    Promise.resolve(p).then((r) => {
      SH.body.set(it.key, { state: 'ok', data: r || {} });
    }, (err) => {
      SH.body.set(it.key, { state: err && err.needsLogin ? 'login' : 'error' });
      if (!(err && (err.needsLogin || err.status === 404))) console.debug('[Toledo+] announcement body', err && (err.status || err.message));
    }).finally(() => {
      if (cur() === it) {
        paint();
        if (seq === SH.seq) TP.shell.announce(t(SH.body.get(it.key).state === 'ok' ? 'annsheet.loaded' : SH.body.get(it.key).state === 'login' ? 'annsheet.login.title' : 'announcements.bodyFailed'));
      }
    });
  }

  function show(i, dir = 0) {
    if (i < 0 || i >= SH.list.length) return;
    const prevFocus = safe(() => TP.shell.app.getRootNode().activeElement?.dataset?.detailAction, null);
    SH.i = i;
    const it = cur();
    load(it);
    markShownRead(it);
    const row = safe(() => SH.hooks.rowFor && SH.hooks.rowFor(it), null);
    TP.shell.detail.open({ title: it.title, html: sheetHtml(), opener: row && row.isConnected ? row : SH.opener, onAction, onKey });
    const dlg = safe(() => TP.shell.app.querySelector('.tp-detail'), null);
    if (dlg) {
      SH.showing = true;
      dlg.setAttribute('data-sheet', 'announcement'); // wider sheet (announcements.css); dropped once it faded out
      if (!dlg.__tpAnnSheet) {
        dlg.__tpAnnSheet = true;
        dlg.addEventListener('close', () => {
          SH.showing = false;
          setTimeout(() => { if (!SH.showing) dlg.removeAttribute('data-sheet'); }, TP.motion && !TP.motion.disabled ? 400 : 0);
        });
      }
      const bodyEl = dlg.querySelector('.tp-detail-body');
      if (bodyEl) bodyEl.scrollTop = 0;
      if (dir && TP.motion && bodyEl) TP.motion.enter(bodyEl, { from: dir > 0 ? 'up' : 'down', duration: TP.motion.DUR[2] });
      if (prevFocus) dlg.querySelector(`[data-detail-action="${prevFocus}"]`)?.focus({ preventScroll: true });
    }
    // Keep the opener's row in view (and the one Esc will return focus to).
    if (row && row.isConnected) safe(() => row.scrollIntoView({ block: 'nearest' }));
  }

  function step(d) {
    const j = SH.i + d;
    if (j < 0 || j >= SH.list.length) return false;
    show(j, d);
    return true;
  }

  async function onAction(action) {
    const it = cur();
    if (!it) return;
    if (action === 'an-prev') { step(-1); return; }
    if (action === 'an-next') { step(1); return; }
    if (action === 'an-retry') { load(it, true); paint(); return; }
    if (action === 'an-login') { SH.awaitLogin = it.key; return; } // the link opens the page top-level; we retry on return
    if (action === 'an-unread' && it.event) {
      it.read = false;
      safe(() => SH.hooks.onUnread && SH.hooks.onUnread(it));
      paint();
      TP.shell.announce(t('annsheet.markedUnread'));
      await TP.data.markUnread([it.event]);
      return;
    }
    if (action === 'an-read' && it.event) {
      it.read = false; markShownRead(it);
      paint();
      TP.shell.announce(t('annsheet.markedRead'));
    }
  }

  function onKey(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = ev.key;
    if (k === 'ArrowDown' || k === 'j' || k === 'J') { if (step(1) || SH.list.length > 1) ev.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'k' || k === 'K') { if (step(-1) || SH.list.length > 1) ev.preventDefault(); }
  }

  // Coming back from the Ad Valvas tab (SSO done there): retry the item that asked for a sign-in.
  let visBound = false;
  function bindVisibility() {
    if (visBound) return;
    visBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !TP.annSheet.isOpen()) return;
      const it = cur();
      const b = it && SH.body.get(it.key);
      if (it && b && (b.state === 'login' || (SH.awaitLogin === it.key && b.state === 'error'))) { SH.awaitLogin = null; load(it, true); paint(); }
    });
  }

  /**
   * Open the announcement sheet.
   * @param target  portal event | sheet item
   * @param o.list    events/items to step through (the current filtered list; default [target])
   * @param o.opener  element focus returns to (default: the active element)
   * @param o.onRead(item) / o.onUnread(item) / o.rowFor(item) → element   view hooks
   */
  function open(target, o = {}) {
    if (!target || !TP.shell.detail) return;
    const norm = (x) => (x && x.kind && x.key ? x : fromEvent(x));
    const list = (o.list && o.list.length ? o.list : [target]).map(norm);
    const tk = norm(target).key;
    let i = list.findIndex((x) => x.key === tk);
    if (i < 0) { list.unshift(norm(target)); i = 0; }
    SH.list = list;
    SH.opener = o.opener || safe(() => TP.shell.app.getRootNode().activeElement, null);
    SH.hooks = { onRead: o.onRead, onUnread: o.onUnread, rowFor: o.rowFor };
    SH.awaitLogin = null;
    for (const [k, v] of SH.body) if (v.state !== 'ok') SH.body.delete(k); // retry failures on a fresh open
    if (SH.body.size > 60) SH.body.clear();
    bindVisibility();
    show(i);
  }

  TP.annSheet = { open, fromEvent, fromUltra, isOpen: () => !!SH.showing && safe(() => TP.shell.detail.isOpen(), false), _state: SH };

  /* ------------------------------------------------------------------ */
  /* Announcements view                                                   */
  /* ------------------------------------------------------------------ */
  const S = {
    ctx: null,
    q: '',
    filter: 'all',          // 'all'|'unread'  — one filter list on the side (like mail folders):
    source: null,           // … or one course luId / 'advalvas' (then filter = 'all')
    keepRead: new Set(),    // ids read this session (stay listed under "Ongelezen")
    events: new Map(),      // id -> event
  };

  function everything() {
    try { return TP.data.announcements({ filter: 'all' }) || []; } catch { return []; }
  }

  const sourceKey = (e) => (e.subType === 'advalvas' ? 'advalvas' : String(e.sourceId || e.source || ''));

  /** Filter choices: Alles · Ongelezen, then every course and Ad Valvas (unread first, then most recent). */
  function choices(all) {
    const by = new Map();
    for (const e of all) {
      const k = sourceKey(e);
      if (!by.has(k)) by.set(k, { k, e, n: 0, unread: 0, latest: 0 });
      const g = by.get(k);
      g.n++; if (!e.read) g.unread++;
      g.latest = Math.max(g.latest, VA().ms(e.date) || 0);
    }
    const unreadN = all.filter((e) => !e.read).length;
    const top = [
      { key: ':all', name: t('announcements.filter.all'), icon: 'announcements', n: all.length, on: !S.source && S.filter === 'all' },
      { key: ':unread', name: t('announcements.filter.unread'), icon: 'bell', n: unreadN, on: !S.source && S.filter === 'unread' },
    ];
    const courses = [...by.values()].sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.latest - a.latest).map((g) => {
      const school = g.k === 'advalvas';
      let color = 'var(--label-3)';
      if (!school) { try { const c = TP.data.course ? TP.data.course(g.e.sourceId) : null; if (c && c.color) color = c.color; } catch { /* no course */ } }
      return { key: g.k, name: school ? t('announcements.school') : TP.util.courseName(g.e.source || ''), color, n: g.n, unread: g.unread, on: S.source === g.k };
    });
    return { top, courses };
  }

  /** Wide screens: the filter list in the side column (like mail folders). */
  function sourcesHtml(c) {
    const row = (x, leading) => TP.ui.row({
      action: 'an-source', attrs: { 'data-key': x.key, 'aria-current': x.on ? 'true' : null },
      leading, title: esc(x.name),
      trailing: `<span class="tp-count">${x.n}</span>`, // the same plain number in every row (like the sidebar); unread = bold name
      strong: x.unread > 0,
      cls: 'va-src-row' + (x.on ? ' is-on' : ''),
    });
    return TP.ui.section({ id: 'an-sources', title: esc(t('announcements.filter.label')),
      body: TP.ui.group(c.top.map((x) => row(x, TP.ui.icon(x.icon, { size: 16 }))).join('')) + TP.ui.group(c.courses.map((x) => row(x, TP.ui.dot(x.color))).join('')) });
  }

  /** Phones / narrow windows: just Alles | Ongelezen (the standard segmented control); per course is a wide-screen extra. */
  function sourcesSeg(c) {
    const seg = TP.ui.segmented('an-seg', c.top.map((x) => ({ value: x.key, label: `${x.name} ${x.n}` })),
      S.source ? null : ':' + S.filter, { label: t('announcements.filter.label') });
    return `<div class="va-filters va-src-seg">${seg}</div>`;
  }

  function pick(k) {
    if (!k || k.startsWith(':')) { S.filter = (k || ':all').slice(1); S.source = null; } else { S.filter = 'all'; S.source = k; }
  }

  function allUnread() {
    try { return (TP.data.announcements({ filter: 'all' }) || []).filter((e) => !e.read); } catch { return []; }
  }

  function rowHtml(e) {
    const id = String(e.id);
    S.events.set(id, e);
    const unread = !e.read;
    const q = TP.index.hayOf.announcement(e); // the same fields as ⌘K: title, course/source, code, sender, date
    const p = VA().annParts(e, unread); // same row as the Overview card
    // Every row (course announcement or Ad Valvas) opens the announcement sheet; ⌘/Ctrl-click still opens the original page.
    return TP.ui.row({
      href: e.url ? TP.util.abs(e.url) : '#',
      attrs: { 'data-action': 'an-open', 'data-eid': id, 'aria-haspopup': 'dialog', 'data-unread': unread ? '1' : null },
      title: esc(e.title),
      subtitle: p.subtitle,
      trailing: p.trailing,
      chevron: true,
      strong: unread,
      q,
      cls: 'va-ann va-ann-row' + (unread ? '' : ' is-read'),
    });
  }

  function render(ctx) {
    S.ctx = ctx;
    const V = VA();
    V.bind(ctx.root, 'announcements', { click: onClick, change: onChange });
    const unreadN = allUnread().length;
    try {
      ctx.setActions && ctx.setActions([]); // "Alles gelezen" sits in the list's section header (like Overzicht › Nieuw)
    } catch { /* ignore */ }
    const loadedOk = V.state('events') === 'ok';
    try { ctx.setSubtitle && ctx.setSubtitle(unreadN ? esc(t('announcements.unreadCount', { n: unreadN })) : loadedOk ? esc(t('announcements.empty.unread')) : ''); } catch { /* ignore */ }

    S.events.clear();
    const all = everything();
    if (S.source && !all.some((e) => sourceKey(e) === S.source)) S.source = null;
    const items = S.source ? all.filter((e) => sourceKey(e) === S.source)
      : S.filter === 'unread' ? all.filter((e) => !e.read || S.keepRead.has(String(e.id))) : all;

    const state = V.state('events');
    let body = state === 'error' || state === 'stale-error' ? V.errorBlock(t('announcements.error'), 'events') : '';
    if (!items.length && state === 'loading') body += V.skeleton(5, { lead: 'dot' });
    else if (!items.length && state === 'error') { /* the error row says it all; no false "Alles gelezen" */ }
    else if (!items.length) body += TP.ui.group(TP.ui.empty(t('announcements.empty.' + S.filter)));
    else {
      // A section heading like "Per vak" next to it, so both columns' headings and cards start at the same height.
      const src = S.source && items[0] ? (items[0].subType === 'advalvas' ? t('announcements.school') : TP.util.courseName(items[0].source || '')) : '';
      body += V.addAttrs(TP.ui.section({
        id: 'an-list', title: esc(src || t('announcements.filter.' + S.filter)), count: items.length,
        actions: unreadN ? [{ action: 'an-readall', label: t('announcements.readAll'), icon: 'check' }] : [],
        body: TP.ui.group(items.map(rowHtml).join(''), { cls: 'va-ann-list' }),
      }), { 'data-va-sec': 'list' });
    }

    // Same two columns as Overzicht and the course page: the list, and "Per vak" on the side.
    // The list and its filter list start level, like Overzicht; below 1100px the filters come first (CSS).
    const c = all.length ? choices(all) : null;
    const main = `${c ? sourcesSeg(c) : ''}${body}<div class="va-noresults" hidden></div>`;
    V.paint(ctx.root, `<div class="va-view va-announcements tp-narrow">${c ? TP.ui.cols(main, sourcesHtml(c)) : main}</div>`);
    if (S.q) V.filter(ctx.root, S.q);
  }

  async function readAll() {
    const unread = allUnread();
    if (!unread.length) return;
    unread.forEach((e) => S.keepRead.add(String(e.id)));
    await TP.data.markRead(unread);
    VA().announce(t('announcements.allRead'));
    if (S.ctx) render(S.ctx);
  }

  /** The rows currently listed (filter + search applied), in order: what the sheet steps through. */
  function visibleEvents(root) {
    return [...root.querySelectorAll('.va-ann-list [data-eid]')].filter((r) => !r.hidden).map((r) => S.events.get(r.getAttribute('data-eid'))).filter(Boolean);
  }

  const modified = (ev) => ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0;

  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    const act = el.getAttribute('data-action');
    const e = S.events.get(el.getAttribute('data-eid'));
    if (act === 'va-retry') {
      ev.preventDefault();
      await VA().retry(el);
    } else if (act === 'an-open' && e) {
      if (modified(ev) && e.url) { if (!e.read) S.keepRead.add(String(e.id)); Promise.resolve().then(() => TP.data.markRead([e])).catch(() => {}); return; }
      ev.preventDefault();
      open(e, {
        list: visibleEvents(ctx.root),
        opener: el,
        onRead: (it) => S.keepRead.add(it.key),
        onUnread: (it) => S.keepRead.delete(it.key),
        rowFor: (it) => safe(() => S.ctx && S.ctx.root.querySelector(`.va-ann-list [data-eid="${VA().cssEsc(it.key)}"]`), null),
      });
    } else if (act === 'an-readall') {
      ev.preventDefault();
      await readAll();
    } else if (act === 'an-source') {
      ev.preventDefault();
      pick(el.getAttribute('data-key') || ':all');
      render(ctx);
    }
  }

  function onChange(ev) {
    const el = ev.target;
    if (el && el.name === 'an-seg' && S.ctx) { pick(el.value); render(S.ctx); }
  }

  TP.shell.register('announcements', {
    title: () => t('nav.announcements'),
    searchPlaceholder: () => t('announcements.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim();
      VA().filter(ctx.root, S.q);
    },
    destroy() { S.q = ''; S.keepRead.clear(); S.ctx = null; },
  });
})();
