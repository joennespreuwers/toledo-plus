/* Toledo+ — Announcements view: course announcements (expand inline) + Ad Valvas (open in new tab). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const VA = () => TP.viewsA;

  const S = {
    ctx: null,
    q: '',
    filter: 'all',          // 'all'|'unread'  — one filter list on the side (like mail folders):
    source: null,           // … or one course luId / 'advalvas' (then filter = 'all')
    open: new Set(),        // ids of expanded announcements
    bodies: new Map(),      // id -> {state:'loading'|'ok'|'err', html}
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

  function openLink(e) {
    if (!e.url) return '';
    return `<p class="va-ann-open"><a href="${esc(TP.util.abs(e.url))}" data-action="an-link" data-eid="${esc(String(e.id))}">${esc(t('announcements.openInToledo'))} ›</a></p>`;
  }

  function bodyHtml(e) {
    const b = S.bodies.get(String(e.id));
    if (b && b.state === 'ok') {
      return `<div class="va-ann-body">${TP.util.sanitize(b.html || '')}</div>${openLink(e)}`;
    }
    if (b && b.state === 'err') {
      return `<p class="va-foot">${esc(t('announcements.bodyFailed'))}</p>${openLink(e)}`;
    }
    return `<p class="va-foot" aria-busy="true">${esc(t('announcements.loadingBody'))}</p>`;
  }

  function rowHtml(e) {
    const id = String(e.id);
    S.events.set(id, e);
    const unread = !e.read && !S.keepRead.has(id);
    const school = e.subType === 'advalvas';
    const src = school ? t('announcements.school') : TP.util.courseName(e.source || '');
    const q = `${e.title} ${src} ${e.author || ''}`.toLowerCase();
    const p = VA().annParts(e, unread); // same row as the Overview card: one chevron for every row (expand or open)
    if (school || !e.url) {
      return TP.ui.row({
        href: e.url ? TP.util.abs(e.url) : undefined,
        attrs: { 'data-action': 'an-open', 'data-eid': id, ...(school ? { target: '_blank', rel: 'noopener' } : {}) },
        title: esc(e.title),
        subtitle: p.subtitle,
        trailing: p.trailing + (school ? `<span class="va-ann-ext">${TP.ui.icon('external', { size: 14 })}</span>` : ''),
        chevron: !school, // ↗ = opens another site in a new tab; ⌄ (course announcements) = reads here
        strong: unread,
        q,
        cls: 'va-ann va-ann-row' + (unread ? '' : ' is-read'),
      });
    }
    const html = TP.ui.disclosure({
      id: 'an-' + id,
      open: S.open.has(id),
      summary: { title: esc(e.title), subtitle: p.subtitle, trailing: p.trailing, strong: unread }, // B12: every unread item = 600 + "Nieuw" 
      body: `<div class="va-ann-slot">${S.open.has(id) ? bodyHtml(e) : ''}</div>`,
      q,
      cls: 'va-ann-row',
    });
    return VA().addAttrs(html, { 'data-eid': id, 'data-unread': unread ? '1' : null });
  }

  function render(ctx) {
    S.ctx = ctx;
    const V = VA();
    V.bind(ctx.root, 'announcements', { click: onClick, change: onChange, toggle: onToggle });
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

  function markOne(e) {
    const id = String(e.id);
    if (e.read || S.keepRead.has(id)) return;
    S.keepRead.add(id);
    Promise.resolve().then(() => TP.data.markRead([e])).catch(() => {});
  }

  async function loadBody(e) {
    const id = String(e.id);
    const cur = S.bodies.get(id);
    if (cur && (cur.state === 'ok' || cur.state === 'loading')) return;
    S.bodies.set(id, { state: 'loading' });
    const { cid, aid } = VA().parseAnnouncement(e.url);
    try {
      if (!cid || !aid) throw new Error('unparseable announcement url');
      const res = await TP.data.ultraAnnouncement(cid, aid);
      if (!res || res.body == null) throw new Error('empty');
      S.bodies.set(id, { state: 'ok', html: String(res.body) });
    } catch (err) {
      S.bodies.set(id, { state: 'err' });
    }
    paintBody(e);
  }

  function paintBody(e) {
    const root = S.ctx && S.ctx.root;
    if (!root) return;
    const d = root.querySelector(`details[data-eid="${VA().cssEsc(String(e.id))}"]`);
    const slot = d && d.querySelector('.va-ann-slot');
    if (slot && d.open) slot.innerHTML = bodyHtml(e);
  }

  async function readAll() {
    const unread = allUnread();
    if (!unread.length) return;
    unread.forEach((e) => S.keepRead.add(String(e.id)));
    await TP.data.markRead(unread);
    VA().announce(t('announcements.allRead'));
    if (S.ctx) render(S.ctx);
  }

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
      if (!e.read) S.keepRead.add(String(e.id));
      await VA().openEvent(ev, el, e, { recent: false });
    } else if (act === 'an-readall') {
      ev.preventDefault();
      await readAll();
    } else if (act === 'an-source') {
      ev.preventDefault();
      pick(el.getAttribute('data-key') || ':all');
      render(ctx);
    } else if (act === 'an-link' && e) {
      markOne(e);
    }
  }

  function onChange(ev) {
    const el = ev.target;
    if (el && el.name === 'an-seg' && S.ctx) { pick(el.value); render(S.ctx); }
  }

  function onToggle(ev) {
    const d = ev.target;
    if (!d || d.tagName !== 'DETAILS' || !d.hasAttribute('data-eid')) return;
    const id = d.getAttribute('data-eid');
    const e = S.events.get(id);
    if (!e) return;
    if (!d.open) { S.open.delete(id); return; }
    S.open.add(id);
    const slot = d.querySelector('.va-ann-slot');
    if (slot && !slot.innerHTML.trim()) slot.innerHTML = bodyHtml(e);
    markOne(e);
    loadBody(e);
  }

  TP.shell.register('announcements', {
    title: () => t('nav.announcements'),
    searchPlaceholder: () => t('announcements.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim().toLowerCase();
      VA().filter(ctx.root, S.q);
    },
    destroy() { S.q = ''; S.keepRead.clear(); S.ctx = null; },
  });
})();
