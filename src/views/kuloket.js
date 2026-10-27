/* Toledo+ — KU Loket hub (route 'kuloket'): next exams, today's lessons, and the KU Loket apps grouped
   with a plain-language line each (opening in a new tab). Toledo+ only reads KU Loket data. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);

  const S = { ctx: null, q: '', seq: 0, loading: false };
  const sod = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const nt = () => `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;

  // B1 for KU Loket (TP-137): "no exams" / "no classes" only after KU Loket answered. Unreachable → an error with
  // "Opnieuw" (and the saved data, if any, under a "saved" note); not loaded yet → a loading placeholder.
  const failed = (s) => !!(s && s.ok === false && s.error !== 'auth' && s.error !== 'ics');
  const retryNote = (text) => `<div class="kl-note kl-error" role="alert">${icon('warning', { size: 15 })}<p>${esc(text)} <button type="button" class="tp-link-btn" data-action="kl-retry">${esc(t('common.retry'))}</button></p></div>`;
  const savedNote = (when) => `<p class="kl-saved">${icon('warning', { size: 13 })}<span>${esc(t('kuloket.saved', { time: when ? TP.fmt.ago(when) : '' }))}</span> <button type="button" class="tp-link-btn" data-action="kl-retry">${esc(t('common.retry'))}</button></p>`;

  function examsSection(st) {
    const now = Date.now();
    const peek = TP.kuloket.peekExams();
    const next = (peek || []).filter((e) => e.end >= now).slice(0, 6);
    const E = st.exams || {};
    let body;
    if (next.length) {
      body = TP.ui.group(next.map((e) => TP.viewsA.examRow(e)).join('')) // same row as Deadlines › Examens
        + (failed(E) ? savedNote(E.t) : '');
    } else if (E.ok === false && E.error === 'auth') {
      body = TP.ui.group(`<div class="kl-note">${icon('info', { size: 15 })}<p>${esc(t('kuloket.exams.login'))} <a href="${esc(TP.kuloket.appUrl('zr_0363'))}" target="_blank" rel="noopener">${esc(t('agenda.status.loginLink'))} ›${nt()}</a></p></div>`);
    } else if (failed(E)) {
      body = TP.ui.group(retryNote(t('kuloket.exams.error')));
    } else if (peek == null || (E.ok == null && !peek.length && S.loading)) {
      body = TP.ui.skeleton(2, { lead: 'date' });
    } else {
      body = TP.ui.group(`<div class="kl-note">${icon('deadlines', { size: 15 })}<p>${esc(t('kuloket.exams.none'))}</p></div>`);
    }
    return TP.ui.section({ id: 'kl-exams', title: esc(t('kuloket.exams.title')), body });
  }

  function todaySection(st) {
    const from = sod(Date.now());
    const peek = TP.kuloket.peekLessons({ from, to: TP.fmt.addDays(from, 1) }); // calendar day (DST: 23/25 h)
    const lessons = (peek || []).filter((l) => l.end > from);
    const L = st.lessons || {};
    let body;
    if (lessons.length) {
      body = TP.ui.group(lessons.map((l) => TP.viewsA.lessonRow(l)).join('')) // same row as Overzicht › Rooster
        + (failed(L) ? savedNote(L.t) : '');
    } else if (L.ok === false && (L.error === 'auth' || L.error === 'ics')) {
      body = TP.ui.group(`<div class="kl-note">${icon('info', { size: 15 })}<p>${esc(t('agenda.status.login'))} <a href="${esc(TP.kuloket.loginUrl())}" target="_blank" rel="noopener">${esc(t('agenda.status.loginLink'))} ›${nt()}</a> <a href="${esc(TP.shell.href('settings'))}">${esc(t('agenda.status.orIcs'))}</a></p></div>`);
    } else if (failed(L)) {
      body = TP.ui.group(retryNote(t('kuloket.today.error')));
    } else if (peek == null || (L.ok == null && S.loading)) {
      body = TP.ui.skeleton(2, { lead: 'none' });
    } else {
      body = TP.ui.group(`<div class="kl-note">${icon('calendar', { size: 15 })}<p>${esc(t('kuloket.today.none'))}</p></div>`);
    }
    return TP.ui.section({ id: 'kl-today', title: esc(t('kuloket.today.title')), body,
      actions: [{ label: t('kuloket.today.open') + ' ›', action: 'kl-agenda', attrs: { href: TP.shell.href('agenda') } }] });
  }

  function appsSections() {
    const links = TP.kuloket.links();
    return TP.kuloket.GROUPS.map((g) => {
      const rows = links.filter((l) => l.group === g).map((l) => TP.ui.row({
        href: l.url,
        attrs: { target: '_blank', rel: 'noopener', 'data-app': l.id },
        leading: `<span class="kl-tile kl-g-${esc(g)}">${icon(l.icon, { size: 17 })}</span>`,
        title: esc(l.title) + nt(),
        subtitle: esc(l.desc),
        trailing: icon('external', { size: 13 }),
        q: `${l.title} ${l.desc}`,
        cls: 'kl-app',
      })).join('');
      return TP.ui.section({ id: 'kl-' + g, title: esc(t('kuloket.group.' + g)), body: TP.ui.group(rows) });
    }).join('');
  }

  function paint() {
    const ctx = S.ctx;
    if (!ctx || !ctx.root.isConnected) return;
    const st = TP.kuloket.status();
    const main = examsSection(st) + todaySection(st);
    ctx.root.innerHTML = `<div class="kl-view tp-narrow">${TP.viewsA.zoneNote ? TP.viewsA.zoneNote() : ''}${main}${appsSections()}<div class="kl-noresults" hidden></div></div>`;
    if (S.q) applySearch();
  }

  function load(ctx, force) {
    const seq = ++S.seq;
    const from = sod(Date.now());
    const r = { from, to: TP.fmt.addDays(from, 1) };
    S.loading = true;
    const job = force && TP.kuloket.refresh ? TP.kuloket.refresh(r) : Promise.all([TP.kuloket.exams(), TP.kuloket.lessons(r)]);
    Promise.resolve(job).catch(() => {}).then(() => {
      if (seq !== S.seq) return;
      S.loading = false;
      if (S.ctx === ctx) paint();
    });
  }

  function onClick(ev) {
    const ctx = S.ctx;
    const el = ev.target.closest && ev.target.closest('[data-action]');
    if (!ctx || !el || !ctx.root.contains(el)) return;
    const a = el.getAttribute('data-action');
    if (a === 'kl-retry') {
      ev.preventDefault();
      el.setAttribute('aria-busy', 'true');
      load(ctx, true);
    } else if (a === 'va-exam-open') {
      ev.preventDefault();
      TP.viewsA.openExam(TP.viewsA.exams.get(el.getAttribute('data-xid')), el, ctx.root);
    }
  }
  const bound = new WeakSet();

  function applySearch() {
    const root = S.ctx && S.ctx.root;
    if (!root) return;
    const els = [...root.querySelectorAll('[data-q]')];
    const m = TP.index.matcher(S.q, els.map((el) => el.getAttribute('data-q') || ''));
    const q = m.empty ? '' : S.q;
    let n = 0;
    els.forEach((el) => { const hit = !q || m(el.getAttribute('data-q') || ''); el.hidden = !hit; if (hit && q) n++; });
    root.querySelectorAll('section.tp-section').forEach((s) => { s.hidden = !!q && !s.querySelector('[data-q]:not([hidden])'); });
    TP.index.highlight(root, q ? m : '', '[data-q] .tp-row-title');
    const nr = root.querySelector('.kl-noresults');
    if (nr) { nr.hidden = !q || n > 0; nr.innerHTML = q && !n ? TP.ui.noResults(q) : ''; }
  }

  if (TP.kuloket && TP.kuloket.on) TP.kuloket.on('change', () => { if (S.ctx && S.ctx.root.isConnected) paint(); });

  TP.shell.register('kuloket', {
    title: () => t('nav.kuloket'),
    searchPlaceholder: () => t('kuloket.search'),
    showUpdated: false,
    render(ctx) {
      S.ctx = ctx;
      try { ctx.setSubtitle(esc(t('kuloket.subtitle'))); } catch (_) { /* ignore */ }
      try { ctx.setActions([{ id: 'kl-open', label: t('kuloket.open'), icon: 'external', onClick: () => window.open(TP.kuloket.appUrl('zr_1027'), '_blank', 'noopener') }]); } catch (_) { /* ignore */ }
      if (!bound.has(ctx.root)) { bound.add(ctx.root); ctx.root.addEventListener('click', onClick); }
      S.loading = true;
      paint();
      load(ctx, false);
    },
    onSearch(ctx, q) { S.q = (q || '').trim(); applySearch(); },
    destroy() { S.ctx = null; S.q = ''; S.seq++; },
  });
})();
