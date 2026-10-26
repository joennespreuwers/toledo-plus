/* Toledo+ — Courses view (views-B).
   Grid of course cards with filter (current / semester / year / communities / archive), sort,
   and an edit mode for nickname, colour, pin (= Toledo favourite), hide and manual order. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  if (!TP.shell || !TP.shell.register) return;

  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const SEP = '__';               // control names: '<kind>__<luId>'
  const FILTERS = ['current', 'sem1', 'sem2', 'year', 'communities', 'archive'];

  const ui = { filter: 'current', edit: false, q: '', hiddenOpen: false };
  let cur = null;                 // latest ctx

  // ---------- helpers ----------
  // Settings apply in memory immediately; don't wait for the (debounced) storage write to repaint.
  const save = (p) => { Promise.resolve(p).catch(() => {}); };
  const cssEsc = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

  function snapFocus(root) {
    const a = root.getRootNode().activeElement;
    if (!a || !root.contains(a)) return null;
    if (a.dataset && a.dataset.fk) return { fk: a.dataset.fk };
    if (a.name) return { name: a.name, value: a.type === 'radio' ? a.value : null };
    return null;
  }
  function restoreFocus(root, f) {
    if (!f) return;
    let el = null;
    if (f.fk) el = root.querySelector(`[data-fk="${cssEsc(f.fk)}"]`);
    else if (f.name) el = root.querySelector(`[name="${cssEsc(f.name)}"]${f.value != null ? `[value="${cssEsc(f.value)}"]` : ''}`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
    else if (f.fk && /^(up|down):/.test(f.fk)) {
      // A moved card hit the top/bottom: keep focus on its other move button.
      const other = f.fk.replace(/^(up|down)/, (m) => (m === 'up' ? 'down' : 'up'));
      root.querySelector(`[data-fk="${cssEsc(other)}"]`)?.focus({ preventScroll: true });
    }
  }

  function allCourses() {
    return TP.data.courses({ includeHidden: true, includeCommunities: true, currentOnly: false }) || [];
  }
  function maxYear(list) {
    return list.filter((c) => c.type === 'course').reduce((m, c) => Math.max(m, Number(c.year) || 0), 0);
  }
  function inFilter(c, f, max, showCommunities) {
    const isCourse = c.type === 'course';
    const current = isCourse && (Number(c.year) || 0) === max;
    switch (f) {
      case 'current': return current || (showCommunities && c.type === 'community');
      case 'sem1': return current && c.semester === 'SEMESTER1';
      case 'sem2': return current && c.semester === 'SEMESTER2';
      case 'year': return current && c.semester === 'YEAR';
      case 'communities': return c.type === 'community';
      case 'archive': return isCourse && (Number(c.year) || 0) < max;
      default: return true;
    }
  }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), TP.i18n.locale(), { sensitivity: 'base', numeric: true });

  function manualOrder(list, order) {
    const pos = new Map((order || []).map((id, i) => [id, i]));
    return list.slice().sort((a, b) => {
      const pa = pos.has(a.luId) ? pos.get(a.luId) : Infinity;
      const pb = pos.has(b.luId) ? pos.get(b.luId) : Infinity;
      return pa !== pb ? pa - pb : byName(a, b);
    });
  }
  function sortList(list, s) {
    const mode = s.courses?.sort || 'activity';
    if (mode === 'manual') return manualOrder(list, s.courses?.order);
    const base = mode === 'name' ? byName : (a, b) => (b.latest || 0) - (a.latest || 0) || byName(a, b);
    return list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || base(a, b));
  }
  function yearLabel(y) {
    y = Number(y) || 0;
    if (!y) return '';
    const s = String(y).padStart(4, '0');
    return t('courses.year', { y: `20${s.slice(0, 2)}–${s.slice(2)}` });
  }
  function metaLine(c, max) {
    const parts = [];
    if (c.code) parts.push(c.code);
    if (c.type === 'community') parts.push(t('courses.community'));
    else {
      const sem = c.semester && c.semester !== 'UNKNOWN' ? t('courses.sem.' + c.semester) : '';
      if (sem) parts.push(sem);
      if ((Number(c.year) || 0) < max) parts.push(yearLabel(c.year));
    }
    return parts.filter(Boolean).join(' · ');
  }

  // ---------- render ----------
  function cardHtml(c, i, n, s, max) {
    const name = c.name || TP.util.courseName(c.title);
    const meta = metaLine(c, max);
    const q = [name, c.title, c.code].join(' ').toLowerCase();
    const flags = [
      c.pinned ? `<span class="cs-flag" title="${esc(t('courses.pinned'))}">${TP.ui.icon('pinFill', { size: 14 })}<span class="cs-sr">${esc(t('courses.pinned'))}</span></span>` : '',
    ].join('');
    const badge = c.unread ? TP.ui.badge(c.unread, { tone: 'tint', label: t('courses.unread', { n: c.unread }) }) : '';
    const unavailable = c.available === false;
    const head = `
      <span class="cs-swatch" style="background:${esc(c.color || 'var(--fill)')}" aria-hidden="true"></span>
      <span class="cs-text">
        <span class="cs-name" title="${esc(c.title || name)}">${esc(name)}</span>
        <span class="cs-meta">${esc(meta)}${unavailable ? `<span class="cs-unavail">${esc(t('courses.unavailable'))}</span>` : ''}</span>
      </span>
      <span class="cs-trail">${flags}${badge}</span>`;

    if (!ui.edit) {
      if (unavailable) return `<li class="cs-card is-unavailable" data-q="${esc(q)}"><div class="cs-card-main" aria-disabled="true">${head}</div></li>`;
      return `<li class="cs-card" data-q="${esc(q)}"><a class="cs-card-main" href="${esc(TP.shell.href('course', { luId: c.luId }))}" data-fk="open:${esc(c.luId)}">${head}</a></li>`;
    }

    const cs = TP.settings.course(c.luId);
    const P = TP.util.PALETTE;
    const sw = Object.keys(P).map((k) => ({ value: k, color: P[k], label: t('courses.colors.' + k) }));
    const manual = (s.courses?.sort || 'activity') === 'manual';
    const move = manual ? `
      <span class="cs-move">
        <button type="button" class="cs-icon-btn" data-action="move-up" data-lu="${esc(c.luId)}" data-fk="up:${esc(c.luId)}" aria-label="${esc(t('courses.moveUp', { name }))}" ${i === 0 ? 'disabled' : ''}>${TP.ui.icon('arrowUp', { size: 15 })}</button>
        <button type="button" class="cs-icon-btn" data-action="move-down" data-lu="${esc(c.luId)}" data-fk="down:${esc(c.luId)}" aria-label="${esc(t('courses.moveDown', { name }))}" ${i === n - 1 ? 'disabled' : ''}>${TP.ui.icon('arrowDown', { size: 15 })}</button>
      </span>` : '';
    const nid = `cs-nick-${TP.util.uid()}`;
    return `
      <li class="cs-card is-editing" data-q="${esc(q)}">
        <div class="cs-card-main">${head}${move}</div>
        <div class="cs-edit">
          <div class="cs-field">
            <label for="${nid}">${esc(t('courses.nickname'))}</label>
            <input id="${nid}" type="text" class="cs-input" name="nick${SEP}${esc(c.luId)}" value="${esc(cs.nickname || '')}"
              placeholder="${esc(TP.util.courseName(c.title) || t('courses.nicknamePh'))}" autocomplete="off" spellcheck="false" maxlength="60">
          </div>
          <div class="cs-field">
            <span class="cs-field-label" id="cs-col-${esc(c.luId)}">${esc(t('courses.color'))}</span>
            <div class="cs-swatches" role="group" aria-labelledby="cs-col-${esc(c.luId)}">
              ${TP.ui.swatches(`color${SEP}${c.luId}`, sw, cs.color || c.colorKey || '')}
              ${cs.color ? `<button type="button" class="cs-link-btn" data-action="color-reset" data-lu="${esc(c.luId)}" data-fk="cr:${esc(c.luId)}">${esc(t('courses.colorReset'))}</button>` : ''}
            </div>
          </div>
          <div class="cs-toggles">
            ${TP.ui.toggle(`pin${SEP}${c.luId}`, !!c.pinned, t('courses.pin'))}
            ${TP.ui.toggle(`hide${SEP}${c.luId}`, !!cs.hidden, t('courses.hide'))}
          </div>
        </div>
      </li>`;
  }

  function hiddenHtml(list) {
    if (!list.length) return '';
    const rows = list.map((c) => {
      const name = c.name || TP.util.courseName(c.title);
      return `<li class="cs-hidden-row" data-q="${esc([name, c.title, c.code].join(' ').toLowerCase())}">
        <span class="cs-swatch cs-swatch-sm" style="background:${esc(c.color || 'var(--fill)')}" aria-hidden="true"></span>
        <span class="cs-hidden-name" title="${esc(c.title || name)}">${esc(name)}</span>
        <button type="button" class="cs-link-btn" data-action="unhide" data-lu="${esc(c.luId)}" data-fk="unhide:${esc(c.luId)}" aria-label="${esc(t('courses.unhideName', { name }))}">${esc(t('courses.unhide'))}</button>
      </li>`;
    }).join('');
    return `
      <details class="cs-hidden" data-hidden-group ${ui.hiddenOpen ? 'open' : ''}>
        <summary class="cs-hidden-sum" data-fk="hidden-sum"><span>${esc(t('courses.hidden', { n: list.length }))}</span>${TP.ui.icon('chevronRight', { size: 14 })}</summary>
        <ul class="cs-hidden-list">${rows}</ul>
      </details>`;
  }

  function render(ctx) {
    cur = ctx;
    const root = ctx.root;
    bind(root);
    ctx.setActions([{ id: 'edit', label: t(ui.edit ? 'courses.done' : 'courses.edit'), icon: ui.edit ? 'check' : undefined, onClick: toggleEdit }]);

    const focus = snapFocus(root);
    const s = TP.settings.get();
    const loaded = TP.data.peek && TP.data.peek('enrollments') != null;
    const all = allCourses();
    const max = maxYear(all);
    const showComm = !!s.courses?.showCommunities;
    const inView = all.filter((c) => inFilter(c, ui.filter, max, showComm));
    const visible = sortList(inView.filter((c) => !c.hidden), s);
    const hidden = inView.filter((c) => c.hidden).sort(byName);

    const segs = FILTERS.map((f) => ({ value: f, label: t('courses.filter.' + f) }));
    const sortOpts = ['activity', 'name', 'manual'].map((v) => ({ value: v, label: t('courses.sort.' + v) }));

    let body;
    if (!loaded && !all.length) body = TP.ui.skeleton(4);
    else if (!visible.length && !hidden.length) {
      body = TP.ui.empty(t(ui.filter === 'archive' ? 'courses.emptyArchive' : ui.filter === 'communities' ? 'courses.emptyCommunities' : 'courses.empty'));
    } else {
      body = (visible.length ? `<ul class="cs-grid${ui.edit ? ' is-editing' : ''}" role="list">${visible.map((c, i) => cardHtml(c, i, visible.length, s, max)).join('')}</ul>` : '')
        + hiddenHtml(hidden);
    }

    root.innerHTML = `
      <div class="cs-view">
        <div class="cs-bar">
          <div class="cs-filter">${TP.ui.segmented('cs-filter', segs, ui.filter, { label: t('courses.filter') })}</div>
          <div class="cs-sort">${TP.ui.select('cs-sort', sortOpts, s.courses?.sort || 'activity', { label: t('courses.sort') })}</div>
        </div>
        ${ui.edit ? `<p class="cs-hint">${esc(t('courses.editHint'))}${(s.courses?.sort === 'manual') ? ' ' + esc(t('courses.manualHint')) : ''}</p>` : ''}
        <div class="cs-body">${body}</div>
        <div class="cs-noresults" hidden></div>
      </div>`;
    restoreFocus(root, focus);
    if (ui.q) applySearch(root, ui.q);
  }

  const live = () => !!(cur && cur.root.querySelector(':scope > .cs-view'));

  function toggleEdit() {
    ui.edit = !ui.edit;
    if (live()) render(cur);
    TP.shell.announce?.(t(ui.edit ? 'courses.edit' : 'courses.done'));
  }

  function applySearch(root, q) {
    ui.q = q || '';
    let shown = 0;
    root.querySelectorAll('.cs-card[data-q], .cs-hidden-row[data-q]').forEach((el) => {
      const hit = !ui.q || el.dataset.q.includes(ui.q);
      el.hidden = !hit;
      if (hit) shown++;
    });
    const hg = root.querySelector('[data-hidden-group]');
    if (hg) {
      const any = hg.querySelector('.cs-hidden-row:not([hidden])');
      hg.hidden = !!ui.q && !any;
      if (ui.q && any) hg.open = true;
    }
    const nr = root.querySelector('.cs-noresults');
    if (nr) {
      const none = !!ui.q && shown === 0 && root.querySelector('.cs-card, .cs-hidden-row');
      nr.hidden = !none;
      nr.innerHTML = none ? TP.ui.noResults(ui.q) : '';
    }
  }

  // ---------- interactions ----------
  async function move(luId, dir) {
    const s = TP.settings.get();
    const all = allCourses();
    const max = maxYear(all);
    const global = manualOrder(all, s.courses?.order).map((c) => c.luId);
    const visible = sortList(all.filter((c) => inFilter(c, ui.filter, max, !!s.courses?.showCommunities) && !c.hidden), s).map((c) => c.luId);
    const i = visible.indexOf(luId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const other = visible[j];
    const a = global.indexOf(luId), b = global.indexOf(other);
    global[a] = other; global[b] = luId;
    save(TP.settings.set({ courses: { order: global } }));
    if (live()) render(cur);
  }

  function pin(luId, on) {
    Promise.resolve(TP.data.setPinned(luId, on)).then((ok) => { if (ok === false) TP.shell.toast?.(t('common.pinFailed')); }, () => {});
  }

  function bind(root) {
    if (root.__tpCoursesBound) return;
    root.__tpCoursesBound = true;

    root.addEventListener('click', async (ev) => {
      if (!ev.target.closest('.cs-view')) return;
      const b = ev.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      const lu = b.dataset.lu;
      switch (b.dataset.action) {
        case 'move-up': return move(lu, -1);
        case 'move-down': return move(lu, 1);
        case 'color-reset': save(TP.settings.setCourse(lu, { color: null })); break;
        case 'unhide': save(TP.settings.setCourse(lu, { hidden: false })); break;
        default: return;
      }
      if (live()) render(cur);
    });

    root.addEventListener('change', async (ev) => {
      const el = ev.target;
      if (!el.closest('.cs-view') || !el.name) return;
      if (el.name === 'cs-filter') { ui.filter = el.value; if (cur) render(cur); return; }
      if (el.name === 'cs-sort') { save(TP.settings.set({ courses: { sort: el.value } })); if (live()) render(cur); return; }
      const k = el.name.indexOf(SEP);
      if (k < 0) return;
      const kind = el.name.slice(0, k), lu = el.name.slice(k + SEP.length);
      if (kind === 'nick') save(TP.settings.setCourse(lu, { nickname: el.value.trim() }));
      else if (kind === 'color') save(TP.settings.setCourse(lu, { color: el.value }));
      else if (kind === 'pin') pin(lu, el.checked);
      else if (kind === 'hide') save(TP.settings.setCourse(lu, { hidden: el.checked }));
      else return;
      // A nickname commits on blur: repaint after focus has moved on, so it lands on the next control.
      if (kind === 'nick') setTimeout(() => { if (live()) render(cur); }, 0);
      else if (live()) render(cur);
    });

    root.addEventListener('keydown', (ev) => {
      // Enter in a nickname field commits it (change fires on blur otherwise).
      if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.cs-view input.cs-input')) {
        ev.preventDefault();
        ev.target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // <details> toggle doesn't bubble: capture it to remember the hidden-group state.
    root.addEventListener('toggle', (ev) => {
      if (ev.target.matches && ev.target.matches('[data-hidden-group]') && !ui.q) ui.hiddenOpen = ev.target.open;
    }, true);
  }

  TP.shell.register('courses', {
    title: () => t('courses.title'),
    searchPlaceholder: () => t('courses.search'),
    render,
    onSearch(ctx, q) { cur = ctx; applySearch(ctx.root, q); },
    destroy() { ui.q = ''; ui.edit = false; },
  });
})();
