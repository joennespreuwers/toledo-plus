/* Toledo+ — Overview view.
   Also defines TP.viewsA: small helpers shared by the views-A family
   (overview, deadlines, planning, announcements). Other views only touch
   TP.viewsA at render time, so content-script load order doesn't matter. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);
  const DAY = 864e5;

  /* ------------------------------------------------------------------ */
  /* Shared helpers (views-A)                                            */
  /* ------------------------------------------------------------------ */
  const KIND_ICON = {
    file: 'doc', video: 'film', image: 'image', page: 'page', assignment: 'task', link: 'link',
    tool: 'tool', folder: 'folder', announcement: 'megaphone', notice: 'bell',
  };

  const VA = {
    /** Insert extra attributes into the first tag of an HTML string. */
    addAttrs(html, attrs) {
      const s = Object.entries(attrs || {})
        .filter(([, v]) => v !== false && v != null)
        .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
      return String(html).replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1${s}`);
    },

    /** 28px leading icon tile for a content kind. */
    kindTile(kind) {
      const k = KIND_ICON[kind] ? kind : 'page';
      const label = t('va.kind.' + k);
      return `<span class="va-tile" title="${esc(label)}">${icon(KIND_ICON[k], { size: 16 })}<span class="va-sr">${esc(label)}</span></span>`;
    },

    kindOf(e) {
      try { return TP.data.kindOf(e); } catch { return 'page'; }
    },

    /** Unread marker: dot with label, or an invisible spacer of the same size. */
    unreadDot(unread) {
      return unread
        ? `<span class="va-unread" role="img" aria-label="${esc(t('va.unread'))}"></span>`
        : '<span class="va-unread va-unread-off" aria-hidden="true"></span>';
    },

    /** Has the shell/data layer recorded a load error for this key? (optional API) */
    loadError(key) {
      const d = TP.data || {};
      try {
        if (typeof d.error === 'function') return !!d.error(key);
        if (typeof d.status === 'function') { const s = d.status(key); return !!(s && (s.error || s === 'error')); }
        if (d.errors && typeof d.errors === 'object') return !!d.errors[key];
      } catch { /* ignore */ }
      return false;
    },

    loaded(key) {
      try { return TP.data.peek(key) != null; } catch { return false; }
    },

    /** Small delayed skeleton (appears after 300ms, per DESIGN). */
    skeleton(n = 3) {
      return `<div class="va-delay" aria-busy="true">${TP.ui.skeleton(n)}</div>`;
    },

    capitalize(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); },

    sameDay(a, b) { return TP.fmt.dayKey(a) === TP.fmt.dayKey(b); },

    /** One delegated listener per event type on ctx.root, guarded per view. */
    bind(root, name, handlers) {
      const flag = '__tpVA_' + name;
      if (root[flag]) return;
      root[flag] = true;
      for (const [type, fn] of Object.entries(handlers)) {
        root.addEventListener(type, (ev) => {
          try {
            const r = fn(ev);
            if (r && typeof r.catch === 'function') r.catch((err) => console.warn('[Toledo+]', name, err));
          } catch (err) { console.warn('[Toledo+]', name, err); }
        }, type === 'toggle' || type === 'focus' || type === 'blur');
      }
    },

    /** Remember which control had focus so a re-render can restore it. */
    focusKey(root) {
      const host = root.getRootNode && root.getRootNode();
      const a = host && host.activeElement;
      if (!a || !root.contains(a)) return null;
      const parts = [];
      for (const at of ['data-action', 'data-key', 'data-id', 'data-eid', 'data-lu', 'name', 'value']) {
        const v = a.getAttribute(at);
        if (v != null) parts.push(`[${at}="${CSS.escape(v)}"]`);
      }
      if (a.id) return '#' + CSS.escape(a.id);
      return parts.length ? a.tagName.toLowerCase() + parts.join('') : null;
    },
    restoreFocus(root, key) {
      if (!key) return;
      try { const el = root.querySelector(key); if (el) el.focus({ preventScroll: true }); } catch { /* ignore */ }
    },

    /** Replace root content, preserving focus. */
    paint(root, html) {
      const fk = VA.focusKey(root);
      root.innerHTML = html;
      VA.restoreFocus(root, fk);
    },

    /**
     * Search filter: hides [data-q] rows that don't match, hides sections with no
     * visible rows, toggles the no-results line. Returns number of visible rows.
     */
    filter(root, q, noResultsKey) {
      q = (q || '').trim().toLowerCase();
      let visible = 0;
      root.querySelectorAll('[data-q]').forEach((el) => {
        if (el.closest('[data-va-nofilter]')) return;
        const hit = !q || String(el.getAttribute('data-q')).includes(q);
        el.hidden = !hit;
        if (hit) visible++;
      });
      root.querySelectorAll('[data-va-sec]').forEach((sec) => {
        if (!q) { sec.hidden = false; return; }
        const rows = [...sec.querySelectorAll('[data-q]')];
        sec.hidden = !rows.some((r) => !r.hidden && !r.closest('[hidden]'));
      });
      const nr = root.querySelector('.va-noresults');
      if (nr) {
        nr.hidden = !q || visible > 0;
        nr.textContent = q && !visible ? t(noResultsKey, { q }) : '';
      }
      return visible;
    },

    /**
     * Deadline row (overview, deadlines, planning).
     * opts: { prefix:'ov'|'dl'|'pl', urgentDays, now, removable, showDay }
     */
    deadlineRow(d, opts = {}) {
      const now = opts.now || Date.now();
      const urgentDays = opts.urgentDays ?? 3;
      const days = TP.fmt.daysUntil(d.due);
      const overdue = !d.done && d.due < now;
      const urgent = !d.done && !overdue && days <= urgentDays;
      const tone = d.done ? 'muted' : overdue ? 'overdue' : urgent ? 'urgent' : 'normal';
      const p = opts.prefix || 'ov';
      const course = d.courseName || t('va.noCourse');

      const check = `<button type="button" class="va-check${d.done ? ' is-done' : ''}" data-action="${p}-done" data-key="${esc(d.key)}" aria-pressed="${d.done ? 'true' : 'false'}" aria-label="${esc(t(d.done ? 'va.undone' : 'va.done', { title: d.title }))}">${icon(d.done ? 'checkCircle' : 'circle', { size: 22 })}</button>`;
      const leading = check + TP.ui.dateTile(d.due, { tone });

      const when = opts.showDay === false
        ? TP.fmt.time(d.due)
        : `${TP.fmt.date(d.due, { weekday: 'short', day: 'numeric', month: 'short' })} ${TP.fmt.time(d.due)}`;
      const subtitle = `${TP.ui.dot(d.color || 'var(--label-3)')}<span>${esc(course)}</span><span aria-hidden="true"> · </span><span>${esc(when)}</span>`
        + (d.source === 'custom' ? ` <span class="va-tag">${esc(t('va.own'))}</span>` : '');

      let urg;
      if (d.done) urg = `<span class="va-urg is-done">${icon('check', { size: 13 })}${esc(t('va.doneWord'))}</span>`;
      else if (overdue) urg = `<span class="va-urg is-overdue">${icon('clock', { size: 13 })}${esc(t('va.overdue'))}</span>`;
      else if (urgent) urg = `<span class="va-urg is-urgent">${icon('clock', { size: 13 })}<span class="va-sr">${esc(t('va.urgent'))}: </span>${esc(TP.fmt.rel(d.due))}</span>`;
      else urg = `<span class="va-urg">${esc(TP.fmt.rel(d.due))}</span>`;

      let trailing = urg;
      if (opts.removable && d.source === 'custom' && d.customId != null) {
        trailing += `<button type="button" class="va-iconbtn" data-action="${p}-remove" data-id="${esc(d.customId)}" aria-label="${esc(t('deadlines.removeLabel', { title: d.title }))}" title="${esc(t('deadlines.remove'))}">${icon('xmark', { size: 15 })}</button>`;
      }
      if (d.url) {
        trailing += `<a class="va-iconbtn" href="${esc(TP.util.abs(d.url))}" aria-label="${esc(t('announcements.openInToledo'))}: ${esc(d.title)}" title="${esc(t('announcements.openInToledo'))}">${icon('chevronRight', { size: 15 })}</a>`;
      }

      return TP.ui.row({
        leading,
        title: esc(d.title),
        subtitle,
        trailing,
        q: `${d.title} ${course}`.toLowerCase(),
        cls: `va-dl tone-${tone}${d.done ? ' is-done' : ''}`,
        attrs: { 'data-key': d.key },
      });
    },

    /** Mark an event read, remember it, and follow its link (unless modifier-click / new tab). */
    async openEvent(ev, el, e, opts = {}) {
      if (!e) return;
      const modified = ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0;
      const newTab = el.getAttribute('target') === '_blank';
      const url = e.url ? TP.util.abs(e.url) : null;
      if (opts.recent !== false && url) {
        try {
          const p = TP.data.addRecent({
            title: e.title, url, courseName: TP.util.courseName(e.source || ''),
            courseLuId: e.sourceId, kind: VA.kindOf(e),
          });
          if (p && p.catch) p.catch(() => {});
        } catch { /* ignore */ }
      }
      const done = Promise.resolve().then(() => TP.data.markRead([e])).catch(() => {});
      if (!url || modified || newTab || el.tagName !== 'A') return;
      ev.preventDefault();
      // Give the PATCH a moment so it isn't cancelled by navigation.
      await Promise.race([done, new Promise((r) => setTimeout(r, 700))]);
      location.assign(url);
    },

    /** Parse Ultra course id + announcement id out of an event url. */
    parseAnnouncement(url) {
      const s = String(url || '');
      let dec = s;
      try { dec = decodeURIComponent(s); } catch { /* keep raw */ }
      const cid = (dec.match(/courses\/(_\d+_\d+)/) || dec.match(/course_?[iI]d=(_\d+_\d+)/) || [])[1] || null;
      const aid = (dec.match(/announcements?\/(_\d+_\d+)/) || dec.match(/announcement_?[iI]d=(_\d+_\d+)/) || [])[1] || null;
      return { cid, aid };
    },

    downloadText(root, text, filename, type) {
      const blob = new Blob([text], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.hidden = true;
      (root || document.body).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    toast(text) { try { TP.shell.toast(text); } catch { /* ignore */ } },
    announce(text) { try { TP.shell.announce(text); } catch { /* ignore */ } },
  };
  TP.viewsA = VA;

  /* ------------------------------------------------------------------ */
  /* Overview                                                            */
  /* ------------------------------------------------------------------ */
  const S = {
    ctx: null,
    q: '',
    showAll: false,
    open: new Set(),          // luIds of expanded feed groups
    kept: new Map(),          // eventId -> { e, luId, meta } read this session, kept visible
    keptStamp: null,          // lastUpdated() when kept was filled; cleared on refresh
    doneKeep: new Set(),      // deadline keys marked done this session (stay visible)
    events: new Map(),        // eventId -> event (for click handlers)
    groupsMeta: new Map(),    // luId -> group meta (name, color, course)
  };

  const SIDE = new Set(['schedule', 'announcements', 'links']);
  const BUILD = {
    deadlines: secDeadlines, new: secNew, recent: secRecent, courses: secCourses,
    schedule: secSchedule, announcements: secAnnouncements, links: secLinks,
  };

  function greeting() {
    const h = new Date().getHours();
    const k = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    return t('overview.greet.' + k);
  }

  function subtitle() {
    const date = VA.capitalize(TP.fmt.date(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }));
    const lu = TP.data.lastUpdated && TP.data.lastUpdated();
    const upd = lu ? t('overview.updated', { time: TP.fmt.time(lu) }) : t('overview.loading');
    return `<span>${esc(date)}</span><span aria-hidden="true"> · </span><span>${esc(upd)}</span>`;
  }

  function section(id, opts) {
    const html = TP.ui.section({ id: 'ov-' + id, ...opts });
    return VA.addAttrs(html, { 'data-va-sec': id });
  }

  function linkRow(href, label, extra = {}) {
    return TP.ui.row({ href, title: esc(label), chevron: true, cls: 'va-more', ...extra });
  }

  /* ---------- Deadlines ---------- */
  function secDeadlines(st) {
    const cfg = st.deadlines || {};
    const horizon = cfg.horizonDays || 42;
    const now = Date.now();
    let body;
    const all = TP.data.deadlines({ includeDone: true, horizonDays: horizon }) || [];
    const list = all
      .filter((d) => d.due <= now + horizon * DAY)
      .filter((d) => !d.done || S.doneKeep.has(d.key))
      .slice(0, 5);
    if (!list.length && !VA.loaded('events') && !VA.loadError('events')) {
      body = VA.skeleton(3);
    } else if (!list.length) {
      body = TP.ui.group(TP.ui.empty(t('overview.deadlines.empty', { n: horizon })));
    } else {
      const rows = list.map((d) => VA.deadlineRow(d, { prefix: 'ov', urgentDays: cfg.urgentDays ?? 3, now })).join('');
      body = TP.ui.group(rows + linkRow(TP.shell.href('deadlines'), t('overview.deadlines.all'), { attrs: { 'data-va-nofilter': '' } }), { cls: 'va-dl-group' });
    }
    return section('deadlines', { title: esc(t('overview.deadlines.title')), body });
  }

  /* ---------- New (compact grouped feed) ---------- */
  const BUCKET = {
    file: 'file', image: 'file', video: 'video', page: 'page', link: 'page', tool: 'page', folder: 'page',
    assignment: 'assignment', announcement: 'announcement', notice: 'announcement',
  };
  const BUCKET_ORDER = ['file', 'video', 'page', 'assignment', 'announcement'];

  function feedWithKept() {
    let groups = [];
    try { groups = (TP.data.feed() || []).map((g) => ({ ...g, items: g.items.slice() })); } catch { groups = []; }
    const lu = TP.data.lastUpdated && TP.data.lastUpdated();
    if (S.kept.size && S.keptStamp !== lu) S.kept.clear();
    const byLu = new Map(groups.map((g) => [g.luId, g]));
    for (const [id, k] of S.kept) {
      let g = byLu.get(k.luId);
      if (!g) {
        g = { ...k.meta, items: [], latest: 0 };
        groups.push(g);
        byLu.set(k.luId, g);
      }
      if (!g.items.some((x) => x.id === id)) g.items.push(k.e);
    }
    for (const g of groups) {
      g.items.sort((a, b) => b.date - a.date);
      g.latest = g.items.length ? g.items[0].date : g.latest;
      S.groupsMeta.set(String(g.luId), { luId: g.luId, course: g.course, name: g.name, color: g.color });
      for (const e of g.items) S.events.set(String(e.id), e);
    }
    return groups;
  }

  function summaryLine(items) {
    const counts = {};
    for (const e of items) {
      const b = BUCKET[VA.kindOf(e)] || 'page';
      counts[b] = (counts[b] || 0) + 1;
    }
    const parts = BUCKET_ORDER.filter((b) => counts[b]).map((b) => t('overview.kind.' + b, { n: counts[b] }));
    return parts.join(' · ');
  }

  function feedItemRow(e, g, extra) {
    const read = S.kept.has(String(e.id)) || e.read;
    const kind = VA.kindOf(e);
    return TP.ui.row({
      href: e.url ? TP.util.abs(e.url) : undefined,
      attrs: { 'data-action': 'ov-open', 'data-eid': String(e.id), ...(extra ? { hidden: '' } : {}) },
      leading: VA.kindTile(kind),
      title: esc(e.title),
      trailing: `<time datetime="${esc(new Date(e.date).toISOString())}">${esc(TP.fmt.ago(e.date))}</time>`,
      q: `${e.title} ${g.name}`.toLowerCase(),
      cls: `va-feed-item${read ? ' is-read' : ''}${extra ? ' va-extra' : ''}`,
    });
  }

  function feedGroup(g, hidden) {
    const unread = g.items.filter((e) => !S.kept.has(String(e.id)) && !e.read);
    const shown = g.items.slice(0, 3);
    const rest = g.items.length - shown.length;
    const href = g.luId ? TP.shell.href('course', { luId: g.luId }) : null;
    const items = g.items.map((e, i) => feedItemRow(e, g, i >= 3)).join('');
    const more = rest > 0 && href
      ? linkRow(href, t('overview.new.more', { n: rest, course: g.name }), { cls: 'va-more va-feed-more' })
      : '';
    const latest = g.latest ? `<time datetime="${esc(new Date(g.latest).toISOString())}">${esc(TP.fmt.ago(g.latest))}</time>` : '';
    const badge = unread.length ? TP.ui.badge(unread.length, { tone: 'tint', label: t('overview.new.badge', { n: unread.length }) }) : '';
    const html = TP.ui.disclosure({
      id: 'ov-fg-' + g.luId,
      open: S.open.has(String(g.luId)),
      summary: {
        leading: TP.ui.dot(g.color || 'var(--label-3)'),
        title: esc(g.name),
        subtitle: esc(summaryLine(unread.length ? unread : g.items) || t('overview.kind.read')),
        trailing: `<span class="va-feed-trail">${badge}${latest}</span>`,
      },
      body: `<div class="va-feed-body">${items}${more}</div>`,
      q: String(g.name || '').toLowerCase(),
    });
    return VA.addAttrs(html, { 'data-lu': String(g.luId), 'data-name': String(g.name || '').toLowerCase(), hidden: hidden || null });
  }

  function secNew(st) {
    const max = Math.max(1, (st.feed && st.feed.maxCourses) || 5);
    const err = VA.loadError('events');
    const loaded = VA.loaded('events');
    const groups = feedWithKept();
    const total = groups.reduce((n, g) => n + g.items.filter((e) => !S.kept.has(String(e.id)) && !e.read).length, 0);
    let body = '';
    if (err) body += TP.ui.group(TP.ui.errorRow(t('overview.new.error'), 'ov-retry'));
    if (!loaded && !err) {
      body += VA.skeleton(3);
    } else if (!groups.length) {
      if (!err) body += TP.ui.group(TP.ui.empty(t('overview.new.empty'), { timestamp: TP.data.lastUpdated && TP.data.lastUpdated() }));
    } else {
      const rows = groups.map((g, i) => feedGroup(g, !S.showAll && i >= max)).join('');
      let toggle = '';
      if (groups.length > max) {
        toggle = TP.ui.row({
          action: 'ov-showall',
          attrs: { 'aria-expanded': S.showAll ? 'true' : 'false', 'data-va-nofilter': '' },
          title: esc(S.showAll ? t('overview.new.showLess') : t('overview.new.showAll', { n: groups.length })),
          cls: 'va-more va-showall',
        });
      }
      body += TP.ui.group(rows + toggle, { cls: 'va-feed' });
    }
    const actions = total ? [{ action: 'ov-readall', label: t('overview.new.readAll'), icon: 'check' }] : [];
    return section('new', { title: esc(t('overview.new.title')), count: total || undefined, actions, body });
  }

  /* ---------- Recent ---------- */
  function secRecent() {
    let recent = [];
    try { recent = ((TP.state.get() || {}).recent || []).slice(0, 5); } catch { recent = []; }
    if (!recent.length) return '';
    const rows = recent.map((r) => TP.ui.row({
      href: r.url ? TP.util.abs(r.url) : undefined,
      leading: VA.kindTile(r.kind),
      title: esc(r.title),
      subtitle: `${esc(r.courseName || '')}${r.ts ? `<span aria-hidden="true"> · </span>${esc(TP.fmt.ago(r.ts))}` : ''}`,
      chevron: true,
      q: `${r.title} ${r.courseName || ''}`.toLowerCase(),
    })).join('');
    return section('recent', { title: esc(t('overview.recent.title')), body: TP.ui.group(rows) });
  }

  /* ---------- Courses ---------- */
  function secCourses() {
    let list = [];
    try { list = TP.data.courses({ currentOnly: true }) || []; } catch { list = []; }
    list = list.filter((c) => !c.hidden);
    list = list.map((c, i) => [c, i]).sort((a, b) => (Number(!!b[0].pinned) - Number(!!a[0].pinned)) || a[1] - b[1]).map((x) => x[0]);
    let body;
    if (!list.length && !VA.loaded('enrollments')) body = VA.skeleton(2);
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.courses.empty')));
    else {
      body = `<ul class="va-cgrid" role="list">${list.map((c) => {
        const badge = c.unread ? TP.ui.badge(c.unread, { tone: 'tint', label: t('overview.new.badge', { n: c.unread }) }) : '';
        return `<li data-q="${esc(`${c.name} ${c.code || ''} ${c.title || ''}`.toLowerCase())}">
          <a class="va-ccard${c.available === false ? ' is-dim' : ''}" href="${esc(TP.shell.href('course', { luId: c.luId }))}" title="${esc(c.title || c.name)}">
            <span class="va-swatch" style="--c:${esc(c.color || 'var(--tint)')}" aria-hidden="true"></span>
            <span class="va-cname">${esc(c.name)}</span>
            ${c.pinned ? `<span class="va-cpin" title="pin">${icon('pinFill', { size: 12 })}</span>` : ''}
            ${badge}
          </a></li>`;
      }).join('')}</ul>`;
    }
    const actions = [{ action: 'ov-nav', label: t('overview.courses.all'), attrs: { 'data-route': 'courses' } }];
    return section('courses', { title: esc(t('overview.courses.title')), actions, body });
  }

  /* ---------- Schedule ---------- */
  function lessonRow(s, prefixQ = '') {
    const loc = [s.location && s.location.mnemonic, s.location && s.location.roomNumber]
      .filter((x) => x && x !== '?').join(' ');
    const color = (s.source && s.source.color) ? (typeof s.source.color === 'number' ? TP.util.colorForIndex(s.source.color) : s.source.color) : 'var(--label-3)';
    const link = s.source && s.source.link;
    return TP.ui.row({
      href: link || undefined,
      leading: `<span class="va-time"><span>${esc(TP.fmt.time(s.start))}</span><span>${esc(TP.fmt.time(s.end))}</span></span><span class="va-bar" style="--c:${esc(color)}" aria-hidden="true"></span>`,
      title: esc(s.name),
      subtitle: esc(loc || t('overview.schedule.noLocation')),
      q: `${prefixQ}${s.name} ${loc}`.toLowerCase(),
      cls: 'va-lesson',
    });
  }
  TP.viewsA.lessonRow = lessonRow;

  function secSchedule() {
    let sched = {};
    try { sched = TP.data.schedule() || {}; } catch { sched = {}; }
    const now = Date.now();
    const days = [[now, 'overview.schedule.today'], [now + DAY, 'overview.schedule.tomorrow']];
    let body;
    if (!VA.loaded('upcoming') && !VA.loadError('upcoming')) body = VA.skeleton(2);
    else {
      body = days.map(([ms, key]) => {
        const list = (sched[TP.fmt.dayKey(ms)] || []).slice().sort((a, b) => a.start - b.start);
        const head = `<h3 class="va-dayhead">${esc(t(key))} <span>${esc(TP.fmt.date(ms, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></h3>`;
        const rows = list.length ? list.map((s) => lessonRow(s)).join('') : TP.ui.empty(t('overview.schedule.none'));
        return head + TP.ui.group(rows);
      }).join('');
    }
    const kul = TP.data.link && TP.data.link('KULOKET-UURROOSTER');
    const footer = `${esc(t('overview.schedule.note'))}${kul ? ` <a href="${esc(kul)}" target="_blank" rel="noopener">${esc(t('overview.schedule.full'))} ›<span class="va-sr"> ${esc(t('va.newTab'))}</span></a>` : ''}`;
    return section('schedule', { title: esc(t('overview.schedule.title')), body, footer });
  }

  /* ---------- Announcements ---------- */
  function annRow(e) {
    S.events.set(String(e.id), e);
    const school = e.subType === 'advalvas';
    const src = school ? t('announcements.school') : TP.util.courseName(e.source || '');
    return TP.ui.row({
      href: e.url ? TP.util.abs(e.url) : undefined,
      attrs: { 'data-action': 'ov-open', 'data-eid': String(e.id), ...(school ? { target: '_blank', rel: 'noopener' } : {}) },
      leading: VA.unreadDot(!e.read),
      title: esc(e.title),
      subtitle: `${esc(src)}<span aria-hidden="true"> · </span>${esc(TP.fmt.ago(e.date))}${school ? `<span class="va-sr"> ${esc(t('va.newTab'))}</span>` : ''}`,
      strong: !e.read,
      q: `${e.title} ${src}`.toLowerCase(),
      cls: 'va-ann' + (e.read ? ' is-read' : ''),
    });
  }

  function secAnnouncements() {
    let list = [];
    try { list = (TP.data.announcements({ filter: 'all' }) || []).slice(0, 5); } catch { list = []; }
    let body;
    if (!list.length && !VA.loaded('events')) body = VA.skeleton(3);
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.ann.empty')));
    else body = TP.ui.group(list.map(annRow).join('') + linkRow(TP.shell.href('announcements'), t('overview.ann.all'), { attrs: { 'data-va-nofilter': '' } }));
    return section('announcements', { title: esc(t('overview.ann.title')), body });
  }

  /* ---------- Links ---------- */
  function secLinks() {
    let links = [];
    try { links = TP.data.quickLinks() || []; } catch { links = []; }
    const body = links.length
      ? TP.ui.group(links.map((l) => TP.ui.row({
        href: l.url,
        attrs: { target: '_blank', rel: 'noopener' },
        leading: `<span class="va-tile">${icon('external', { size: 15 })}</span>`,
        title: esc(l.title || l.label) + `<span class="va-sr"> ${esc(t('va.newTab'))}</span>`,
        q: String(l.title || l.label || '').toLowerCase(),
      })).join(''))
      : (VA.loaded('links') ? TP.ui.group(TP.ui.empty(t('overview.links.empty'))) : VA.skeleton(2));
    return section('links', { title: esc(t('overview.links.title')), body });
  }

  /* ---------- Search ---------- */
  function applySearch(root, q) {
    q = (q || '').trim().toLowerCase();
    const feed = root.querySelector('.va-feed');
    // Feed: work on all groups (incl. ones beyond maxCourses) and all items (incl. beyond 3).
    if (feed) feed.setAttribute('data-va-nofilter', '');
    VA.filter(root, q, 'overview.noResults');
    let feedHits = 0;
    if (feed) {
      feed.querySelectorAll('details[data-lu]').forEach((d) => {
        const groupHit = !!q && String(d.getAttribute('data-name') || '').includes(q);
        let itemHit = false;
        d.querySelectorAll('.va-feed-item').forEach((r) => {
          const hit = !q ? !r.classList.contains('va-extra') : (groupHit || String(r.getAttribute('data-q')).includes(q));
          r.hidden = !hit;
          if (q && String(r.getAttribute('data-q')).includes(q)) itemHit = true;
        });
        d.querySelectorAll('.va-feed-more').forEach((m) => { m.hidden = !!q; });
        if (q) {
          d.hidden = !(groupHit || itemHit);
          if (itemHit) d.open = true;
          if (groupHit || itemHit) feedHits++;
        }
      });
      const sa = feed.querySelector('.va-showall');
      if (sa) sa.hidden = !!q;
      const sec = feed.closest('[data-va-sec]');
      if (sec && q) sec.hidden = feedHits === 0;
      const nr = root.querySelector('.va-noresults');
      if (nr && q && feedHits) { nr.hidden = true; nr.textContent = ''; }
    }
  }

  /* ---------- Events ---------- */
  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    const act = el.getAttribute('data-action');
    switch (act) {
      case 'ov-open': {
        const e = S.events.get(el.getAttribute('data-eid'));
        if (!e) return;
        if (!e.read) {
          const host = el.closest('details[data-lu]');
          const meta = host ? S.groupsMeta.get(host.getAttribute('data-lu')) : null;
          if (meta) {
            S.kept.set(String(e.id), { e: { ...e, read: true }, luId: meta.luId, meta });
            S.keptStamp = TP.data.lastUpdated && TP.data.lastUpdated();
          }
        }
        await VA.openEvent(ev, el, e);
        break;
      }
      case 'ov-done': {
        ev.preventDefault();
        const key = el.getAttribute('data-key');
        const wasDone = el.getAttribute('aria-pressed') === 'true';
        S.doneKeep.add(key);
        await TP.data.toggleDone(key);
        VA.announce(t(wasDone ? 'va.markedOpen' : 'va.markedDone'));
        break;
      }
      case 'ov-readall': {
        ev.preventDefault();
        S.kept.clear();
        await TP.data.markFeedSeen();
        VA.announce(t('overview.new.allRead'));
        break;
      }
      case 'ov-showall': {
        ev.preventDefault();
        S.showAll = !S.showAll;
        render(ctx);
        break;
      }
      case 'ov-nav': {
        ev.preventDefault();
        TP.shell.navigate(el.getAttribute('data-route') || 'overview');
        break;
      }
      case 'ov-retry': {
        ev.preventDefault();
        await TP.data.refresh();
        break;
      }
      default:
    }
  }

  function onToggle(ev) {
    const d = ev.target;
    if (!d || d.tagName !== 'DETAILS' || !d.hasAttribute('data-lu')) return;
    if (S.q) return; // search auto-expansion shouldn't stick
    const lu = d.getAttribute('data-lu');
    if (d.open) S.open.add(lu); else S.open.delete(lu);
  }

  /* ---------- Render ---------- */
  function render(ctx) {
    S.ctx = ctx;
    VA.bind(ctx.root, 'overview', { click: onClick, toggle: onToggle });
    try { ctx.setTitle && ctx.setTitle(greeting()); } catch { /* ignore */ }
    try { ctx.setSubtitle && ctx.setSubtitle(subtitle()); } catch { /* ignore */ }
    try { ctx.setActions && ctx.setActions([]); } catch { /* ignore */ }

    const st = TP.settings.get() || {};
    const order = (st.overview && st.overview.sections) || [];
    S.events.clear();
    let main = '';
    let side = '';
    for (const s of order) {
      if (!s || !s.on || !BUILD[s.id]) continue;
      let html = '';
      try { html = BUILD[s.id](st); } catch (err) { console.warn('[Toledo+] overview section', s.id, err); }
      if (!html) continue;
      if (SIDE.has(s.id)) side += html; else main += html;
    }
    const layout = side ? TP.ui.cols(main, side) : main;
    VA.paint(ctx.root, `<div class="va-view va-overview">${layout}<p class="va-noresults" role="status" hidden></p></div>`);
    if (S.q) applySearch(ctx.root, S.q);
  }

  TP.shell.register('overview', {
    title: () => greeting(),
    searchPlaceholder: () => t('overview.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim().toLowerCase();
      render(ctx);
    },
    destroy() {
      S.kept.clear();
      S.doneKeep.clear();
      S.q = '';
      S.ctx = null;
    },
  });
})();
