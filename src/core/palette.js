/* Toledo+ — TP.palette: the ⌘K command palette. Searches navigation, courses, documents in all
   course trees (TP.index), deadlines and announcements. Opened by the shell (⌘K / Ctrl+K, '/', the ⌘K
   button in the toolbar field, "Zoek overal" in the phone More sheet). A modal <dialog> inside the shell's
   shadow root: combobox input + listbox (aria-activedescendant), ↑/↓ move, ↵ open, ⌘↵ download a file,
   Esc closes and returns focus. The toolbar search field keeps filtering the current view. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const icon = (n, o) => TP.ui.icon(n, o);

  const PER_GROUP = 8;
  const NAV = ['overview', 'courses', 'deadlines', 'agenda', 'announcements', 'kuloket', 'settings'];
  const KIND_ICON = { file: 'doc', video: 'film', image: 'image', page: 'page', assignment: 'task', link: 'link', tool: 'tool', folder: 'folder', announcement: 'megaphone', notice: 'bell' };
  const FILE_KINDS = new Set(['file', 'video', 'image']);

  let dlg = null;
  let opener = null;
  let items = [];       // flat list of results in display order
  let active = -1;
  let q = '';
  let unsubIndex = null;
  let announceTimer = 0;

  const safe = (fn, fb) => { try { return fn(); } catch (_) { return fb; } };
  const isOpen = () => !!(dlg && dlg.open);
  const onUltra = () => TP.shell.origin === 'ultra';

  // ---------------------------------------------------------------- DOM
  function build() {
    const app = TP.shell.app;
    if (!app) return null;
    if (dlg && dlg.isConnected && app.contains(dlg)) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'tp-palette tp-glass';
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'tp-pal-title');
    dlg.innerHTML = `
<h2 class="tp-sr" id="tp-pal-title">${esc(t('palette.title'))}</h2>
<div class="tp-pal-field">
  ${icon('search', { size: 18, strokeWidth: 2.1 })}
  <input type="text" class="tp-pal-input" role="combobox" aria-expanded="true" aria-controls="tp-pal-list" aria-autocomplete="list"
    aria-labelledby="tp-pal-title" aria-describedby="tp-pal-status" placeholder="${esc(t('palette.placeholder'))}" autocomplete="off" spellcheck="false" enterkeyhint="go">
  <button type="button" class="tp-pal-close" data-pal="close" aria-label="${esc(t('shell.close'))}"><span class="tp-pal-esc" aria-hidden="true">esc</span>${icon('xmark', { size: 18, cls: 'tp-pal-x' })}</button>
</div>
<div class="tp-pal-list" id="tp-pal-list" role="listbox" aria-label="${esc(t('palette.results'))}"></div>
<div class="tp-pal-foot">
  <p class="tp-pal-status" id="tp-pal-status"></p>
  <p class="tp-pal-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('palette.hint.move'))}</span><span><kbd>↵</kbd> ${esc(t('palette.hint.open'))}</span><span><kbd>${esc(TP.shell.mod.trim())}↵</kbd> ${esc(t('palette.hint.download'))}</span></p>
</div>`;
    app.appendChild(dlg);
    const input = dlg.querySelector('.tp-pal-input');
    input.addEventListener('input', () => { q = input.value; update(); });
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('pointermove', onPointer);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
    return dlg;
  }

  // ---------------------------------------------------------------- data
  function scored(list, q, fn, cap = PER_GROUP) {
    const out = [];
    for (const x of list) {
      const [title, extra] = fn(x);
      const s = TP.index.score(q, title, extra);
      if (s >= 0) out.push({ x, s, title });
    }
    return out.sort((a, b) => b.s - a.s || a.title.length - b.title.length).slice(0, cap);
  }

  function navItem(route) {
    return { type: 'nav', route, title: t('nav.' + route), sub: '', icon: route };
  }

  function collect(query) {
    const groups = [];
    const words = String(query || '').trim();
    if (!words) {
      const recent = safe(() => (TP.state.get().recent || []).slice(0, 6), []);
      if (recent.length) {
        groups.push({ id: 'recent', title: t('palette.group.recent'), items: recent.map((r) => ({
          type: 'recent', url: r.url, title: r.title, sub: r.courseName || '', icon: KIND_ICON[r.kind] || 'doc', kind: r.kind,
        })) });
      }
      groups.push({ id: 'nav', title: t('palette.group.nav'), items: NAV.map(navItem) });
      return groups;
    }
    const nav = scored(NAV, words, (r) => [t('nav.' + r), [r === 'settings' ? t('palette.settingsWords') : '']]).map((h) => navItem(h.x));
    if (nav.length) groups.push({ id: 'nav', title: t('palette.group.nav'), items: nav });

    const courses = scored(safe(() => TP.data.courses({}), []), words, (c) => [c.name, [c.code, c.title]]).map(({ x: c }) => ({
      type: 'course', luId: c.luId, title: c.name, sub: c.code || '', color: c.color,
    }));
    if (courses.length) groups.push({ id: 'courses', title: t('palette.group.courses'), items: courses });

    const docs = safe(() => TP.index.search(words, { limit: PER_GROUP }), []).map((d) => ({
      type: 'doc', cid: d.cid, luId: d.luId, id: d.id, kind: d.kind, title: d.title, course: d.course,
      sub: [kindLabel(d), d.course, d.path].filter(Boolean).join(' · '), icon: KIND_ICON[d.kind] || 'doc',
    }));
    if (docs.length) groups.push({ id: 'docs', title: t('palette.group.docs'), items: docs });

    const dls = scored(safe(() => TP.data.deadlines({}), []), words, (d) => [d.title, [d.courseName]]).map(({ x: d }) => ({
      type: 'deadline', url: d.url, title: d.title,
      sub: [d.courseName, `${TP.fmt.date(d.due, { weekday: 'short', day: 'numeric', month: 'short' })} ${TP.fmt.time(d.due)}`, d.due < Date.now() && !d.done ? t('palette.overdue') : ''].filter(Boolean).join(' · '),
      icon: 'deadlines',
    }));
    if (dls.length) groups.push({ id: 'deadlines', title: t('palette.group.deadlines'), items: dls });

    const anns = scored(safe(() => TP.data.announcements({ filter: 'all' }), []), words, (e) => [e.title || '', [TP.util.courseName(e.source || '')]]).map(({ x: e }) => ({
      type: 'announcement', ev: e, url: e.url, title: e.title || '',
      sub: [e.subType === 'advalvas' || e.type === 'advalvas' ? t('palette.school') : TP.util.courseName(e.source || ''), e.date ? TP.fmt.ago(e.date) : ''].filter(Boolean).join(' · '),
      icon: e.subType === 'advalvas' || e.type === 'advalvas' ? 'bell' : 'megaphone',
    }));
    if (anns.length) groups.push({ id: 'announcements', title: t('palette.group.announcements'), items: anns });
    return groups;
  }

  function kindLabel(d) {
    if (d.kind === 'file') {
      const ext = String(d.title || '').split('.').pop();
      if (ext && ext !== d.title && ext.length <= 5) return ext.toUpperCase();
    }
    return t('course.kind.' + d.kind);
  }

  // ---------------------------------------------------------------- render
  function optionHtml(it, i) {
    const lead = it.type === 'course'
      ? `<span class="tp-pal-tile tp-pal-tile-dot">${TP.ui.dot(it.color)}</span>`
      : `<span class="tp-pal-tile">${icon(it.icon || 'doc', { size: 16 })}</span>`;
    const isFile = it.type === 'doc' && FILE_KINDS.has(it.kind);
    return `<div class="tp-pal-opt" role="option" id="tp-pal-o${i}" data-i="${i}" aria-selected="false"${isFile ? ' data-file="1"' : ''}>
  ${lead}<span class="tp-pal-main"><span class="tp-pal-name">${esc(it.title)}</span>${it.sub ? `<span class="tp-pal-sub">${esc(it.sub)}</span>` : ''}</span>
  <span class="tp-pal-enter" aria-hidden="true">${isFile ? `<kbd>${esc(TP.shell.mod.trim())}↵</kbd> ${icon('download', { size: 13 })}` : '<kbd>↵</kbd>'}</span>
</div>`;
  }

  function render(groups) {
    const list = dlg.querySelector('.tp-pal-list');
    const prevKey = items[active] ? keyOf(items[active]) : null;
    items = [];
    let html = '';
    for (const g of groups) {
      const start = items.length;
      items.push(...g.items);
      html += `<div class="tp-pal-group" role="group" aria-labelledby="tp-pal-g-${g.id}"><div class="tp-pal-head" id="tp-pal-g-${g.id}" role="presentation">${esc(g.title)}</div>${g.items.map((it, k) => optionHtml(it, start + k)).join('')}</div>`;
    }
    if (!items.length) {
      html = `<div class="tp-pal-empty" role="presentation">${TP.ui.noResults(q.trim())}</div>`;
    }
    list.innerHTML = html;
    const keep = prevKey ? items.findIndex((it) => keyOf(it) === prevKey) : -1;
    setActive(keep >= 0 ? keep : (items.length ? 0 : -1), false);
    status();
  }
  const keyOf = (it) => [it.type, it.route, it.luId, it.cid, it.id, it.url, it.title].join('|');

  function setActive(i, scroll = true) {
    active = i;
    const input = dlg.querySelector('.tp-pal-input');
    dlg.querySelectorAll('.tp-pal-opt[aria-selected="true"]').forEach((o) => o.setAttribute('aria-selected', 'false'));
    const el = i >= 0 ? dlg.querySelector(`#tp-pal-o${i}`) : null;
    if (el) {
      el.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', el.id);
      if (scroll) el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function status() {
    const el = dlg && dlg.querySelector('.tp-pal-status');
    if (el) el.textContent = safe(() => TP.index.statusText(), '');
  }

  const update = TP.util.debounce(() => {
    if (!isOpen()) return;
    render(collect(q));
    clearTimeout(announceTimer);
    if (q.trim()) announceTimer = setTimeout(() => TP.shell.announce(items.length ? t('shell.results', { n: items.length }) : t('common.noResults', { q: q.trim() })), 600);
  }, 60);

  // ---------------------------------------------------------------- actions
  async function activate(it, opts = {}) {
    if (!it) return;
    const mod = !!opts.download;
    const S = TP.shell;
    if (it.type === 'nav') { close(false); S.navigate(it.route); return; }
    if (it.type === 'course') {
      close(false);
      const cid = safe(() => (TP.state.get().cidMap || {})[it.luId], null);
      if (onUltra() && cid) S.navigate('course', { cid }); else S.navigate('course', { luId: it.luId });
      return;
    }
    if (it.type === 'doc') {
      const recent = { title: it.title, url: TP.data.ultraItemUrl(it.cid, it.id), courseName: it.course || '', courseLuId: it.luId || '', kind: it.kind };
      safe(() => Promise.resolve(TP.data.addRecent(recent)).catch(() => {}));
      if (FILE_KINDS.has(it.kind)) {
        close(false);
        // Both keep the key press' user activation for window.open / the download.
        if (mod) Promise.resolve(TP.data.ultraDownload(it.cid, it.id)).catch(() => S.toast(t('course.downloadFailed')));
        else Promise.resolve(TP.data.ultraOpen(it.cid, it.id)).catch(() => S.toast(t('course.openFailed')));
        return;
      }
      close(false);
      await openInCourse(it);
      return;
    }
    if (it.type === 'announcement' && it.ev) safe(() => Promise.resolve(TP.data.markRead([it.ev])).catch(() => {}));
    if (it.type === 'deadline' || it.type === 'announcement' || it.type === 'recent') {
      close(false);
      if (it.url) location.assign(TP.util.abs(it.url));
      else S.navigate(it.type === 'deadline' ? 'deadlines' : 'announcements');
    }
  }

  /** Folders/pages/assignments: open the course view, unfold the containing folders, highlight the row.
   *  The target travels in state.focus (chrome.storage.local, shared by both origins). */
  async function openInCourse(it) {
    const focus = { cid: it.cid, luId: it.luId || '', id: it.id, at: Date.now() };
    try { await TP.state.set({ focus }); } catch (_) { /* best effort */ }
    const r = TP.shell.route;
    const here = r && r.route === 'course' && ((r.params.cid && r.params.cid === it.cid) || (r.params.luId && r.params.luId === it.luId));
    if (here) { TP.shell.rerender(); return; }
    location.assign(TP.shell.href('course', { cid: it.cid, focus: it.id }));
  }

  // ---------------------------------------------------------------- events
  function onKey(ev) {
    const n = items.length;
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); if (n) setActive((active + 1) % n); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); if (n) setActive((active - 1 + n) % n); return; }
    if (ev.key === 'PageDown' || ev.key === 'PageUp') {
      ev.preventDefault();
      if (n) setActive(Math.max(0, Math.min(n - 1, active + (ev.key === 'PageDown' ? 5 : -5))));
      return;
    }
    if (ev.key === 'Enter' && !ev.isComposing) {
      if (ev.target.closest && ev.target.closest('[data-pal="close"]')) return;
      ev.preventDefault();
      activate(items[active], { download: mod });
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key === 'Tab') {
      // Focus trap: input ↔ close button.
      const f = [...dlg.querySelectorAll('input, button')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const root = dlg.getRootNode();
      const i = f.indexOf(root.activeElement);
      ev.preventDefault();
      f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }

  function onClick(ev) {
    if (ev.target === dlg) { close(); return; } // backdrop
    if (ev.target.closest('[data-pal="close"]')) { close(); return; }
    const o = ev.target.closest('.tp-pal-opt');
    if (o) activate(items[Number(o.dataset.i)], { download: ev.metaKey || ev.ctrlKey });
  }

  function onPointer(ev) {
    const o = ev.target.closest && ev.target.closest('.tp-pal-opt');
    if (o && Number(o.dataset.i) !== active) setActive(Number(o.dataset.i), false);
  }

  // ---------------------------------------------------------------- open / close
  function open(opts = {}) {
    if (!build()) return false;
    const root = dlg.getRootNode();
    opener = opts.opener || root.activeElement || null;
    const input = dlg.querySelector('.tp-pal-input');
    if (!dlg.open) {
      q = opts.q || '';
      input.value = q;
      items = []; active = -1;
      try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
      render(collect(q));
      unsubIndex = safe(() => TP.index.on('change', () => { if (isOpen()) { status(); if (q.trim()) update(); } }), null);
      safe(() => TP.index.crawlIfStale().catch(() => {}));
    }
    input.focus();
    input.select();
    return true;
  }

  function close(returnFocus = true) {
    if (!dlg || !dlg.open) return false;
    try { dlg.close(); } catch (_) { dlg.removeAttribute('open'); }
    if (unsubIndex) { unsubIndex(); unsubIndex = null; }
    clearTimeout(announceTimer);
    if (returnFocus && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
    return true;
  }

  TP.palette = { open, close, isOpen, _collect: collect };
})();
