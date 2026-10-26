/* Toledo+ — Courses view.
   Grid of course cards with a 3-way scope (Huidig · Communities · Archief) + a semester menu, sort, and an
   edit mode (the one place for per-course settings, N5): a compact list with nickname, colour (popover of
   swatches), hide and manual order (drag handle + ↑/↓ for keyboard). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  if (!TP.shell || !TP.shell.register) return;

  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const SEP = '__';               // control names: '<kind>__<luId>'
  const SCOPES = ['current', 'communities', 'archive'];
  const SEMS = ['all', 'SEMESTER1', 'SEMESTER2', 'YEAR'];

  const ui = { scope: 'current', sem: 'all', edit: false, q: '', hiddenOpen: false, drag: null, ctxSeen: null };
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
      // A moved row hit the top/bottom: keep focus on its other move button.
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
  function inFilter(c, max) {
    const isCourse = c.type === 'course';
    const year = Number(c.year) || 0;
    let ok;
    if (ui.scope === 'communities') ok = c.type === 'community';
    else if (ui.scope === 'archive') ok = isCourse && year < max;
    else ok = isCourse && year === max;
    if (ok && ui.scope !== 'communities' && ui.sem !== 'all') ok = c.semester === ui.sem;
    return ok;
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
    return list.slice().sort(base);
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
  const colorOptions = () => {
    const P = TP.util.PALETTE;
    return Object.keys(P).map((k) => ({ value: k, color: P[k], label: t('courses.colors.' + k) }));
  };

  // ---------- render ----------
  function cardHtml(c, max) {
    const name = c.name || TP.util.courseName(c.title);
    const meta = metaLine(c, max);
    const q = [name, c.title, c.code].join(' ').toLowerCase();
    const badge = c.unread ? TP.ui.badge(c.unread, { tone: 'tint', label: t('courses.unread', { n: c.unread }) }) : '';
    const unavailable = c.available === false;
    const head = `
      <span class="cs-swatch" style="background:${esc(c.color || 'var(--fill)')}" aria-hidden="true"></span>
      <span class="cs-text">
        <span class="cs-name" title="${esc(c.title || name)}">${esc(name)}</span>
        <span class="cs-meta">${esc(meta)}</span>
        ${unavailable ? `<span class="cs-unavail">${esc(t('courses.unavailable'))}</span>` : ''}
      </span>
      <span class="cs-trail">${badge}</span>`;
    if (unavailable) return `<li class="cs-card is-unavailable" data-q="${esc(q)}"><div class="cs-card-main" aria-disabled="true">${head}</div></li>`;
    return `<li class="cs-card" data-q="${esc(q)}"><a class="cs-card-main" href="${esc(TP.shell.href('course', { luId: c.luId }))}" data-fk="open:${esc(c.luId)}">${head}</a></li>`;
  }

  // Edit mode: one compact row per course.
  function editRowHtml(c, i, n) {
    const cs = TP.settings.course(c.luId);
    const name = c.name || TP.util.courseName(c.title);
    const orig = TP.util.courseName(c.title) || name;
    const q = [name, c.title, c.code].join(' ').toLowerCase();
    const key = cs.color || c.colorKey || '';
    const colorName = key ? t('courses.colors.' + key) : '';
    const nid = `cs-nick-${TP.util.uid()}`;
    const lu = esc(c.luId);
    return `
      <li class="cs-erow${cs.hidden ? ' is-hidden' : ''}" data-q="${esc(q)}" data-lu="${lu}">
        <span class="cs-grip" data-grip aria-hidden="true" title="${esc(t('courses.drag'))}">${TP.ui.icon('grip', { size: 16 })}</span>
        <details class="cs-color" data-color-pop>
          <summary class="cs-color-btn" data-fk="color:${lu}" aria-label="${esc(t('courses.colorOf', { name, color: colorName }))}"><span class="cs-color-dot" style="background:${esc(c.color || 'var(--fill)')}"></span></summary>
          <div class="cs-pop tp-glass" role="group" aria-label="${esc(t('courses.colorOf', { name, color: colorName }))}">
            ${TP.ui.swatches(`color${SEP}${c.luId}`, colorOptions(), key)}
            ${cs.color ? `<button type="button" class="cs-link-btn" data-action="color-reset" data-lu="${lu}" data-fk="cr:${lu}">${esc(t('courses.colorReset'))}</button>` : ''}
          </div>
        </details>
        <span class="cs-nick">
          <label class="cs-sr" for="${nid}">${esc(t('courses.nicknameFor', { name: orig }))}</label>
          <input id="${nid}" type="text" class="cs-input" name="nick${SEP}${lu}" value="${esc(cs.nickname || '')}"
            placeholder="${esc(orig)}" autocomplete="off" spellcheck="false" maxlength="60">
          <span class="cs-erow-meta">${esc([c.code, c.available === false ? t('courses.unavailable') : ''].filter(Boolean).join(' · '))}</span>
        </span>
        <label class="cs-hide" title="${esc(t('courses.hide'))}"><span class="cs-hide-label">${esc(t('courses.hide'))}</span><input type="checkbox" role="switch" class="tp-switch" name="hide${SEP}${lu}"${cs.hidden ? ' checked' : ''} aria-label="${esc(t('courses.hideName', { name }))}"></label>
        <span class="cs-move">
          <button type="button" class="cs-icon-btn" data-action="move-up" data-lu="${lu}" data-fk="up:${lu}" aria-label="${esc(t('courses.moveUp', { name }))}" ${i === 0 ? 'disabled' : ''}>${TP.ui.icon('arrowUp', { size: 15 })}</button>
          <button type="button" class="cs-icon-btn" data-action="move-down" data-lu="${lu}" data-fk="down:${lu}" aria-label="${esc(t('courses.moveDown', { name }))}" ${i === n - 1 ? 'disabled' : ''}>${TP.ui.icon('arrowDown', { size: 15 })}</button>
        </span>
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

  function lists(s) {
    const all = allCourses();
    const max = maxYear(all);
    const inView = all.filter((c) => inFilter(c, max));
    return { all, max, inView };
  }

  function render(ctx) {
    // Settings › "Vakken aanpassen…" opens this view in edit mode ('#/home?tplus=courses&id=edit').
    if (ctx !== ui.ctxSeen) { ui.ctxSeen = ctx; if ((ctx.params || {}).id === 'edit') ui.edit = true; }
    cur = ctx;
    const root = ctx.root;
    bind(root);
    ctx.setActions([{ id: 'edit', label: t(ui.edit ? 'courses.done' : 'courses.edit'), icon: ui.edit ? 'check' : undefined, onClick: toggleEdit }]);

    const focus = snapFocus(root);
    const s = TP.settings.get();
    const st = TP.data.status ? TP.data.status('enrollments') : {};
    const loaded = TP.data.peek && TP.data.peek('enrollments') != null;
    const { max, inView } = lists(s);
    const visible = sortList(inView.filter((c) => !c.hidden), s);
    const hidden = inView.filter((c) => c.hidden).sort(byName);

    const segs = SCOPES.map((f) => ({ value: f, label: t('courses.filter.' + f) }));
    const semOpts = SEMS.map((v) => ({ value: v, label: t('courses.sem.menu.' + v) }));
    const sortOpts = ['activity', 'name', 'manual'].map((v) => ({ value: v, label: t('courses.sort.' + v) }));

    let body;
    if (!loaded && !(st && st.error)) body = TP.ui.skeleton(4, { lead: 'dot' });
    else if (!loaded) body = TP.ui.group(TP.ui.errorRow(t('courses.error'), 'cs-retry'));
    else if (ui.edit) {
      const list = sortList(inView, s);
      body = list.length
        ? `<ul class="cs-edit-list" role="list" aria-describedby="cs-edit-hint">${list.map((c, i) => editRowHtml(c, i, list.length)).join('')}</ul>`
        : TP.ui.group(TP.ui.empty(emptyText()));
    } else if (!visible.length && !hidden.length) {
      body = TP.ui.group(TP.ui.empty(emptyText()));
    } else {
      body = (visible.length ? `<ul class="cs-grid" role="list">${visible.map((c) => cardHtml(c, max)).join('')}</ul>` : '')
        + hiddenHtml(hidden);
    }

    root.innerHTML = `
      <div class="cs-view${ui.edit ? ' is-editing' : ''}">
        <div class="cs-bar">
          <div class="cs-filter">${TP.ui.segmented('cs-scope', segs, ui.scope, { label: t('courses.filter') })}</div>
          <div class="cs-menus">
            ${ui.scope !== 'communities' ? TP.ui.select('cs-sem', semOpts, ui.sem, { ariaLabel: t('courses.sem.menu') }) : ''}
            ${TP.ui.select('cs-sort', sortOpts, s.courses?.sort || 'activity', { ariaLabel: t('courses.sort') })}
          </div>
        </div>
        ${ui.edit ? `<p class="cs-hint" id="cs-edit-hint">${esc(t('courses.editHint'))}</p>` : ''}
        <div class="cs-body">${body}</div>
        <div class="cs-noresults" hidden></div>
      </div>`;
    restoreFocus(root, focus);
    if (ui.q) applySearch(root, ui.q);
  }
  function emptyText() {
    return t(ui.scope === 'archive' ? 'courses.emptyArchive' : ui.scope === 'communities' ? 'courses.emptyCommunities' : 'courses.empty');
  }

  const live = () => !!(cur && cur.root.querySelector(':scope > .cs-view'));

  function toggleEdit() {
    ui.edit = !ui.edit;
    if (live()) render(cur);
    TP.shell.announce?.(t(ui.edit ? 'courses.editOn' : 'courses.editOff'));
  }

  function applySearch(root, q) {
    ui.q = q || '';
    let shown = 0;
    root.querySelectorAll('.cs-card[data-q], .cs-hidden-row[data-q], .cs-erow[data-q]').forEach((el) => {
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
      const none = !!ui.q && shown === 0 && root.querySelector('.cs-card, .cs-hidden-row, .cs-erow');
      nr.hidden = !none;
      nr.innerHTML = none ? TP.ui.noResults(ui.q) : '';
    }
  }

  // ---------- ordering ----------
  // The full manual order (all courses), seeded from what the student sees now when the sort wasn't manual yet.
  function baseOrder(s) {
    const all = allCourses();
    return (s.courses?.sort === 'manual' ? manualOrder(all, s.courses?.order) : sortList(all, s)).map((c) => c.luId);
  }
  function commitOrder(global, s) {
    const patch = { courses: { order: global } };
    if (s.courses?.sort !== 'manual') { patch.courses.sort = 'manual'; TP.shell.announce?.(t('courses.sortManualOn')); }
    save(TP.settings.set(patch));
    if (live()) render(cur);
  }
  function visibleIds(s) {
    const { inView } = lists(s);
    return sortList(inView, s).map((c) => c.luId);
  }
  function move(luId, dir) {
    const s = TP.settings.get();
    const vis = visibleIds(s);
    const i = vis.indexOf(luId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const global = baseOrder(s);
    const a = global.indexOf(luId), b = global.indexOf(vis[j]);
    if (a < 0 || b < 0) return;
    global[a] = vis[j]; global[b] = luId;
    commitOrder(global, s);
    const name = (TP.data.course(luId) || {}).name || '';
    TP.shell.announce?.(t('courses.movedTo', { name, n: j + 1, total: vis.length }));
  }
  function moveTo(luId, targetLu, after) {
    if (!luId || !targetLu || luId === targetLu) return;
    const s = TP.settings.get();
    const global = baseOrder(s).filter((x) => x !== luId);
    let k = global.indexOf(targetLu);
    if (k < 0) return;
    if (after) k++;
    global.splice(k, 0, luId);
    commitOrder(global, s);
  }

  function closePops(root, except) {
    root.querySelectorAll('details[data-color-pop][open]').forEach((d) => { if (d !== except) d.open = false; });
  }

  function bind(root) {
    if (root.__tpCoursesBound) return;
    root.__tpCoursesBound = true;

    root.addEventListener('click', async (ev) => {
      if (!ev.target.closest('.cs-view')) return;
      // a click outside an open colour popover closes it
      const pop = ev.target.closest('details[data-color-pop]');
      closePops(root, pop);
      const b = ev.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      const lu = b.dataset.lu;
      switch (b.dataset.action) {
        case 'move-up': return move(lu, -1);
        case 'move-down': return move(lu, 1);
        case 'color-reset': save(TP.settings.setCourse(lu, { color: null })); break;
        case 'unhide': save(TP.settings.setCourse(lu, { hidden: false })); break;
        case 'cs-retry': ev.preventDefault(); Promise.resolve(TP.data.load('enrollments', { force: true })).catch(() => {}); return;
        default: return;
      }
      if (live()) render(cur);
    });

    root.addEventListener('change', async (ev) => {
      const el = ev.target;
      if (!el.closest('.cs-view') || !el.name) return;
      if (el.name === 'cs-scope') { ui.scope = el.value; if (cur) render(cur); return; }
      if (el.name === 'cs-sem') { ui.sem = el.value; if (cur) render(cur); return; }
      if (el.name === 'cs-sort') { save(TP.settings.set({ courses: { sort: el.value } })); if (live()) render(cur); return; }
      const k = el.name.indexOf(SEP);
      if (k < 0) return;
      const kind = el.name.slice(0, k), lu = el.name.slice(k + SEP.length);
      if (kind === 'nick') save(TP.settings.setCourse(lu, { nickname: el.value.trim() }));
      else if (kind === 'color') save(TP.settings.setCourse(lu, { color: el.value }));
      else if (kind === 'hide') save(TP.settings.setCourse(lu, { hidden: el.checked }));
      else return;
      // A nickname commits on blur: repaint after focus has moved on, so it lands on the next control.
      if (kind === 'nick') setTimeout(() => { if (live()) render(cur); }, 0);
      else if (kind === 'color') { if (live()) { render(cur); root.querySelector(`[data-fk="color:${cssEsc(lu)}"]`)?.focus({ preventScroll: true }); } }
      else if (live()) render(cur);
    });

    root.addEventListener('keydown', (ev) => {
      // Enter in a nickname field commits it (change fires on blur otherwise).
      if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.cs-view input.cs-input')) {
        ev.preventDefault();
        ev.target.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Esc closes an open colour popover and returns focus to its button.
      if (ev.key === 'Escape') {
        const d = ev.target.closest && ev.target.closest('details[data-color-pop][open]');
        if (d) { ev.preventDefault(); ev.stopPropagation(); d.open = false; d.querySelector('summary')?.focus(); }
      }
    });

    // Drag and drop (pointer users); ↑/↓ stay the keyboard path.
    root.addEventListener('pointerdown', (ev) => {
      const g = ev.target.closest && ev.target.closest('[data-grip]');
      const li = g && g.closest('.cs-erow');
      if (li) li.draggable = true;
    });
    root.addEventListener('dragstart', (ev) => {
      const li = ev.target.closest && ev.target.closest('.cs-erow');
      if (!li || !li.draggable) { ev.preventDefault(); return; }
      ui.drag = li.dataset.lu;
      li.classList.add('is-dragging');
      try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', ui.drag); } catch { /* ignore */ }
    });
    root.addEventListener('dragover', (ev) => {
      const li = ev.target.closest && ev.target.closest('.cs-erow');
      if (!ui.drag || !li) return;
      ev.preventDefault();
      const r = li.getBoundingClientRect();
      const after = ev.clientY > r.top + r.height / 2;
      root.querySelectorAll('.cs-erow.drop-before, .cs-erow.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      if (li.dataset.lu !== ui.drag) li.classList.add(after ? 'drop-after' : 'drop-before');
    });
    root.addEventListener('drop', (ev) => {
      const li = ev.target.closest && ev.target.closest('.cs-erow');
      if (!ui.drag || !li) return;
      ev.preventDefault();
      const r = li.getBoundingClientRect();
      const dragged = ui.drag;
      ui.drag = null;
      moveTo(dragged, li.dataset.lu, ev.clientY > r.top + r.height / 2);
    });
    root.addEventListener('dragend', () => {
      ui.drag = null;
      root.querySelectorAll('.cs-erow').forEach((x) => { x.draggable = false; x.classList.remove('is-dragging', 'drop-before', 'drop-after'); });
    });

    // <details> toggle doesn't bubble: capture it to remember the hidden-group state.
    root.addEventListener('toggle', (ev) => {
      if (ev.target.matches && ev.target.matches('[data-hidden-group]') && !ui.q) ui.hiddenOpen = ev.target.open;
      if (ev.target.matches && ev.target.matches('details[data-color-pop]') && ev.target.open) {
        closePops(root, ev.target);
        ev.target.querySelector('input:checked, input')?.focus({ preventScroll: true });
      }
    }, true);
  }

  TP.shell.register('courses', {
    title: () => t('courses.title'),
    searchPlaceholder: () => t('courses.search'),
    render,
    onSearch(ctx, q) { cur = ctx; applySearch(ctx.root, q); },
    destroy() { ui.q = ''; ui.edit = false; ui.drag = null; },
  });
})();
