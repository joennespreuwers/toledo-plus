/* Toledo+ — Planning view: agenda for the next 14 days (lessons today/tomorrow + deadlines). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const VA = () => TP.viewsA;
  const DAYS = 14;

  const S = { ctx: null, q: '' };

  function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }

  function dayLabel(i, ms) {
    const date = TP.fmt.date(ms, { weekday: 'long', day: 'numeric', month: 'long' });
    if (i === 0) return { main: t('planning.today'), sub: date };
    if (i === 1) return { main: t('planning.tomorrow'), sub: date };
    return { main: VA().capitalize(TP.fmt.date(ms, { weekday: 'long' })), sub: TP.fmt.date(ms, { day: 'numeric', month: 'long' }) };
  }

  function emptyRun(run) {
    const first = run[0].ms;
    const last = run[run.length - 1].ms;
    const f = (ms) => TP.fmt.date(ms, { weekday: 'short', day: 'numeric', month: 'short' });
    const range = run.length === 1 ? f(first) : `${f(first)} – ${f(last)}`;
    const lessonNote = run.some((d) => d.i > 1) ? `<span class="va-sr"> (${esc(t('planning.noLessonsInfo'))})</span>` : '';
    return `<div class="va-pl-empty">${TP.ui.row({
      leading: `<span class="va-tile">${TP.ui.icon('calendar', { size: 15 })}</span>`,
      title: esc(range),
      trailing: `<span class="va-muted">${esc(t('planning.nothing'))}</span>${lessonNote}`,
      cls: 'va-pl-emptyrow',
    })}</div>`;
  }

  function render(ctx) {
    S.ctx = ctx;
    const V = VA();
    V.bind(ctx.root, 'planning', { click: onClick });
    try { ctx.setActions && ctx.setActions([]); } catch { /* ignore */ }
    try { ctx.setSubtitle && ctx.setSubtitle(esc(t('planning.subtitle'))); } catch { /* ignore */ }

    const st = TP.settings.get() || {};
    const urgentDays = (st.deadlines && st.deadlines.urgentDays) ?? 3;
    const now = Date.now();
    const today = dayStart(now);

    let sched = {};
    try { sched = TP.data.schedule() || {}; } catch { sched = {}; }
    let dls = [];
    try { dls = TP.data.deadlines({ includeDone: true, horizonDays: DAYS + 1 }) || []; } catch { dls = []; }
    const byDay = new Map();
    for (const d of dls) {
      const k = TP.fmt.dayKey(d.due);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(d);
    }

    const loading = !V.loaded('upcoming') && !V.loaded('events') && !V.loadError('events');
    let body = '';
    if (loading) body = V.skeleton(5);
    else {
      const days = [];
      for (let i = 0; i < DAYS; i++) {
        const ms = addDays(today, i);
        const key = TP.fmt.dayKey(ms);
        const lessons = i <= 1 ? (sched[key] || []).slice().sort((a, b) => a.start - b.start) : [];
        const deadlines = (byDay.get(key) || []).slice().sort((a, b) => a.due - b.due);
        days.push({ i, ms, key, lessons, deadlines, empty: !lessons.length && !deadlines.length });
      }
      let run = [];
      const flush = () => { if (run.length) { body += emptyRun(run); run = []; } };
      for (const d of days) {
        if (d.empty && d.i > 0) { run.push(d); continue; }
        flush();
        const lab = dayLabel(d.i, d.ms);
        const rows = d.lessons.map((s) => V.lessonRow(s)).join('')
          + d.deadlines.map((x) => V.deadlineRow(x, { prefix: 'pl', urgentDays, now, showDay: false })).join('');
        const isToday = d.i === 0;
        const hid = 'pl-day-' + d.key;
        body += `<section class="va-day${isToday ? ' is-today' : ''}" aria-labelledby="${hid}" data-va-sec="${esc(d.key)}">
          <h2 class="va-dayhead" id="${hid}"${isToday ? ' aria-current="date"' : ''}>${esc(lab.main)} <span>${esc(lab.sub)}</span></h2>
          ${TP.ui.group(rows || TP.ui.empty(t('planning.nothing')))}
        </section>`;
      }
      flush();
    }

    const kul = TP.data.link && TP.data.link('KULOKET-UURROOSTER');
    const bb = TP.data.link && TP.data.link('BB-CALENDAR-ULTRA');
    const nt = `<span class="va-sr"> ${esc(t('va.newTab'))}</span>`;
    const links = [
      kul ? `<a href="${esc(kul)}" target="_blank" rel="noopener">${esc(t('planning.kuloket'))} ›${nt}</a>` : '',
      bb ? `<a href="${esc(bb)}" target="_blank" rel="noopener">${esc(t('planning.bbCalendar'))} ›${nt}</a>` : '',
    ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
    const note = `<p class="va-foot va-pl-note">${TP.ui.icon('clock', { size: 13 })} ${esc(t('planning.note'))}${links ? ` ${links}` : ''}</p>`;

    V.paint(ctx.root, `<div class="va-view va-planning">${note}${body}<div class="va-noresults" hidden></div></div>`);
    if (S.q) applySearch(ctx.root, S.q);
  }

  function applySearch(root, q) {
    root.querySelectorAll('.va-pl-empty').forEach((el) => { el.hidden = !!q; });
    VA().filter(root, q);
  }

  async function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx || !ctx.root.contains(el)) return;
    if (el.getAttribute('data-action') === 'pl-done') {
      ev.preventDefault();
      const wasDone = el.getAttribute('aria-pressed') === 'true';
      await TP.data.toggleDone(el.getAttribute('data-key'));
      VA().announce(t(wasDone ? 'va.markedOpen' : 'va.markedDone'));
    }
  }

  TP.shell.register('planning', {
    title: () => t('nav.planning'),
    searchPlaceholder: () => t('planning.search'),
    render,
    onSearch(ctx, q) {
      S.q = (q || '').trim().toLowerCase();
      applySearch(ctx.root, S.q);
    },
    destroy() { S.q = ''; S.ctx = null; },
  });
})();
