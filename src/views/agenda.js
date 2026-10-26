/* Toledo+ — Agenda view (route 'agenda'): a Google-Calendar-like agenda in Apple Calendar style.
   Views: Dag · Week (7 days or Mon–Fri) · Maand (6 weeks) · Lijst (schedule; phone default).
   Sources: lessons from TP.kuloket (KU Loket, or the TimeEdit iCal fallback; Toledo's today/tomorrow as last resort),
   exams (TP.kuloket.exams), deadlines incl. own deadlines (TP.data.deadlines). Read-only.
   Per-device preferences (view, work week, week numbers, filters) live in TP.state.ui.agenda.
   Keyboard (no modifiers, never while typing): t vandaag · d/w/m/a(l) views · j n → volgende · k p ← vorige · g ga naar datum ·
   ? sneltoetsen · arrows move between events when one has focus · Enter opens. ⌘K, / and ⌘\ stay the shell's.
   Pure helpers (layout/packing, ranges, scroll target, .ics) are exported on TP.agenda for unit tests. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);
  const H = 3600e3, MIN = 60e3;
  const MODES = ['day', 'week', 'month', 'list'];
  const NARROW = 700;
  const VISIBLE_HOURS = 11;          // 08:00–19:00 visible by default; the grid scrolls 00–24 in its own container
  const MIN_EVENT = 20 * MIN;        // shorter events are laid out as if they lasted this long
  const PREF_DEFAULTS = { mode: null, workweek: false, weekNums: false, show: { lesson: true, exam: true, deadline: true }, hidden: [] };

  const S = {
    ctx: null, mode: null, anchor: null, q: '', items: new Map(), seq: 0,
    pop: null, popKind: '', popOpener: null, timer: null, ro: null, lastNarrow: null,
    prefs: null, known: new Map(), scroll: { key: '', top: 0, pending: false }, mini: null, swipe: null, paintT: 0,
  };
  const bound = new WeakSet();

  // ------------------------------------------------------------------ dates (browser local time)
  const sod = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const addDays = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  const addMonths = (ms, n) => { const d = new Date(ms); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return d.getTime(); };
  const startOfWeek = (ms) => { const d = new Date(sod(ms)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); };
  const startOfMonth = (ms) => { const d = new Date(sod(ms)); d.setDate(1); return d.getTime(); };
  const isoWeekNo = (ms) => {
    const d = new Date(ms); const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dow = u.getUTCDay() || 7; u.setUTCDate(u.getUTCDate() + 4 - dow);
    return Math.ceil(((u - Date.UTC(u.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  };
  const hourOf = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
  const isWeekend = (ms) => { const g = new Date(ms).getDay(); return g === 0 || g === 6; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const fdate = (ms, o) => TP.fmt.date(ms, o);
  const ftime = (ms) => TP.fmt.time(ms);
  const longDay = (ms) => cap(fdate(ms, { weekday: 'long', day: 'numeric', month: 'long' }));
  const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const narrow = () => (typeof window !== 'undefined' ? window.innerWidth < NARROW : false);
  const mode = () => S.mode || (narrow() ? 'list' : 'week');

  /** Visible range for a view. week: Mon..Sun (or Mon..Fri with workweek); month: 6 full weeks around the month. */
  function rangeFor(m, a, o = {}) {
    if (m === 'day') return { from: sod(a), to: addDays(sod(a), 1), days: 1 };
    if (m === 'month') { const g = startOfWeek(startOfMonth(a)); return { from: g, to: addDays(g, 42), month: startOfMonth(a), days: 42 }; }
    const w = startOfWeek(a);
    const n = m === 'week' && o.workweek ? 5 : 7;
    return { from: w, to: addDays(w, n), days: n, week: true };
  }
  function stepAnchor(m, a, dir) {
    return m === 'day' ? addDays(a, dir) : m === 'month' ? addMonths(a, dir) : addDays(a, 7 * dir);
  }

  /**
   * Google-style column packing for one day. Events are clustered (transitively overlapping), each gets the first
   * free column of its cluster, then widens to the right over columns where nothing overlaps it.
   * evs: [{start, end, ...}] → same objects (sorted) with col, span and n (columns in its cluster) set.
   */
  function layout(evs, minDur = MIN_EVENT) {
    const list = evs.slice().sort((a, b) => a.start - b.start || (b.end - a.end));
    const endOf = (e) => Math.max(e.end, e.start + minDur);
    const overlaps = (a, b) => a.start < endOf(b) && b.start < endOf(a);
    let cluster = [], cols = [], clusterEnd = -Infinity;
    const flush = () => {
      const n = cols.length;
      for (const e of cluster) {
        e.n = n;
        let span = 1;
        for (let c = e.col + 1; c < n; c++) {
          if (cluster.some((o) => o !== e && o.col === c && overlaps(o, e))) break;
          span++;
        }
        e.span = span;
      }
      cluster = []; cols = []; clusterEnd = -Infinity;
    };
    for (const e of list) {
      if (cluster.length && e.start >= clusterEnd) flush();
      let c = cols.findIndex((end) => end <= e.start);
      if (c < 0) { c = cols.length; cols.push(endOf(e)); } else cols[c] = endOf(e);
      e.col = c; cluster.push(e); clusterEnd = Math.max(clusterEnd, endOf(e));
    }
    flush();
    return list;
  }

  /** Hour (0..24−visible) the time grid scrolls to: ~1 h before the earliest event, or before "now" when today is
   *  shown and now would otherwise be out of view. Default 08:00. */
  function scrollHour(timed, range, now = Date.now(), visible = VISIBLE_HOURS) {
    let target = 8;
    const hs = timed.filter((i) => i.end > range.from && i.start < range.to).map((i) => (i.start < sod(i.end - 1) ? 0 : hourOf(i.start)));
    if (hs.length) target = Math.max(0, Math.floor(Math.min(...hs)) - 1);
    if (now >= range.from && now < range.to) {
      const nh = hourOf(now);
      if (nh < target || nh > target + visible - 1) target = Math.max(0, Math.floor(nh) - 1);
    }
    return Math.max(0, Math.min(target, 24 - visible));
  }

  /** One VEVENT calendar file for a lesson/exam ("Zet in agenda"). Times as UTC. */
  function icsFor(it, now = Date.now()) {
    const z = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
    const d = it.data || {};
    const loc = d.location || {};
    const where = [loc.room, loc.building && loc.building !== loc.room ? loc.building : '', loc.street, loc.city].filter(Boolean).join(', ');
    const desc = [d.courseCode, d.form || d.text, d.group, (d.teachers || []).join(', ')].filter(Boolean).join('\n');
    const uid = `${String(d.id || it.key).replace(/[^\w.-]/g, '')}@toledoplus`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Toledo+//Agenda//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${uid}`, `DTSTAMP:${z(now)}`, `DTSTART:${z(it.start)}`, `DTEND:${z(Math.max(it.end, it.start + MIN))}`, `SUMMARY:${e(it.title)}`];
    if (where) lines.push(`LOCATION:${e(where)}`);
    if (desc) lines.push(`DESCRIPTION:${e(desc)}`);
    if (loc.url) lines.push(`URL:${loc.url}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ preferences (per device: TP.state.ui.agenda)
  function loadPrefs() {
    let p = null;
    try { p = TP.state && TP.state.get && TP.state.get().ui && TP.state.get().ui.agenda; } catch (_) { p = null; }
    p = p && typeof p === 'object' ? p : {};
    return {
      mode: MODES.includes(p.mode) ? p.mode : null,
      workweek: !!p.workweek,
      weekNums: !!p.weekNums,
      show: { ...PREF_DEFAULTS.show, ...(p.show && typeof p.show === 'object' ? p.show : {}) },
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((k) => typeof k === 'string').slice(0, 200) : [],
    };
  }
  function savePrefs() {
    try { TP.state && TP.state.set && TP.state.set({ ui: { agenda: { ...S.prefs, show: { ...S.prefs.show }, hidden: S.prefs.hidden.slice() } } }); } catch (_) { /* ignore */ }
  }
  const filtersActive = () => !S.prefs.show.lesson || !S.prefs.show.exam || !S.prefs.show.deadline || S.prefs.hidden.length > 0;

  // ------------------------------------------------------------------ data
  const PAL = () => Object.entries(TP.util.PALETTE).filter(([k]) => k !== 'graphite').map(([, v]) => v);
  function hashColor(s) { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) | 0; const p = PAL(); return p[Math.abs(h) % p.length]; }
  const courseOf = (luId) => { try { return luId && TP.data.course ? TP.data.course(luId) : null; } catch (_) { return null; } };
  const colorFor = (luId, key) => { const c = courseOf(luId); return (c && c.color) || hashColor(key); };
  const courseNameFor = (luId, fallback) => { const c = courseOf(luId); return (c && c.name) || fallback; };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  /** Filter key of an item's course: the Toledo course when matched, else its (normalised) name. */
  const courseKey = (luId, name) => (luId ? 'lu:' + luId : name ? 'n:' + norm(name) : 'none');
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
        if (!(s.start < to && (s.end || s.start + H) > from)) continue;
        const loc = s.location || {};
        const room = [loc.roomNumber, loc.mnemonic].find((x) => x && x !== '?') || '';
        out.push({ id: `tol-${s.start}-${s.courseLuId || s.name}`, start: s.start, end: s.end || s.start + H, title: s.courseName || s.name || '—', courseCode: '',
          group: '', kind: 'les', location: { room, building: '', street: '', city: '', mnemonic: '', url: '' }, teachers: [], courseLuId: s.courseLuId || null, source: 'toledo' });
      }
    }
    return out;
  }

  /** Everything in [from, to): {all, items (after filters), st, info, fallback, lessonsKnown}. */
  function gather(from, to) {
    const K = TP.kuloket;
    const st = (K && K.status && K.status()) || {};
    const info = K && K.peekRange ? K.peekRange({ from, to }) : { items: K && K.peekLessons ? K.peekLessons({ from, to }) : null };
    let lessons = info.items;
    const lessonsKnown = Array.isArray(lessons);
    let fallback = false;
    if ((!lessons || !lessons.length) && st.lessons && st.lessons.ok === false) {
      const tl = toledoLessons(from, to);
      if (tl.length) { lessons = tl; fallback = true; }
    }
    lessons = lessons || [];
    const exams = ((K && K.peekExams && K.peekExams()) || []).filter((e) => e.start < to && e.end > from);
    let dls = [];
    try { dls = (TP.data.deadlines({ includeDone: true, horizonDays: 400 }) || []).filter((d) => d.due >= from && d.due < to); } catch (_) { dls = []; }

    const all = [];
    const examAt = new Set(exams.map((e) => e.start + '|' + (e.courseCode || '')));
    for (const l of lessons) {
      if (l.kind === 'examen' && examAt.has(l.start + '|' + (l.courseCode || ''))) continue;
      const title = courseNameFor(l.courseLuId, l.title);
      all.push({ key: 'l:' + l.id, type: l.kind === 'examen' ? 'exam' : 'lesson', start: l.start, end: Math.max(l.end, l.start + MIN), allDay: !!l.allDay, title,
        color: colorFor(l.courseLuId, l.courseCode || l.title), room: roomText(l.location), ckey: courseKey(l.courseLuId, l.title), data: l });
    }
    for (const e of exams) {
      all.push({ key: 'x:' + e.id, type: 'exam', start: e.start, end: Math.max(e.end, e.start + MIN), title: courseNameFor(e.courseLuId, e.title),
        color: colorFor(e.courseLuId, e.courseCode || e.title), room: roomText(e.location), ckey: courseKey(e.courseLuId, e.title), data: { ...e, source: 'kuloket' } });
    }
    for (const d of dls) {
      all.push({ key: 'd:' + d.key, type: 'deadline', start: d.due, end: d.due, title: d.title,
        color: d.color || colorFor(d.courseLuId, d.courseName), room: '', ckey: courseKey(d.courseLuId, d.courseName), data: d, done: d.done });
    }
    all.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
    for (const it of all) {
      if (it.ckey === 'none' || S.known.has(it.ckey)) continue;
      const name = it.type === 'deadline' ? (it.data.courseName || '') : it.title;
      if (name) S.known.set(it.ckey, { name, color: it.color });
    }
    const hidden = new Set(S.prefs.hidden);
    const items = all.filter((it) => S.prefs.show[it.type] !== false && !hidden.has(it.ckey));
    S.items = new Map(all.map((i) => [i.key, i]));
    return { all, items, st, info, fallback, lessonsKnown };
  }

  const typeLabel = (it) => (it.type === 'exam' ? t('agenda.exam') : it.type === 'deadline' ? t('agenda.deadline') : t('agenda.lesson'));
  const kindLine = (it) => (it.type === 'lesson' && it.data.form ? it.data.form : typeLabel(it));
  const qOf = (it) => [it.title, it.room, it.data.courseName, it.data.courseCode, ...(it.data.teachers || []), it.data.group, it.data.form,
    typeLabel(it)].filter(Boolean).join(' ').toLowerCase();
  const timeRange = (it) => `${ftime(it.start)} – ${ftime(it.end)}`;
  function ariaFor(it) {
    const when = it.type === 'deadline' ? `${longDay(it.start)} ${ftime(it.start)}` : `${longDay(it.start)}, ${ftime(it.start)} ${t('agenda.until')} ${ftime(it.end)}`;
    return [`${typeLabel(it)}: ${it.title}`, when, it.room, it.done ? t('agenda.done') : ''].filter(Boolean).join(', ');
  }
  const evAttrs = (it) => `data-action="ag-open" data-key="${esc(it.key)}" data-day="${sod(it.start)}" data-start="${it.start}" data-q="${esc(qOf(it))}" aria-label="${esc(ariaFor(it))}"`;

  // ------------------------------------------------------------------ pieces
  function chip(it, withTime = true) {
    const ic = it.type === 'deadline' ? icon(it.done ? 'checkCircle' : 'deadlines', { size: 12 }) : '<span class="ag-chip-dot" aria-hidden="true"></span>';
    return `<button type="button" class="ag-chip ag-chip-${it.type}${it.done ? ' is-done' : ''}" ${evAttrs(it)} style="--c:${esc(it.color)}">`
      + `${ic}${withTime ? `<span class="ag-chip-t">${esc(ftime(it.start))}</span>` : ''}<span class="ag-chip-x">${esc(it.title)}</span></button>`;
  }

  /** it = the item (real times), g = its clipped piece for one day with col/span/n from layout(). */
  function evBlock(it, g, day, wide) {
    const durMin = (g.end - g.start) / MIN;
    const size = durMin < 40 ? ' is-tiny' : durMin < 70 ? ' is-short' : '';
    const top = (g.start - day) / H;
    const hours = (g.end - g.start) / H;
    const style = `--c:${esc(it.color)};top:calc(var(--hh) * ${top.toFixed(4)});height:calc(var(--hh) * ${Math.max(hours, 0.34).toFixed(4)} - 2px);`
      + `left:calc(${((g.col / g.n) * 100).toFixed(3)}% + 1px);width:calc(${((g.span / g.n) * 100).toFixed(3)}% - 3px)`;
    const meta = [wide ? timeRange(it) : ftime(it.start), it.room, wide ? (it.data.teachers || []).join(', ') : ''].filter(Boolean);
    const tag = it.type === 'exam' ? `<span class="ag-ev-tag">${esc(t('agenda.exam'))}</span>` : '';
    return `<button type="button" class="ag-ev ag-ev-${it.type}${size}${g.col > 0 ? ' is-stacked' : ''}" ${evAttrs(it)} style="${style}">`
      + `${tag}<span class="ag-ev-title">${esc(it.title)}</span>`
      + `<span class="ag-ev-time">${esc(wide ? timeRange(it) : `${ftime(it.start)} – ${ftime(it.end)}`)}</span>`
      + (meta.length > 1 ? `<span class="ag-ev-meta">${esc(meta.slice(1).join(' · '))}</span>` : '') + '</button>';
  }

  function dayHead(d, wide, today) {
    const lbl = longDay(d);
    return `<button type="button" class="ag-dayhead${d === today ? ' is-today' : ''}${isWeekend(d) ? ' is-weekend' : ''}" data-action="ag-day" data-day="${d}" aria-label="${esc(t('agenda.openDay', { day: lbl }))}"${d === today ? ' aria-current="date"' : ''}>`
      + `<span class="ag-dow">${esc(fdate(d, { weekday: wide ? 'long' : 'short' }).replace(/\.$/, ''))}</span><span class="ag-num">${esc(fdate(d, { day: 'numeric' }))}</span></button>`;
  }

  function timeGrid(r, days, items) {
    const timed = items.filter((i) => i.type !== 'deadline' && !i.allDay);
    const top = items.filter((i) => i.type === 'deadline' || i.allDay);
    const today = sod(Date.now());
    const wide = days.length === 1;
    const head = days.map((d) => dayHead(d, wide, today)).join('');
    const allday = `<div class="ag-allday" role="group" aria-label="${esc(t('agenda.allDay'))}"><div class="ag-gutter ag-ad-label" title="${esc(t('agenda.allDay'))}">${icon('deadlines', { size: 14 })}<span class="tp-sr">${esc(t('agenda.allDay'))}</span></div>${days.map((d) => {
      const list = top.filter((i) => sod(i.start) === d);
      return `<div class="ag-ad-cell${isWeekend(d) ? ' is-weekend' : ''}">${list.map((i) => chip(i, !i.allDay)).join('')}</div>`;
    }).join('')}</div>`;
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(`<div class="ag-hour"><span>${h ? esc(ftime(new Date(2026, 0, 5, h).getTime())) : ''}</span></div>`);
    const cols = days.map((d) => {
      const dEnd = addDays(d, 1);
      const evs = layout(timed.filter((i) => i.start < dEnd && i.end > d).map((i) => ({ it: i, start: Math.max(i.start, d), end: Math.min(i.end, dEnd) })));
      const blocks = evs.map((g) => evBlock(g.it, g, d, wide)).join('');
      const marks = top.filter((i) => i.type === 'deadline' && sod(i.start) === d)
        .map((i) => `<span class="ag-dlmark${i.done ? ' is-done' : ''}" data-action="ag-open" data-key="${esc(i.key)}" style="--c:${esc(i.color)};top:calc(var(--hh) * ${hourOf(i.start).toFixed(4)})" title="${esc(`${ftime(i.start)} ${i.title}`)}" aria-hidden="true"></span>`).join('');
      const label = `${longDay(d)}${evs.length ? ', ' + t('agenda.items', { n: evs.length }) : ''}`;
      const isToday = d === today;
      return `<div class="ag-col${isToday ? ' is-today' : ''}${isWeekend(d) ? ' is-weekend' : ''}" data-day="${d}" role="group" aria-label="${esc(label)}">${blocks}${marks}${isToday ? '<div class="ag-now" aria-hidden="true"></div>' : ''}</div>`;
    }).join('');
    return `<div class="ag-cal ag-timegrid${wide ? ' ag-dayview' : ''}" role="region" aria-label="${esc(t('agenda.region'))}" style="--days:${days.length}" data-scroll="${scrollHour(timed, r)}">
  <div class="ag-head"><div class="ag-gutter"><span class="ag-tz">${esc(t('agenda.weekShort', { n: isoWeekNo(r.from) }))}</span></div>${head}</div>
  ${allday}
  <div class="ag-scroll" tabindex="0" role="group" aria-label="${esc(t('agenda.timeline'))}"><div class="ag-grid"><div class="ag-hours" aria-hidden="true">${hours.join('')}</div>${cols}</div></div>
</div>`;
  }

  function monthGrid(r, items) {
    const today = sod(Date.now());
    const m = new Date(r.month).getMonth();
    const wn = S.prefs.weekNums;
    const dows = [];
    if (wn) dows.push('<div class="ag-mdow ag-mwk" aria-hidden="true"></div>');
    for (let i = 0; i < 7; i++) dows.push(`<div class="ag-mdow${i > 4 ? ' is-weekend' : ''}" aria-hidden="true">${esc(fdate(addDays(r.from, i), { weekday: 'short' }).replace(/\.$/, ''))}</div>`);
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(r.from, i);
      if (wn && i % 7 === 0) cells.push(`<div class="ag-mwk" aria-hidden="true">${esc(String(isoWeekNo(d)))}</div>`);
      const dEnd = addDays(d, 1);
      const list = items.filter((it) => (it.type === 'deadline' ? sod(it.start) === d : it.start < dEnd && it.end > d));
      const shown = list.slice(0, list.length > 3 ? 2 : 3);
      const more = list.length - shown.length;
      const chips = shown.map((it) => `<li>${chip(it, !it.allDay)}</li>`).join('');
      const label = `${longDay(d)}${list.length ? ', ' + t('agenda.items', { n: list.length }) : ''}`;
      cells.push(`<div class="ag-mcell${new Date(d).getMonth() !== m ? ' is-out' : ''}${d === today ? ' is-today' : ''}${isWeekend(d) ? ' is-weekend' : ''}" data-day="${d}">
  <button type="button" class="ag-mnum" data-action="ag-day" data-day="${d}" aria-label="${esc(t('agenda.openDay', { day: label }))}"${d === today ? ' aria-current="date"' : ''}>${esc(fdate(d, { day: 'numeric' }))}</button>
  ${chips ? `<ul class="ag-mlist">${chips}</ul>` : ''}${more > 0 ? `<button type="button" class="ag-more" data-action="ag-day" data-day="${d}" aria-label="${esc(t('agenda.moreLabel', { n: more, day: longDay(d) }))}">${esc(t('agenda.more', { n: more }))}</button>` : ''}
  ${list.length ? `<span class="ag-mdots" aria-hidden="true">${list.slice(0, 4).map((it) => `<i style="--c:${esc(it.color)}"></i>`).join('')}</span>` : ''}
</div>`);
    }
    return `<div class="ag-cal ag-month${wn ? ' has-wk' : ''}" role="region" aria-label="${esc(t('agenda.region'))}"><div class="ag-mhead">${dows.join('')}</div><div class="ag-mgrid">${cells.join('')}</div></div>`;
  }

  function listView(r, items, known) {
    const today = sod(Date.now());
    const strip = [];
    const out = [];
    for (let d = r.from; d < r.to; d = addDays(d, 1)) {
      const list = items.filter((it) => sod(it.start) === d || (it.type !== 'deadline' && it.start < d && it.end > d));
      strip.push(`<button type="button" class="ag-strip-day${d === today ? ' is-today' : ''}${d === sod(S.anchor) ? ' is-sel' : ''}" data-action="ag-jump" data-day="${d}" aria-label="${esc(longDay(d) + (list.length ? ', ' + t('agenda.items', { n: list.length }) : ''))}"${d === today ? ' aria-current="date"' : ''}>`
        + `<span class="ag-dow">${esc(fdate(d, { weekday: 'short' }).replace(/\.$/, ''))}</span><span class="ag-num">${esc(fdate(d, { day: 'numeric' }))}</span>`
        + `<span class="ag-strip-dots" aria-hidden="true">${list.slice(0, 3).map((it) => `<i style="--c:${esc(it.color)}"></i>`).join('')}</span></button>`);
      const rel = d === today ? t('agenda.today') : d === addDays(today, 1) ? t('agenda.tomorrow') : '';
      const head = `${esc(cap(fdate(d, { weekday: 'long' })))} <span>${esc(fdate(d, { day: 'numeric', month: 'long' }))}${rel ? ' · ' + esc(rel) : ''}</span>`;
      const rows = list.map((it) => {
        const lead = `<span class="ag-ltime" aria-hidden="true">${it.type === 'deadline' ? esc(ftime(it.start)) : `${esc(ftime(it.start))}<br><small>${esc(ftime(it.end))}</small>`}</span><span class="ag-lbar" style="--c:${esc(it.color)}" aria-hidden="true"></span>`;
        const sub = it.type === 'deadline' ? esc([t('agenda.deadline'), it.data.courseName].filter(Boolean).join(' · '))
          : esc([it.room || (it.data.source === 'toledo' ? '' : t('agenda.noRoom')), (it.data.teachers || []).join(', ')].filter(Boolean).join(' · '));
        const title = `${it.type === 'exam' ? `<span class="ag-tag">${esc(t('agenda.exam'))}</span> ` : ''}${esc(it.title)}`;
        const attrs = { 'data-key': it.key, 'data-day': String(sod(it.start)), 'data-start': String(it.start), 'aria-label': ariaFor(it) };
        return TP.ui.row({ action: 'ag-open', leading: lead, title, subtitle: sub, q: qOf(it), cls: `ag-lrow ag-lrow-${it.type}${it.done ? ' is-done' : ''}`, attrs, chevron: true });
      }).join('');
      const none = known ? `<div class="ag-lnone">${esc(t('agenda.nothing'))}</div>` : `<div class="ag-lnone ag-loading" aria-hidden="true">…</div>`;
      out.push(`<section class="ag-lday${d === today ? ' is-today' : ''}${list.length ? '' : ' is-empty'}" data-day="${d}" aria-labelledby="ag-lh-${d}">
  <h3 class="ag-lhead" id="ag-lh-${d}" tabindex="-1"${d === today ? ' aria-current="date"' : ''}>${head}</h3>
  ${TP.ui.group(rows || none)}
</section>`);
    }
    return `<div class="ag-cal ag-list" role="region" aria-label="${esc(t('agenda.region'))}">
  <nav class="ag-strip" aria-label="${esc(t('agenda.stripLabel'))}">${strip.join('')}</nav>${out.join('')}</div>`;
  }

  // ------------------------------------------------------------------ status (B1: empty only after a successful fetch)
  const agoText = (ms) => (TP.fmt.ago && sod(ms) !== sod(Date.now()) ? TP.fmt.ago(ms) : ftime(ms));
  function statusLine(g) {
    const { st, info, fallback, lessonsKnown } = g;
    const L = (st && st.lessons) || {};
    const nt = `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;
    const K = TP.kuloket;
    const login = (txt) => `<a href="${esc(K.loginUrl())}" target="_blank" rel="noopener" class="ag-status-link">${esc(txt)} ›${nt}</a>`;
    if (L.ok === false && (L.error === 'auth' || L.error === 'ics')) {
      const settings = `<a href="${esc(TP.shell.href('settings'))}">${esc(t('agenda.status.orIcs'))}</a>`;
      const msg = L.error === 'ics' ? t('agenda.status.icsFailed') : t('agenda.status.login');
      const cached = lessonsKnown && info && info.t ? ` <span class="ag-fallback">${esc(t('agenda.status.cached', { time: agoText(info.t) }))}</span>` : '';
      return `<div class="ag-status is-warn" role="status">${icon('info', { size: 15 })}<p>${esc(msg)} ${login(t('agenda.status.loginLink'))} <span class="ag-or">${settings}</span>${cached}${fallback ? ` <span class="ag-fallback">${esc(t('agenda.status.toledoOnly'))}</span>` : ''}</p></div>`;
    }
    if (L.ok === false) {
      const cached = lessonsKnown && info && info.t ? ' ' + t('agenda.status.cached', { time: agoText(info.t) }) : '';
      return `<div class="ag-status is-warn is-error" role="status">${icon('warning', { size: 15 })}<p>${esc(t('agenda.status.offline') + cached)} <button type="button" class="tp-link-btn" data-action="ag-retry">${esc(t('common.retry'))}</button></p></div>`;
    }
    const src = (info && info.source) || L.source;
    const when = (info && info.t) || L.t;
    if (lessonsKnown && when && (src === 'ics' || (src === 'mixed' && L.needsLogin))) {
      return `<p class="ag-status is-ics" role="status">${icon('calendar', { size: 14 })}<span>${esc(t('agenda.status.icsFeed', { time: agoText(when) }))} · ${login(t('agenda.status.icsLogin'))}</span></p>`;
    }
    if (lessonsKnown && when) {
      return `<p class="ag-status" role="status">${icon('checkCircle', { size: 14 })}<span>${esc(t(src === 'ics' ? 'agenda.status.ics' : 'agenda.status.kuloket', { time: agoText(when) }))}</span></p>`;
    }
    return `<p class="ag-status" role="status" aria-busy="true"><span class="ag-spin" aria-hidden="true"></span><span>${esc(t('agenda.status.loading'))}</span></p>`;
  }

  function rangeLabel(m, r) {
    if (m === 'day') return cap(fdate(r.from, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    if (m === 'month') return cap(fdate(r.month, { month: 'long', year: 'numeric' }));
    const last = addDays(r.to, -1);
    const a = new Date(r.from), b = new Date(last);
    const left = a.getMonth() === b.getMonth() ? fdate(r.from, { day: 'numeric' }) : fdate(r.from, { day: 'numeric', month: 'short', ...(a.getFullYear() !== b.getFullYear() ? { year: 'numeric' } : {}) });
    return `${left} – ${fdate(last, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  // ------------------------------------------------------------------ filters / options panel + mini month
  function courseEntries(all) {
    const map = new Map();
    let cs = [];
    try { cs = TP.data.courses({ currentOnly: true }) || []; } catch (_) { cs = []; }
    for (const c of cs) map.set('lu:' + c.luId, { key: 'lu:' + c.luId, name: c.name, color: c.color });
    for (const it of all) if (it.ckey !== 'none' && !map.has(it.ckey) && S.known.has(it.ckey)) map.set(it.ckey, { key: it.ckey, ...S.known.get(it.ckey) });
    for (const k of S.prefs.hidden) if (!map.has(k)) { const kn = S.known.get(k); map.set(k, { key: k, name: kn ? kn.name : cap(k.replace(/^(lu|n):/, '')), color: kn ? kn.color : 'var(--label-3)' }); }
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function panelHtml(all, idp) {
    const P = S.prefs;
    const sw = (name, value, checked, label, ic) => `<label class="ag-opt"><span class="ag-opt-l">${ic || ''}<span>${esc(label)}</span></span><input type="checkbox" role="switch" class="tp-switch" name="${name}" value="${value}"${checked ? ' checked' : ''}></label>`;
    const courses = courseEntries(all);
    const hidden = new Set(P.hidden);
    const crow = (c) => `<label class="ag-copt"><input type="checkbox" name="ag-course" value="${esc(c.key)}"${hidden.has(c.key) ? '' : ' checked'}><span class="ag-cdot" style="--c:${esc(c.color)}" aria-hidden="true"></span><span class="ag-cname">${esc(c.name)}</span></label>`;
    return `<div class="ag-panel">
  <fieldset class="ag-fs"><legend>${esc(t('agenda.filter.show'))}</legend>
    ${sw('ag-show', 'lesson', P.show.lesson, t('agenda.filter.lessons'), '<span class="ag-kind ag-kind-lesson" aria-hidden="true"></span>')}
    ${sw('ag-show', 'exam', P.show.exam, t('agenda.filter.exams'), '<span class="ag-kind ag-kind-exam" aria-hidden="true"></span>')}
    ${sw('ag-show', 'deadline', P.show.deadline, t('agenda.filter.deadlines'), '<span class="ag-kind ag-kind-deadline" aria-hidden="true"></span>')}
  </fieldset>
  ${courses.length ? `<fieldset class="ag-fs ag-fs-courses"><legend>${esc(t('agenda.filter.courses'))}</legend>
    <div class="ag-clist" id="${idp}-courses">${courses.map(crow).join('')}</div>
    <div class="ag-fs-actions"><button type="button" class="tp-link-btn" data-action="ag-courses-all">${esc(t('agenda.filter.all'))}</button><button type="button" class="tp-link-btn" data-action="ag-courses-none">${esc(t('agenda.filter.none'))}</button></div>
  </fieldset>` : ''}
  <fieldset class="ag-fs"><legend>${esc(t('agenda.filter.display'))}</legend>
    ${sw('ag-opt', 'workweek', P.workweek, t('agenda.filter.workweek'))}
    ${sw('ag-opt', 'weekNums', P.weekNums, t('agenda.filter.weekNums'))}
  </fieldset>
  ${filtersActive() ? `<button type="button" class="tp-btn tp-btn-gray ag-reset" data-action="ag-reset">${esc(t('agenda.filter.reset'))}</button>` : ''}
</div>`;
  }

  function miniMonth(r) {
    const base = S.mini != null ? S.mini : startOfMonth(S.anchor);
    const from = startOfWeek(base);
    const m = new Date(base).getMonth();
    const today = sod(Date.now());
    const head = [];
    for (let i = 0; i < 7; i++) head.push(`<th scope="col" abbr="${esc(fdate(addDays(from, i), { weekday: 'long' }))}">${esc(fdate(addDays(from, i), { weekday: 'narrow' }))}</th>`);
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const cells = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(from, w * 7 + i);
        const inR = mode() !== 'month' && d >= r.from && d < r.to;
        cells.push(`<td><button type="button" class="ag-mini-d${new Date(d).getMonth() !== m ? ' is-out' : ''}${d === today ? ' is-today' : ''}${inR ? ' in-range' : ''}${d === sod(S.anchor) ? ' is-sel' : ''}" data-action="ag-goto-day" data-day="${d}" aria-label="${esc(cap(fdate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}"${d === today ? ' aria-current="date"' : ''}${inR ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${esc(fdate(d, { day: 'numeric' }))}</button></td>`);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    return `<div class="ag-mini" role="group" aria-label="${esc(t('agenda.mini'))}">
  <div class="ag-mini-head"><h3>${esc(cap(fdate(base, { month: 'long', year: 'numeric' })))}</h3>
    <button type="button" class="ag-mini-nav" data-action="ag-mini-prev" aria-label="${esc(t('agenda.mini.prev'))}">${icon('chevronLeft', { size: 14 })}</button>
    <button type="button" class="ag-mini-nav" data-action="ag-mini-next" aria-label="${esc(t('agenda.mini.next'))}">${icon('chevronRight', { size: 14 })}</button></div>
  <table class="ag-mini-t"><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
</div>`;
  }

  // ------------------------------------------------------------------ paint
  let paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    setTimeout(() => { paintQueued = false; paint(); }, 30);
  }

  function shell(ctx) {
    let view = ctx.root.querySelector(':scope > .ag-view');
    if (!view) {
      ctx.root.innerHTML = '<div class="ag-view"></div><div class="ag-layer"></div>';
      view = ctx.root.querySelector(':scope > .ag-view');
    }
    return view;
  }

  function paint() {
    const ctx = S.ctx;
    if (!ctx || !ctx.root || !ctx.root.isConnected) return;
    const m = mode();
    const r = rangeFor(m, S.anchor, S.prefs);
    const g = gather(r.from, r.to);
    const { items } = g;
    const days = [];
    if (m === 'day' || m === 'week') for (let i = 0; i < r.days; i++) days.push(addDays(r.from, i));
    const cal = m === 'month' ? monthGrid(r, items) : m === 'list' ? listView(r, items, g.lessonsKnown) : timeGrid(r, days, items);
    const wk = m !== 'month' ? `<span class="ag-wk">${esc(t('agenda.weekNo', { n: isoWeekNo(r.from) }))}</span>` : '';
    const opts = MODES.map((v) => ({ value: v, label: t('agenda.view.' + v) }));
    const fa = filtersActive();
    const bar = `<div class="ag-bar">
  <div class="ag-nav">
    <button type="button" class="tp-btn tp-btn-gray ag-today" data-action="ag-today" title="${esc(t('agenda.today'))} (T)">${esc(t('agenda.today'))}</button>
    <span class="ag-arrows">
      <button type="button" class="tp-btn tp-btn-plain tp-btn-icon" data-action="ag-prev" aria-label="${esc(t('agenda.prev'))}" title="${esc(t('agenda.prev'))} (K)">${icon('chevronLeft', { size: 16, strokeWidth: 2.4 })}</button>
      <button type="button" class="tp-btn tp-btn-plain tp-btn-icon" data-action="ag-next" aria-label="${esc(t('agenda.next'))}" title="${esc(t('agenda.next'))} (J)">${icon('chevronRight', { size: 16, strokeWidth: 2.4 })}</button>
    </span>
    <h2 class="ag-range" id="ag-range"><button type="button" class="ag-range-btn" data-action="ag-goto" title="${esc(t('agenda.goto'))} (G)" aria-label="${esc(t('agenda.gotoLabel', { range: rangeLabel(m, r) }))}">${esc(rangeLabel(m, r))}</button> ${wk}</h2>
  </div>
  <div class="ag-controls">
    ${TP.ui.segmented('ag-mode', opts, m, { label: t('agenda.view.label') })}
    <button type="button" class="tp-btn tp-btn-gray tp-btn-icon ag-filter-btn${fa ? ' is-active' : ''}" data-action="ag-filter" aria-haspopup="dialog" aria-label="${esc(t(fa ? 'agenda.filter.labelActive' : 'agenda.filter.label'))}" title="${esc(t('agenda.filter.label'))}">${icon('filter', { size: 16 })}${fa ? '<span class="ag-badge" aria-hidden="true"></span>' : ''}</button>
    <button type="button" class="tp-btn tp-btn-gray tp-btn-icon ag-keys-btn" data-action="ag-keys" aria-haspopup="dialog" aria-label="${esc(t('agenda.keys.title'))}" title="${esc(t('agenda.keys.title'))} (?)"><span aria-hidden="true">?</span></button>
  </div>
</div>`;
    const emptyKind = m === 'day' ? 'day' : m === 'month' ? 'month' : 'week';
    const L = (g.st && g.st.lessons) || {};
    const showEmpty = !items.length && g.lessonsKnown && L.ok !== false;
    const empty = showEmpty ? `<div class="ag-empty" role="note">${icon('calendar', { size: 18 })}<span>${esc(t(g.all.length ? 'agenda.empty.filtered' : 'agenda.empty.' + emptyKind))}</span>${g.all.length ? ` <button type="button" class="tp-link-btn" data-action="ag-reset">${esc(t('agenda.filter.reset'))}</button>` : ''}</div>` : '';
    const K = TP.kuloket;
    const foot = `<p class="ag-foot">${icon('calendar', { size: 13 })} ${esc(t('agenda.subscribeHint'))} <a href="${esc(K.icalAppUrl())}" target="_blank" rel="noopener">${esc(t('agenda.subscribeLink'))} ›<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span></a><span class="ag-keyhint"> · ${esc(t('agenda.keys.hint'))}</span></p>`;
    const side = `<aside class="ag-side" aria-label="${esc(t('agenda.side'))}">${miniMonth(r)}${panelHtml(g.all, 'ag-side')}</aside>`;

    const view = shell(ctx);
    const focus = captureFocus(ctx.root);
    const sc = view.querySelector('.ag-scroll');
    const prevKey = S.scroll.key;
    if (sc) S.scroll.top = sc.scrollTop;
    const lsc = view.querySelector('.ag-list');
    const pageY = typeof window !== 'undefined' ? window.scrollY : 0;
    view.className = `ag-view ag-m-${m}${S.prefs.workweek ? ' is-workweek' : ''}`;
    view.dataset.mode = m;
    view.innerHTML = `<div class="ag-main">${bar}${statusLine(g)}<div class="ag-calwrap"${!g.lessonsKnown && L.ok !== false ? ' aria-busy="true"' : ''}>${cal}${empty}</div><div class="ag-noresults" hidden></div>${foot}</div>${side}`;
    // keep the grid where the student scrolled it; jump to the first lesson only for a new range
    const key = `${m}|${r.from}|${r.days}`;
    const nsc = view.querySelector('.ag-scroll');
    S.scroll.key = key;
    if (nsc) {
      if (key !== prevKey || S.scroll.pending) autoScroll(nsc);
      else nsc.scrollTop = S.scroll.top;
    }
    if (lsc && typeof window !== 'undefined' && window.scrollY !== pageY) window.scrollTo(0, pageY);
    restoreFocus(ctx.root, focus);
    updateNow();
    if (S.q) applySearch();
    if (S.pop && S.popKind === 'ag-pop-filter') refreshFilterPop(g.all);
  }

  /** Scroll the time grid to its start hour; retried on the next paint/frame while the view isn't laid out yet. */
  function autoScroll(sc, tries = 0) {
    const hour = Number(sc.closest('.ag-timegrid').dataset.scroll || 8);
    const hh = (sc.querySelector('.ag-hour') || {}).offsetHeight || 0;
    sc.scrollTop = hour * hh;
    S.scroll.pending = !hh || (hour > 0 && sc.scrollTop === 0);
    if (S.scroll.pending && tries < 40 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { if (sc.isConnected && S.scroll.pending) autoScroll(sc, tries + 1); });
    }
  }

  function captureFocus(root) {
    const a = root.getRootNode && root.getRootNode().activeElement;
    if (!a || !root.contains(a) || (S.pop && S.pop.contains(a))) return null;
    if (a.name && a.value != null) return `[name="${CSS.escape(a.name)}"][value="${CSS.escape(a.value)}"]`;
    if (a.dataset && a.dataset.key) return `[data-key="${CSS.escape(a.dataset.key)}"]:not(.ag-dlmark)`;
    if (a.dataset && a.dataset.action) return `[data-action="${CSS.escape(a.dataset.action)}"]${a.dataset.day ? `[data-day="${a.dataset.day}"]` : ''}`;
    if (a.classList.contains('ag-scroll')) return '.ag-scroll';
    return null;
  }
  function restoreFocus(root, sel) {
    if (!sel) return;
    const el = root.querySelector(sel);
    if (el) el.focus({ preventScroll: true });
  }

  function updateNow() {
    const el = S.ctx && S.ctx.root.querySelector('.ag-now');
    if (!el) return;
    const now = Date.now();
    if (Number(el.parentElement.dataset.day) !== sod(now)) { schedulePaint(); return; } // midnight passed
    el.style.top = `calc(var(--hh) * ${hourOf(now).toFixed(4)})`;
    el.title = t('agenda.now', { time: ftime(now) });
  }

  // ------------------------------------------------------------------ load (+ prefetch neighbouring ranges)
  function load(force) {
    const K = TP.kuloket;
    if (!K) return;
    const m = mode();
    const r = rangeFor(m, S.anchor, S.prefs);
    const seq = ++S.seq;
    const job = force && K.refresh ? K.refresh({ from: r.from, to: r.to }) : Promise.all([K.lessons({ from: r.from, to: r.to }), K.exams()]);
    Promise.resolve(job)
      .then(() => {
        if (seq !== S.seq || !S.ctx) return;
        paint();
        // neighbours, so ‹ › feel instant (cache-first; already cached weeks cost nothing)
        const next = rangeFor(m, stepAnchor(m, S.anchor, 1), S.prefs); const prev = rangeFor(m, stepAnchor(m, S.anchor, -1), S.prefs);
        setTimeout(() => { if (seq === S.seq) K.lessons({ from: next.from, to: next.to }).then(() => (seq === S.seq ? K.lessons({ from: prev.from, to: prev.to }) : null)).catch(() => {}); }, 250);
      })
      .catch(() => {});
  }
  function go(announce = true) {
    closePop(false);
    S.mini = null;
    paint();
    load();
    if (announce) TP.shell.announce(S.ctx.root.querySelector('.ag-range')?.textContent.trim() || '');
  }
  function setMode(m) {
    if (!MODES.includes(m)) return;
    S.mode = m; S.prefs.mode = m; savePrefs();
    go();
  }
  function step(dir) { S.anchor = stepAnchor(mode(), S.anchor, dir); go(); }

  // ------------------------------------------------------------------ dialogs (event detail, filters, go to date, shortcuts)
  function openDialog({ cls, html, label, labelledby, opener, place }) {
    closePop(false);
    const layer = S.ctx && S.ctx.root.querySelector(':scope > .ag-layer');
    if (!layer) return null;
    const d = document.createElement('dialog');
    d.className = `ag-pop tp-glass ${cls || ''}`;
    if (labelledby) d.setAttribute('aria-labelledby', labelledby); else if (label) d.setAttribute('aria-label', label);
    d.innerHTML = html;
    layer.appendChild(d);
    S.pop = d; S.popKind = cls || '';
    const back = opener ? openerSel(opener) : null;
    S.popOpener = back;
    d.addEventListener('close', () => {
      if (S.pop === d) { S.pop = null; S.popKind = ''; }
      d.remove();
      const refocus = () => {
        const el = back && S.ctx && S.ctx.root.querySelector(back);
        if (el && el.getRootNode().activeElement !== el && !S.pop) el.focus({ preventScroll: true });
      };
      refocus();
      setTimeout(refocus, 0); // the browser's own dialog focus fix-up may land on a node a repaint replaced
    });
    try { d.showModal(); } catch (_) { d.setAttribute('open', ''); }
    position(d, opener, place);
    return d;
  }
  function openerSel(el) {
    if (el.dataset.key) return `[data-key="${CSS.escape(el.dataset.key)}"]:not(.ag-dlmark)`;
    if (el.dataset.action) return `[data-action="${CSS.escape(el.dataset.action)}"]${el.dataset.day ? `[data-day="${el.dataset.day}"]` : ''}`;
    return null;
  }
  function position(d, opener, place) {
    if (place === 'center') { d.classList.add('is-center'); return; }
    if (narrow() || !opener || !opener.isConnected) { d.classList.add('is-sheet'); return; }
    const r = opener.getBoundingClientRect();
    const w = d.offsetWidth || 320, h = d.offsetHeight || 240;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (place === 'below') {
      left = Math.min(vw - w - 12, Math.max(12, r.right - w));
      top = Math.min(vh - h - 12, r.bottom + 6);
    } else {
      left = r.right + 10;
      if (left + w > vw - 12) left = r.left - w - 10;
      if (left < 12) left = Math.max(12, Math.min(vw - w - 12, r.left));
      top = Math.max(12, Math.min(vh - h - 12, r.top));
    }
    d.style.left = `${Math.round(Math.max(12, left))}px`; d.style.top = `${Math.round(Math.max(12, top))}px`;
  }
  function closePop(restore = true) {
    const d = S.pop;
    if (!d) return false;
    if (!restore) { S.pop = null; S.popKind = ''; d.remove(); return true; }
    try { d.close(); } catch (_) { S.pop = null; d.remove(); }
    return true;
  }

  function detailRow(ic, label, valueHtml) {
    return valueHtml ? `<div class="ag-prow"><dt>${icon(ic, { size: 15 })}<span class="tp-sr">${esc(label)}</span></dt><dd>${valueHtml}</dd></div>` : '';
  }
  function openItem(key, opener) {
    const it = S.items.get(key);
    if (!it || !S.ctx) return;
    if (it.type === 'deadline' && TP.viewsA && typeof TP.viewsA.openDeadline === 'function' && TP.shell.detail) {
      closePop(false);
      TP.viewsA.openDeadline(it.data, opener, S.ctx.root);
      return;
    }
    const l = it.data;
    const loc = l.location || {};
    const nt = `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;
    const course = l.courseLuId && courseOf(l.courseLuId);
    const dur = Math.round((it.end - it.start) / MIN);
    const durTxt = it.type === 'deadline' ? '' : ` · ${dur >= 60 ? t('agenda.hours', { n: +(dur / 60).toFixed(dur % 60 ? 1 : 0) }) : t('agenda.minutes', { n: dur })}`;
    const when = it.type === 'deadline' ? `${longDay(it.start)} · ${ftime(it.start)}` : `${longDay(it.start)}<br>${esc(timeRange(it))}${esc(durTxt)}`;
    const place = [esc(it.room || ''), loc.street && (it.room || '') !== loc.street ? esc(loc.street) : '', loc.city ? esc(loc.city) : ''].filter(Boolean).join('<br>');
    const roomHtml = place + (loc.url ? `<br><a href="${esc(loc.url)}" target="_blank" rel="noopener">${esc(t('agenda.pop.map'))} ›${nt}</a>` : '');
    const kind = [kindLine(it), l.courseCode].filter(Boolean).join(' · ');
    const actions = [
      course ? TP.ui.button(t('agenda.pop.openCourse'), { kind: 'filled', icon: 'courses', action: 'ag-course', attrs: { href: TP.shell.href('course', { luId: l.courseLuId }) } }) : '',
      it.type !== 'deadline' ? TP.ui.button(t('agenda.pop.ics'), { kind: 'gray', icon: 'calendar', action: 'ag-ics-one', attrs: { 'data-key': it.key } }) : '',
      it.type === 'deadline' && l.url ? TP.ui.button(t('agenda.pop.openToledo'), { kind: 'gray', icon: 'external', attrs: { href: TP.util.abs(l.url), target: '_blank', rel: 'noopener' } }) : '',
      l.url && it.type !== 'deadline' ? TP.ui.button(t('agenda.pop.ects'), { kind: 'plain', icon: 'external', attrs: { href: l.url, target: '_blank', rel: 'noopener' } }) : '',
    ].filter(Boolean).join('');
    const src = l.source === 'ics' && l.detailsFrom === 'kuloket' ? 'icsKuloket' : (l.source || (it.type === 'deadline' ? '' : 'kuloket'));
    const html = `<div class="ag-pop-head"><span class="ag-pop-bar" aria-hidden="true"></span><div class="ag-pop-ht">
  <p class="ag-pop-kind${it.type === 'exam' ? ' is-exam' : ''}">${esc(kind)}</p>
  <h2 id="ag-pop-title">${esc(it.title)}</h2></div>
  ${TP.ui.button('', { icon: 'xmark', kind: 'gray', action: 'ag-close', cls: 'ag-pop-x', attrs: { 'aria-label': t('agenda.pop.close') } })}</div>
<dl class="ag-pop-dl">
  ${detailRow('clock', t('agenda.pop.time'), when)}
  ${it.type !== 'deadline' ? detailRow('location', t('agenda.pop.room'), roomHtml || `<span class="ag-muted">${esc(t('agenda.noRoom'))}</span>`) : ''}
  ${detailRow('person', t('agenda.pop.teachers'), (l.teachers || []).map(esc).join('<br>'))}
  ${detailRow('courses', t('agenda.pop.group'), esc(l.group || ''))}
  ${it.type === 'deadline' ? detailRow('courses', t('agenda.pop.course'), esc(l.courseName || '')) : ''}
  ${detailRow('info', t('agenda.pop.info'), esc(l.text || ''))}
</dl>
${actions ? `<div class="ag-pop-actions">${actions}</div>` : ''}
${src ? `<p class="ag-pop-src">${esc(t('agenda.pop.source.' + src))}${l.source === 'ics' && l.detailsFrom !== 'kuloket' ? ` · ${`<a href="${esc(TP.kuloket.loginUrl())}" target="_blank" rel="noopener">${esc(t('agenda.status.icsLogin'))}${nt}</a>`}` : ''}</p>` : ''}`;
    const d = openDialog({ cls: 'ag-pop-ev', html, labelledby: 'ag-pop-title', opener });
    if (!d) return;
    d.style.setProperty('--c', it.color);
    d.querySelector('[data-action="ag-close"]').focus();
  }

  function filterPopHtml(all) {
    return `<div class="ag-pop-head"><div class="ag-pop-ht"><h2 id="ag-filter-title">${esc(t('agenda.filter.label'))}</h2></div>
  ${TP.ui.button('', { icon: 'xmark', kind: 'gray', action: 'ag-close', cls: 'ag-pop-x', attrs: { 'aria-label': t('agenda.pop.close') } })}</div>${panelHtml(all, 'ag-pop')}`;
  }
  function openFilter(opener) {
    const r = rangeFor(mode(), S.anchor, S.prefs);
    const g = gather(r.from, r.to);
    const d = openDialog({ cls: 'ag-pop-filter', html: filterPopHtml(g.all), labelledby: 'ag-filter-title', opener, place: 'below' });
    d && (d.querySelector('input') || d.querySelector('button')).focus();
  }
  function refreshFilterPop(all) {
    const d = S.pop;
    if (!d) return;
    const a = d.getRootNode().activeElement;
    const sel = a && d.contains(a) ? (a.name ? `[name="${CSS.escape(a.name)}"][value="${CSS.escape(a.value)}"]` : a.dataset.action ? `[data-action="${CSS.escape(a.dataset.action)}"]` : null) : null;
    const panel = d.querySelector('.ag-panel');
    if (!panel) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = panelHtml(all, 'ag-pop');
    panel.replaceWith(tmp.firstElementChild);
    const el = sel && d.querySelector(sel);
    (el || d.querySelector('input')).focus({ preventScroll: true });
  }

  function openGoto(opener) {
    const v = dayKey(S.anchor);
    const html = `<form class="ag-goto" data-form="ag-goto">
  <div class="ag-pop-head"><div class="ag-pop-ht"><h2 id="ag-goto-title">${esc(t('agenda.goto'))}</h2></div>
  ${TP.ui.button('', { icon: 'xmark', kind: 'gray', action: 'ag-close', cls: 'ag-pop-x', attrs: { 'aria-label': t('agenda.pop.close') } })}</div>
  <label class="ag-goto-l" for="ag-goto-in">${esc(t('agenda.goto.date'))}</label>
  <div class="ag-goto-row"><input id="ag-goto-in" class="ag-goto-in" type="date" name="ag-goto-date" value="${esc(v)}" required>
  <button type="submit" class="tp-btn tp-btn-filled">${esc(t('agenda.goto.go'))}</button></div>
</form>`;
    const d = openDialog({ cls: 'ag-pop-goto', html, labelledby: 'ag-goto-title', opener: opener || S.ctx.root.querySelector('[data-action="ag-goto"]'), place: 'below' });
    d && d.querySelector('input').focus();
  }

  const KEYS = [
    ['T', 'agenda.keys.today'], ['D', 'agenda.keys.day'], ['W', 'agenda.keys.week'], ['M', 'agenda.keys.month'], ['A / L', 'agenda.keys.list'],
    ['J · N · →', 'agenda.keys.next'], ['K · P · ←', 'agenda.keys.prev'], ['G', 'agenda.keys.goto'],
    ['↑ ↓ ← →', 'agenda.keys.move'], ['↵', 'agenda.keys.open'], ['Esc', 'agenda.keys.close'], ['?', 'agenda.keys.help'],
  ];
  function openKeys(opener) {
    const mod = (TP.shell && TP.shell.mod) || 'Ctrl ';
    const rows = KEYS.concat([[`${mod}K · /`, 'agenda.keys.palette']]).map(([k, s]) => `<div class="ag-key"><dt>${k.split(' ').map((x) => (/^[·/]$/.test(x) ? `<span class="ag-key-sep">${esc(x)}</span>` : `<kbd>${esc(x)}</kbd>`)).join(' ')}</dt><dd>${esc(t(s))}</dd></div>`).join('');
    const html = `<div class="ag-pop-head"><div class="ag-pop-ht"><h2 id="ag-keys-title">${esc(t('agenda.keys.title'))}</h2></div>
  ${TP.ui.button('', { icon: 'xmark', kind: 'gray', action: 'ag-close', cls: 'ag-pop-x', attrs: { 'aria-label': t('agenda.pop.close') } })}</div>
<dl class="ag-keys">${rows}</dl><p class="ag-pop-src">${esc(t('agenda.keys.note'))}</p>`;
    const d = openDialog({ cls: 'ag-pop-keys', html, labelledby: 'ag-keys-title', opener: opener || S.ctx.root.querySelector('[data-action="ag-keys"]'), place: 'center' });
    d && d.querySelector('[data-action="ag-close"]').focus();
  }

  function download(text, name) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.hidden = true;
      (S.ctx ? S.ctx.root : document.body).appendChild(a);
      a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { console.warn('[Toledo+] ics download', e && e.message); return false; }
  }
  function exportOne(key) {
    const it = S.items.get(key);
    if (!it) return;
    const slug = norm(it.title).replace(/ /g, '-').slice(0, 40) || 'les';
    if (download(icsFor(it), `${slug}-${dayKey(it.start)}.ics`)) TP.shell.toast(t('agenda.pop.icsDone'));
  }
  function exportIcs() {
    let list = [];
    try { list = TP.data.deadlines({}) || []; } catch (_) { list = []; }
    let text;
    try { text = TP.data.ics(list); } catch (e) { console.warn('[Toledo+] ics', e); return; }
    if (download(text, 'toledo-deadlines.ics')) TP.shell.toast(t('agenda.exported'));
  }

  // ------------------------------------------------------------------ events
  function onClick(ev) {
    const ctx = S.ctx;
    if (!ctx) return;
    if (S.pop && ev.target === S.pop) { closePop(); return; } // backdrop
    const el = ev.target.closest('[data-action]');
    if (!el || !ctx.root.contains(el)) return;
    const a = el.getAttribute('data-action');
    const day = Number(el.getAttribute('data-day'));
    switch (a) {
      case 'ag-open': ev.preventDefault(); openItem(el.getAttribute('data-key'), el); return;
      case 'ag-close': ev.preventDefault(); closePop(); return;
      case 'ag-prev': step(-1); return;
      case 'ag-next': step(1); return;
      case 'ag-today': S.anchor = sod(Date.now()); go(); return;
      case 'ag-day': if (day) { S.anchor = day; S.mode = 'day'; S.prefs.mode = 'day'; savePrefs(); go(); } return;
      case 'ag-goto-day': if (day) { S.anchor = day; closePop(false); paint(); load(); TP.shell.announce(S.ctx.root.querySelector('.ag-range')?.textContent.trim() || ''); } return;
      case 'ag-jump': {
        if (!day) return;
        S.anchor = day;
        const sec = ctx.root.querySelector(`.ag-lday[data-day="${day}"] .ag-lhead`);
        ctx.root.querySelectorAll('.ag-strip-day').forEach((b) => b.classList.toggle('is-sel', Number(b.dataset.day) === day));
        if (sec) { sec.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); sec.focus({ preventScroll: true }); }
        return;
      }
      case 'ag-mini-prev': case 'ag-mini-next':
        S.mini = addMonths(S.mini != null ? S.mini : startOfMonth(S.anchor), a === 'ag-mini-next' ? 1 : -1);
        paint();
        return;
      case 'ag-filter': openFilter(el); return;
      case 'ag-keys': openKeys(el); return;
      case 'ag-goto': openGoto(el); return;
      case 'ag-ics-one': exportOne(el.getAttribute('data-key')); return;
      case 'ag-course': closePop(false); return; // plain link navigation
      case 'ag-retry': load(true); paint(); return;
      case 'ag-reset': S.prefs.show = { ...PREF_DEFAULTS.show }; S.prefs.hidden = []; savePrefs(); paint(); return;
      case 'ag-courses-all': S.prefs.hidden = []; savePrefs(); paint(); return;
      case 'ag-courses-none': {
        const r = rangeFor(mode(), S.anchor, S.prefs);
        S.prefs.hidden = courseEntries(gather(r.from, r.to).all).map((c) => c.key);
        savePrefs(); paint(); return;
      }
      default:
    }
  }
  function onChange(ev) {
    const el = ev.target;
    if (!el || !el.name) return;
    if (el.name === 'ag-mode' && MODES.includes(el.value)) { setMode(el.value); return; }
    if (el.name === 'ag-show') { S.prefs.show = { ...S.prefs.show, [el.value]: !!el.checked }; savePrefs(); paint(); return; }
    if (el.name === 'ag-course') {
      const h = new Set(S.prefs.hidden);
      if (el.checked) h.delete(el.value); else h.add(el.value);
      S.prefs.hidden = [...h]; savePrefs(); paint(); return;
    }
    if (el.name === 'ag-opt' && (el.value === 'workweek' || el.value === 'weekNums')) {
      S.prefs[el.value] = !!el.checked; savePrefs(); paint();
      if (el.value === 'workweek' && mode() === 'week') load();
    }
  }
  function onSubmit(ev) {
    const f = ev.target;
    if (!f || f.getAttribute('data-form') !== 'ag-goto') return;
    ev.preventDefault();
    const v = String((f.querySelector('input') || {}).value || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return;
    S.anchor = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    S.mini = null;
    closePop(false);
    go();
    S.ctx.root.querySelector('.ag-range-btn')?.focus({ preventScroll: true });
  }

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  /** Arrow keys between events: ↑/↓ within a day (list: previous/next row), ←/→ to the nearest event on the next day with one. */
  function moveFocus(from, key) {
    const root = S.ctx.root;
    const sel = '.ag-ev[data-key], .ag-chip[data-key], .ag-lrow[data-key]';
    const els = [...root.querySelectorAll(sel)].filter((e) => !e.hidden && e.offsetParent !== null);
    if (!els.length) return false;
    const day = Number(from.dataset.day); const start = Number(from.dataset.start);
    const m = mode();
    const byStart = (a, b) => Number(a.dataset.start) - Number(b.dataset.start);
    let target = null;
    if (m === 'list' || key === 'ArrowUp' || key === 'ArrowDown') {
      const dir = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
      if (m === 'month' && (key === 'ArrowUp' || key === 'ArrowDown')) return moveDay(els, day, start, dir * 7, dir);
      const pool = m === 'list' ? els : els.filter((e) => Number(e.dataset.day) === day).sort(byStart);
      const i = pool.indexOf(from);
      target = pool[i + dir] || null;
    } else {
      return moveDay(els, day, start, key === 'ArrowRight' ? 1 : -1, key === 'ArrowRight' ? 1 : -1);
    }
    if (target) { target.focus(); return true; }
    return true; // at an edge: keep focus, don't page
  }
  function moveDay(els, day, start, stepDays, dir) {
    const days = [...new Set(els.map((e) => Number(e.dataset.day)))].sort((a, b) => a - b);
    let want = addDays(day, stepDays);
    const cand = dir > 0 ? days.filter((d) => d >= want) : days.filter((d) => d <= want).reverse();
    if (Math.abs(stepDays) === 7) { const exact = days.includes(want) ? want : null; if (!exact) return true; want = exact; } else if (cand.length) want = cand[0]; else return true;
    const tod = (ms) => ms - sod(ms);
    const pool = els.filter((e) => Number(e.dataset.day) === want);
    pool.sort((a, b) => Math.abs(tod(Number(a.dataset.start)) - tod(start)) - Math.abs(tod(Number(b.dataset.start)) - tod(start)));
    if (pool[0]) pool[0].focus();
    return true;
  }

  /** Keyboard shortcuts. Called from the view's keydown listener and — via the shell hook `view.onKey` — for keys
   *  pressed anywhere in the app. Returns true when handled. */
  function onKey(ev) {
    if (!S.ctx || ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
    const tg = (ev.composedPath && ev.composedPath()[0]) || ev.target;
    if (S.pop && S.pop.open) return false; // dialogs handle their own keys (Esc closes)
    if (TP.shell.detail && TP.shell.detail.isOpen && TP.shell.detail.isOpen()) return false;
    if (TP.palette && TP.palette.isOpen && TP.palette.isOpen()) return false;
    if (isEditable(tg)) return false;
    const k = ev.key;
    const done = () => { ev.preventDefault(); return true; };
    if (/^Arrow/.test(k) && !ev.shiftKey) {
      const evEl = tg && tg.closest && tg.closest('.ag-ev[data-key], .ag-chip[data-key], .ag-lrow[data-key]');
      if (evEl && S.ctx.root.contains(evEl)) { moveFocus(evEl, k); return done(); }
      if (k === 'ArrowRight') { step(1); return done(); }
      if (k === 'ArrowLeft') { step(-1); return done(); }
      return false;
    }
    if (k === '?') { openKeys(); return done(); }
    if (ev.shiftKey || k.length !== 1) return false;
    switch (k.toLowerCase()) {
      case 't': S.anchor = sod(Date.now()); go(); return done();
      case 'd': setMode('day'); return done();
      case 'w': setMode('week'); return done();
      case 'm': setMode('month'); return done();
      case 'a': case 'l': setMode('list'); return done();
      case 'j': case 'n': step(1); return done();
      case 'k': case 'p': step(-1); return done();
      case 'g': openGoto(); return done();
      default: return false;
    }
  }

  // swipe left/right (touch / pen) on the calendar → next / previous period
  function onPointerDown(ev) {
    if (ev.pointerType === 'mouse' || !ev.isPrimary || !ev.target.closest('.ag-cal')) { S.swipe = null; return; }
    S.swipe = { x: ev.clientX, y: ev.clientY, t: Date.now() };
  }
  function onPointerUp(ev) {
    const s = S.swipe; S.swipe = null;
    if (!s || ev.pointerType === 'mouse') return;
    const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dy) < Math.abs(dx) * 0.6 && Date.now() - s.t < 800) step(dx < 0 ? 1 : -1);
  }

  // ------------------------------------------------------------------ search
  function applySearch() {
    const root = S.ctx && S.ctx.root;
    if (!root) return;
    const q = S.q;
    let n = 0;
    root.querySelectorAll('.ag-main [data-q]').forEach((el) => {
      const hit = !q || (el.getAttribute('data-q') || '').includes(q);
      if (hit && q) n++;
      if (el.classList.contains('tp-row')) el.hidden = !hit; else el.classList.toggle('ag-dim', !hit);
    });
    root.querySelectorAll('.ag-lday').forEach((s) => { s.hidden = !!q && !s.querySelector('.tp-row:not([hidden])'); });
    const nr = root.querySelector('.ag-noresults');
    if (nr) { nr.hidden = !q || n > 0; nr.innerHTML = q && !n ? TP.ui.noResults(q) : ''; }
  }

  // ------------------------------------------------------------------ register
  TP.agenda = { layout, rangeFor, stepAnchor, scrollHour, icsFor, courseKey, isoWeekNo, MODES, VISIBLE_HOURS };

  if (TP.kuloket && TP.kuloket.on) TP.kuloket.on('change', () => { if (S.ctx && S.ctx.root.isConnected) schedulePaint(); });

  if (!TP.shell || !TP.shell.register) return;
  TP.shell.register('agenda', {
    title: () => t('nav.agenda'),
    searchPlaceholder: () => t('agenda.search'),
    showUpdated: false,
    render(ctx) {
      const fresh = S.ctx !== ctx;
      S.ctx = ctx;
      if (!S.prefs || fresh) S.prefs = loadPrefs();
      if (fresh) S.mode = S.prefs.mode;
      if (S.anchor == null) S.anchor = sod(Date.now());
      if (!bound.has(ctx.root)) {
        bound.add(ctx.root);
        ctx.root.addEventListener('click', onClick);
        ctx.root.addEventListener('change', onChange);
        ctx.root.addEventListener('submit', onSubmit);
        ctx.root.addEventListener('keydown', (ev) => { onKey(ev); });
        ctx.root.addEventListener('pointerdown', onPointerDown);
        ctx.root.addEventListener('pointerup', onPointerUp);
        if (typeof ResizeObserver !== 'undefined') {
          S.lastNarrow = narrow();
          S.ro = new ResizeObserver(() => { const n = narrow(); if (n !== S.lastNarrow) { S.lastNarrow = n; if (!S.mode) paint(); } });
          S.ro.observe(ctx.root);
        }
      }
      try { ctx.setActions([{ id: 'ag-ics', label: t('agenda.export'), icon: 'calendar', onClick: exportIcs }]); } catch (_) { /* ignore */ }
      if (!S.timer) S.timer = setInterval(updateNow, 60e3);
      paint();
      if (fresh) load();
    },
    onSearch(ctx, q) { S.q = (q || '').trim().toLowerCase(); applySearch(); },
    /** Shell hook (optional): global shortcuts while focus is outside the view. */
    onKey(ctx, ev) { return S.ctx === ctx ? onKey(ev) : false; },
    destroy() {
      closePop(false);
      clearInterval(S.timer); S.timer = null;
      if (S.ro) { S.ro.disconnect(); S.ro = null; }
      S.ctx = null; S.q = ''; S.seq++; S.scroll.key = '';
    },
  });
})();
