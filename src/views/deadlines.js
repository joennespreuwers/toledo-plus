/* Toledo+ — Deadlines view: exams (KU Loket) + overdue on top, then grouped by week; filters, own deadlines,
   "Zet in agenda" (.ics with deadlines and exams); every row opens the detail sheet (F6), exams their exam sheet. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const VA = () => TP.viewsA;

  const S = {
    ctx: null,
    q: '',
    filter: 'open',            // 'open'|'all'|'done'
    course: 'all',             // 'all'|'none'|luId
    addOpen: false,
    draft: {},                 // unsent add-form values (survive re-renders)
    doneKeep: new Set(),       // keys toggled this session (stay visible in current filter)
    oldOpen: false,            // "Ouder dan een week (n)" disclosure
  };
  const DAY = 864e5;
  // Done items stay reachable under "Klaar" for a term (TP-209: after 7 days they vanished from every view).
  const KEEP_DONE_DAYS = 120;

  function startOfWeek(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }

  function allDeadlines() {
    // allCustom: an own deadline years ahead is listed too, it just lands in its own "Week van …" group (TP-015)
    try { return TP.data.deadlines({ includeDone: true, horizonDays: 366, pastDays: KEEP_DONE_DAYS, allCustom: true }) || []; } catch { return []; }
  }

  const inCourse = (d) => {
    if (S.course === 'none') return !d.courseLuId;
    if (S.course !== 'all') return String(d.courseLuId) === S.course;
    return true;
  };

  function filtered() {
    return allDeadlines().filter((d) => {
      if (!inCourse(d)) return false;
      if (S.filter === 'open') return !d.done || S.doneKeep.has(d.key);
      if (S.filter === 'done') return d.done || S.doneKeep.has(d.key);
      return true;
    });
  }

  function groupsOf(list) {
    const now = Date.now();
    const w0 = startOfWeek(now);
    const w1 = TP.fmt.addDays(w0, 7);
    const map = new Map();
    const push = (key, title, sort, d) => {
      if (!map.has(key)) map.set(key, { key, title, sort, items: [] });
      map.get(key).items.push(d);
    };
    for (const d of list) {
      if (VA().isOverdue(d, now) || (d.done && S.doneKeep.has(d.key) && d.due < now && S.filter === 'open')) push('overdue', t('deadlines.group.overdue'), -Infinity, d);
      else if (d.due < w0 || d.due < now) push('earlier', t('deadlines.group.earlier'), Infinity, d);
      else {
        const ws = startOfWeek(d.due);
        if (ws === w0) push('w0', t('deadlines.group.thisWeek'), ws, d);
        else if (ws === w1) push('w1', t('deadlines.group.nextWeek'), ws, d);
        else push('w' + ws, t('deadlines.group.weekOf', { date: TP.fmt.date(ws) }), ws, d); // with the year when not this year
      }
    }
    const groups = [...map.values()].sort((a, b) => a.sort - b.sort);
    for (const g of groups) g.items.sort((a, b) => (g.key === 'earlier' || g.key === 'overdue' ? b.due - a.due : a.due - b.due));
    return groups;
  }

  /** Upcoming exams from KU Loket that match the course filter (TP-101: a course filter no longer drops them). */
  const exams = () => VA().upcomingExams({ course: S.course });

  /** Exam row (Deadlines › Examens, Overzicht, KU Loket): opens the exam sheet (TP-018). */
  function examRow(e) {
    let c = null;
    try { c = e.courseLuId && TP.data.course ? TP.data.course(e.courseLuId) : null; } catch { c = null; }
    const name = (c && c.name) || e.title || '';
    const L = e.location || {};
    const loc = [L.room || L.mnemonic, L.building].filter(Boolean).join(' · ');
    const when = `${TP.fmt.when(e.start, 'day')} ${TP.fmt.timeRange(e.start, e.end)}`;
    const days = TP.fmt.daysUntil(e.start);
    const id = String(e.id || `${e.courseCode || name}-${e.start}`);
    VA().exams.set(id, e);
    const tone = days <= 3 ? 'urgent' : 'normal';
    const main = `<button type="button" class="va-dl-open" data-action="va-exam-open" data-xid="${esc(id)}" aria-haspopup="dialog">`
      + `<span class="tp-row-title">${esc(name)}</span><span class="tp-row-sub">${TP.ui.dot((c && c.color) || 'var(--label-3)')} <span>${esc([when, loc, e.text].filter(Boolean).join(' · '))}</span></span></button>`;
    return `<div class="tp-row has-lead va-exam${days <= 3 ? ' tone-urgent' : ''}" data-xid="${esc(id)}" data-q="${esc(TP.index.hay([name, e.courseCode || (c && c.code), loc, e.text, t('agenda.exam')], [e.start]))}">`
      + `<span class="tp-row-lead">${TP.ui.dateTile(e.start, { tone })}</span><span class="tp-row-main">${main}</span>`
      + `<span class="tp-row-trail"><span class="va-urg${days <= 3 ? ' is-urgent' : ''}">${esc(TP.fmt.rel(e.start))}</span></span></div>`;
  }

  VA().examRow = examRow; // KU Loket's exam list and the Overview card use the same row

  function courseOptions() {
    let courses = [];
    try { courses = TP.data.courses({ currentOnly: true }) || []; } catch { courses = []; }
    return courses.filter((c) => !c.hidden).map((c) => ({ value: String(c.luId), label: c.name }));
  }

  function filtersHtml() {
    const seg = TP.ui.segmented('dl-filter', [
      { value: 'open', label: t('deadlines.filter.open') },
      { value: 'all', label: t('deadlines.filter.all') },
      { value: 'done', label: t('deadlines.filter.done') },
    ], S.filter, { label: t('deadlines.filter.label') });
    const opts = [{ value: 'all', label: t('deadlines.course.all') }, ...courseOptions(), { value: 'none', label: t('deadlines.course.none') }];
    if (!opts.some((o) => o.value === S.course)) S.course = 'all';
    const sel = TP.ui.select('dl-course', opts, S.course, { label: t('deadlines.course.label') });
    return `<div class="va-filters">${seg}${sel}</div>`;
  }

  function addFormHtml() {
    const form = `<form class="va-form" data-form="dl-add" novalidate>
      <p class="va-foot">${esc(t('deadlines.add.hint'))}</p>
      ${VA().deadlineFields(S.draft, VA().courseOptions())}
      <p class="va-form-error" role="alert" hidden></p>
      <div class="va-form-actions"><button type="submit" class="tp-btn tp-btn-filled">${TP.ui.icon('plus')}<span>${esc(t('deadlines.add.submit'))}</span></button></div>
    </form>`;
    const html = TP.ui.disclosure({
      id: 'dl-add',
      open: S.addOpen,
      summary: { leading: `<span class="va-tile">${TP.ui.icon('plus', { size: 15 })}</span>`, title: esc(t('deadlines.add.title')) },
      body: form,
    });
    return TP.ui.group(VA().addAttrs(html, { 'data-dl-add': '' }), { cls: 'va-dl-add' });
  }

  function groupSection(g, rowsHtml, cls) {
    return VA().addAttrs(TP.ui.section({
      id: 'dl-g-' + g.key,
      title: esc(g.title),
      count: g.count != null ? g.count : g.items.length,
      body: rowsHtml,
      cls,
    }), { 'data-va-sec': g.key });
  }

  function render(ctx) {
    S.ctx = ctx;
    const V = VA();
    V.bind(ctx.root, 'deadlines', { click: onClick, change: onChange, submit: onSubmit, input: onInput, toggle: onToggle });
    try {
      ctx.setActions && ctx.setActions([{ id: 'dl-ics', label: t('deadlines.export'), icon: 'calendar', onClick: exportIcs }]);
    } catch { /* ignore */ }

    const st = TP.settings.get() || {};
    const urgentDays = (st.deadlines && st.deadlines.urgentDays) ?? 3;
    const list = filtered();
    const now = Date.now();
    const open = allDeadlines().filter((d) => !d.done);
    const late = open.filter((d) => V.isOverdue(d, now)).length;
    const state = V.state('events');
    // "7 open · 1 te laat" — no count while nothing could be loaded (TP-147: "0 open" above the error)
    try {
      ctx.setSubtitle && ctx.setSubtitle(state === 'error' && !open.length ? ''
        : esc(t('deadlines.count', { n: open.length }))
        + (late ? `<span aria-hidden="true"> · </span><strong class="va-late">${esc(t('deadlines.lateCount', { n: late }))}</strong>` : ''));
    } catch { /* ignore */ }

    const ex = S.filter !== 'done' ? exams() : [];
    let body = '';
    if (ex.length) {
      body += groupSection({ key: 'exams', title: t('deadlines.group.exams'), items: ex },
        TP.ui.group(ex.map(examRow).join(''), { cls: 'va-exam-group' }));
    }
    if (state === 'stale-error' || (state === 'error')) body += V.errorBlock(t('deadlines.error'), 'events');
    if (!list.length && state === 'loading') body += V.skeleton(4, { lead: 'date' });
    else if (!list.length && state !== 'error') body += TP.ui.group(TP.ui.empty(t('deadlines.empty.' + S.filter)));
    else if (list.length) {
      body += groupsOf(list).map((g) => {
        const row = (d) => V.deadlineRow(d, { prefix: 'dl', urgentDays, now, removable: true });
        if (g.key !== 'overdue') return groupSection(g, TP.ui.group(g.items.map(row).join(''), { cls: 'va-dl-group' }));
        // B2: overdue stays, however old; older than a week sits in a collapsed disclosure.
        const weekAgo = TP.fmt.addDays(now, -7);
        const recent = g.items.filter((d) => d.due >= weekAgo);
        const old = g.items.filter((d) => d.due < weekAgo);
        const openOld = old.filter((d) => !d.done);
        // TP-159: one action for the old pile, with Undo
        const bulk = openOld.length > 1 ? `<button type="button" class="tp-row va-more va-bulk" data-action="dl-old-done" data-va-nofilter><span class="tp-row-main"><span class="tp-row-title">${esc(t('deadlines.oldDone', { n: openOld.length }))}</span></span></button>` : '';
        const oldHtml = old.length ? VA().addAttrs(TP.ui.disclosure({
          id: 'dl-old',
          open: S.oldOpen,
          cls: 'va-dl-old',
          summary: { title: esc(t('deadlines.group.older', { n: old.length })) },
          body: old.map(row).join('') + bulk,
        }), { 'data-va-collapse': '', 'data-dl-old': '' }) : '';
        return groupSection(g, TP.ui.group(recent.map(row).join('') + oldHtml, { cls: 'va-dl-group is-overdue' }), 'va-sec-overdue');
      }).join('');
    }

    V.paint(ctx.root, `<div class="va-view va-deadlines tp-narrow">
      ${V.zoneNote()}
      ${filtersHtml()}
      ${addFormHtml()}
      <div class="va-dl-list">${body}</div>
      <div class="va-noresults" hidden></div>
    </div>`);
    if (S.q) V.filter(ctx.root, S.q);
  }

  /** One export set for "Zet in agenda" here and in the Agenda (TP-104): open deadlines that are still to come plus
   *  upcoming exams, following the Vak filter here (the file is then named after the course). */
  function exportIcs() {
    const V = VA();
    const now = Date.now();
    const list = allDeadlines().filter((d) => inCourse(d) && !d.done && d.due >= now);
    const ex = exams();
    const n = list.length + ex.length;
    if (!n) { V.toast(t('deadlines.export.none')); return; }
    const course = S.course !== 'all' && S.course !== 'none' ? (courseOptions().find((o) => o.value === S.course) || {}).label || '' : '';
    let ics;
    try { ics = TP.data.ics(list, { exams: ex, name: course ? `Toledo+ · ${course}` : 'Toledo+' }); } catch (err) { console.warn('[Toledo+] ics', err); return; }
    const file = course ? `toledo-deadlines-${TP.data.icsName(course, 'vak')}.ics` : 'toledo-deadlines.ics';
    V.downloadText(S.ctx && S.ctx.root, ics, file, 'text/calendar;charset=utf-8');
    V.toast(t('deadlines.exported', { n }));
  }

  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    const act = el.getAttribute('data-action');
    if (act === 'va-dl-open') {
      ev.preventDefault();
      VA().openDeadline(VA().dls.get(el.getAttribute('data-key')), el, ctx.root);
    } else if (act === 'va-exam-open') {
      ev.preventDefault();
      VA().openExam(VA().exams.get(el.getAttribute('data-xid')), el, ctx.root);
    } else if (act === 'va-retry') {
      ev.preventDefault();
      await VA().retry(el);
    } else if (act === 'dl-done') {
      ev.preventDefault();
      const key = el.getAttribute('data-key');
      const wasDone = el.getAttribute('aria-pressed') === 'true';
      S.doneKeep.add(key);
      await TP.data.toggleDone(key);
      VA().announce(t(wasDone ? 'va.markedOpen' : 'va.markedDone'));
    } else if (act === 'dl-old-done') {
      ev.preventDefault();
      const weekAgo = TP.fmt.addDays(Date.now(), -7);
      const keys = filtered().filter((d) => !d.done && VA().isOverdue(d) && d.due < weekAgo).map((d) => d.key);
      if (!keys.length) return;
      await TP.data.setDone(keys, true);
      TP.ui.undoToast(t('deadlines.oldDoneToast', { n: keys.length }), () => TP.data.setDone(keys, false));
    } else if (act === 'dl-remove') {
      ev.preventDefault();
      await VA().removeCustom(el.getAttribute('data-id'));
    }
  }

  function onChange(ev) {
    const el = ev.target;
    if (!el || !S.ctx) return;
    if (el.name === 'dl-filter') {
      S.filter = el.value;
      S.doneKeep.clear();
      render(S.ctx);
    } else if (el.name === 'dl-course') {
      S.course = el.value;
      render(S.ctx);
    } else if (el.closest && el.closest('[data-form="dl-add"]') && el.name) {
      S.draft[el.name] = el.value;
    }
  }

  function onInput(ev) {
    const el = ev.target;
    if (el && el.name && el.closest && el.closest('[data-form="dl-add"]')) S.draft[el.name] = el.value;
  }

  function onToggle(ev) {
    const d = ev.target;
    if (d && d.tagName === 'DETAILS' && d.hasAttribute('data-dl-old')) { if (!S.q) S.oldOpen = d.open; return; }
    if (d && d.tagName === 'DETAILS' && d.closest('[data-dl-add]')) {
      S.addOpen = d.open;
      if (d.open) { const i = d.querySelector('input[name="title"]'); if (i && ev.isTrusted) i.focus(); }
    }
  }

  async function onSubmit(ev) {
    const form = ev.target.closest && ev.target.closest('[data-form="dl-add"]');
    if (!form) return;
    ev.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get('title') || '').trim();
    const p = VA().parseDue(String(fd.get('date') || ''), String(fd.get('time') || '') || '23:59');
    const errEl = form.querySelector('.va-form-error');
    if (!title || !p) {
      if (errEl) { errEl.hidden = false; errEl.textContent = t('deadlines.add.invalid'); }
      const bad = form.querySelector(!title ? 'input[name="title"]' : 'input[name="date"]');
      if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
      return;
    }
    S.draft = {};
    S.addOpen = true;
    const now = Date.now();
    await TP.data.addCustomDeadline({ title, courseLuId: String(fd.get('courseLuId') || ''), due: p.due });
    // Say where it went: in the past it is under "Te laat" (older than a week: in its disclosure, opened now) (TP-015);
    // a time the clocks skip is saved an hour later (TP-220).
    if (p.due < now && p.due < TP.fmt.addDays(now, -7)) S.oldOpen = true;
    const msg = p.shifted ? t('deadlines.add.shifted', { time: TP.fmt.time(p.due) })
      : p.due < now ? t('deadlines.add.addedLate')
        : t('deadlines.add.addedWhen', { when: TP.fmt.when(p.due) });
    VA().toast(msg);
    if (S.ctx) {
      render(S.ctx);
      const i = S.ctx.root.querySelector('[data-form="dl-add"] input[name="title"]');
      if (i) i.focus();
    }
  }

  TP.shell.register('deadlines', {
    title: () => t('nav.deadlines'),
    searchPlaceholder: () => t('deadlines.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim();
      VA().filter(ctx.root, S.q);
    },
    destroy() {
      S.doneKeep.clear();
      S.q = '';
      S.ctx = null;
    },
  });
})();
