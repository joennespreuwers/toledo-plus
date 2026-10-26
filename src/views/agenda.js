/* Toledo+ — Agenda view (route 'agenda'): Apple Calendar–style Day / Week / Month / List.
   Sources: lessons from TP.kuloket (KU Loket, or the iCal fallback; Toledo's today/tomorrow as last resort),
   exams (TP.kuloket.exams), deadlines incl. own deadlines (TP.data.deadlines). Read-only. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);
  const H = 3600e3;
  const MODES = ['day', 'week', 'month', 'list'];
  const HOUR_PX = 48;
  const NARROW = 700;

  const S = { ctx: null, mode: null, anchor: null, q: '', items: new Map(), seq: 0, pop: null, popOpener: null, dirty: false, timer: null, ro: null, lastNarrow: null };
  const bound = new WeakSet();

  // ------------------------------------------------------------------ dates (browser local time)
  const sod = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  const addMonths = (ms, n) => { const d = new Date(ms); d.setDate(1); d.setMonth(d.getMonth() + n); return d.getTime(); };
  const startOfWeek = (ms) => { const d = new Date(sod(ms)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); };
  const startOfMonth = (ms) => { const d = new Date(sod(ms)); d.setDate(1); return d.getTime(); };
  const isoWeekNo = (ms) => {
    const d = new Date(ms); const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = u.getUTCDay() || 7; u.setUTCDate(u.getUTCDate() + 4 - dow);
    return Math.ceil(((u - Date.UTC(u.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const fdate = (ms, o) => TP.fmt.date(ms, o);
  const ftime = (ms) => TP.fmt.time(ms);

  const narrow = () => (typeof window !== 'undefined' ? window.innerWidth < NARROW : false);
  const mode = () => S.mode || (narrow() ? 'list' : 'week');

  function rangeFor(m, a) {
    if (m === 'day') return { from: sod(a), to: addDays(sod(a), 1) };
    if (m === 'month') { const g = startOfWeek(startOfMonth(a)); return { from: g, to: addDays(g, 42), month: startOfMonth(a) }; }
    const w = startOfWeek(a); return { from: w, to: addDays(w, 7) };
  }
  function step(dir) {
    const m = mode();
    S.anchor = m === 'day' ? addDays(S.anchor, dir) : m === 'month' ? addMonths(S.anchor, dir) : addDays(S.anchor, 7 * dir);
  }

  // ------------------------------------------------------------------ data
  const PAL = () => Object.entries(TP.util.PALETTE).filter(([k]) => k !== 'graphite').map(([, v]) => v);
  function hashColor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) | 0; const p = PAL(); return p[Math.abs(h) % p.length]; }
  function colorFor(luId, key) {
    const c = luId && TP.data && TP.data.course ? TP.data.course(luId) : null;
    return (c && c.color) || hashColor(key);
  }
  const courseNameFor = (luId, fallback) => { const c = luId && TP.data.course ? TP.data.course(luId) : null; return (c && c.name) || fallback; };
  const roomText = (loc) => {
    if (!loc) return '';
    return [loc.room, loc.building && loc.building !== loc.room ? loc.building : '', !loc.room ? loc.street : ''].filter(Boolean).join(', ');
  };

  function toledoLessons(from, to) {
    let sched = {};
    try { sched = TP.data.schedule() || {}; } catch (_) { sched = {}; }
    const out = [];
    for (const list of Object.values(sched)) {
      for (const s of list || []) {
        if (!(s.start < to && s.end > from)) continue;
        const loc = s.location || {};
        const room = [loc.roomNumber, loc.mnemonic].find((x) => x && x !== '?') || '';
        out.push({ id: `tol-${s.start}-${s.courseLuId || s.name}`, start: s.start, end: s.end || s.start + H, title: s.courseName || s.name || '—', courseCode: '',
          group: '', kind: 'les', location: { room, building: '', street: '', city: '', mnemonic: '', url: '' }, teachers: [], courseLuId: s.courseLuId || null, source: 'toledo' });
      }
    }
    return out;
  }

  function gather(from, to) {
    const K = TP.kuloket;
    const st = (K && K.status && K.status()) || {};
    let lessons = K && K.peekLessons ? K.peekLessons({ from, to }) : null;
    let fallback = false;
    if ((!lessons || !lessons.length) && st.lessons && st.lessons.ok === false) {
      const tl = toledoLessons(from, to);
      if (tl.length) { lessons = tl; fallback = true; }
    }
    lessons = lessons || [];
    const exams = ((K && K.peekExams && K.peekExams()) || []).filter((e) => e.start < to && e.end > from);
    let dls = [];
    try { dls = (TP.data.deadlines({ includeDone: true, horizonDays: 400 }) || []).filter((d) => d.due >= from && d.due < to); } catch (_) { dls = []; }

    const items = [];
    const examAt = new Set(exams.map((e) => e.start + '|' + (e.courseCode || '')));
    for (const l of lessons) {
      if (l.kind === 'examen' && examAt.has(l.start + '|' + (l.courseCode || ''))) continue;
      const title = courseNameFor(l.courseLuId, l.title);
      items.push({ key: 'l:' + l.id, type: l.kind === 'examen' ? 'exam' : 'lesson', start: l.start, end: l.end, allDay: !!l.allDay, title,
        color: colorFor(l.courseLuId, l.courseCode || l.title), room: roomText(l.location), data: l });
    }
    for (const e of exams) {
      items.push({ key: 'x:' + e.id, type: 'exam', start: e.start, end: e.end, title: courseNameFor(e.courseLuId, e.title),
        color: colorFor(e.courseLuId, e.courseCode || e.title), room: roomText(e.location), data: { ...e, source: 'kuloket' } });
    }
    for (const d of dls) {
      items.push({ key: 'd:' + d.key, type: 'deadline', start: d.due, end: d.due, allDay: true, title: d.title,
        color: d.color || colorFor(d.courseLuId, d.courseName), room: '', data: d, done: d.done });
    }
    items.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    S.items = new Map(items.map((i) => [i.key, i]));
    return { items, st, fallback };
  }

  const qOf = (it) => [it.title, it.room, it.data.courseName, it.data.courseCode, ...(it.data.teachers || []), it.data.group,
    it.type === 'exam' ? t('agenda.exam') : it.type === 'deadline' ? t('agenda.deadline') : t('agenda.lesson')].filter(Boolean).join(' ').toLowerCase();
  const typeLabel = (it) => (it.type === 'exam' ? t('agenda.exam') : it.type === 'deadline' ? t('agenda.deadline') : t('agenda.lesson'));
  function ariaFor(it) {
    const when = it.type === 'deadline' ? `${fdate(it.start, { weekday: 'long', day: 'numeric', month: 'long' })} ${ftime(it.start)}`
      : `${fdate(it.start, { weekday: 'long', day: 'numeric', month: 'long' })}, ${ftime(it.start)}–${ftime(it.end)}`;
    return [`${typeLabel(it)}: ${it.title}`, when, it.room].filter(Boolean).join(', ');
  }
  const timeRange = (it) => `${ftime(it.start)}–${ftime(it.end)}`;

  // ------------------------------------------------------------------ pieces
  function deadlineChip(it) {
    const attrs = it.data.url ? `href="${esc(it.data.url)}" target="_blank" rel="noopener"` : `href="${esc(TP.shell.href('deadlines'))}"`;
    return `<a class="ag-chip ag-chip-dl${it.done ? ' is-done' : ''}" ${attrs} style="--c:${esc(it.color)}" data-q="${esc(qOf(it))}" data-key="${esc(it.key)}" aria-label="${esc(ariaFor(it))}${it.data.url ? ' ' + esc(t('agenda.newTab')) : ''}">`
      + `${icon(it.done ? 'checkCircle' : 'deadlines', { size: 12 })}<span class="ag-chip-t">${esc(ftime(it.start))}</span> <span class="ag-chip-x">${esc(it.title)}</span></a>`;
  }

  function evBlock(it, geo, wide) {
    const meta = wide ? [timeRange(it), it.room, (it.data.teachers || []).join(', ')].filter(Boolean).join(' · ') : [ftime(it.start), it.room].filter(Boolean).join(' · ');
    const style = `--c:${esc(it.color)};top:${geo.top}px;height:${geo.height}px;left:calc(${geo.left}% + 1px);width:calc(${geo.width}% - 3px)`;
    return `<button type="button" class="ag-ev ag-ev-${it.type}${geo.height < 34 ? ' is-short' : ''}" data-action="ag-open" data-key="${esc(it.key)}" data-q="${esc(qOf(it))}" style="${style}" aria-label="${esc(ariaFor(it))}">`
      + `${it.type === 'exam' ? `<span class="ag-ev-tag">${esc(t('agenda.exam'))}</span>` : ''}<span class="ag-ev-title">${esc(it.title)}</span><span class="ag-ev-meta">${esc(meta)}</span></button>`;
  }

  /** Side-by-side layout for overlapping events: sets .col and .n on each (sorted by start). */
  function layout(evs) {
    let cluster = [], cols = [], clusterEnd = -Infinity;
    const flush = () => { for (const e of cluster) e.n = cols.length; cluster = []; cols = []; clusterEnd = -Infinity; };
    for (const e of evs) {
      const end = Math.max(e.end, e.start + 20 * 60e3);
      if (cluster.length && e.start >= clusterEnd) flush();
      let c = cols.findIndex((x) => x <= e.start);
      if (c < 0) { c = cols.length; cols.push(end); } else cols[c] = end;
      e.col = c; cluster.push(e); clusterEnd = Math.max(clusterEnd, end);
    }
    flush();
    return evs;
  }

  function timeGrid(r, days, items) {
    const timed = items.filter((i) => i.type !== 'deadline' && !i.allDay);
    const dl = items.filter((i) => i.type === 'deadline' || i.allDay);
    let h0 = 7, h1 = 20;
    for (const i of timed) {
      const s = new Date(i.start), e = new Date(i.end);
      if (sod(i.start) === sod(i.end - 1)) { h0 = Math.min(h0, s.getHours()); h1 = Math.max(h1, e.getHours() + (e.getMinutes() ? 1 : 0)); }
    }
    h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 1));
    const today = sod(Date.now());
    const wide = days.length === 1;
    const head = days.map((d) => `<button type="button" class="ag-dayhead${d === today ? ' is-today' : ''}" data-action="ag-day" data-day="${d}" aria-label="${esc(cap(fdate(d, { weekday: 'long', day: 'numeric', month: 'long' })))}"${d === today ? ' aria-current="date"' : ''}>`
      + `<span class="ag-dow">${esc(fdate(d, { weekday: wide ? 'long' : 'short' }).replace(/\.$/, ''))}</span><span class="ag-num">${esc(fdate(d, { day: 'numeric' }))}</span></button>`).join('');
    const allday = dl.length ? `<div class="ag-allday" style="--days:${days.length}"><div class="ag-gutter ag-ad-label" title="${esc(t('agenda.allDay'))}">${icon('deadlines', { size: 14 })}<span class="tp-sr">${esc(t('agenda.allDay'))}</span></div>${days.map((d) => {
      const list = dl.filter((i) => sod(i.start) === d);
      return `<div class="ag-ad-cell">${list.map(deadlineChip).join('')}</div>`;
    }).join('')}</div>` : '';
    const hours = [];
    for (let h = h0; h < h1; h++) hours.push(`<div class="ag-hour"><span>${esc(String(h).padStart(2, '0') + ':00')}</span></div>`);
    const cols = days.map((d) => {
      const evs = layout(timed.filter((i) => i.start < addDays(d, 1) && i.end > d).map((i) => ({ ...i })));
      const base = d + h0 * H;
      const blocks = evs.map((e) => {
        const s = Math.max(e.start, base); const en = Math.min(e.end, d + h1 * H);
        const top = Math.round(((s - base) / H) * HOUR_PX);
        const height = Math.max(18, Math.round(((en - s) / H) * HOUR_PX) - 2);
        return evBlock(e, { top, height, left: (e.col / e.n) * 100, width: 100 / e.n }, wide);
      }).join('');
      const isToday = d === today;
      return `<div class="ag-col${isToday ? ' is-today' : ''}" data-day="${d}">${blocks}${isToday ? '<div class="ag-now" aria-hidden="true"></div>' : ''}</div>`;
    }).join('');
    return `<div class="ag-cal ag-timegrid${wide ? ' ag-dayview' : ''}" role="region" tabindex="0" aria-label="${esc(t('agenda.region'))}" style="--days:${days.length};--h0:${h0};--hours:${h1 - h0};--hh:${HOUR_PX}px">
  <div class="ag-head"><div class="ag-gutter"></div>${head}</div>
  ${allday}
  <div class="ag-grid"><div class="ag-hours" aria-hidden="true">${hours.join('')}</div>${cols}</div>
</div>`;
  }

  function monthGrid(r, items) {
    const today = sod(Date.now());
    const m = new Date(r.month).getMonth();
    const dows = [];
    for (let i = 0; i < 7; i++) dows.push(`<div class="ag-mdow" aria-hidden="true">${esc(fdate(addDays(r.from, i), { weekday: 'short' }).replace(/\.$/, ''))}</div>`);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(r.from, i);
      const list = items.filter((it) => sod(it.start) === d || (it.type !== 'deadline' && it.start < d && it.end > d));
      const shown = list.slice(0, 3);
      const more = list.length - shown.length;
      const chips = shown.map((it) => (it.type === 'deadline' ? `<li>${deadlineChip(it)}</li>`
        : `<li><button type="button" class="ag-chip ag-chip-${it.type}" data-action="ag-open" data-key="${esc(it.key)}" data-q="${esc(qOf(it))}" style="--c:${esc(it.color)}" aria-label="${esc(ariaFor(it))}"><span class="ag-chip-dot" aria-hidden="true"></span><span class="ag-chip-t">${esc(ftime(it.start))}</span> <span class="ag-chip-x">${esc(it.title)}</span></button></li>`)).join('');
      const label = `${cap(fdate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${list.length ? ', ' + t('agenda.items', { n: list.length }) : ''}`;
      cells.push(`<div class="ag-mcell${new Date(d).getMonth() !== m ? ' is-out' : ''}${d === today ? ' is-today' : ''}">
  <button type="button" class="ag-mnum" data-action="ag-day" data-day="${d}" aria-label="${esc(label)}"${d === today ? ' aria-current="date"' : ''}>${esc(fdate(d, { day: 'numeric' }))}</button>
  ${chips ? `<ul class="ag-mlist">${chips}</ul>` : ''}${more > 0 ? `<button type="button" class="ag-more" data-action="ag-day" data-day="${d}">${esc(t('agenda.more', { n: more }))}</button>` : ''}
  ${list.length ? `<span class="ag-mdots" aria-hidden="true">${list.slice(0, 4).map((it) => `<i style="--c:${esc(it.color)}"></i>`).join('')}</span>` : ''}
</div>`);
    }
    return `<div class="ag-cal ag-month" role="region" tabindex="0" aria-label="${esc(t('agenda.region'))}"><div class="ag-mhead">${dows.join('')}</div><div class="ag-mgrid">${cells.join('')}</div></div>`;
  }

  function listView(r, items) {
    const today = sod(Date.now());
    const out = [];
    for (let d = r.from; d < r.to; d = addDays(d, 1)) {
      const list = items.filter((it) => sod(it.start) === d);
      const rel = d === today ? t('agenda.today') : '';
      const head = `${cap(fdate(d, { weekday: 'long' }))} <span>${esc(fdate(d, { day: 'numeric', month: 'long' }))}${rel ? ' · ' + esc(rel) : ''}</span>`;
      const rows = list.map((it) => {
        const lead = `<span class="ag-ltime" aria-hidden="true">${it.type === 'deadline' ? esc(ftime(it.start)) : `${esc(ftime(it.start))}<br><small>${esc(ftime(it.end))}</small>`}</span><span class="ag-lbar" style="--c:${esc(it.color)}" aria-hidden="true"></span>`;
        const sub = it.type === 'deadline' ? esc([t('agenda.deadline'), it.data.courseName].filter(Boolean).join(' · '))
          : esc([it.room || (it.data.source === 'toledo' ? '' : t('agenda.noRoom')), (it.data.teachers || []).join(', ')].filter(Boolean).join(' · '));
        const title = `${it.type === 'exam' ? `<span class="ag-tag">${esc(t('agenda.exam'))}</span> ` : ''}${esc(it.title)}`;
        const attrs = { 'data-key': it.key, 'aria-label': ariaFor(it) };
        if (it.type === 'deadline') {
          const href = it.data.url || TP.shell.href('deadlines');
          if (it.data.url) Object.assign(attrs, { target: '_blank', rel: 'noopener' });
          return TP.ui.row({ href, leading: lead, title, subtitle: sub, q: qOf(it), cls: `ag-lrow ag-lrow-deadline${it.done ? ' is-done' : ''}`, attrs, trailing: it.data.url ? icon('external', { size: 13 }) : '' });
        }
        return TP.ui.row({ action: 'ag-open', leading: lead, title, subtitle: sub, q: qOf(it), cls: `ag-lrow ag-lrow-${it.type}`, attrs, chevron: true });
      }).join('');
      out.push(`<section class="ag-lday${d === today ? ' is-today' : ''}${list.length ? '' : ' is-empty'}" aria-label="${esc(cap(fdate(d, { weekday: 'long', day: 'numeric', month: 'long' })))}">
  <h3 class="ag-lhead"${d === today ? ' aria-current="date"' : ''}>${head}</h3>
  ${TP.ui.group(rows || `<div class="ag-lnone">${esc(t('agenda.nothing'))}</div>`)}
</section>`);
    }
    return `<div class="ag-cal ag-list" role="region" tabindex="0" aria-label="${esc(t('agenda.region'))}">${out.join('')}</div>`;
  }

  function statusLine(st, fallback) {
    const L = (st && st.lessons) || {};
    const nt = `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;
    const K = TP.kuloket;
    if (L.ok === false && (L.error === 'auth' || L.error === 'ics')) {
      const login = `<a href="${esc(K.loginUrl())}" target="_blank" rel="noopener" class="ag-status-link">${esc(t('agenda.status.loginLink'))} ›${nt}</a>`;
      const settings = `<a href="${esc(TP.shell.href('settings'))}">${esc(t('agenda.status.orIcs'))}</a>`;
      const msg = L.error === 'ics' ? t('agenda.status.icsFailed') : t('agenda.status.login');
      return `<div class="ag-status is-warn" role="status">${icon('info', { size: 15 })}<p>${esc(msg)} ${login} <span class="ag-or">${settings}</span>${fallback ? ` <span class="ag-fallback">${esc(t('agenda.status.toledoOnly'))}</span>` : ''}</p></div>`;
    }
    if (L.ok === false) {
      return `<div class="ag-status is-warn" role="status">${icon('warning', { size: 15 })}<p>${esc(t('agenda.status.offline'))} <button type="button" class="tp-link-btn" data-action="ag-retry">${esc(t('common.retry'))}</button></p></div>`;
    }
    if (L.t && L.source) {
      return `<p class="ag-status" role="status">${icon('checkCircle', { size: 14 })}<span>${esc(t(L.source === 'ics' ? 'agenda.status.ics' : 'agenda.status.kuloket', { time: ftime(L.t) }))}</span></p>`;
    }
    return `<p class="ag-status" role="status" aria-busy="true">${icon('clock', { size: 14 })}<span>${esc(t('agenda.status.loading'))}</span></p>`;
  }

  function rangeLabel(m, r) {
    if (m === 'day') return cap(fdate(r.from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (m === 'month') return cap(fdate(r.month, { month: 'long', year: 'numeric' }));
    const last = addDays(r.to, -1);
    const a = new Date(r.from), b = new Date(last);
    const left = a.getMonth() === b.getMonth() ? fdate(r.from, { day: 'numeric' }) : fdate(r.from, { day: 'numeric', month: 'short', ...(a.getFullYear() !== b.getFullYear() ? { year: 'numeric' } : {}) });
    return `${left} – ${fdate(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  // ------------------------------------------------------------------ paint
  function paint() {
    const ctx = S.ctx;
    if (!ctx || !ctx.root || !ctx.root.isConnected) return;
    if (S.pop && S.pop.open) { S.dirty = true; return; }
    const m = mode();
    const r = rangeFor(m, S.anchor);
    const { items, st, fallback } = gather(r.from, r.to);
    const days = [];
    if (m === 'day') days.push(r.from); else if (m === 'week') for (let i = 0; i < 7; i++) days.push(addDays(r.from, i));
    const cal = m === 'month' ? monthGrid(r, items) : m === 'list' ? listView(r, items) : timeGrid(r, days, items);
    const wk = m === 'week' || m === 'list' || m === 'day' ? `<span class="ag-wk">${esc(t('agenda.weekNo', { n: isoWeekNo(r.from) }))}</span>` : '';
    const opts = MODES.map((v) => ({ value: v, label: t('agenda.view.' + v) }));
    const bar = `<div class="ag-bar">
  <h2 class="ag-range" id="ag-range">${esc(rangeLabel(m, r))} ${wk}</h2>
  <div class="ag-controls">
    <div class="ag-nav">
      <button type="button" class="tp-btn tp-btn-gray tp-btn-icon" data-action="ag-prev" aria-label="${esc(t('agenda.prev'))}" title="${esc(t('agenda.prev'))} (←)">${icon('chevronLeft', { size: 16, strokeWidth: 2.4 })}</button>
      <button type="button" class="tp-btn tp-btn-gray" data-action="ag-today" title="T">${esc(t('agenda.today'))}</button>
      <button type="button" class="tp-btn tp-btn-gray tp-btn-icon" data-action="ag-next" aria-label="${esc(t('agenda.next'))}" title="${esc(t('agenda.next'))} (→)">${icon('chevronRight', { size: 16, strokeWidth: 2.4 })}</button>
    </div>
    ${TP.ui.segmented('ag-mode', opts, m, { label: t('agenda.view.label') })}
  </div>
</div>`;
    const K = TP.kuloket;
    const foot = `<p class="ag-foot">${icon('calendar', { size: 13 })} ${esc(t('agenda.subscribeHint'))} <a href="${esc(K.icalAppUrl())}" target="_blank" rel="noopener">${esc(t('agenda.subscribeLink'))} ›<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span></a><span class="ag-keys"> · ${esc(t('agenda.keys'))}</span></p>`;

    const focus = captureFocus(ctx.root);
    ctx.root.innerHTML = `<div class="ag-view ag-m-${m}" data-mode="${m}">${bar}${statusLine(st, fallback)}${cal}<div class="ag-noresults" hidden></div>${foot}</div>`;
    restoreFocus(ctx.root, focus);
    updateNow();
    if (S.q) applySearch();
  }

  function captureFocus(root) {
    const a = root.getRootNode && root.getRootNode().activeElement;
    if (!a || !root.contains(a)) return null;
    if (a.name === 'ag-mode') return `input[name="ag-mode"][value="${a.value}"]`;
    if (a.dataset && a.dataset.key) return `[data-key="${CSS.escape(a.dataset.key)}"]`;
    if (a.dataset && a.dataset.action) return `[data-action="${CSS.escape(a.dataset.action)}"]${a.dataset.day ? `[data-day="${a.dataset.day}"]` : ''}`;
    if (a.classList.contains('ag-cal')) return '.ag-cal';
    return null;
  }
  function restoreFocus(root, sel) {
    if (!sel) return;
    const el = root.querySelector(sel) || (sel.startsWith('[data-action="ag-day"]') ? root.querySelector('.ag-cal') : null);
    if (el) el.focus({ preventScroll: true });
  }

  function updateNow() {
    const el = S.ctx && S.ctx.root.querySelector('.ag-now');
    if (!el) return;
    const cal = el.closest('.ag-timegrid');
    const h0 = Number(cal.style.getPropertyValue('--h0')) || 0;
    const hours = Number(cal.style.getPropertyValue('--hours')) || 0;
    const now = Date.now();
    const top = ((now - sod(now)) / H - h0) * HOUR_PX;
    el.hidden = top < 0 || top > hours * HOUR_PX;
    el.style.top = `${Math.round(top)}px`;
    el.title = t('agenda.now', { time: ftime(now) });
  }

  // ------------------------------------------------------------------ load
  function load() {
    const K = TP.kuloket;
    if (!K) return;
    const r = rangeFor(mode(), S.anchor);
    const seq = ++S.seq;
    Promise.all([K.lessons({ from: r.from, to: r.to }), K.exams()])
      .then(() => { if (seq === S.seq && S.ctx) paint(); })
      .catch(() => {});
  }
  function go() { closePop(false); paint(); load(); TP.shell.announce(S.ctx.root.querySelector('.ag-range')?.textContent.trim() || ''); }

  // ------------------------------------------------------------------ popover
  function detailRow(label, valueHtml) { return valueHtml ? `<div class="ag-prow"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>` : ''; }
  function openPop(key, opener) {
    const it = S.items.get(key);
    if (!it || !S.ctx) return;
    closePop(false);
    const l = it.data;
    const loc = l.location || {};
    const nt = `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;
    const roomHtml = [esc(it.room || ''), loc.street && it.room ? esc(loc.street) : '', loc.city ? esc(loc.city) : ''].filter(Boolean).join(', ')
      + (loc.url ? ` <a href="${esc(loc.url)}" target="_blank" rel="noopener">${esc(t('agenda.pop.map'))} ›${nt}</a>` : '');
    const course = l.courseLuId && TP.data.course && TP.data.course(l.courseLuId);
    const actions = [
      course ? TP.ui.button(t('agenda.pop.openCourse'), { kind: 'filled', icon: 'courses', attrs: { href: TP.shell.href('course', { luId: l.courseLuId }) } }) : '',
      l.url ? TP.ui.button(t('agenda.pop.ects'), { kind: 'gray', icon: 'external', attrs: { href: l.url, target: '_blank', rel: 'noopener' } }) : '',
    ].filter(Boolean).join('');
    const d = document.createElement('dialog');
    d.className = 'ag-pop tp-glass';
    d.setAttribute('aria-labelledby', 'ag-pop-title');
    d.style.setProperty('--c', it.color);
    d.innerHTML = `<div class="ag-pop-head"><span class="ag-pop-bar" aria-hidden="true"></span><div class="ag-pop-ht">
  <p class="ag-pop-kind${it.type === 'exam' ? ' is-exam' : ''}">${esc(typeLabel(it))}${l.courseCode ? ` · ${esc(l.courseCode)}` : ''}</p>
  <h2 id="ag-pop-title">${esc(it.title)}</h2></div>
  ${TP.ui.button('', { icon: 'xmark', kind: 'gray', action: 'ag-close', attrs: { 'aria-label': t('agenda.pop.close') } })}</div>
<dl class="ag-pop-dl">
  ${detailRow(t('agenda.pop.time'), esc(`${cap(fdate(it.start, { weekday: 'long', day: 'numeric', month: 'long' }))}, ${timeRange(it)}`))}
  ${detailRow(t('agenda.pop.room'), roomHtml || `<span class="ag-muted">${esc(t('agenda.noRoom'))}</span>`)}
  ${detailRow(t('agenda.pop.teachers'), (l.teachers || []).map(esc).join('<br>'))}
  ${detailRow(t('agenda.pop.group'), esc(l.group || ''))}
  ${detailRow(t('agenda.pop.form'), esc(l.form || ''))}
  ${detailRow(t('agenda.pop.info'), esc(l.text || ''))}
</dl>
${actions ? `<div class="ag-pop-actions">${actions}</div>` : ''}
<p class="ag-pop-src">${esc(t('agenda.pop.source.' + (l.source || 'kuloket')))}</p>`;
    S.ctx.root.querySelector('.ag-view').appendChild(d);
    S.pop = d; S.popOpener = key;
    d.addEventListener('close', () => {
      if (S.pop !== d) return;
      S.pop = null; d.remove();
      if (S.dirty) { S.dirty = false; paint(); }
      const back = S.ctx && S.ctx.root.querySelector(`[data-key="${CSS.escape(key)}"]`);
      back && back.focus({ preventScroll: true });
    });
    try { d.showModal(); } catch (_) { d.setAttribute('open', ''); }
    position(d, opener);
    d.querySelector('[data-action="ag-close"]').focus();
  }
  function position(d, opener) {
    if (narrow() || !opener) { d.classList.add('is-sheet'); return; }
    const r = opener.getBoundingClientRect();
    const w = d.offsetWidth || 320, h = d.offsetHeight || 240;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = r.right + 10;
    if (left + w > vw - 12) left = r.left - w - 10;
    if (left < 12) left = Math.max(12, Math.min(vw - w - 12, r.left));
    const top = Math.max(12, Math.min(vh - h - 12, r.top));
    d.style.left = `${Math.round(left)}px`; d.style.top = `${Math.round(top)}px`;
  }
  function closePop(restore = true) {
    const d = S.pop;
    if (!d) return;
    if (!restore) { S.pop = null; d.remove(); return; }
    try { d.close(); } catch (_) { S.pop = null; d.remove(); }
  }

  // ------------------------------------------------------------------ events
  function onClick(ev) {
    const ctx = S.ctx;
    if (!ctx) return;
    if (S.pop && ev.target === S.pop) { closePop(); return; } // backdrop
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx.root.contains(el)) return;
    const a = el.getAttribute('data-action');
    if (a === 'ag-open') { ev.preventDefault(); openPop(el.getAttribute('data-key'), el); }
    else if (a === 'ag-close') { ev.preventDefault(); closePop(); }
    else if (a === 'ag-prev') { step(-1); go(); }
    else if (a === 'ag-next') { step(1); go(); }
    else if (a === 'ag-today') { S.anchor = sod(Date.now()); go(); }
    else if (a === 'ag-day') { S.anchor = Number(el.getAttribute('data-day')) || S.anchor; S.mode = 'day'; go(); }
    else if (a === 'ag-retry') { const r = rangeFor(mode(), S.anchor); TP.kuloket.refresh({ from: r.from, to: r.to }).then(paint); }
  }
  function onChange(ev) {
    const el = ev.target;
    if (el && el.name === 'ag-mode' && MODES.includes(el.value)) { S.mode = el.value; go(); }
  }
  function onKey(ev) {
    if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tg = ev.target;
    if (S.pop && S.pop.open) return;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); go(); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); go(); }
    else if (ev.key === 't' || ev.key === 'T') { ev.preventDefault(); S.anchor = sod(Date.now()); go(); }
  }

  function exportIcs() {
    let list = [];
    try { list = TP.data.deadlines({}) || []; } catch (_) { list = []; }
    let text;
    try { text = TP.data.ics(list); } catch (e) { console.warn('[Toledo+] ics', e); return; }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'toledo-deadlines.ics'; a.hidden = true;
      (S.ctx ? S.ctx.root : document.body).appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { console.warn('[Toledo+] ics download', e); }
    TP.shell.toast(t('agenda.exported'));
  }

  // ------------------------------------------------------------------ search
  function applySearch() {
    const root = S.ctx && S.ctx.root;
    if (!root) return;
    const q = S.q;
    let n = 0;
    root.querySelectorAll('[data-q]').forEach((el) => {
      const hit = !q || (el.getAttribute('data-q') || '').includes(q);
      if (hit && q) n++;
      if (el.classList.contains('tp-row')) el.hidden = !hit; else el.classList.toggle('ag-dim', !hit);
    });
    root.querySelectorAll('.ag-lday').forEach((s) => { s.hidden = !!q && !s.querySelector('.tp-row:not([hidden])'); });
    const nr = root.querySelector('.ag-noresults');
    if (nr) { nr.hidden = !q || n > 0; nr.innerHTML = q && !n ? TP.ui.noResults(q) : ''; }
  }

  // ------------------------------------------------------------------ register
  if (TP.kuloket && TP.kuloket.on) TP.kuloket.on('change', () => { if (S.ctx && S.ctx.root.isConnected) paint(); });

  TP.shell.register('agenda', {
    title: () => t('nav.agenda'),
    searchPlaceholder: () => t('agenda.search'),
    showUpdated: false,
    render(ctx) {
      const fresh = S.ctx !== ctx;
      S.ctx = ctx;
      if (S.anchor == null) S.anchor = sod(Date.now());
      if (!bound.has(ctx.root)) {
        bound.add(ctx.root);
        ctx.root.addEventListener('click', onClick);
        ctx.root.addEventListener('change', onChange);
        ctx.root.addEventListener('keydown', onKey);
        if (typeof ResizeObserver !== 'undefined') {
          S.lastNarrow = narrow();
          S.ro = new ResizeObserver(() => { const n = narrow(); if (n !== S.lastNarrow) { S.lastNarrow = n; if (!S.mode) paint(); } });
          S.ro.observe(ctx.root);
        }
      }
      try { ctx.setActions([{ id: 'ag-ics', label: t('agenda.export'), icon: 'calendar', onClick: exportIcs }]); } catch (_) { /* ignore */ }
      if (!S.timer) S.timer = setInterval(updateNow, 60e3);
      paint();
      if (fresh || !S.pop) load();
    },
    onSearch(ctx, q) { S.q = (q || '').trim().toLowerCase(); applySearch(); },
    destroy() {
      closePop(false);
      clearInterval(S.timer); S.timer = null;
      if (S.ro) { S.ro.disconnect(); S.ro = null; }
      S.ctx = null; S.q = ''; S.seq++;
    },
  });
})();
