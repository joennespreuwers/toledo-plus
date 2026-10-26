/* Toledo+ — Settings view.
   Inset grouped settings (≤ 10 groups), applied instantly through TP.settings.set (no Save button).
   '#/home?tplus=settings&id=sections' is the "Secties aanpassen" subpage (edit mode for the overview blocks). */
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

  const ui = { resetArmed: false, resetTimer: 0, icsEdit: false, drag: null };
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
    // N7: red and pink are reserved for "te laat" and never offered as accent.
    const keys = TP.util.ACCENTS || Object.keys(P).filter((k) => k !== 'red' && k !== 'pink');
    return keys.map((k) => ({ value: k, color: P[k], label: t('courses.colors.' + k) }));
  }
  const navRow = (label, attrs, value) => `<a class="st-row st-link-row st-nav-row"${TP.ui.attrs(attrs)}><span class="st-label">${esc(label)}</span><span class="st-trail">${value ? `<span class="st-value">${esc(value)}</span>` : ''}${TP.ui.icon('chevronRight', { size: 14, strokeWidth: 2.2 })}</span></a>`;

  // ---------- groups (≤ 10: Taal · Weergave · Overzicht · Deadlines · Vakken · Agenda · Zoeken · Synchronisatie · Geavanceerd · Over) ----------
  function language(s) {
    const seg = TP.ui.segmented('s:language', opts([['system', t('settings.lang.system')], ['nl', 'Nederlands'], ['en', 'English'], ['fr', 'Français']]), s.language, { label: t('settings.lang.label') });
    return block('lang', t('settings.lang'), ctlRow(t('settings.lang.label'), (id) => labelled(seg, id)));
  }

  function look(s) {
    const app = TP.ui.segmented('s:appearance', opts(['system', 'light', 'dark'].map((v) => [v, t('settings.appearance.' + v)])), s.appearance);
    const den = TP.ui.segmented('s:density', opts(['compact', 'standard', 'comfortable'].map((v) => [v, t('settings.density.' + v)])), s.density);
    const acc = TP.ui.swatches('s:accent', accentOptions(), TP.util.accentKey ? TP.util.accentKey(s.accent) : s.accent);
    return block('look', t('settings.look'),
      ctlRow(t('settings.appearance'), (id) => labelled(app, id))
      + ctlRow(t('settings.accent'), (id) => labelled(acc, id), { stack: true })
      + ctlRow(t('settings.density'), (id) => labelled(den, id)));
  }

  // "Overzicht": start page, the sections subpage, and the "Nieuw" feed options.
  function overview(s) {
    const start = ['planning', 'agenda'].includes(s.startPage) ? 'agenda' : s.startPage;
    const page = TP.ui.select('s:startPage', opts(['overview', 'courses', 'deadlines', 'agenda'].map((v) => [v, t('settings.page.' + v)])), start, { ariaLabel: t('settings.start.label') });
    const list = (s.overview && s.overview.sections) || [];
    const on = list.filter((x) => x.on !== false).length;
    const f = s.feed || {};
    const max = Number(f.maxCourses) || 5;
    const sel = TP.ui.select('n:feed.maxCourses', [3, 5, 8].map((n) => ({ value: n, label: String(n) })).concat({ value: ALL, label: t('settings.feed.all') }),
      [3, 5, 8].includes(max) ? max : ALL, { ariaLabel: t('settings.feed.max') });
    return block('overview', t('settings.overview'),
      ctlRow(t('settings.start.label'), page)
      + navRow(t('settings.sections.edit'), { href: TP.shell.href('settings', { id: 'sections' }), 'data-fk': 'open-sections' }, t('settings.sections.count', { n: on, total: list.length }))
      + toggleRow('s:feed.includeAnnouncements', f.includeAnnouncements, t('settings.feed.ann'), t('settings.feed.annDesc'))
      + ctlRow(t('settings.feed.max'), sel));
  }

  function deadlines(s) {
    const d = s.deadlines || {};
    const hz = TP.ui.select('n:deadlines.horizonDays', [2, 4, 6, 8].map((w) => ({ value: w * 7, label: t('settings.dl.weeks', { n: w }) })), d.horizonDays, { ariaLabel: t('settings.dl.horizon') });
    const ur = TP.ui.select('n:deadlines.urgentDays', [1, 3, 7].map((n) => ({ value: n, label: t('settings.dl.days', { n }) })), d.urgentDays, { ariaLabel: t('settings.dl.urgent') });
    const rm = TP.ui.select('s:deadlines.reminder', ['none', '1h', '1d', '2d'].map((v) => ({ value: v, label: t('settings.dl.rem.' + v) })), d.reminder, { ariaLabel: t('settings.dl.reminder') });
    return block('dl', t('settings.dl'), ctlRow(t('settings.dl.horizon'), hz) + ctlRow(t('settings.dl.urgent'), ur) + ctlRow(t('settings.dl.reminder'), rm));
  }

  // N5: one place for nickname/colour/hide/order → Vakken › Bewerk.
  function coursesBlock() {
    return block('courses', t('settings.courses'),
      navRow(t('settings.courses.edit'), { href: TP.shell.href('courses', { id: 'edit' }), 'data-fk': 'open-courses' }),
      t('settings.courses.foot'));
  }

  // Agenda: KU Loket status + the personal iCal link (masked; paste / replace / remove).
  function agenda() {
    const K = TP.kuloket;
    if (!K) return block('agenda', t('settings.agenda'), `<div class="st-row"><span class="st-label">KU Loket</span><span class="st-value">${esc(t('settings.agenda.unavailable'))}</span></div>`);
    let st = null;
    try { st = K.status ? K.status() : null; } catch { st = null; }
    const L = (st && st.lessons) || {};
    let line;
    if (L.ok) line = t('settings.agenda.ok', { time: L.t ? TP.fmt.time(L.t) : '—', source: t('settings.agenda.src.' + (L.source === 'ics' ? 'ics' : 'kuloket')) });
    else if (L.error === 'auth') line = t('settings.agenda.auth');
    else if (L.error) line = t('settings.agenda.error');
    else line = t('settings.agenda.idle');
    let masked = '';
    try { masked = K.getIcsUrlMasked ? K.getIcsUrlMasked() : ''; } catch { masked = ''; }
    const canSet = typeof K.setIcsUrl === 'function';
    let ics = '';
    if (canSet) {
      if (masked && !ui.icsEdit) {
        ics = `<div class="st-row"><span class="st-label">${esc(t('settings.agenda.ics'))}</span><span class="st-value st-mono" data-ics-masked>${esc(masked)}</span></div>
        <div class="st-row st-row-actions">
          <button type="button" class="st-action" data-action="ics-edit" data-fk="ics-edit">${TP.ui.icon('link', { size: 16 })}<span>${esc(t('settings.agenda.icsReplace'))}</span></button>
          <button type="button" class="st-action st-danger" data-action="ics-remove" data-fk="ics-remove">${TP.ui.icon('trash', { size: 16 })}<span>${esc(t('settings.agenda.icsRemove'))}</span></button>
        </div>`;
      } else {
        const id = nid('ics');
        ics = `<form class="st-row st-row-stack st-ics" data-form="ics" novalidate>
          <label class="st-field-label" for="${id}">${esc(t('settings.agenda.icsPaste'))}</label>
          <div class="st-ics-line"><input id="${id}" type="url" class="st-input" name="st-ics" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://cloud.timeedit.net/…/s.ics?…">
          <button type="submit" class="tp-btn tp-btn-tinted" data-fk="ics-save">${esc(t('common.save'))}</button>
          ${masked ? `<button type="button" class="tp-btn tp-btn-plain" data-action="ics-cancel" data-fk="ics-cancel">${esc(t('common.cancel'))}</button>` : ''}</div>
          <p class="st-form-error" role="alert" hidden></p>
        </form>`;
      }
    }
    const app = K.icalAppUrl ? K.icalAppUrl() : null;
    const login = L.error === 'auth' && K.loginUrl ? K.loginUrl() : null;
    if (login) ics = `<a class="st-row st-link-row" href="${esc(login)}" target="_blank" rel="noopener" data-kul-login><span class="st-label st-strong">${esc(t('settings.agenda.login'))}</span><span class="st-trail">${TP.ui.icon('external', { size: 15 })}<span class="st-sr">${esc(t('settings.newTab'))}</span></span></a>` + ics;
    return block('agenda', t('settings.agenda'),
      `<div class="st-row"><span class="st-label">KU Loket</span><span class="st-value" data-kul-status>${esc(line)}</span></div>${ics}`
      + (app ? `<a class="st-row st-link-row" href="${esc(app)}" target="_blank" rel="noopener"><span class="st-label">${esc(t('settings.agenda.icsWhere'))}</span><span class="st-trail">${TP.ui.icon('external', { size: 15 })}<span class="st-sr">${esc(t('settings.newTab'))}</span></span></a>` : ''),
      t('settings.agenda.foot'));
  }

  // ---- BEGIN full-text block (owner: TP.fulltext, src/core/fulltext.js) — switch, status, "Wis bestandsindex" ----
  function fullTextRows() {
    const F = TP.fulltext;
    if (!F) return '';
    return toggleRow('s:search.fullText', F.enabled(), t('fulltext.setting'), t('fulltext.settingDesc'))
      + `<div class="st-row"><span class="st-label">${esc(t('fulltext.status'))}</span><span class="st-value" data-ft-status>${esc(F.settingsText())}</span></div>`
      + `<div class="st-row st-row-actions"><button type="button" class="st-action st-danger" data-action="ft-wipe" data-fk="ft-wipe">${TP.ui.icon('trash', { size: 16 })}<span>${esc(t('fulltext.wipe'))}</span></button></div>`;
  }
  function bindFullText() {
    try {
      TP.fulltext && TP.fulltext.on('change', () => {
        const el = cur && cur.root.querySelector('.st-view [data-ft-status]');
        if (el) el.textContent = TP.fulltext.settingsText();
      });
    } catch { /* no full-text module */ }
  }
  function onFullTextWipe() {
    Promise.resolve(TP.fulltext && TP.fulltext.wipe()).catch(() => {}).finally(() => { TP.shell.toast?.(t('fulltext.wiped')); rerender(); });
  }
  // ---- END full-text block ----

  function search(s) {
    const on = ((s.search || {}).indexAll) !== false;
    let st = null;
    try { st = TP.index.status(); } catch { st = null; }
    const busy = !!(st && st.crawling);
    const line = st ? TP.index.statusText() : t('settings.search.never');
    return block('search', t('settings.search'),
      toggleRow('s:search.indexAll', on, t('settings.search.index'), t('settings.search.indexDesc'))
      + `<div class="st-row"><span class="st-label">${esc(t('settings.search.status'))}</span><span class="st-value st-index-status" data-index-status>${esc(line)}</span></div>`
      + `<div class="st-row st-row-actions">
        <button type="button" class="st-action" data-action="reindex" data-fk="reindex"${busy ? ' aria-busy="true"' : ''}>${TP.ui.icon('refresh', { size: 16 })}<span>${esc(t('settings.search.rebuild'))}</span></button>
      </div>`
      + fullTextRows(),
      t('settings.search.foot'));
  }

  function sync(s) {
    const y = s.sync || {};
    return block('sync', t('settings.sync'),
      toggleRow('s:sync.markReadInToledo', y.markReadInToledo !== false, t('settings.sync.read')),
      t('settings.sync.foot'));
  }

  // "Geavanceerd": which Toledo pages Toledo+ replaces + settings export/import/reset.
  function advanced(s) {
    const w = s.wrap || {};
    const fileId = nid('import');
    return block('advanced', t('settings.advanced'),
      toggleRow('s:wrap.portal', w.portal, t('settings.wrap.portal'))
      + toggleRow('s:wrap.courses', w.courses, t('settings.wrap.courses'))
      + toggleRow('s:wrap.deepBar', w.deepBar, t('settings.wrap.deepBar'))
      + toggleRow('s:wrap.skipLanding', w.skipLanding !== false, t('settings.wrap.skipLanding'))
      + `<div class="st-row st-row-actions">
        <button type="button" class="st-action" data-action="export" data-fk="export">${TP.ui.icon('download', { size: 16 })}<span>${esc(t('settings.data.export'))}</span></button>
      </div>
      <div class="st-row st-row-actions">
        <input type="file" id="${fileId}" class="st-file" name="st-import" accept="application/json,.json">
        <label for="${fileId}" class="st-action">${TP.ui.icon('arrowUp', { size: 16 })}<span>${esc(t('settings.data.import'))}</span></label>
      </div>
      <div class="st-row st-row-actions">
        <button type="button" class="st-action st-danger${ui.resetArmed ? ' is-armed' : ''}" data-action="reset" data-fk="reset">${TP.ui.icon(ui.resetArmed ? 'warning' : 'refresh', { size: 16 })}<span>${esc(t(ui.resetArmed ? 'settings.data.confirm' : 'settings.data.reset'))}</span></button>
      </div>`, t('settings.advanced.foot'));
  }

  function about(s) {
    let version = '';
    try { version = chrome.runtime.getManifest().version; } catch { version = ''; }
    const link = (href, label, icon) => `<a class="st-row st-link-row" href="${esc(href)}" target="_blank" rel="noopener">
        <span class="st-label">${esc(label)}</span><span class="st-trail">${TP.ui.icon(icon, { size: 15 })}<span class="st-sr">${esc(t('settings.newTab'))}</span></span></a>`;
    return block('about', t('settings.about'),
      // brand (Agent I, v1.6): logo + name + version + "Onofficieel studentenproject"
      `<div class="st-row st-brand-row">${TP.ui.logo ? TP.ui.logo({ size: 44 }) : ''}<span class="st-brand-text"><span class="st-brand-name">${TP.ui.wordmark ? TP.ui.wordmark() : 'Toledo+'}</span><span class="st-brand-meta">${esc(t('brand.unofficial'))}</span></span></div>`
      + `<div class="st-row"><span class="st-label">${esc(t('settings.about.version'))}</span><span class="st-value">${esc(version || '—')}</span></div>`
      + link(REPO, t('settings.about.github'), 'external')
      + link(ISSUE, t('settings.about.issue'), 'external')
      + toggleRow('s:privacy.telemetry', s.privacy?.telemetry !== false, t('telemetry.setting.label'), t('telemetry.setting.desc'))
      + toggleRow('s:privacy.updateCheck', s.privacy?.updateCheck !== false, t('telemetry.update.label'), t('telemetry.update.desc'))
      + `<div class="st-row st-row-actions"><button type="button" class="st-action" data-action="feedback" data-fk="feedback">${TP.ui.icon('megaphone', { size: 16 })}<span>${esc(t('feedback.menu'))}</span></button></div>`,
      t('telemetry.about'));
  }

  // ---------- subpage: Overzicht › Secties (edit mode: drag handle + ↑/↓ + switch) ----------
  function sectionsPage(s) {
    const list = (s.overview && s.overview.sections) || [];
    const rows = list.map((x, i) => {
      const name = t('settings.sec.' + x.id);
      return `<li class="st-row st-row-toggle st-row-order st-sec-row" data-sec="${esc(x.id)}">
        <span class="st-grip" data-grip aria-hidden="true" title="${esc(t('settings.sections.drag'))}">${TP.ui.icon('grip', { size: 16 })}</span>
        ${TP.ui.toggle('sec' + SEP + x.id, x.on !== false, name)}
        <span class="st-move">
          <button type="button" class="st-icon-btn" data-action="sec-up" data-id="${esc(x.id)}" data-fk="up:${esc(x.id)}" aria-label="${esc(t('settings.moveUp', { name }))}" ${i === 0 ? 'disabled' : ''}>${TP.ui.icon('arrowUp', { size: 15 })}</button>
          <button type="button" class="st-icon-btn" data-action="sec-down" data-id="${esc(x.id)}" data-fk="down:${esc(x.id)}" aria-label="${esc(t('settings.moveDown', { name }))}" ${i === list.length - 1 ? 'disabled' : ''}>${TP.ui.icon('arrowDown', { size: 15 })}</button>
        </span>
      </li>`;
    }).join('');
    return `<div class="st-view st-sub tp-narrow">
      <p><a class="st-back" href="${esc(TP.shell.href('settings'))}" data-route="settings" data-fk="back">${TP.ui.icon('chevronLeft', { size: 16, strokeWidth: 2.4 })}<span>${esc(t('settings.title'))}</span></a></p>
      ${TP.ui.section({ id: 'st-sections', title: esc(t('settings.sections.title')), body: `<ul class="tp-group st-group st-sec-list" role="list">${rows}</ul>`, footer: esc(t('settings.sections.foot')) })}
    </div>`;
  }

  // ---------- render ----------
  const isSub = (ctx) => ((ctx && ctx.params) || {}).id === 'sections';
  function render(ctx) {
    cur = ctx;
    const root = ctx.root;
    bind(root);
    try { ctx.setActions && ctx.setActions([]); } catch { /* ignore */ }
    const focus = snapFocus(root);
    const s = TP.settings.get();
    if (isSub(ctx)) {
      try { ctx.setTitle && ctx.setTitle(t('settings.sections.title')); } catch { /* ignore */ }
      root.innerHTML = sectionsPage(s);
    } else {
      try { ctx.setTitle && ctx.setTitle(t('settings.title')); } catch { /* ignore */ }
      root.innerHTML = `<div class="st-view tp-narrow">${language(s)}${look(s)}${overview(s)}${deadlines(s)}${coursesBlock()}${agenda()}${search(s)}${sync(s)}${advanced(s)}${about(s)}</div>`;
    }
    restoreFocus(root, focus);
  }
  // Async callers only repaint while the settings view is still what the container shows.
  const rerender = () => { if (cur && cur.root.querySelector(':scope > .st-view')) (TP.motion ? TP.motion.flip(cur.root, () => render(cur)) : render(cur)); };

  // ---------- interactions ----------
  function patchFor(path, value) {
    const keys = path.split('.');
    const out = {};
    let o = out;
    keys.forEach((k, i) => { o[k] = i === keys.length - 1 ? value : {}; o = o[k]; });
    return out;
  }

  function sectionList() {
    return ((TP.settings.get().overview || {}).sections || []).map((x) => ({ id: x.id, on: x.on !== false }));
  }
  async function moveSection(id, dir) {
    const list = sectionList();
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(TP.settings.set({ overview: { sections: list } }));
    rerender();
    TP.shell.announce?.(t('settings.movedTo', { name: t('settings.sec.' + id), n: j + 1, total: list.length }));
  }
  function moveSectionTo(id, target, after) {
    if (!id || !target || id === target) return;
    const list = sectionList();
    const item = list.find((x) => x.id === id);
    const rest = list.filter((x) => x.id !== id);
    let k = rest.findIndex((x) => x.id === target);
    if (!item || k < 0) return;
    if (after) k++;
    rest.splice(k, 0, item);
    save(TP.settings.set({ overview: { sections: rest } }));
    rerender();
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
    try { await TP.fulltext?.wipe?.(); } catch { /* the file index lives in IndexedDB; best effort */ }
    rerender();
  }

  async function saveIcs(form) {
    const input = form.querySelector('input[name="st-ics"]');
    const err = form.querySelector('.st-form-error');
    const v = String((input && input.value) || '').trim();
    let ok = false;
    try { ok = !!v && (await TP.kuloket.setIcsUrl(v)) !== false; } catch { ok = false; }
    if (!ok) {
      if (err) { err.hidden = false; err.textContent = t('settings.agenda.icsInvalid'); }
      if (input) { input.setAttribute('aria-invalid', 'true'); input.focus(); }
      return;
    }
    ui.icsEdit = false;
    TP.shell.toast?.(t('settings.agenda.icsSaved'));
    rerender();
    cur?.root.querySelector('[data-fk="ics-edit"]')?.focus({ preventScroll: true });
  }

  function bind(root) {
    if (root.__tpSettingsBound) return;
    root.__tpSettingsBound = true;

    bindFullText();
    // Index status line + rebuild button follow the crawl (only while this view is shown).
    try {
      TP.index.on('change', () => {
        if (!cur || !cur.root.querySelector(':scope > .st-view')) return;
        const el = cur.root.querySelector('[data-index-status]');
        if (el) el.textContent = TP.index.statusText();
        const b = cur.root.querySelector('[data-action="reindex"]');
        if (b) { if (TP.index.status().crawling) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy'); }
      });
    } catch { /* no index */ }

    root.addEventListener('click', (ev) => {
      if (!ev.target.closest('.st-view')) return;
      const b = ev.target.closest('[data-action]');
      if (!b || !root.contains(b)) return;
      const act = b.dataset.action;
      if (act === 'sec-up') moveSection(b.dataset.id, -1);
      else if (act === 'sec-down') moveSection(b.dataset.id, 1);
      else if (act === 'export') exportSettings();
      else if (act === 'feedback') TP.feedback?.open({ page: 'settings', opener: b });
      else if (act === 'reset') resetClick();
      else if (act === 'ics-edit') { ui.icsEdit = true; rerender(); cur?.root.querySelector('input[name="st-ics"]')?.focus(); }
      else if (act === 'ics-cancel') { ui.icsEdit = false; rerender(); cur?.root.querySelector('[data-fk="ics-edit"]')?.focus(); }
      else if (act === 'ics-remove') {
        Promise.resolve(TP.kuloket && TP.kuloket.setIcsUrl('')).catch(() => {}).finally(() => { TP.shell.toast?.(t('settings.agenda.icsRemoved')); rerender(); });
      } else if (act === 'ft-wipe') onFullTextWipe();
      else if (act === 'reindex') {
        if (b.getAttribute('aria-busy') === 'true') return;
        TP.shell.announce?.(t('settings.search.rebuilding'));
        Promise.resolve(TP.index.rebuild()).catch(() => {}).finally(rerender);
        rerender();
      }
    });

    root.addEventListener('submit', (ev) => {
      const form = ev.target.closest && ev.target.closest('[data-form="ics"]');
      if (!form) return;
      ev.preventDefault();
      saveIcs(form);
    });

    root.addEventListener('change', async (ev) => {
      const el = ev.target;
      if (!el.closest || !el.closest('.st-view') || !el.name) return;
      const name = el.name;
      if (name === 'st-import') { importSettings(el); return; }
      if (name === 'st-ics') return; // saved on submit
      const value = el.type === 'checkbox' ? el.checked : el.value;
      let p = null;
      if (name.startsWith('s:')) p = TP.settings.set(patchFor(name.slice(2), value));
      else if (name.startsWith('n:')) p = TP.settings.set(patchFor(name.slice(2), Number(value)));
      else {
        const k = name.indexOf(SEP);
        if (k < 0) return;
        const kind = name.slice(0, k), id = name.slice(k + SEP.length);
        if (kind === 'sec') {
          const list = sectionList().map((x) => ({ id: x.id, on: x.id === id ? !!value : x.on }));
          p = TP.settings.set({ overview: { sections: list } });
        }
      }
      if (!p) return;
      save(p); // applied in memory synchronously; persistence is debounced by core
      rerender();
    });

    // Sections subpage: drag handle (pointer); ↑/↓ are the keyboard path.
    root.addEventListener('pointerdown', (ev) => {
      const g = ev.target.closest && ev.target.closest('[data-grip]');
      const li = g && g.closest('.st-sec-row');
      if (li) li.draggable = true;
    });
    root.addEventListener('dragstart', (ev) => {
      const li = ev.target.closest && ev.target.closest('.st-sec-row');
      if (!li || !li.draggable) { ev.preventDefault(); return; }
      ui.drag = li.dataset.sec;
      li.classList.add('is-dragging');
      try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', ui.drag); } catch { /* ignore */ }
    });
    root.addEventListener('dragover', (ev) => {
      const li = ev.target.closest && ev.target.closest('.st-sec-row');
      if (!ui.drag || !li) return;
      ev.preventDefault();
      const r = li.getBoundingClientRect();
      root.querySelectorAll('.st-sec-row').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      if (li.dataset.sec !== ui.drag) li.classList.add(ev.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
    });
    root.addEventListener('drop', (ev) => {
      const li = ev.target.closest && ev.target.closest('.st-sec-row');
      if (!ui.drag || !li) return;
      ev.preventDefault();
      const r = li.getBoundingClientRect();
      const id = ui.drag;
      ui.drag = null;
      moveSectionTo(id, li.dataset.sec, ev.clientY > r.top + r.height / 2);
    });
    root.addEventListener('dragend', () => {
      ui.drag = null;
      root.querySelectorAll('.st-sec-row').forEach((x) => { x.draggable = false; x.classList.remove('is-dragging', 'drop-before', 'drop-after'); });
    });
  }

  TP.shell.register('settings', {
    title: () => t('settings.title'),
    showUpdated: false, // "Bijgewerkt hh:mm" means nothing here
    render,
    destroy() { clearTimeout(ui.resetTimer); ui.resetArmed = false; ui.icsEdit = false; },
  });
})();
