/* Toledo+ — Deadlines view: full list grouped by week, filters, own deadlines, .ics export. */
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
  };

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
      if (!d.done && d.due < now) push('overdue', t('deadlines.group.overdue'), -Infinity, d);
      else if (d.due < w0) push('earlier', t('deadlines.group.earlier'), Infinity, d);
      else {
        const ws = startOfWeek(d.due);
        if (ws === w0) push('w0', t('deadlines.group.thisWeek'), ws, d);
        else if (ws === w1) push('w1', t('deadlines.group.nextWeek'), ws, d);
        else push('w' + ws, t('deadlines.group.weekOf', { date: TP.fmt.date(ws, { day: 'numeric', month: 'short' }) }), ws, d);
      }
    }
    const groups = [...map.values()].sort((a, b) => a.sort - b.sort);
    for (const g of groups) g.items.sort((a, b) => (g.key === 'earlier' ? b.due - a.due : a.due - b.due));
    return groups;
  }

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
    const openCount = allDeadlines().filter((d) => !d.done).length;
    try { ctx.setSubtitle && ctx.setSubtitle(esc(t('deadlines.count', { n: openCount }))); } catch { /* ignore */ }

    let body;
    const loading = !list.length && !V.loaded('events') && !V.loadError('events');
    if (loading) body = V.skeleton(4);
    else if (!list.length) body = TP.ui.group(TP.ui.empty(t('deadlines.empty.' + S.filter)));
    else {
      const now = Date.now();
      body = groupsOf(list).map((g) => VA().addAttrs(TP.ui.section({
        id: 'dl-g-' + g.key,
        title: esc(g.title),
        count: g.items.length,
        body: TP.ui.group(g.items.map((d) => V.deadlineRow(d, { prefix: 'dl', urgentDays, now, removable: true })).join(''), { cls: 'va-dl-group' + (g.key === 'overdue' ? ' is-overdue' : '') }),
      }), { 'data-va-sec': g.key })).join('');
    }

    const footer = `<div class="va-footnotes">
      <p class="va-foot">${TP.ui.icon('calendar', { size: 13 })} ${esc(t('deadlines.exportHint'))}</p>
      <p class="va-foot">${TP.ui.icon('check', { size: 13 })} ${esc(t('deadlines.honest'))}</p>
    </div>`;

    V.paint(ctx.root, `<div class="va-view va-deadlines">
      ${filtersHtml()}
      ${addFormHtml()}
      <div class="va-dl-list">${body}</div>
      <div class="va-noresults" hidden></div>
      ${footer}
    </div>`);
    if (S.q) V.filter(ctx.root, S.q);
  }

  function exportIcs() {
    const V = VA();
    const now = Date.now();
    const list = filtered().filter((d) => !d.done && d.due >= now);
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
    if (act === 'dl-done') {
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
