/* Toledo+ — KU Loket hub (route 'kuloket'): next exams, today's lessons, and the KU Loket apps grouped
   with a plain-language line each (opening in a new tab). Toledo+ only reads KU Loket data. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s == null ? '' : String(s));
  const icon = (n, o) => TP.ui.icon(n, o);
  const DAY = 864e5;

  const S = { ctx: null, q: '', seq: 0 };
  const sod = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const nt = () => `<span class="tp-sr"> ${esc(t('agenda.newTab'))}</span>`;

  function examsSection(st) {
    const now = Date.now();
    const all = (TP.kuloket.peekExams() || []);
    const next = all.filter((e) => e.end >= now).slice(0, 6);
    let body;
    if (next.length) {
      body = TP.ui.group(next.map((e) => TP.viewsA.examRow(e)).join('')); // same row as Deadlines › Examens
    } else if (st.exams && st.exams.ok === false && st.exams.error === 'auth') {
      body = TP.ui.group(`<div class="kl-note">${icon('info', { size: 15 })}<p>${esc(t('kuloket.exams.login'))} <a href="${esc(TP.kuloket.appUrl('zr_0363'))}" target="_blank" rel="noopener">${esc(t('agenda.status.loginLink'))} ›${nt()}</a></p></div>`);
    } else {
      body = TP.ui.group(`<div class="kl-note">${icon('deadlines', { size: 15 })}<p>${esc(t('kuloket.exams.none'))}</p></div>`);
    }
    return TP.ui.section({ id: 'kl-exams', title: esc(t('kuloket.exams.title')), body });
  }

  function todaySection(st) {
    const from = sod(Date.now());
    const lessons = (TP.kuloket.peekLessons({ from, to: from + DAY }) || []).filter((l) => l.end > from);
    let body;
    if (lessons.length) {
      body = TP.ui.group(lessons.map((l) => TP.viewsA.lessonRow(l)).join('')); // same row as Overzicht › Rooster
    } else if (st.lessons && st.lessons.ok === false && (st.lessons.error === 'auth' || st.lessons.error === 'ics')) {
      body = TP.ui.group(`<div class="kl-note">${icon('info', { size: 15 })}<p>${esc(t('agenda.status.login'))} <a href="${esc(TP.kuloket.loginUrl())}" target="_blank" rel="noopener">${esc(t('agenda.status.loginLink'))} ›${nt()}</a> <a href="${esc(TP.shell.href('settings'))}">${esc(t('agenda.status.orIcs'))}</a></p></div>`);
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
    ctx.root.innerHTML = `<div class="kl-view tp-narrow">${main}${appsSections()}<div class="kl-noresults" hidden></div></div>`;
    if (S.q) applySearch();
  }

  function applySearch() {
    const root = S.ctx && S.ctx.root;
    if (!root) return;
    const q = S.q;
    let n = 0;
    root.querySelectorAll('[data-q]').forEach((el) => { const hit = !q || (el.getAttribute('data-q') || '').includes(q); el.hidden = !hit; if (hit && q) n++; });
    root.querySelectorAll('section.tp-section').forEach((s) => { s.hidden = !!q && !s.querySelector('[data-q]:not([hidden])'); });
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
      paint();
      const seq = ++S.seq;
      const from = sod(Date.now());
      Promise.all([TP.kuloket.exams(), TP.kuloket.lessons({ from, to: from + DAY })])
        .then(() => { if (seq === S.seq && S.ctx === ctx) paint(); }).catch(() => {});
    },
    onSearch(ctx, q) { S.q = (q || '').trim().toLowerCase(); applySearch(); },
    destroy() { S.ctx = null; S.q = ''; S.seq++; },
  });
})();
