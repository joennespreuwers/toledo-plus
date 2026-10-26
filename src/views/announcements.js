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
    filter: 'all',          // 'all'|'courses'|'school'|'unread'
    open: new Set(),        // ids of expanded announcements
    bodies: new Map(),      // id -> {state:'loading'|'ok'|'err', html}
    keepRead: new Set(),    // ids read this session (stay listed under "Ongelezen")
    events: new Map(),      // id -> event
  };

  function list() {
    let all = [];
    try {
      if (S.filter === 'unread') {
        all = (TP.data.announcements({ filter: 'all' }) || []).filter((e) => !e.read || S.keepRead.has(String(e.id)));
      } else {
        all = TP.data.announcements({ filter: S.filter }) || [];
      }
    } catch { all = []; }
    return all;
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
    const sub = `${esc(src)}<span aria-hidden="true"> · </span>${VA().timeAgo(e.date)}`;
    if (school || !e.url) {
      return TP.ui.row({
        href: e.url ? TP.util.abs(e.url) : undefined,
        attrs: { 'data-action': 'an-open', 'data-eid': id, ...(school ? { target: '_blank', rel: 'noopener' } : {}) },
        leading: VA().unreadDot(unread),
        title: esc(e.title),
        subtitle: sub + (school ? `<span class="va-sr"> ${esc(t('va.newTab'))}</span>` : ''),
        trailing: school ? TP.ui.icon('external', { size: 15 }) : '',
        strong: unread,
        q,
        cls: 'va-ann' + (unread ? '' : ' is-read'),
      });
    }
    const html = TP.ui.disclosure({
      id: 'an-' + id,
      open: S.open.has(id),
      summary: { leading: VA().unreadDot(unread), title: esc(e.title), subtitle: sub, strong: unread }, // B12: dot + 600 for every unread item
      body: `<div class="va-ann-slot">${S.open.has(id) ? bodyHtml(e) : ''}</div>`,
      q,
    });
    return VA().addAttrs(html, { 'data-eid': id, 'data-unread': unread ? '1' : null });
  }

  function render(ctx) {
    S.ctx = ctx;
    const V = VA();
    V.bind(ctx.root, 'announcements', { click: onClick, change: onChange, toggle: onToggle });
    const unreadN = allUnread().length;
    try {
      ctx.setActions && ctx.setActions(unreadN
        ? [{ id: 'an-readall', label: t('announcements.readAll'), icon: 'check', onClick: readAll }]
        : []);
    } catch { /* ignore */ }
    const loadedOk = V.state('events') === 'ok';
    try { ctx.setSubtitle && ctx.setSubtitle(unreadN ? esc(t('announcements.unreadCount', { n: unreadN })) : loadedOk ? esc(t('announcements.empty.unread')) : ''); } catch { /* ignore */ }

    S.events.clear();
    const items = list();
    const seg = TP.ui.segmented('an-filter', [
      { value: 'all', label: t('announcements.filter.all') },
      { value: 'courses', label: t('announcements.filter.courses') },
      { value: 'school', label: t('announcements.filter.school') },
      { value: 'unread', label: t('announcements.filter.unread') },
    ], S.filter, { label: t('announcements.filter.label') });

    const state = V.state('events');
    let body = state === 'error' || state === 'stale-error' ? V.errorBlock(t('announcements.error'), 'events') : '';
    if (!items.length && state === 'loading') body += V.skeleton(5, { lead: 'dot' });
    else if (!items.length && state === 'error') { /* the error row says it all; no false "Alles gelezen" */ }
    else if (!items.length) body += TP.ui.group(TP.ui.empty(t('announcements.empty.' + S.filter)));
    else body += V.addAttrs(TP.ui.group(items.map(rowHtml).join(''), { cls: 'va-ann-list' }), { 'data-va-sec': 'list' });

    V.paint(ctx.root, `<div class="va-view va-announcements tp-narrow">
      <div class="va-filters">${seg}</div>
      ${body}
      <div class="va-noresults" hidden></div>
    </div>`);
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
    } else if (act === 'an-link' && e) {
      markOne(e);
    }
  }

  function onChange(ev) {
    const el = ev.target;
    if (el && el.name === 'an-filter' && S.ctx) {
      S.filter = el.value;
      render(S.ctx);
    }
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
