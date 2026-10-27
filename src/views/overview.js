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

  const cssEsc = (v) => (globalThis.CSS && CSS.escape ? CSS.escape(String(v)) : String(v).replace(/["\\\]\[#.:()]/g, '\\$&'));

  const VA = {
    cssEsc,
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
    /** One look for an announcement row (Mededelingen + Overview card), built only from standard row parts:
     *  title (600 when unread) · meta "● course" like a deadline row · trailing [Nieuw] time ›. */
    annParts(e, unread) {
      const school = e.subType === 'advalvas';
      let color = 'var(--label-3)';
      if (!school) { try { const c = e.sourceId && TP.data.course ? TP.data.course(e.sourceId) : null; if (c && c.color) color = c.color; } catch { /* no course */ } }
      const src = school ? t('announcements.school') : TP.util.courseName(e.source || '');
      return {
        src,
        subtitle: `${TP.ui.dot(color)}<span>${esc(src)}</span>`, // every row opens the announcement sheet (no new tab)
        // time first, "Nieuw" last (an invisible copy on read rows): pills and times line up whatever the time says
        trailing: `${VA.daysAgo(e.date)}${unread ? TP.ui.badge(t('course.new'), { tone: 'tint', label: t('va.unread') })
          : `<span class="tp-badge tp-badge-tint va-new-slot" aria-hidden="true">${esc(t('course.new'))}</span>`}`,
      };
    },
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

    /**
     * B1: one place that decides between skeleton / error / empty / content for a section.
     * keys: data keys the section depends on. → 'loading' (no data yet, no error) | 'error' (failed, nothing cached)
     * | 'stale-error' (failed, cached data shown) | 'ok'. An empty state may only be shown for 'ok'.
     */
    state(keys) {
      keys = [].concat(keys);
      const err = keys.some((k) => VA.loadError(k));
      const loaded = keys.every((k) => VA.loaded(k));
      if (!loaded) return err ? 'error' : 'loading';
      return err ? 'stale-error' : 'ok';
    },

    /** Small delayed skeleton inside an inset group (appears after 300ms, per DESIGN). */
    skeleton(n = 3, opts) {
      return `<div class="va-delay" aria-busy="true">${TP.ui.skeleton(n, opts)}</div>`;
    },

    /** Inline per-section error row with "Opnieuw" (reloads `key`). */
    errorBlock(text, key) {
      return TP.ui.group(TP.ui.errorRow(text || t('va.loadError'), 'va-retry', { attrs: { 'data-key': [].concat(key || 'events').join(' ') } }), { cls: 'va-error' });
    },

    /** Retry handler for errorBlock rows (any view of the family). */
    async retry(el) {
      const keys = String(el.getAttribute('data-key') || 'events').split(/\s+/).filter(Boolean);
      el.setAttribute('aria-busy', 'true');
      try {
        if (TP.data.load) await Promise.allSettled(keys.map((k) => TP.data.load(k, { force: true })));
        else await TP.data.refresh();
      } catch { /* status/error events re-render */ }
      try { TP.shell.rerender(); } catch { /* ignore */ }
    },

    /** Robust ms from number | ISO string. */
    ms(v) {
      if (typeof v === 'number') return v;
      const n = new Date(v).getTime();
      return Number.isFinite(n) ? n : 0;
    },
    /** <time> element with relative "ago" text. */
    /** One date format for announcements, worded like deadlines ("in 9 d" / "5 d te laat"): vandaag · gisteren · 3 d geleden.
     *  The exact date and time are in the tooltip. */
    daysAgo(v) {
      const n = VA.ms(v);
      if (!n) return '';
      const sod = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
      const days = Math.max(0, Math.round((sod(Date.now()) - sod(n)) / 864e5));
      const txt = days === 0 ? t('fmt.today') : days === 1 ? t('fmt.yesterday') : t('fmt.daysAgo', { n: days });
      const full = `${TP.fmt.date(n, { weekday: 'long', day: 'numeric', month: 'long' })} ${TP.fmt.time(n)}`;
      return `<time datetime="${esc(new Date(n).toISOString())}" title="${esc(full)}">${esc(txt)}</time>`;
    },
    timeAgo(v) {
      const n = VA.ms(v);
      if (!n) return '';
      return `<time datetime="${esc(new Date(n).toISOString())}">${esc(TP.fmt.ago(n))}</time>`;
    },

    capitalize(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); },

    sameDay(a, b) { return TP.fmt.dayKey(a) === TP.fmt.dayKey(b); },

    startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); },

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
        if (v != null) parts.push(`[${at}="${cssEsc(v)}"]`);
      }
      if (a.id) return '#' + cssEsc(a.id);
      return parts.length ? a.tagName.toLowerCase() + parts.join('') : null;
    },
    restoreFocus(root, key) {
      if (!key) return;
      try { const el = root.querySelector(key); if (el) el.focus({ preventScroll: true }); } catch { /* ignore */ }
    },

    /** Replace root content, preserving focus. Rows that stay glide to their new place, new ones fade up,
        removed ones fade out (TP.motion.flip; a no-op inside the shell's own re-render flip). */
    paint(root, html) {
      const fk = VA.focusKey(root);
      const swap = () => { root.innerHTML = html; };
      if (TP.motion && root.firstElementChild) TP.motion.flip(root, swap); else swap();
      VA.restoreFocus(root, fk);
    },

    /**
     * Search filter: hides [data-q] rows that don't match, hides sections/day blocks with no visible rows,
     * updates section counts to the filtered number (B11), toggles the shared no-results state.
     * Returns number of visible rows.
     */
    filter(root, q) {
      q = (q || '').trim();
      const rows = [...root.querySelectorAll('[data-q]')].filter((el) => !el.closest('[data-va-nofilter]'));
      const m = TP.index.matcher(q, rows.map((el) => el.getAttribute('data-q')));
      const on = !!q && !m.empty;
      // Day blocks and sections an earlier query hid are evaluated afresh (TP-168: they used to stay hidden).
      root.querySelectorAll('[data-va-qhidden]').forEach((el) => { el.hidden = false; el.removeAttribute('data-va-qhidden'); });
      const qhide = (el, hide) => { if (hide) { el.hidden = true; el.setAttribute('data-va-qhidden', ''); } else el.hidden = false; };
      let visible = 0;
      rows.forEach((el) => {
        const hit = !on || m(el.getAttribute('data-q'));
        el.hidden = !hit;
        if (hit) visible++;
      });
      // Disclosures that only hold matches inside: open them while searching.
      if (on) root.querySelectorAll('details[data-va-collapse]').forEach((d) => { if (d.querySelector('[data-q]:not([hidden])')) d.open = true; });
      const vis = (box) => [...box.querySelectorAll('[data-q]')].filter((r) => !r.hidden && !r.closest('[data-va-nofilter]') && !r.parentElement.closest('[hidden]'));
      root.querySelectorAll('[data-va-day]').forEach((day) => qhide(day, on && vis(day).length === 0));
      root.querySelectorAll('[data-va-sec]').forEach((sec) => {
        const cnt = sec.querySelector('.tp-sec-title .tp-count');
        if (cnt) {
          if (!cnt.hasAttribute('data-n')) cnt.setAttribute('data-n', cnt.textContent);
          cnt.textContent = on ? String(vis(sec).length) : cnt.getAttribute('data-n');
        }
        qhide(sec, on && vis(sec).length === 0);
      });
      TP.index.highlight(root, on ? m : '', '[data-q] .tp-row-title, [data-q] .va-cname');
      const nr = root.querySelector('.va-noresults');
      if (nr) {
        nr.hidden = !on || visible > 0;
        nr.innerHTML = on && !visible ? TP.ui.noResults(q) : '';
      }
      return visible;
    },

    isOverdue(d, now = Date.now()) { return !d.done && (d.overdue != null ? !!d.overdue : d.due < now); },

    /**
     * Deadline row (overview, deadlines). The row opens the detail sheet (F6); the check marks it done;
     * a small external-link icon opens it in Toledo.
     * opts: { prefix:'ov'|'dl', urgentDays, now, removable, showDay }
     */
    deadlineRow(d, opts = {}) {
      const now = opts.now || Date.now();
      const urgentDays = opts.urgentDays ?? 3;
      const days = TP.fmt.daysUntil(d.due);
      const overdue = VA.isOverdue(d, now);
      const urgent = !d.done && !overdue && days <= urgentDays;
      const tone = d.done ? 'muted' : overdue ? 'overdue' : urgent ? 'urgent' : 'normal';
      const p = opts.prefix || 'ov';
      const course = d.courseName || t('va.noCourse');
      VA.dls.set(String(d.key), d);

      const check = `<button type="button" class="va-check${d.done ? ' is-done' : ''}" data-action="${p}-done" data-key="${esc(d.key)}" aria-pressed="${d.done ? 'true' : 'false'}" aria-label="${esc(t(d.done ? 'va.undone' : 'va.done', { title: d.title }))}">${icon(d.done ? 'checkCircle' : 'circle', { size: 22 })}</button>`;
      const when = opts.showDay === false
        ? TP.fmt.time(d.due)
        : `${TP.fmt.date(d.due, { weekday: 'short', day: 'numeric', month: 'short' })} ${TP.fmt.time(d.due)}`;
      const sub = `${TP.ui.dot(d.color || 'var(--label-3)')}<span>${esc(course)}</span><span aria-hidden="true"> · </span><span>${esc(when)}</span>`
        + (d.source === 'custom' ? ` <span class="va-tag">${esc(t('va.own'))}</span>` : '');

      let urg;
      if (d.done) urg = `<span class="va-urg is-done">${icon('check', { size: 13 })}${esc(t('va.doneWord'))}</span>`;
      else if (overdue) urg = `<span class="va-urg is-overdue">${esc(overdueText(d.due))}</span>`;
      else if (urgent) urg = `<span class="va-urg is-urgent"><span class="va-sr">${esc(t('va.urgent'))}: </span>${esc(TP.fmt.rel(d.due))}</span>`;
      else urg = `<span class="va-urg">${esc(TP.fmt.rel(d.due))}</span>`;

      let trailing = `<span class="va-urg-wrap">${urg}</span>`;
      if (opts.removable && d.source === 'custom' && d.customId != null) {
        trailing += `<button type="button" class="va-iconbtn" data-action="${p}-remove" data-id="${esc(d.customId)}" aria-label="${esc(t('deadlines.removeLabel', { title: d.title }))}" title="${esc(t('deadlines.remove'))}">${icon('xmark', { size: 15 })}</button>`;
      }
      if (d.url) {
        trailing += `<a class="va-iconbtn va-ext" href="${esc(TP.util.abs(d.url))}" target="_blank" rel="noopener" aria-label="${esc(t('va.openToledoLabel', { title: d.title }))}" title="${esc(t('va.openToledo'))}">${icon('external', { size: 15 })}</a>`;
      }
      const main = `<button type="button" class="va-dl-open" data-action="va-dl-open" data-key="${esc(d.key)}" aria-haspopup="dialog">`
        + `<span class="tp-row-title">${esc(d.title)}</span><span class="tp-row-sub">${sub}</span><span class="va-urg-under">${urg}</span></button>`;
      return `<div class="tp-row has-lead va-dl tone-${tone}${d.done ? ' is-done' : ''}" data-key="${esc(d.key)}" data-q="${esc(TP.index.hayOf.deadline(d))}">`
        + `<span class="tp-row-lead">${check}${TP.ui.dateTile(d.due, { tone })}</span><span class="tp-row-main">${main}</span><span class="tp-row-trail">${trailing}</span></div>`;
    },
    dls: new Map(), // deadline key → deadline (for the sheet)

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
      const flushed = done.then(() => (TP.data.flush ? TP.data.flush() : null)).catch(() => {});
      await Promise.race([flushed, new Promise((r) => setTimeout(r, 1200))]);
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

    /** Ultra course id + content id from a Toledo/Ultra deadline URL (redirect links, outline paths). */
    itemIds(url) {
      let s = String(url || '');
      try { s = decodeURIComponent(s); } catch { /* keep raw */ }
      const cid = (s.match(/course_?[iI]d=(_\d+_\d+)/) || s.match(/courses\/(_\d+_\d+)/) || [])[1] || null;
      const id = (s.match(/content_?[iI]d=(_\d+_\d+)/) || s.match(/contents?\/(_\d+_\d+)/) || s.match(/outline\/[a-z]+\/(_\d+_\d+)/) || [])[1] || null;
      return { cid, id };
    },

    /** "Open in vak": the course in Toledo+, with the assignment unfolded and highlighted (state.focus, like ⌘K). */
    async openInCourse(d) {
      const { cid, id } = VA.itemIds(d.url);
      if (id) {
        try { await TP.state.set({ focus: { cid: cid || null, luId: d.courseLuId || null, id, at: Date.now() } }); } catch { /* best effort */ }
      }
      try { if (TP.data.flush) await Promise.race([TP.data.flush(), new Promise((r) => setTimeout(r, 1200))]); } catch { /* best effort */ }
      if (cid && TP.shell.origin === 'ultra') location.assign(TP.shell.href('course', { cid }));
      else if (d.courseLuId) location.assign(TP.shell.href('course', { luId: d.courseLuId }));
      else if (cid) location.assign(TP.shell.href('course', { cid }));
    },

    /** Single-event .ics for one deadline ("Zet in agenda"). */
    icsOne(d, root) {
      let ics = '';
      try { ics = TP.data.ics([d]); } catch (err) { console.warn('[Toledo+] ics', err); return; }
      const slug = String(d.title || 'deadline').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deadline';
      VA.downloadText(root, ics, `${slug}.ics`, 'text/calendar;charset=utf-8');
      VA.toast(t('va.icsDone'));
    },

    /** F6: deadline detail sheet (title, course, due + relative, source, description when available, actions). */
    openDeadline(d, opener, root) {
      if (!d || !TP.shell.detail) return;
      const now = Date.now();
      const overdue = VA.isOverdue(d, now);
      const { cid, id } = VA.itemIds(d.url);
      const st = { body: null, loading: false };
      const metaRow = (ic, label, value) => TP.ui.row({ leading: `<span class="tp-tile">${icon(ic, { size: 16 })}</span>`, title: value, subtitle: esc(label) });
      const html = () => {
        const urg = d.done ? t('va.doneWord') : overdue ? overdueText(d.due) : VA.capitalize(TP.fmt.rel(d.due));
        const due = `${VA.capitalize(TP.fmt.date(d.due, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${TP.fmt.time(d.due)}`;
        const meta = [
          metaRow('courses', t('va.sheet.course'), `${TP.ui.dot(d.color || 'var(--label-3)')} ${esc(d.courseName || t('va.noCourse'))}`),
          metaRow('clock', t('va.sheet.due'), `${esc(due)} <span class="va-urg ${d.done ? 'is-done' : overdue ? 'is-overdue' : ''}">· ${esc(urg)}</span>`),
          metaRow(d.source === 'custom' ? 'person' : 'doc', t('va.sheet.source'), esc(t('va.source.' + (['toledo', 'ultra', 'custom'].includes(d.source) ? d.source : 'toledo')))),
        ].join('');
        let desc = '';
        if (st.loading) desc = TP.ui.group(`<p class="tp-detail-desc va-muted">${esc(t('common.loading'))}</p>`);
        else if (st.body) desc = TP.ui.group(`<div class="tp-detail-desc tp-prose">${TP.util.sanitize(st.body)}</div>`);
        const btn = (action, ic, label) => `<button type="button" class="tp-row has-lead" data-detail-action="${esc(action)}"><span class="tp-row-lead"><span class="tp-tile">${icon(ic, { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(label)}</span></span></button>`;
        const actions = [
          d.courseLuId || cid ? btn('course', 'courses', t('va.sheet.openCourse')) : '',
          d.url ? `<a class="tp-row has-lead" href="${esc(TP.util.abs(d.url))}" target="_blank" rel="noopener"><span class="tp-row-lead"><span class="tp-tile">${icon('external', { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(t('va.openToledo'))}</span></span><span class="va-sr">${esc(t('va.newTab'))}</span></a>` : '',
          btn('done', d.done ? 'circle' : 'checkCircle', t(d.done ? 'va.sheet.markOpen' : 'va.sheet.markDone')),
          btn('ics', 'calendar', t('va.addToCalendar')),
          d.source === 'custom' && d.customId != null ? btn('remove', 'trash', t('deadlines.remove')) : '',
        ].filter(Boolean).join('');
        return `${TP.ui.group(meta, { cls: 'tp-detail-meta' })}${desc}${TP.ui.group(actions, { cls: 'tp-detail-actions' })}`
          + `<p class="va-foot">${esc(t('deadlines.honest'))}</p>`;
      };
      TP.shell.detail.open({
        title: d.title,
        html: html(),
        opener,
        async onAction(action) {
          if (action === 'course') { TP.shell.detail.close(); await VA.openInCourse(d); return; }
          if (action === 'ics') { VA.icsOne(d, root); return; }
          if (action === 'done') {
            await TP.data.toggleDone(d.key);
            d.done = !d.done;
            VA.announce(t(d.done ? 'va.markedDone' : 'va.markedOpen'));
            TP.shell.detail.update(html());
            return;
          }
          if (action === 'remove') { TP.shell.detail.close(); await TP.data.removeCustomDeadline(d.customId); VA.toast(t('deadlines.removed')); }
        },
      });
      // Assignment text from Ultra when the data layer can give it (cache or TP.data.ultraItem).
      const getter = cid && id && typeof TP.data.ultraItem === 'function' ? () => TP.data.ultraItem(cid, id) : null;
      if (getter) {
        st.loading = true;
        TP.shell.detail.update(html());
        Promise.resolve().then(getter).then((n) => {
          st.body = n && (n.body || n.description) ? String(n.body || n.description) : null;
        }).catch(() => { st.body = null; }).finally(() => {
          st.loading = false;
          if (TP.shell.detail.isOpen()) TP.shell.detail.update(html());
        });
      }
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
    const greet = t('overview.greet.' + k);
    // First name from Ultra (TP.data.userName, cached locally); without it just the greeting.
    let name = '';
    try { name = (TP.data.userName && TP.data.userName()) || ''; } catch { name = ''; }
    return name ? t('overview.greet.named', { greet, name }) : greet;
  }
  let askedName = false;
  function askName() {
    if (askedName || !TP.data.loadUser) return;
    askedName = true;
    try { if (!TP.data.userName()) Promise.resolve(TP.data.loadUser()).catch(() => {}); } catch { /* best effort */ }
  }

  function subtitle() {
    const date = VA.capitalize(TP.fmt.date(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' }));
    const lu = TP.data.lastUpdated && TP.data.lastUpdated();
    // never "Gegevens laden…" forever: after a failed first load the shell's error line says it
    const upd = lu ? t('overview.updated', { time: TP.fmt.time(lu) }) : VA.state(['events', 'enrollments']) === 'loading' ? t('overview.loading') : '';
    return `<span>${esc(date)}</span>${upd ? `<span aria-hidden="true"> · </span><span>${esc(upd)}</span>` : ''}`;
  }

  function section(id, opts) {
    const html = TP.ui.section({ id: 'ov-' + id, ...opts });
    return VA.addAttrs(html, { 'data-va-sec': id });
  }

  function linkRow(href, label, extra = {}) {
    return TP.ui.row({ href, title: esc(label), chevron: true, cls: 'va-more', ...extra });
  }

  /* ---------- Onboarding (F10) ---------- */
  function onboarded() {
    try { return !!(((TP.state.get() || {}).ui || {}).onboarded); } catch { return true; }
  }
  function onboardingCard() {
    if (onboarded()) return '';
    const li = (k) => `<li>${icon('checkCircle', { size: 16 })}<span>${esc(t(k))}</span></li>`;
    // Branded intro (v1.6): an ink card in both themes with the glyph (clear space ≥ ¼ of its width), short copy,
    // the three bullets, the privacy line and one primary button. Premium, not loud: no gradients on the logo, no glow.
    const glyph = TP.ui.logo ? TP.ui.logo({ variant: 'glyph', size: 56 }) : '';
    return `<section class="va-onboard" aria-labelledby="va-onboard-h" data-va-nofilter>
      <button type="button" class="va-onboard-x" data-action="ov-onboard-close" aria-label="${esc(t('overview.onboard.close'))}">${icon('xmark', { size: 16 })}</button>
      <div class="va-onboard-head"><span class="va-onboard-glyph">${glyph}</span>
        <div class="va-onboard-titles"><h2 id="va-onboard-h">${esc(t('overview.onboard.title'))}</h2><p class="va-onboard-lead">${esc(t('overview.onboard.lead'))}</p></div></div>
      <ul>${li('overview.onboard.what')}${li('overview.onboard.classic')}${li('overview.onboard.read')}</ul>
      <p class="va-onboard-privacy">${esc(t('telemetry.onboarding'))}</p>
      <div class="va-onboard-actions"><button type="button" class="tp-btn va-onboard-ok" data-action="ov-onboard-close"><span>${esc(t('overview.onboard.ok'))}</span></button></div>
    </section>`;
  }

  /* ---------- Deadlines ---------- */
  function secDeadlines(st) {
    const cfg = st.deadlines || {};
    const horizon = cfg.horizonDays || 42;
    const now = Date.now();
    let body;
    const all = TP.data.deadlines({ includeDone: true, horizonDays: horizon }) || [];
    // B2: overdue items stay until marked done, however old (most recent first); then what is coming up.
    const overdue = all.filter((d) => VA.isOverdue(d, now)).sort((a, b) => b.due - a.due);
    const kept = all.filter((d) => d.done && S.doneKeep.has(d.key));
    const coming = all.filter((d) => !d.done && !VA.isOverdue(d, now) && d.due <= now + horizon * DAY);
    const list = [...overdue.slice(0, 3), ...kept, ...coming].filter((d, i, a) => a.indexOf(d) === i).slice(0, 5);
    const state = VA.state('events');
    if (!list.length && state === 'loading') body = VA.skeleton(3, { lead: 'date' });
    else if (!list.length && state === 'error') body = VA.errorBlock(t('overview.deadlines.error'), 'events');
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.deadlines.empty', { n: horizon })));
    else {
      const rows = list.map((d) => VA.deadlineRow(d, { prefix: 'ov', urgentDays: cfg.urgentDays ?? 3, now })).join('');
      body = (state !== 'ok' && state !== 'loading' ? VA.errorBlock(t('overview.deadlines.error'), 'events') : '')
        + TP.ui.group(rows, { cls: 'va-dl-group' });
    }
    const more = overdue.length > 3 ? t('overview.deadlines.allOverdue', { n: overdue.length }) : t('overview.deadlines.all');
    const actions = [{ action: 'ov-nav', label: more, attrs: { 'data-route': 'deadlines', href: TP.shell.href('deadlines') } }];
    return section('deadlines', { title: esc(t('overview.deadlines.title')), actions, body });
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
      g.items.sort((a, b) => VA.ms(b.date) - VA.ms(a.date));
      g.latest = g.items.length ? VA.ms(g.items[0].date) : g.latest;
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
      trailing: VA.timeAgo(e.date),
      strong: !read, // B12: one unread style everywhere (weight 600; the group carries the dot/badge)
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
    const latest = VA.timeAgo(g.latest);
    const badge = unread.length ? TP.ui.badge(unread.length, { tone: 'tint', label: t('overview.new.badge', { n: unread.length }) }) : '';
    const html = TP.ui.disclosure({
      id: 'ov-fg-' + g.luId,
      open: S.open.has(String(g.luId)),
      summary: {
        leading: TP.ui.dot(g.color || 'var(--label-3)'),
        title: esc(g.name),
        strong: unread.length > 0,
        subtitle: esc(summaryLine(unread.length ? unread : g.items) || t('overview.kind.read')),
        // time first, count last: counts line up at the right edge whatever the time says ("16:21", "gisteren", "donderdag")
        trailing: `<span class="va-feed-trail">${latest}${badge || '<span class="va-badge-slot" aria-hidden="true"></span>'}</span>`,
      },
      body: `<div class="va-feed-body">${items}${more}</div>`,
      q: String(g.name || '').toLowerCase(),
    });
    return VA.addAttrs(html, { 'data-lu': String(g.luId), 'data-name': String(g.name || '').toLowerCase(), hidden: hidden || null });
  }

  function secNew(st) {
    const max = Math.max(1, (st.feed && st.feed.maxCourses) || 5);
    const state = VA.state(['events', 'enrollments']);
    const groups = feedWithKept();
    const total = groups.reduce((n, g) => n + g.items.filter((e) => !S.kept.has(String(e.id)) && !e.read).length, 0);
    let body = '';
    if (state === 'error' || state === 'stale-error') body += VA.errorBlock(t('overview.new.error'), ['events', 'enrollments']);
    if (state === 'loading' && !groups.length) {
      body += VA.skeleton(3, { lead: 'dot' });
    } else if (!groups.length) {
      if (state === 'ok') body += TP.ui.group(TP.ui.empty(t('overview.new.empty'), { timestamp: TP.data.lastUpdated && TP.data.lastUpdated() }));
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
      subtitle: `${esc(r.courseName || '')}${r.ts ? `<span aria-hidden="true"> · </span>${VA.timeAgo(r.ts)}` : ''}`,
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
    try { list = TP.shell.sortCourses ? TP.shell.sortCourses(list) : list; } catch { /* keep data order */ }
    const state = VA.state('enrollments');
    let body;
    if (!list.length && state === 'loading') body = VA.skeleton(2, { lead: 'dot' });
    else if (!list.length && state === 'error') body = VA.errorBlock(t('overview.courses.error'), 'enrollments');
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.courses.empty')));
    else {
      body = `<ul class="va-cgrid" role="list">${list.map((c) => {
        const badge = c.unread ? TP.ui.badge(c.unread, { tone: 'tint', label: t('overview.new.badge', { n: c.unread }) }) : '';
        return `<li data-q="${esc(TP.index.hayOf.course(c))}">
          <a class="va-ccard${c.available === false ? ' is-dim' : ''}" href="${esc(TP.shell.href('course', { luId: c.luId }))}" title="${esc(c.title || c.name)}">
            <span class="va-swatch" style="--c:${esc(c.color || 'var(--tint)')}" aria-hidden="true"></span>
            <span class="va-cname">${esc(c.name)}</span>
            ${badge}
          </a></li>`;
      }).join('')}</ul>`;
    }
    const actions = [{ action: 'ov-nav', label: t('overview.courses.all'), attrs: { 'data-route': 'courses' } }];
    return section('courses', { title: esc(t('overview.courses.title')), actions, body });
  }

  /** "3 d te laat" (whole days past due), or "Te laat" on the day itself. Same wording everywhere. */
  function overdueText(due) {
    const n = Math.floor((Date.now() - due) / 864e5);
    return n >= 1 ? t('va.overdueBy', { n }) : t('va.overdue');
  }

  /* ---------- Schedule ---------- */
  // Accepts a TP.data.schedule() item (portal "upcoming") or a TP.kuloket Lesson.
  function lessonRow(s, prefixQ = '') {
    const kul = !!(s && (s.source === 'kuloket' || s.source === 'ics' || Array.isArray(s.teachers)));
    const L = s.location || {};
    const loc = kul
      ? [L.room || [L.mnemonic, L.roomNumber].filter((x) => x && x !== '?').join(' '), L.building].filter(Boolean).join(' · ')
      : [L.mnemonic, L.roomNumber].filter((x) => x && x !== '?').join(' ');
    const teachers = kul ? (s.teachers || []).filter(Boolean).join(', ') : '';
    let course = null;
    try { course = s.courseLuId && TP.data.course ? TP.data.course(s.courseLuId) : null; } catch { course = null; }
    const color = s.color || (course && course.color)
      || (s.source && typeof s.source.color === 'number' ? TP.util.colorForIndex(s.source.color) : 'var(--label-3)');
    const name = kul ? ((course && course.name) || s.title || '') : s.name;
    const link = kul ? (s.courseLuId ? TP.shell.href('course', { luId: s.courseLuId }) : null) : (s.source && s.source.link);
    const sub = [loc || t('overview.schedule.noLocation'), teachers].filter(Boolean).join(' · ');
    return TP.ui.row({
      href: link || undefined,
      leading: `<span class="va-time"><span>${esc(TP.fmt.time(s.start))}</span><span>${esc(TP.fmt.time(s.end))}</span></span><span class="va-bar" style="--c:${esc(color)}" aria-hidden="true"></span>`,
      title: esc(name) + (kul && s.kind === 'examen' ? ` <span class="va-tag">${esc(t('overview.schedule.exam'))}</span>` : ''),
      subtitle: esc(sub),
      q: TP.index.hayOf.lesson({ ...s, title: name, teachers: kul ? s.teachers : [] }, [prefixQ, loc]),
      cls: 'va-lesson',
    });
  }
  TP.viewsA.lessonRow = lessonRow;
  TP.viewsA.overdueText = overdueText;

  let kulAsked = '';
  /** Lessons for today + tomorrow: KU Loket when it has them, else Toledo's own "upcoming". */
  function lessonsByDay() {
    const sod = VA.startOfToday();
    const range = { from: sod, to: sod + 2 * DAY };
    const K = TP.kuloket;
    let kul = null;
    let status = null;
    try { kul = K && typeof K.peekLessons === 'function' ? K.peekLessons(range) : null; } catch { kul = null; }
    try { status = K && typeof K.status === 'function' ? K.status() : null; } catch { status = null; }
    if (K && kul == null && typeof K.lessons === 'function' && kulAsked !== TP.fmt.dayKey(sod)) {
      kulAsked = TP.fmt.dayKey(sod); // ask once per day; TP.kuloket 'change' re-renders
      Promise.resolve().then(() => K.lessons(range)).catch(() => {});
    }
    const kulOk = Array.isArray(kul) && !(status && status.lessons && status.lessons.error && !kul.length);
    if (kulOk) {
      const by = {};
      for (const l of kul) if (l && l.start) (by[TP.fmt.dayKey(l.start)] ||= []).push(l);
      return { source: 'kuloket', by, state: 'ok' };
    }
    let sched = {};
    try { sched = TP.data.schedule() || {}; } catch { sched = {}; }
    return { source: 'toledo', by: sched, state: VA.state('upcoming') };
  }

  function secSchedule() {
    const now = Date.now();
    const days = [[now, 'overview.schedule.today'], [now + DAY, 'overview.schedule.tomorrow']];
    const { source, by, state } = lessonsByDay();
    let body;
    if (state === 'loading') body = VA.skeleton(2, { lead: 'none' });
    else if (state === 'error') body = VA.errorBlock(t('overview.schedule.error'), 'upcoming');
    else {
      // One card (its top lines up with the Deadlines card); "Vandaag" / "Morgen" are sub-headings inside it.
      body = TP.ui.group(days.map(([ms, key]) => {
        const list = (by[TP.fmt.dayKey(ms)] || []).slice().sort((a, b) => a.start - b.start);
        const head = `<h3 class="va-dayhead">${esc(t(key))} <span>${esc(TP.fmt.date(ms, { weekday: 'short', day: 'numeric', month: 'short' }))}</span></h3>`;
        const rows = list.length ? list.map((s) => lessonRow(s)).join('') : `<p class="va-dayempty">${esc(t('overview.schedule.none'))}</p>`;
        return `<div class="va-day" data-va-day>${head}${rows}</div>`;
      }).join(''));
    }
    const actions = [{ action: 'ov-nav', label: t('overview.schedule.agenda'), attrs: { 'data-route': 'agenda', href: TP.shell.href('agenda') } }];
    const footer = source === 'kuloket' ? '' : esc(t('overview.schedule.note'));
    return section('schedule', { title: esc(t('overview.schedule.title')), actions, body, footer });
  }

  /* ---------- Announcements ---------- */
  function annRow(e) {
    S.events.set(String(e.id), e);
    const p = VA.annParts(e, !e.read);
    return TP.ui.row({
      href: e.url ? TP.util.abs(e.url) : '#',
      attrs: { 'data-action': 'ov-ann', 'data-eid': String(e.id), 'aria-haspopup': 'dialog' }, // opens TP.annSheet (Ad Valvas too)
      title: esc(e.title),
      subtitle: p.subtitle,
      trailing: p.trailing,
      chevron: true,
      strong: !e.read,
      q: TP.index.hayOf.announcement(e),
      cls: 'va-ann va-ann-row' + (e.read ? ' is-read' : ''),
    });
  }

  function secAnnouncements() {
    let list = [];
    try { list = (TP.data.announcements({ filter: 'all' }) || []).slice(0, 5); } catch { list = []; }
    const state = VA.state('events');
    let body;
    if (!list.length && state === 'loading') body = VA.skeleton(3, { lead: 'dot' });
    else if (!list.length && state === 'error') body = VA.errorBlock(t('overview.ann.error'), 'events');
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.ann.empty')));
    else body = TP.ui.group(list.map(annRow).join(''));
    const actions = [{ action: 'ov-nav', label: t('overview.ann.all'), attrs: { 'data-route': 'announcements', href: TP.shell.href('announcements') } }];
    return section('announcements', { title: esc(t('overview.ann.title')), actions, body });
  }

  /* ---------- Links ---------- */
  function secLinks() {
    let links = [];
    try { links = TP.data.quickLinks() || []; } catch { links = []; }
    const state = VA.state('links');
    let body;
    if (links.length) {
      body = TP.ui.group(links.map((l) => TP.ui.row({
        href: l.url,
        attrs: { target: '_blank', rel: 'noopener' },
        leading: `<span class="va-tile">${icon('external', { size: 15 })}</span>`,
        title: esc(l.title || l.label) + `<span class="va-sr"> ${esc(t('va.newTab'))}</span>`,
        q: String(l.title || l.label || '').toLowerCase(),
      })).join(''));
    } else if (state === 'loading') body = VA.skeleton(2);
    else if (state === 'error') body = VA.errorBlock(t('overview.links.error'), 'links');
    else body = TP.ui.group(TP.ui.empty(t('overview.links.empty')));
    return section('links', { title: esc(t('overview.links.title')), body });
  }

  /* ---------- Search ---------- */
  function applySearch(root, q) {
    const feed = root.querySelector('.va-feed');
    // Feed: work on all groups (incl. ones beyond maxCourses) and all items (incl. beyond 3).
    if (feed) feed.setAttribute('data-va-nofilter', '');
    VA.filter(root, q);
    const m = TP.index.matcher(q, feed ? [...feed.querySelectorAll('details[data-lu], .va-feed-item')].map((el) => el.getAttribute('data-name') || el.getAttribute('data-q')) : []);
    q = m.empty ? '' : q;
    let feedHits = 0;
    let itemHits = 0;
    if (feed) {
      feed.querySelectorAll('details[data-lu]').forEach((d) => {
        const groupHit = !!q && m(d.getAttribute('data-name') || '');
        let itemHit = false;
        d.querySelectorAll('.va-feed-item').forEach((r) => {
          const own = !!q && m(r.getAttribute('data-q') || '');
          const hit = !q ? !r.classList.contains('va-extra') : (groupHit || own);
          r.hidden = !hit;
          if (q && hit && !r.classList.contains('is-read')) itemHits++;
          if (own) itemHit = true;
        });
        d.querySelectorAll('.va-feed-more').forEach((x) => { x.hidden = !!q; });
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
      // B11: the "Nieuw" count follows the filter.
      const cnt = sec && sec.querySelector('.tp-sec-title .tp-count');
      if (cnt) cnt.textContent = q ? String(itemHits) : cnt.getAttribute('data-n') || cnt.textContent;
      const nr = root.querySelector('.va-noresults');
      if (nr && q && feedHits) { nr.hidden = true; nr.innerHTML = ''; }
    }
  }

  /* ---------- Events ---------- */
  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    const act = el.getAttribute('data-action');
    switch (act) {
      case 'ov-ann': // announcements section → the announcement sheet, stepping through that section's rows
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
        const isAnn = e.subType === 'announcement' || e.subType === 'advalvas' || e.type === 'advalvas';
        if (isAnn && TP.annSheet && !(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0)) {
          ev.preventDefault();
          const sec = el.closest('[data-va-sec], section') || ctx.root;
          const rows = act === 'ov-ann' ? [...sec.querySelectorAll('[data-action="ov-ann"][data-eid]')] : [el];
          TP.annSheet.open(e, {
            list: rows.map((r) => S.events.get(r.getAttribute('data-eid'))).filter(Boolean),
            opener: el,
            rowFor: (it) => { try { return S.ctx && S.ctx.root.querySelector(`[data-action="${act}"][data-eid="${VA.cssEsc(it.key)}"]`); } catch { return null; } },
          });
          return;
        }
        await VA.openEvent(ev, el, e);
        break;
      }
      case 'va-dl-open': {
        ev.preventDefault();
        VA.openDeadline(VA.dls.get(el.getAttribute('data-key')), el, ctx.root);
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
      case 'ov-onboard-close': {
        ev.preventDefault();
        const ui = ((TP.state.get() || {}).ui) || {};
        await TP.state.set({ ui: { ...ui, onboarded: true } });
        render(ctx); // the shell does not re-render on state.ui
        try { ctx.root.closest('main')?.querySelector('.tp-large-title')?.focus({ preventScroll: true }); } catch { /* ignore */ }
        VA.announce(t('overview.onboard.closed'));
        break;
      }
      case 'va-retry': {
        ev.preventDefault();
        await VA.retry(el);
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
    askName(); // state.me changes re-render the shell (and so this title)
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
    VA.paint(ctx.root, `<div class="va-view va-overview">${onboardingCard()}${layout}<div class="va-noresults" hidden></div></div>`);
    if (S.q) applySearch(ctx.root, S.q);
  }

  TP.shell.register('overview', {
    title: () => greeting(),
    searchPlaceholder: () => t('overview.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim();
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
