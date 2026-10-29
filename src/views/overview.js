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
      // the sender ("Docent A", "Studentenadministratie"): how a student judges a notice, and what the search matches (TP-198)
      const by = e.author && String(e.author).trim() !== src ? String(e.author).trim() : '';
      return {
        src,
        subtitle: `${TP.ui.dot(color)}<span>${esc(src)}</span>${by ? `<span aria-hidden="true"> · </span><span class="va-author">${esc(by)}</span>` : ''}`, // every row opens the announcement sheet (no new tab)
        // time first, "Nieuw" last (an invisible copy on read rows): pills and times line up whatever the time says
        trailing: `${VA.daysAgo(e.date)}${unread ? TP.ui.badge(t('course.new'), { tone: 'tint', label: t('course.new') })
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

    /** Remember which control had focus so a re-render can restore it (TP.shell.focus: the same control by its
        keys; when it is gone — e.g. "Mark all read" removed its own button — the next row or the section heading). */
    focusKey(root) { return TP.shell.focus.snap(root); },
    restoreFocus(root, key) { TP.shell.focus.restore(key, { scope: root }); },

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
      const when = opts.showDay === false ? TP.fmt.time(d.due) : TP.fmt.when(d.due);
      const sub = `${TP.ui.dot(d.color || 'var(--label-3)')}<span>${esc(course)}</span><span aria-hidden="true"> · </span><span>${esc(when)}</span>`
        + (d.source === 'custom' ? ` <span class="va-tag">${esc(t('va.own'))}</span>` : '');

      let urg;
      if (d.done) urg = `<span class="va-urg is-done">${icon('check', { size: 13 })}${esc(t('va.doneWord'))}</span>`;
      else if (overdue) urg = `<span class="va-urg is-overdue">${esc(overdueText(d.due))}</span>`;
      else if (urgent) urg = `<span class="va-urg is-urgent"><span class="va-sr">${esc(t('va.urgent'))}: </span>${esc(TP.fmt.rel(d.due))}</span>`;
      else urg = `<span class="va-urg">${esc(TP.fmt.rel(d.due))}</span>`;

      let trailing = `<span class="va-urg-wrap">${urg}</span>`;
      if (opts.removable && d.source === 'custom' && d.customId != null) { // deleting offers Undo (VA.removeCustom)
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
      VA.downloadText(root, ics, `${TP.data.icsName(d.title, 'deadline')}.ics`, 'text/calendar;charset=utf-8');
      VA.toast(t('va.icsDone'));
    },

    /** Delete an own deadline; the toast offers Undo (same id → same key, so a "klaar" mark comes back too). */
    async removeCustom(id) {
      const item = await TP.data.removeCustomDeadline(id);
      if (item && TP.ui.undoToast) {
        TP.ui.undoToast(t('deadlines.removed'), async () => {
          await TP.data.addCustomDeadline(item);
          VA.announce(t('deadlines.restored'));
        });
      } else VA.toast(t('deadlines.removed'));
    },

    /** "2026-03-28" + "02:30" → { due, shifted } in local time. shifted: that wall-clock time does not exist on that
     *  day (the clocks go forward), so the date moved it (TP-220); the caller says so. */
    parseDue(date, time) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
      const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time || '23:59'));
      if (!m || !tm) return null;
      const due = new Date(+m[1], +m[2] - 1, +m[3], +tm[1], +tm[2]).getTime();
      const back = new Date(due);
      if (!Number.isFinite(due) || back.getMonth() !== +m[2] - 1 || back.getDate() !== +m[3] || +tm[1] > 23 || +tm[2] > 59) return null; // 2026-02-30
      const shifted = TP.fmt.time(due) !== `${String(+tm[1]).padStart(2, '0')}:${tm[2]}`;
      return { due, shifted };
    },

    /** Form fields shared by "Eigen deadline toevoegen" and the sheet's edit form. v: {title, courseLuId, date, time} */
    deadlineFields(v, courseOpts) {
      const today = TP.fmt.dayKey(Date.now());
      const z = TP.fmt.zone();
      return `<label class="va-field"><span>${esc(t('deadlines.add.name'))}</span>
        <input name="title" type="text" required maxlength="200" autocomplete="off" placeholder="${esc(t('deadlines.add.placeholder'))}" value="${esc(v.title || '')}"></label>
      <label class="va-field"><span>${esc(t('deadlines.add.course'))}</span>
        <select name="courseLuId">${courseOpts.map((o) => `<option value="${esc(o.value)}"${String(v.courseLuId || '') === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <div class="va-field-row">
        <label class="va-field"><span>${esc(t('deadlines.add.date'))}</span>
          <input name="date" type="date" required${v.min === false ? '' : ` min="${esc(today)}"`} value="${esc(v.date || '')}"></label>
        <label class="va-field"><span>${esc(t('deadlines.add.time'))}</span>
          <input name="time" type="time" value="${esc(v.time || '23:59')}"${z ? ` aria-describedby="va-zone-note"` : ''}></label>
      </div>
      ${z ? `<p class="va-foot" id="va-zone-note">${esc(t('time.zoneForm', { zone: z }))}</p>` : ''}`;
    },

    courseOptions() {
      let courses = [];
      try { courses = TP.data.courses({ currentOnly: true }) || []; } catch { courses = []; }
      return [{ value: '', label: t('va.noCourse') }, ...courses.filter((c) => !c.hidden).map((c) => ({ value: String(c.luId), label: c.name }))];
    },

    /** TP-217: one line on time-based pages when this device is not on Belgian time ("Tijden in je eigen tijdzone (GMT+9)"). */
    zoneNote() {
      const z = TP.fmt.zone();
      return z ? `<p class="va-zone-note" role="note">${icon('clock', { size: 14 })}<span>${esc(t('time.zoneNote', { zone: z }))}</span></p>` : '';
    },

    /** Exams by id (for the exam sheet; rows carry data-xid). */
    exams: new Map(),

    /** TP-018: an exam opens the same kind of sheet as a deadline: when (and how long), where, who, Add to calendar. */
    openExam(e, opener, root) {
      if (!e || !TP.shell.detail) return;
      let c = null;
      try { c = e.courseLuId && TP.data.course ? TP.data.course(e.courseLuId) : null; } catch { c = null; }
      const name = (c && c.name) || e.title || '';
      const L = e.location || {};
      const metaRow = (ic, label, value) => (value ? TP.ui.row({ leading: `<span class="tp-tile">${icon(ic, { size: 16 })}</span>`, title: value, subtitle: esc(label) }) : '');
      const nt = `<span class="va-sr">${esc(t('va.newTab'))}</span>`;
      const where = [L.room || L.mnemonic, L.building && L.building !== L.room ? L.building : '', L.street, L.city].filter(Boolean).map(esc).join('<br>');
      const when = `${esc(VA.capitalize(TP.fmt.date(e.start, { weekday: 'long', day: 'numeric', month: 'long', ...(new Date(e.start).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })))}<br>${esc(TP.fmt.timeRange(e.start, e.end))}`
        + `${TP.fmt.zone(e.start) ? ` <span class="va-zone">${esc(t('time.zoneShort', { zone: TP.fmt.zone(e.start) }))}</span>` : ''} <span class="va-urg">· ${esc(VA.capitalize(TP.fmt.rel(e.start)))}</span>`;
      const meta = [
        metaRow('courses', t('va.sheet.course'), `${TP.ui.dot((c && c.color) || 'var(--label-3)')} ${esc(name)}${e.courseCode ? ` <span class="va-muted">${esc(e.courseCode)}</span>` : ''}`),
        metaRow('clock', t('va.sheet.when'), when),
        metaRow('location', t('va.sheet.room'), where + (L.url ? `${where ? '<br>' : ''}<a href="${esc(L.url)}" target="_blank" rel="noopener">${esc(t('agenda.pop.map'))} ›${nt}</a>` : '')),
        metaRow('person', t('agenda.pop.teachers'), (e.teachers || []).map(esc).join('<br>')),
        metaRow('info', t('agenda.pop.info'), esc([e.text, e.group].filter(Boolean).join(' · '))),
      ].join('');
      const btn = (action, ic, label) => `<button type="button" class="tp-row has-lead" data-detail-action="${esc(action)}"><span class="tp-row-lead"><span class="tp-tile">${icon(ic, { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(label)}</span></span></button>`;
      const actions = [
        e.courseLuId ? btn('course', 'courses', t('va.sheet.openCourse')) : '',
        btn('ics', 'calendar', t('va.addToCalendar')),
        btn('agenda', 'planning', t('va.sheet.inAgenda')),
      ].filter(Boolean).join('');
      TP.shell.detail.open({
        title: `${t('agenda.exam')}: ${name}`,
        html: `${TP.ui.group(meta, { cls: 'tp-detail-meta' })}${TP.ui.group(actions, { cls: 'tp-detail-actions' })}<p class="va-foot">${esc(t('agenda.pop.source.kuloket'))}</p>`,
        opener,
        onAction(action) {
          if (action === 'course') { TP.shell.detail.close(); location.assign(TP.shell.href('course', { luId: e.courseLuId })); return; }
          if (action === 'agenda') { TP.shell.detail.close(); TP.shell.navigate('agenda', { id: TP.fmt.dayKey(e.start) }); return; }
          if (action === 'ics') {
            let ics = '';
            try { ics = TP.data.ics([], { exams: [e], name: 'Toledo+' }); } catch (err) { console.warn('[Toledo+] ics', err); return; }
            VA.downloadText(root, ics, `${TP.data.icsName(`${t('agenda.exam')} ${name}`, 'examen')}-${TP.fmt.dayKey(e.start)}.ics`, 'text/calendar;charset=utf-8');
            VA.toast(t('va.icsDone'));
          }
        },
      });
    },

    /** Upcoming KU Loket exams (TP.kuloket, optional), soonest first. opts.course: 'all' | 'none' | luId. */
    upcomingExams(opts = {}) {
      let list = null;
      try { list = TP.kuloket && typeof TP.kuloket.peekExams === 'function' ? TP.kuloket.peekExams() : null; } catch { list = null; }
      const now = Date.now();
      const course = opts.course || 'all';
      return (Array.isArray(list) ? list : []).filter((e) => e && e.start && (e.end || e.start) >= now)
        .filter((e) => course === 'all' || (course === 'none' ? !e.courseLuId : String(e.courseLuId || '') === course))
        .filter((e) => !opts.within || e.start <= now + opts.within)
        .sort((a, b) => a.start - b.start);
    },

    /** F6: deadline detail sheet (title, course, due + relative, source, description when available, actions).
     *  Own deadlines can be edited in place (TP-207) and deleted with Undo (TP-208). */
    openDeadline(d, opener, root) {
      if (!d || !TP.shell.detail) return;
      const { cid, id } = VA.itemIds(d.url);
      const st = { body: null, loading: false, edit: false, err: '' };
      const metaRow = (ic, label, value) => TP.ui.row({ leading: `<span class="tp-tile">${icon(ic, { size: 16 })}</span>`, title: value, subtitle: esc(label) });
      const btn = (action, ic, label) => `<button type="button" class="tp-row has-lead" data-detail-action="${esc(action)}"><span class="tp-row-lead"><span class="tp-tile">${icon(ic, { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(label)}</span></span></button>`;
      const own = d.source === 'custom' && d.customId != null;
      const editHtml = () => {
        const v = { title: d.title, courseLuId: d.courseLuId || '', date: TP.fmt.dayKey(d.due), time: TP.fmt.time(d.due), min: false };
        return TP.ui.group(`<div class="va-form va-edit" data-form="dl-edit">${VA.deadlineFields(v, VA.courseOptions())}
          <p class="va-form-error" role="alert"${st.err ? '' : ' hidden'}>${esc(st.err)}</p>
          <div class="va-form-actions"><button type="button" class="tp-btn tp-btn-gray" data-detail-action="edit-cancel"><span>${esc(t('common.cancel'))}</span></button>
          <button type="button" class="tp-btn tp-btn-filled" data-detail-action="edit-save"><span>${esc(t('deadlines.edit.save'))}</span></button></div></div>`);
      };
      const html = () => {
        if (st.edit) return editHtml();
        const overdue = VA.isOverdue(d, Date.now());
        const urg = d.done ? t('va.doneWord') : overdue ? overdueText(d.due) : VA.capitalize(TP.fmt.rel(d.due));
        const due = TP.fmt.when(d.due, 'long', { zone: true });
        const meta = [
          metaRow('courses', t('va.sheet.course'), `${TP.ui.dot(d.color || 'var(--label-3)')} ${esc(d.courseName || t('va.noCourse'))}`),
          metaRow('clock', t('va.sheet.due'), `${esc(due)} <span class="va-urg ${d.done ? 'is-done' : overdue ? 'is-overdue' : ''}">· ${esc(urg)}</span>`),
          metaRow(d.source === 'custom' ? 'person' : 'doc', t('va.sheet.source'), esc(t('va.source.' + (['toledo', 'ultra', 'custom'].includes(d.source) ? d.source : 'toledo')))),
        ].join('');
        let desc = '';
        if (st.loading) desc = TP.ui.group(`<p class="tp-detail-desc va-muted">${esc(t('common.loading'))}</p>`);
        else if (st.body) desc = TP.ui.group(`<div class="tp-detail-desc tp-prose">${TP.util.sanitize(st.body)}</div>`);
        const actions = [
          d.courseLuId || cid ? btn('course', 'courses', t('va.sheet.openCourse')) : '',
          d.url ? `<a class="tp-row has-lead" href="${esc(TP.util.abs(d.url))}" target="_blank" rel="noopener"><span class="tp-row-lead"><span class="tp-tile">${icon('external', { size: 16 })}</span></span><span class="tp-row-main"><span class="tp-row-title">${esc(t('va.openToledo'))}</span></span><span class="va-sr">${esc(t('va.newTab'))}</span></a>` : '',
          btn('done', d.done ? 'circle' : 'checkCircle', t(d.done ? 'va.sheet.markOpen' : 'va.sheet.markDone')),
          btn('ics', 'calendar', t('va.addToCalendar')),
          own ? btn('edit', 'page', t('deadlines.edit')) : '',
          own ? btn('remove', 'trash', t('deadlines.remove')) : '',
        ].filter(Boolean).join('');
        return `${TP.ui.group(meta, { cls: 'tp-detail-meta' })}${desc}${TP.ui.group(actions, { cls: 'tp-detail-actions' })}`
          + `<p class="va-foot">${esc(t('deadlines.honest'))}</p>`;
      };
      const sheet = () => (TP.shell.app && TP.shell.app.querySelector('.tp-detail')) || null;
      const focusIn = (sel) => { const el = sheet() && sheet().querySelector(sel); if (el) el.focus(); };
      async function save() {
        const box = sheet() && sheet().querySelector('[data-form="dl-edit"]');
        if (!box) return;
        const val = (n) => String((box.querySelector(`[name="${n}"]`) || {}).value || '');
        const title = val('title').trim();
        const p = VA.parseDue(val('date'), val('time') || '23:59');
        if (!title || !p) {
          st.err = t('deadlines.add.invalid');
          TP.shell.detail.update(html());
          focusIn(!title ? 'input[name="title"]' : 'input[name="date"]');
          return;
        }
        const item = await TP.data.updateCustomDeadline(d.customId, { title, courseLuId: val('courseLuId'), due: p.due });
        if (!item) return;
        let c = null;
        try { c = item.courseLuId && TP.data.course ? TP.data.course(item.courseLuId) : null; } catch { c = null; }
        Object.assign(d, { title: item.title, courseLuId: item.courseLuId, due: item.due, courseName: c ? c.name : '', color: c ? c.color : null });
        st.edit = false; st.err = '';
        const head = sheet() && sheet().querySelector('#tp-detail-title');
        if (head) head.textContent = d.title;
        TP.shell.detail.update(html());
        focusIn('[data-detail-action="edit"]');
        VA.toast(p.shifted ? t('deadlines.add.shifted', { time: TP.fmt.time(p.due) }) : t('deadlines.edit.saved'));
      }
      TP.shell.detail.open({
        title: d.title,
        html: html(),
        opener,
        key: d.key, link: d.url ? TP.util.abs(d.url) : '', // history entry (Back closes it) + "Kopieer link" (TP-199, TP-202)
        onKey(ev) {
          // Enter in a field of the edit form saves (no <form>: the sheet routes its own actions)
          if (st.edit && ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') { ev.preventDefault(); save(); }
        },
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
          if (action === 'edit') { st.edit = true; st.err = ''; TP.shell.detail.update(html()); focusIn('input[name="title"]'); return; }
          if (action === 'edit-cancel') { st.edit = false; st.err = ''; TP.shell.detail.update(html()); focusIn('[data-detail-action="edit"]'); return; }
          if (action === 'edit-save') { await save(); return; }
          if (action === 'remove') { TP.shell.detail.close(); await VA.removeCustom(d.customId); }
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
          if (TP.shell.detail.isOpen() && !st.edit) TP.shell.detail.update(html()); // never under a half-typed edit
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
    const upd = lu ? TP.ui.updatedText(lu) : VA.state(['events', 'enrollments']) === 'loading' ? t('overview.loading') : '';
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
      <p class="va-onboard-privacy">${esc(t('telemetry.onboarding'))} <a class="va-onboard-link" href="${esc(TP.shell.href('settings', { id: 'about' }))}" data-action="ov-nav" data-route="settings" data-id="about">${esc(t('overview.onboard.privacyLink'))}</a></p>
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
    if (!list.length && state === 'loading') body = VA.skeleton(5, { lead: 'date' });
    else if (!list.length && state === 'error') body = VA.errorBlock(t('overview.deadlines.error'), 'events');
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.deadlines.empty', { n: horizon })));
    else {
      // cached rows after a failed refresh: the shell's status line ("Kon Toledo niet laden · Opnieuw") is the one notice
      const rows = list.map((d) => VA.deadlineRow(d, { prefix: 'ov', urgentDays: cfg.urgentDays ?? 3, now })).join('');
      body = TP.ui.group(rows, { cls: 'va-dl-group' });
    }
    // TP-102: exams in the next 14 days sit on top of the card (the same row as Deadlines › Examens; it opens the exam sheet)
    const exams = VA.examRow ? VA.upcomingExams({ within: 14 * DAY }).slice(0, 2) : [];
    if (exams.length) body = TP.ui.group(exams.map((e) => VA.examRow(e)).join(''), { cls: 'va-exam-group' }) + body;
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
    const readGroup = unread.length
      ? `<div class="va-group-read" data-va-nofilter>${TP.ui.button(t('overview.new.readCourse', { course: g.name }), { kind: 'plain', icon: 'check', action: 'ov-readgroup', attrs: { 'data-lu': String(g.luId) } })}</div>`
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
      body: `<div class="va-feed-body">${items}${more}${readGroup}</div>`,
      q: String(g.name || '').toLowerCase(),
    });
    return VA.addAttrs(html, { 'data-lu': String(g.luId), 'data-name': String(g.name || '').toLowerCase(), hidden: hidden || null });
  }

  /** The unread feed items the "mark as read" button covers: everything, or what the top-bar search shows (TP-153). */
  function feedScope(groups, q) {
    const out = [];
    for (const g of groups) {
      const groupHit = !!q && String(g.name || '').toLowerCase().includes(q);
      for (const e of g.items) {
        if (S.kept.has(String(e.id)) || e.read) continue;
        if (!q || groupHit || `${e.title} ${g.name}`.toLowerCase().includes(q)) out.push(e);
      }
    }
    return out;
  }

  /** Under an empty "Nieuw": announcements are not part of it by default — say where the unread ones are (TP-154). */
  function annHint(st) {
    if ((st.feed || {}).includeAnnouncements) return '';
    let n = 0;
    try { n = (TP.data.announcements({ filter: 'unread' }) || []).length; } catch { n = 0; }
    if (!n) return '';
    return `<p class="va-empty-more"><a href="${esc(TP.shell.href('announcements'))}" data-action="ov-nav" data-route="announcements">${esc(t('overview.new.annUnread', { n }))}</a></p>`;
  }

  function secNew(st) {
    const max = Math.max(1, (st.feed && st.feed.maxCourses) || 5);
    const state = VA.state(['events', 'enrollments']);
    const groups = feedWithKept();
    const total = groups.reduce((n, g) => n + g.items.filter((e) => !S.kept.has(String(e.id)) && !e.read).length, 0);
    let body = '';
    // One line that says what "Nieuw" counts (TP-005): files, pages, assignments (+ announcements when switched on).
    const note = `<p class="va-sec-note">${esc(t((st.feed || {}).includeAnnouncements ? 'overview.new.noteAnn' : 'overview.new.note'))}</p>`;
    if (state === 'error') body += VA.errorBlock(t('overview.new.error'), ['events', 'enrollments']);
    if (state === 'loading' && !groups.length) {
      body += VA.skeleton(Math.min(5, max), { lead: 'dot' });
    } else if (!groups.length) {
      if (state === 'ok' || state === 'stale-error') body += TP.ui.group(TP.ui.empty(t('overview.new.empty'), { timestamp: TP.data.lastUpdated && TP.data.lastUpdated() }) + annHint(st));
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
    // The button names its scope: everything in Nieuw, or (while searching) the n items found (TP-153).
    const scopeN = S.q ? feedScope(groups, S.q).length : total;
    const actions = scopeN ? [{ action: 'ov-readall', label: S.q ? t('overview.new.readSome', { n: scopeN }) : t('overview.new.readAll'), icon: 'check' }] : [];
    return section('new', { title: esc(t('overview.new.title')), count: total || undefined, actions, body: (groups.length || state === 'ok' ? note : '') + body });
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

  /** "3 d te laat" (calendar days past due, like "gisteren"/"over 3 d"; flips at midnight, TP-219), or "Te laat" on
   *  the day itself. Same wording everywhere. */
  function overdueText(due) {
    const n = -TP.fmt.daysUntil(due);
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
    // ends on a later calendar day (e.g. a Leuven evening lesson seen from Tokyo): "+1" after the end time (TP-222)
    const nextDay = s.end > s.start ? Math.round((TP.fmt.sod(s.end - 1) - TP.fmt.sod(s.start)) / DAY) : 0;
    return TP.ui.row({
      href: link || undefined,
      leading: `<span class="va-time"><span>${esc(TP.fmt.time(s.start))}</span><span>${esc(TP.fmt.time(s.end))}${nextDay > 0 ? `<small class="va-plus">+${nextDay}</small>` : ''}</span></span><span class="va-bar" style="--c:${esc(color)}" aria-hidden="true"></span>`,
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
    const range = { from: sod, to: TP.fmt.addDays(sod, 2) }; // calendar days: 23 h / 25 h on the DST days (TP-218)
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
    const days = [[now, 'overview.schedule.today'], [TP.fmt.addDays(now, 1), 'overview.schedule.tomorrow']]; // not now + 24 h (TP-218)
    const { source, by, state } = lessonsByDay();
    // KU Loket exams today/tomorrow belong in the day list too (they never were, TP-102).
    try {
      const ex = (TP.kuloket && TP.kuloket.peekExams && TP.kuloket.peekExams()) || [];
      for (const [ms] of days) {
        const k = TP.fmt.dayKey(ms);
        const have = by[k] || [];
        const add = ex.filter((x) => x && x.start && TP.fmt.dayKey(x.start) === k
          && !have.some((l) => l.start === x.start && (l.kind === 'examen' || l.title === x.title)));
        if (add.length) by[k] = have.concat(add.map((x) => ({ ...x, kind: 'examen' })));
      }
    } catch { /* no KU Loket */ }
    let body;
    if (state === 'loading') body = VA.skeleton(2, { lead: 'none' });
    else if (state === 'error') body = VA.errorBlock(t('overview.schedule.error'), 'upcoming');
    else {
      // One card (its top lines up with the Deadlines card); "Vandaag" / "Morgen" are sub-headings inside it.
      // TP-102: exams today/tomorrow are in the schedule too (unless KU Loket already lists them as a lesson)
      const exams = VA.upcomingExams({ within: 2 * DAY });
      body = TP.ui.group(days.map(([ms, key]) => {
        const day = (by[TP.fmt.dayKey(ms)] || []).slice();
        for (const e of exams) {
          if (TP.fmt.dayKey(e.start) !== TP.fmt.dayKey(ms) || day.some((l) => l.start === e.start && (l.kind === 'examen' || l.courseCode === e.courseCode))) continue;
          day.push({ ...e, source: 'kuloket', kind: 'examen' });
        }
        const list = day.sort((a, b) => a.start - b.start);
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
    if (!list.length && state === 'loading') body = VA.skeleton(5, { lead: 'dot' });
    else if (!list.length && state === 'error') body = VA.errorBlock(t('overview.ann.error'), 'events');
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('overview.ann.empty')));
    else body = TP.ui.group(list.map(annRow).join(''));
    let unreadN = 0;
    try { unreadN = (TP.data.announcements({ filter: 'unread' }) || []).length; } catch { unreadN = 0; }
    const actions = [{ action: 'ov-nav', label: unreadN ? t('overview.ann.allUnread', { n: unreadN }) : t('overview.ann.all'), attrs: { 'data-route': 'announcements', href: TP.shell.href('announcements') } }];
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
      case 'va-exam-open': {
        ev.preventDefault();
        VA.openExam(VA.exams.get(el.getAttribute('data-xid')), el, ctx.root);
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
      case 'ov-readall':
      case 'ov-readgroup': {
        // One markAllRead(scope) with Undo (shared pattern 5): the items in view (search applied), or one course.
        ev.preventDefault();
        const lu = act === 'ov-readgroup' ? el.getAttribute('data-lu') : null;
        const scope = lu ? { luId: lu } : { events: feedScope(feedWithKept(), S.q) };
        if (lu) for (const [id, k] of S.kept) if (String(k.luId) === lu) S.kept.delete(id);
        if (!lu) S.kept.clear();
        S.focusNew = true;
        const r = await TP.data.markAllRead(scope);
        render(ctx);
        const label = lu ? t('overview.new.markedCourse', { n: r.unread, course: (S.groupsMeta.get(lu) || {}).name || '' }) : t('overview.new.markedN', { n: r.unread });
        TP.ui.undoToast(label, () => r.undo());
        r.synced.then((ok) => { if (!ok) VA.toast(t('announcements.syncPending')); });
        break;
      }
      case 'ov-showall': {
        ev.preventDefault();
        S.showAll = !S.showAll;
        render(ctx);
        break;
      }
      case 'ov-nav': {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button > 0) return; // new tab: let the link do it
        ev.preventDefault();
        const id = el.getAttribute('data-id');
        TP.shell.navigate(el.getAttribute('data-route') || 'overview', id ? { id } : {});
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
    if (S.focusNew && !ctx.root.querySelector('[data-action="ov-readall"]:focus, [data-action="ov-readgroup"]:focus')) {
      // The button is gone after "mark as read": focus its section heading instead of dropping to <body> (TP-044).
      S.focusNew = false;
      let h = ctx.root.querySelector('[data-va-sec="new"] .tp-sec-title');
      if (h && !h.getClientRects().length) h = ctx.root.closest('main')?.querySelector('.tp-large-title'); // section hidden by the search
      if (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch { /* ignore */ } }
    }
  }

  TP.shell.register('overview', {
    title: () => greeting(),
    docTitle: () => t('nav.overview'), // the tab/bookmark says what the page is; the greeting stays the large title (TP-006)
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
