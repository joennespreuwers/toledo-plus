/* Toledo+ — Deadlines view: exams (KU Loket) + overdue on top, then grouped by week; filters, own deadlines,
   "Zet in agenda" (.ics); every row opens the detail sheet (F6). */
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

  function startOfWeek(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }

  function allDeadlines() {
    try { return TP.data.deadlines({ includeDone: true, horizonDays: 366 }) || []; } catch { return []; }
  }

  function filtered() {
    return allDeadlines().filter((d) => {
      if (S.course === 'none' && d.courseLuId) return false;
      if (S.course !== 'all' && S.course !== 'none' && String(d.courseLuId) !== S.course) return false;
      if (S.filter === 'open') return !d.done || S.doneKeep.has(d.key);
      if (S.filter === 'done') return d.done || S.doneKeep.has(d.key);
      return true;
    });
  }

  function groupsOf(list) {
    const now = Date.now();
    const w0 = startOfWeek(now);
    const w1 = addDays(w0, 7);
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
        else push('w' + ws, t('deadlines.group.weekOf', { date: TP.fmt.date(ws, { day: 'numeric', month: 'short' }) }), ws, d);
      }
    }
    const groups = [...map.values()].sort((a, b) => a.sort - b.sort);
    for (const g of groups) g.items.sort((a, b) => (g.key === 'earlier' || g.key === 'overdue' ? b.due - a.due : a.due - b.due));
    return groups;
  }

  /** Upcoming exams from KU Loket (Agent B's TP.kuloket; optional). */
  function exams() {
    let list = null;
    try { list = TP.kuloket && typeof TP.kuloket.peekExams === 'function' ? TP.kuloket.peekExams() : null; } catch { list = null; }
    const now = Date.now();
    return (Array.isArray(list) ? list : []).filter((e) => e && e.start && (e.end || e.start) >= now).sort((a, b) => a.start - b.start);
  }
  function examRow(e) {
    let c = null;
    try { c = e.courseLuId && TP.data.course ? TP.data.course(e.courseLuId) : null; } catch { c = null; }
    const name = (c && c.name) || e.title || '';
    const L = e.location || {};
    const loc = [L.room || L.mnemonic, L.building].filter(Boolean).join(' · ');
    const when = `${TP.fmt.date(e.start, { weekday: 'short', day: 'numeric', month: 'short' })} ${TP.fmt.time(e.start)}${e.end ? '–' + TP.fmt.time(e.end) : ''}`;
    const days = TP.fmt.daysUntil(e.start);
    return TP.ui.row({
      href: e.courseLuId ? TP.shell.href('course', { luId: e.courseLuId }) : undefined,
      leading: TP.ui.dateTile(e.start, { tone: days <= 3 ? 'urgent' : 'normal' }),
      title: esc(name),
      subtitle: `${TP.ui.dot((c && c.color) || 'var(--label-3)')} <span>${esc([when, loc, e.text].filter(Boolean).join(' · '))}</span>`,
      trailing: `<span class="va-urg${days <= 3 ? ' is-urgent' : ''}">${esc(TP.fmt.rel(e.start))}</span>`,
      q: `${name} ${e.courseCode || ''} ${loc}`.toLowerCase(),
      cls: 'va-exam has-lead' + (days <= 3 ? ' tone-urgent' : ''),
    });
  }

  VA().examRow = examRow; // KU Loket's exam list uses the same row

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
    const dr = S.draft;
    const courseOpts = [{ value: '', label: t('va.noCourse') }, ...courseOptions()];
    const today = TP.fmt.dayKey(Date.now());
    const form = `<form class="va-form" data-form="dl-add" novalidate>
      <p class="va-foot">${esc(t('deadlines.add.hint'))}</p>
      <label class="va-field"><span>${esc(t('deadlines.add.name'))}</span>
        <input name="title" type="text" required maxlength="200" autocomplete="off" placeholder="${esc(t('deadlines.add.placeholder'))}" value="${esc(dr.title || '')}"></label>
      <label class="va-field"><span>${esc(t('deadlines.add.course'))}</span>
        <select name="courseLuId">${courseOpts.map((o) => `<option value="${esc(o.value)}"${String(dr.courseLuId || '') === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
      <div class="va-field-row">
        <label class="va-field"><span>${esc(t('deadlines.add.date'))}</span>
          <input name="date" type="date" required min="${esc(today)}" value="${esc(dr.date || '')}"></label>
        <label class="va-field"><span>${esc(t('deadlines.add.time'))}</span>
          <input name="time" type="time" value="${esc(dr.time || '23:59')}"></label>
      </div>
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
    // "7 open · 1 te laat"
    try {
      ctx.setSubtitle && ctx.setSubtitle(esc(t('deadlines.count', { n: open.length }))
        + (late ? `<span aria-hidden="true"> · </span><strong class="va-late">${esc(t('deadlines.lateCount', { n: late }))}</strong>` : ''));
    } catch { /* ignore */ }

    const state = V.state('events');
    const ex = S.course === 'all' && S.filter !== 'done' ? exams() : [];
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
        const recent = g.items.filter((d) => d.due >= now - 7 * DAY);
        const old = g.items.filter((d) => d.due < now - 7 * DAY);
        const oldHtml = old.length ? VA().addAttrs(TP.ui.disclosure({
          id: 'dl-old',
          open: S.oldOpen,
          cls: 'va-dl-old',
          summary: { title: esc(t('deadlines.group.older', { n: old.length })) },
          body: old.map(row).join(''),
        }), { 'data-va-collapse': '', 'data-dl-old': '' }) : '';
        return groupSection(g, TP.ui.group(recent.map(row).join('') + oldHtml, { cls: 'va-dl-group is-overdue' }), 'va-sec-overdue');
      }).join('');
    }


    V.paint(ctx.root, `<div class="va-view va-deadlines tp-narrow">
      ${filtersHtml()}
      ${addFormHtml()}
      <div class="va-dl-list">${body}</div>
      <div class="va-noresults" hidden></div>
    </div>`);
    if (S.q) V.filter(ctx.root, S.q);
  }

  function exportIcs() {
    const V = VA();
    const now = Date.now();
    const list = filtered().filter((d) => !d.done && d.due >= now);
    // one file with every open, upcoming deadline in this view (each one is also in its own detail sheet)
    if (!list.length) { V.toast(t('deadlines.empty.open')); return; }
    let ics;
    try { ics = TP.data.ics(list); } catch (err) { console.warn('[Toledo+] ics', err); return; }
    V.downloadText(S.ctx && S.ctx.root, ics, 'toledo-deadlines.ics', 'text/calendar;charset=utf-8');
    V.toast(t('deadlines.exported'));
  }

  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    const act = el.getAttribute('data-action');
    if (act === 'va-dl-open') {
      ev.preventDefault();
      VA().openDeadline(VA().dls.get(el.getAttribute('data-key')), el, ctx.root);
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
    } else if (act === 'dl-remove') {
      ev.preventDefault();
      await TP.data.removeCustomDeadline(el.getAttribute('data-id'));
      VA().toast(t('deadlines.removed'));
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
    const date = String(fd.get('date') || '');
    const time = String(fd.get('time') || '') || '23:59';
    const due = new Date(`${date}T${time}`).getTime();
    const errEl = form.querySelector('.va-form-error');
    if (!title || !date || !Number.isFinite(due)) {
      if (errEl) { errEl.hidden = false; errEl.textContent = t('deadlines.add.invalid'); }
      const bad = form.querySelector(!title ? 'input[name="title"]' : 'input[name="date"]');
      if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
      return;
    }
    S.draft = {};
    S.addOpen = true;
    await TP.data.addCustomDeadline({ title, courseLuId: String(fd.get('courseLuId') || ''), due });
    VA().toast(t('deadlines.add.added'));
    VA().announce(t('deadlines.add.added'));
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
      S.q = (q || '').trim().toLowerCase();
      VA().filter(ctx.root, S.q);
    },
    destroy() {
      S.doneKeep.clear();
      S.q = '';
      S.ctx = null;
    },
  });
})();
