/* Toledo+ — Settings view (views-B).
   Inset grouped settings, applied instantly through TP.settings.set (no Save button). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  if (!TP.shell || !TP.shell.register) return;

  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const SEP = '__';
  const REPO = 'https://github.com/joennespreuwers/toledo-plus';
  const ISSUE = 'https://github.com/joennespreuwers/toledo-plus/issues/new/choose';
  const ALL = 999; // feed.maxCourses value meaning "all"

  const ui = { openCourses: new Set(), resetArmed: false, resetTimer: 0 };
  let cur = null;

  // Settings apply in memory immediately; don't wait for the (debounced) storage write to repaint.
  const save = (p) => { Promise.resolve(p).catch(() => {}); };
  const cssEsc = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

  // ---------- focus preservation across re-renders ----------
  function snapFocus(root) {
    const a = root.getRootNode().activeElement;
    if (!a || !root.contains(a)) return null;
    if (a.dataset && a.dataset.fk) return { fk: a.dataset.fk };
    if (a.name) return { name: a.name, value: a.type === 'radio' ? a.value : null };
    if (a.tagName === 'SUMMARY' && a.parentElement && a.parentElement.dataset.id) return { sum: a.parentElement.dataset.id };
    return null;
  }
  function restoreFocus(root, f) {
    if (!f) return;
    let el = null;
    if (f.fk) el = root.querySelector(`[data-fk="${cssEsc(f.fk)}"]`);
    else if (f.sum) el = root.querySelector(`details[data-id="${cssEsc(f.sum)}"] > summary`);
    else if (f.name) el = root.querySelector(`[name="${cssEsc(f.name)}"]${f.value != null ? `[value="${cssEsc(f.value)}"]` : ''}`);
    if (el && !el.disabled) el.focus({ preventScroll: true });
    else if (f.fk && /^(up|down):/.test(f.fk)) {
      const other = f.fk.replace(/^(up|down)/, (m) => (m === 'up' ? 'down' : 'up'));
      root.querySelector(`[data-fk="${cssEsc(other)}"]`)?.focus({ preventScroll: true });
    }
  }

  // ---------- building blocks ----------
  let seq = 0;
  const nid = (p) => `st-${p}-${++seq}`;

  // Label leading, control trailing.
  function ctlRow(label, control, opts = {}) {
    const id = nid('l');
    const ctl = typeof control === 'function' ? control(id) : control;
    return `<div class="st-row${opts.stack ? ' st-row-stack' : ''}"><span class="st-label" id="${id}">${esc(label)}</span><div class="st-ctl">${ctl}</div></div>`;
  }
  const toggleRow = (name, checked, label, description) =>
    `<div class="st-row st-row-toggle">${TP.ui.toggle(name, !!checked, label, description ? { description } : {})}</div>`;
  const labelled = (html, labelId) => html.replace(/^<div class="tp-(segmented|swatches)" role="radiogroup"/, (m) => `${m} aria-labelledby="${labelId}"`);
  function block(id, title, rows, footer) {
    return TP.ui.section({ id: 'st-' + id, title: esc(title), body: TP.ui.group(rows, { cls: 'st-group' }), footer: footer ? esc(footer) : '' });
  }
  const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));

  function accentOptions() {
    const P = TP.util.PALETTE;
    return Object.keys(P).map((k) => ({ value: k, color: P[k], label: t('courses.colors.' + k) }));
  }

  // ---------- sections ----------
  function language(s) {
    const seg = TP.ui.segmented('s:language', opts([['system', t('settings.lang.system')], ['nl', 'Nederlands'], ['en', 'English'], ['fr', 'Français']]), s.language, { label: t('settings.lang.label') });
    return block('lang', t('settings.lang'), ctlRow(t('settings.lang.label'), (id) => labelled(seg, id)));
  }

  function look(s) {
    const app = TP.ui.segmented('s:appearance', opts(['system', 'light', 'dark'].map((v) => [v, t('settings.appearance.' + v)])), s.appearance);
    const den = TP.ui.segmented('s:density', opts(['compact', 'standard', 'comfortable'].map((v) => [v, t('settings.density.' + v)])), s.density);
    const acc = TP.ui.swatches('s:accent', accentOptions(), s.accent);
    return block('look', t('settings.look'),
      ctlRow(t('settings.appearance'), (id) => labelled(app, id))
      + ctlRow(t('settings.accent'), (id) => labelled(acc, id), { stack: true })
      + ctlRow(t('settings.density'), (id) => labelled(den, id)));
  }

  function start(s) {
    const sel = TP.ui.select('s:startPage', opts(['overview', 'courses', 'deadlines', 'planning'].map((v) => [v, t('settings.page.' + v)])), s.startPage, { ariaLabel: t('settings.start.label') });
    return block('start', t('settings.start'), ctlRow(t('settings.start.label'), sel));
  }

  function sections(s) {
    const list = (s.overview && s.overview.sections) || [];
    const rows = list.map((x, i) => {
      const name = t('settings.sec.' + x.id);
      return `<div class="st-row st-row-toggle st-row-order">
        ${TP.ui.toggle('sec' + SEP + x.id, x.on !== false, name)}
        <span class="st-move">
          <button type="button" class="st-icon-btn" data-action="sec-up" data-id="${esc(x.id)}" data-fk="up:${esc(x.id)}" aria-label="${esc(t('settings.moveUp', { name }))}" ${i === 0 ? 'disabled' : ''}>${TP.ui.icon('arrowUp', { size: 15 })}</button>
          <button type="button" class="st-icon-btn" data-action="sec-down" data-id="${esc(x.id)}" data-fk="down:${esc(x.id)}" aria-label="${esc(t('settings.moveDown', { name }))}" ${i === list.length - 1 ? 'disabled' : ''}>${TP.ui.icon('arrowDown', { size: 15 })}</button>
        </span>
      </div>`;
    }).join('');
    return block('sections', t('settings.sections'), rows, t('settings.sections.foot'));
  }

  function feed(s) {
    const f = s.feed || {};
    const max = Number(f.maxCourses) || 5;
    const sel = TP.ui.select('n:feed.maxCourses', [3, 5, 8].map((n) => ({ value: n, label: String(n) })).concat({ value: ALL, label: t('settings.feed.all') }),
      [3, 5, 8].includes(max) ? max : ALL, { ariaLabel: t('settings.feed.max') });
    return block('feed', t('settings.feed'),
      toggleRow('s:feed.includeAnnouncements', f.includeAnnouncements, t('settings.feed.ann'), t('settings.feed.annDesc'))
      + ctlRow(t('settings.feed.max'), sel));
  }

  function deadlines(s) {
    const d = s.deadlines || {};
    const hz = TP.ui.select('n:deadlines.horizonDays', [2, 4, 6, 8].map((w) => ({ value: w * 7, label: t('settings.dl.weeks', { n: w }) })), d.horizonDays, { ariaLabel: t('settings.dl.horizon') });
    const ur = TP.ui.select('n:deadlines.urgentDays', [1, 3, 7].map((n) => ({ value: n, label: t('settings.dl.days', { n }) })), d.urgentDays, { ariaLabel: t('settings.dl.urgent') });
    const rm = TP.ui.select('s:deadlines.reminder', ['none', '1h', '1d', '2d'].map((v) => ({ value: v, label: t('settings.dl.rem.' + v) })), d.reminder, { ariaLabel: t('settings.dl.reminder') });
    return block('dl', t('settings.dl'), ctlRow(t('settings.dl.horizon'), hz) + ctlRow(t('settings.dl.urgent'), ur) + ctlRow(t('settings.dl.reminder'), rm));
  }

  function courseRow(c) {
    const cs = TP.settings.course(c.luId);
    const name = c.name || TP.util.courseName(c.title);
    const tags = [cs.pinned ? t('settings.courses.pinned') : '', cs.hidden ? t('settings.courses.hidden') : ''].filter(Boolean).join(' · ');
    const inputId = nid('nick');
    const colId = nid('col');
    const body = `
      <div class="st-course">
        <div class="st-field">
          <label for="${inputId}">${esc(t('settings.nickname'))}</label>
          <input id="${inputId}" type="text" class="st-input" name="nick${SEP}${esc(c.luId)}" value="${esc(cs.nickname || '')}"
            placeholder="${esc(TP.util.courseName(c.title))}" autocomplete="off" spellcheck="false" maxlength="60">
        </div>
        <div class="st-field">
          <span class="st-field-label" id="${colId}">${esc(t('settings.color'))}</span>
          <div class="st-swatch-line">
            ${labelled(TP.ui.swatches('color' + SEP + c.luId, accentOptions(), cs.color || c.colorKey || ''), colId)}
            ${cs.color ? `<button type="button" class="st-link-btn" data-action="color-reset" data-lu="${esc(c.luId)}" data-fk="cr:${esc(c.luId)}">${esc(t('settings.colorReset'))}</button>` : ''}
          </div>
        </div>
        <div class="st-course-toggles">
          ${TP.ui.toggle('pin' + SEP + c.luId, !!cs.pinned, t('settings.pin'))}
          ${TP.ui.toggle('hide' + SEP + c.luId, !!cs.hidden, t('settings.hide'))}
        </div>
      </div>`;
    return TP.ui.disclosure({
      id: c.luId,
      open: ui.openCourses.has(c.luId),
      cls: 'st-course-disc',
      summary: {
        leading: TP.ui.dot(c.color),
        title: esc(name),
        subtitle: esc([c.code, tags].filter(Boolean).join(' · ')),
      },
      body,
    });
  }

  function coursesBlock(s) {
    let list = [];
    try { list = TP.data.courses({ currentOnly: true, includeHidden: true }) || []; } catch { list = []; }
    const rows = list.length ? list.map(courseRow).join('') : `<div class="st-row"><span class="st-muted">${esc(t('settings.courses.none'))}</span></div>`;
    return block('courses', t('settings.courses'),
      toggleRow('s:courses.showCommunities', s.courses && s.courses.showCommunities, t('settings.courses.communities'), t('settings.courses.communitiesDesc')) + rows,
      t('settings.courses.foot'));
  }

  function sync(s) {
    const y = s.sync || {};
    return block('sync', t('settings.sync'),
      toggleRow('s:sync.markReadInToledo', y.markReadInToledo, t('settings.sync.read'))
      + toggleRow('s:sync.favoritesToToledo', y.favoritesToToledo, t('settings.sync.fav')),
      t('settings.sync.foot'));
  }

  function wrap(s) {
    const w = s.wrap || {};
    return block('wrap', t('settings.wrap'),
      toggleRow('s:wrap.portal', w.portal, t('settings.wrap.portal'))
      + toggleRow('s:wrap.courses', w.courses, t('settings.wrap.courses'))
      + toggleRow('s:wrap.deepBar', w.deepBar, t('settings.wrap.deepBar')),
      t('settings.wrap.foot'));
  }

  function data() {
    const fileId = nid('import');
    return block('data', t('settings.data'), `
      <div class="st-row st-row-actions">
        <button type="button" class="st-action" data-action="export" data-fk="export">${TP.ui.icon('download', { size: 16 })}<span>${esc(t('settings.data.export'))}</span></button>
      </div>
      <div class="st-row st-row-actions">
        <input type="file" id="${fileId}" class="st-file" name="st-import" accept="application/json,.json">
        <label for="${fileId}" class="st-action">${TP.ui.icon('arrowUp', { size: 16 })}<span>${esc(t('settings.data.import'))}</span></label>
      </div>
      <div class="st-row st-row-actions">
        <button type="button" class="st-action st-danger${ui.resetArmed ? ' is-armed' : ''}" data-action="reset" data-fk="reset">${TP.ui.icon(ui.resetArmed ? 'warning' : 'refresh', { size: 16 })}<span>${esc(t(ui.resetArmed ? 'settings.data.confirm' : 'settings.data.reset'))}</span></button>
      </div>`, t('settings.data.foot'));
  }

  function about() {
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch { version = ''; }
    const link = (href, label, icon) => `<a class="st-row st-link-row" href="${esc(href)}" target="_blank" rel="noopener">
        <span class="st-label">${esc(label)}</span><span class="st-trail">${TP.ui.icon(icon, { size: 15 })}<span class="st-sr">${esc(t('settings.newTab'))}</span></span></a>`;
    return block('about', t('settings.about'),
      `<div class="st-row"><span class="st-label">${esc(t('settings.about.version'))}</span><span class="st-value">${esc(version || '—')}</span></div>`
      + link(REPO, t('settings.about.github'), 'external')
      + link(ISSUE, t('settings.about.issue'), 'external'),
      t('settings.about.privacy'));
  }

  // ---------- render ----------
  function render(ctx) {
    cur = ctx;
    const root = ctx.root;
    bind(root);
    try { ctx.setActions && ctx.setActions([]); } catch { /* ignore */ }
    const focus = snapFocus(root);
    const s = TP.settings.get();
    root.innerHTML = `<div class="st-view">${language(s)}${look(s)}${start(s)}${sections(s)}${feed(s)}${deadlines(s)}${coursesBlock(s)}${sync(s)}${wrap(s)}${data()}${about()}</div>`;
    restoreFocus(root, focus);
  }
  // Async callers only repaint while the settings view is still what the container shows.
  const rerender = () => { if (cur && cur.root.querySelector(':scope > .st-view')) render(cur); };

  // ---------- interactions ----------
  function patchFor(path, value) {
    const keys = path.split('.');
    const out = {};
    let o = out;
    keys.forEach((k, i) => { o[k] = i === keys.length - 1 ? value : {}; o = o[k]; });
    return out;
  }

  async function moveSection(id, dir) {
    const list = ((TP.settings.get().overview || {}).sections || []).map((x) => ({ id: x.id, on: x.on !== false }));
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(TP.settings.set({ overview: { sections: list } }));
    rerender();
    TP.shell.announce?.(t(dir < 0 ? 'settings.moveUp' : 'settings.moveDown', { name: t('settings.sec.' + id) }));
  }

  function exportSettings() {
    const json = TP.settings.export();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `toledo-plus-settings-${TP.fmt.dayKey(Date.now())}.json`;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
    TP.shell.toast?.(t('settings.data.exported'));
  }

  async function importSettings(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await TP.settings.import(text);
      TP.shell.toast?.(t('settings.data.imported'));
    } catch {
      TP.shell.toast?.(t('settings.data.importFailed'));
    }
    input.value = '';
    rerender();
  }

  async function resetClick() {
    clearTimeout(ui.resetTimer);
    if (!ui.resetArmed) {
      ui.resetArmed = true;
      rerender();
      TP.shell.announce?.(t('settings.data.confirm'));
      ui.resetTimer = setTimeout(() => { ui.resetArmed = false; rerender(); }, 5000);
      return;
    }
    ui.resetArmed = false;
    try { await TP.settings.reset(); TP.shell.toast?.(t('settings.data.resetDone')); } catch { /* ignore */ }
    rerender();
  }

  function bind(root) {
    if (root.__tpSettingsBound) return;
    root.__tpSettingsBound = true;

    root.addEventListener('click', (ev) => {
      if (!ev.target.closest('.st-view')) return;
      const b = ev.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      const act = b.dataset.action;
      if (act === 'sec-up') moveSection(b.dataset.id, -1);
      else if (act === 'sec-down') moveSection(b.dataset.id, 1);
      else if (act === 'export') exportSettings();
      else if (act === 'reset') resetClick();
      else if (act === 'color-reset') { save(TP.settings.setCourse(b.dataset.lu, { color: null })); rerender(); }
    });

    root.addEventListener('change', async (ev) => {
      const el = ev.target;
      if (!el.closest || !el.closest('.st-view') || !el.name) return;
      const name = el.name;
      if (name === 'st-import') { importSettings(el); return; }
      const value = el.type === 'checkbox' ? el.checked : el.value;
      let p = null;
      if (name.startsWith('s:')) p = TP.settings.set(patchFor(name.slice(2), value));
      else if (name.startsWith('n:')) p = TP.settings.set(patchFor(name.slice(2), Number(value)));
      else {
        const k = name.indexOf(SEP);
        if (k < 0) return;
        const kind = name.slice(0, k), id = name.slice(k + SEP.length);
        if (kind === 'sec') {
          const list = ((TP.settings.get().overview || {}).sections || []).map((x) => ({ id: x.id, on: x.id === id ? !!value : x.on !== false }));
          p = TP.settings.set({ overview: { sections: list } });
        } else if (kind === 'nick') p = TP.settings.setCourse(id, { nickname: String(value).trim() });
        else if (kind === 'color') p = TP.settings.setCourse(id, { color: value });
        else if (kind === 'pin') p = TP.settings.setCourse(id, { pinned: !!value });
        else if (kind === 'hide') p = TP.settings.setCourse(id, { hidden: !!value });
      }
      if (!p) return;
      save(p); // applied in memory synchronously; persistence is debounced by core
      // A nickname commits on blur: repaint after focus has moved on, so it lands on the next control.
      if (name.startsWith('nick' + SEP)) setTimeout(rerender, 0); else rerender();
    });

    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.st-view input.st-input')) {
        ev.preventDefault();
        ev.target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // Remember which course drill-ins are open (toggle doesn't bubble → capture).
    root.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (!d.matches || !d.matches('.st-view details.st-course-disc') || !d.isConnected) return;
      if (d.open) ui.openCourses.add(d.dataset.id); else ui.openCourses.delete(d.dataset.id);
    }, true);
  }

  TP.shell.register('settings', {
    title: () => t('settings.title'),
    render,
    destroy() { clearTimeout(ui.resetTimer); ui.resetArmed = false; },
  });
})();
