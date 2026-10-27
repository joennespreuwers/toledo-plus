/* Toledo+ — TP.palette: the ⌘K command palette. Searches navigation, courses, documents in all
   course trees (TP.index), the contents of indexed files (TP.fulltext, opt-in), deadlines and announcements. Opened by the shell (⌘K / Ctrl+K, '/', the ⌘K
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
  const MAX_GROUP = 50;   // a group opened with "+N more"
  const NAV = ['overview', 'courses', 'deadlines', 'agenda', 'announcements', 'kuloket', 'settings'];
  const KIND_ICON = { file: 'doc', video: 'film', image: 'image', page: 'page', assignment: 'task', link: 'link', tool: 'tool', folder: 'folder', announcement: 'megaphone', notice: 'bell' };
  const FILE_KINDS = new Set(['file', 'video', 'image']);

  let dlg = null;
  let opener = null;
  let items = [];       // flat list of results in display order
  let active = -1;
  let q = '';
  let unsubIndex = null;
  let unsubFt = null;
  let ft = { q: null, items: [] };   // full-text results for query ft.q (async: they arrive after the sync groups)
  let ftWant = null;                 // query whose full-text search is in flight
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
    aria-labelledby="tp-pal-title" aria-describedby="tp-pal-status" maxlength="200" placeholder="${esc(t('palette.placeholder'))}" autocomplete="off" spellcheck="false" enterkeyhint="go">
  <button type="button" class="tp-pal-close" data-pal="close" aria-label="${esc(t('shell.close'))}"><span class="tp-pal-esc" aria-hidden="true">esc</span>${icon('xmark', { size: 18, cls: 'tp-pal-x' })}</button>
</div>
<div class="tp-pal-list" id="tp-pal-list" role="listbox" aria-label="${esc(t('palette.results'))}"></div>
<div class="tp-pal-foot">
  <p class="tp-pal-status" id="tp-pal-status"></p>
  <p class="tp-pal-hints" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('palette.hint.move'))}</span><span><kbd>↵</kbd> ${esc(t('palette.hint.open'))}</span><span><kbd>${esc(TP.shell.mod)}↵</kbd> ${esc(t('palette.hint.download'))}</span></p>
</div>`;
    app.appendChild(dlg);
    const input = dlg.querySelector('.tp-pal-input');
    input.addEventListener('input', () => { q = input.value; expanded = new Set(); update(); });
    dlg.addEventListener('keydown', onKey);
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('pointermove', onPointer);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
    return dlg;
  }

  // ---------------------------------------------------------------- data
  // Matching is TP.index's (one matcher for every search surface): accents, word order, course codes with or
  // without a space, dates ("morgen", "28 okt"), and one typo per long word when nothing matches exactly.
  const allLangs = (key) => safe(() => TP.i18n.LANGS.map((l) => TP.i18n._table[l][key]).filter(Boolean), []);
  // Settings sections the palette can jump to (TP-173): section id in src/views/settings.js → the labels inside it.
  const SETTINGS = {
    lang: ['settings.lang', 'settings.lang.label'],
    look: ['settings.look', 'settings.appearance', 'settings.accent', 'settings.density'],
    overview: ['settings.overview', 'settings.start.label', 'settings.feed.ann', 'settings.feed.max', 'settings.sections.title'],
    dl: ['settings.dl', 'settings.dl.horizon', 'settings.dl.urgent', 'settings.dl.reminder'],
    courses: ['settings.courses', 'settings.courses.edit'],
    agenda: ['settings.agenda', 'settings.agenda.ics'],
    search: ['settings.search', 'settings.search.index', 'settings.search.rebuild', 'fulltext.setting'],
    sync: ['settings.sync', 'settings.sync.read'],
    advanced: ['settings.advanced', 'settings.wrap.portal', 'settings.wrap.courses', 'settings.wrap.deepBar', 'settings.data.export', 'settings.data.import', 'settings.data.reset'],
    about: ['settings.about', 'settings.about.version', 'telemetry.setting.label', 'telemetry.update.label', 'feedback.menu'],
  };
  let expanded = new Set();   // groups opened with "+N more" for the current query
  let teachersBy = null;      // luId → teacher names (KU Loket lessons around today), once per palette session

  /** Every hit of `list` for query Q, best first: [{x, s, title}]. fn(x) → [title, extra strings]. */
  function scored(list, Q, fn, fuzzy) {
    const out = [];
    for (const x of list) {
      const [title, extra] = fn(x);
      const s = TP.index.score(Q, title, extra, { fuzzy });
      if (s >= 0) out.push({ x, s, title });
    }
    return out.sort((a, b) => b.s - a.s || a.title.length - b.title.length);
  }
  /** A result group capped at PER_GROUP rows, plus a "+N more" row that shows the rest (TP-112). */
  function capped(id, title, hits, map, total = hits.length) {
    const cap = expanded.has(id) ? MAX_GROUP : PER_GROUP;
    const items = hits.slice(0, cap).map(map);
    if (total > items.length && items.length < MAX_GROUP) items.push({ type: 'more', group: id, title: t('palette.more', { n: total - items.length }), sub: '', icon: 'chevronDown' });
    return { id, title, items };
  }

  function navItem(route) {
    return { type: 'nav', route, title: t('nav.' + route), sub: '', icon: route };
  }

  /** Teachers per course from the KU Loket lessons around today (already cached by Overzicht/Agenda). */
  function teachers() {
    if (teachersBy) return teachersBy;
    teachersBy = {};
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const list = safe(() => TP.kuloket.peekLessons({ from: from.getTime() - 7 * 864e5, to: from.getTime() + 14 * 864e5 }), null) || [];
    for (const l of list) {
      if (!l || !l.courseLuId || !Array.isArray(l.teachers)) continue;
      const set = (teachersBy[l.courseLuId] ||= new Set());
      l.teachers.forEach((x) => x && set.add(x));
    }
    return teachersBy;
  }

  function collect(query) {
    const groups = [];
    const words = String(query || '').trim();
    const Q = TP.index.query(words);
    if (!Q.words.length) {
      const recent = safe(() => (TP.state.get().recent || []).slice(0, 6), []);
      if (recent.length) {
        groups.push({ id: 'recent', title: t('palette.group.recent'), items: recent.map((r) => ({
          type: 'recent', url: r.url, title: r.title, sub: r.courseName || '', icon: KIND_ICON[r.kind] || 'doc', kind: r.kind,
        })) });
      }
      groups.push({ id: 'nav', title: t('palette.group.nav'), items: NAV.map(navItem) });
      return groups;
    }
    const exact = groupsFor(Q, words, false);
    if (exact.length || !Q.words.some((w) => w.length >= 5)) return exact;
    const near = groupsFor(Q, words, true); // nothing at all: allow one typo per word of 5+ letters (TP-175)
    near.approx = near.length > 0;
    return near;
  }

  function groupsFor(Q, words, fuzzy) {
    const groups = [];
    const add = (g) => { if (g.items.length) groups.push(g); };
    // Navigation: the view names in every language (TP-032); Settings also by its keywords.
    add(capped('nav', t('palette.group.nav'), scored(NAV, Q, (r) => [t('nav.' + r), [...allLangs('nav.' + r), ...(r === 'settings' ? allLangs('palette.settingsWords') : [])]], fuzzy), (h) => navItem(h.x)));

    const tb = teachers();
    add(capped('courses', t('palette.group.courses'), scored(safe(() => TP.data.courses({}), []), Q, (c) => [c.name, [TP.index.hayOf.course({ ...c, teachers: [...(tb[c.luId] || [])] })]], fuzzy), ({ x: c }) => ({
      type: 'course', luId: c.luId, title: c.name, sub: c.code || '', color: c.color,
    })));

    const total = {};
    const docs = safe(() => TP.index.search(Q, { limit: expanded.has('docs') ? MAX_GROUP : PER_GROUP, fuzzy, total }), []);
    add(capped('docs', t('palette.group.docs'), docs, (d) => ({
      type: 'doc', cid: d.cid, luId: d.luId, id: d.id, kind: d.kind, title: d.title, course: d.course,
      sub: [kindLabel(d), d.course, d.path].filter(Boolean).join(' · '), icon: KIND_ICON[d.kind] || 'doc',
    }), total.n || docs.length));

    if (!fuzzy) add({ id: 'files', title: t('palette.group.files'), items: ftItems(words) });

    add(capped('deadlines', t('palette.group.deadlines'), scored(safe(() => TP.data.deadlines({}), []), Q, (d) => [d.title, [TP.index.hayOf.deadline(d)]], fuzzy), ({ x: d }) => ({
      type: 'deadline', url: d.url, title: d.title,
      sub: [d.courseName, `${TP.fmt.date(d.due, { weekday: 'short', day: 'numeric', month: 'short' })} ${TP.fmt.time(d.due)}`, d.due < Date.now() && !d.done ? t('palette.overdue') : ''].filter(Boolean).join(' · '),
      icon: 'deadlines',
    })));

    add(capped('announcements', t('palette.group.announcements'), scored(safe(() => TP.data.announcements({ filter: 'all' }), []), Q, (e) => [e.title || '', [TP.index.hayOf.announcement(e)]], fuzzy), ({ x: e }) => ({
      type: 'announcement', ev: e, url: e.url, title: e.title || '',
      sub: [e.subType === 'advalvas' || e.type === 'advalvas' ? t('palette.school') : TP.util.courseName(e.source || ''), e.author || '', e.date ? TP.fmt.ago(e.date) : ''].filter(Boolean).join(' · '),
      icon: e.subType === 'advalvas' || e.type === 'advalvas' ? 'bell' : 'megaphone',
    })));

    // KU Loket apps (TP-031): the hub's entries, by name and description in every language.
    add(capped('kuloket', t('nav.kuloket'), scored(safe(() => TP.kuloket.links(), []), Q, (l) => [l.title, [l.desc, ...allLangs('kuloket.app.' + l.id), ...allLangs('kuloket.app.' + l.id + '.desc')]], fuzzy), ({ x: l }) => ({
      type: 'kuloket', url: l.url, title: l.title, sub: l.desc, icon: 'kuloket',
    })));

    // Settings, per section (TP-173): "iCal" → Agenda, "reset" → Geavanceerd, "full text" → Zoeken.
    add(capped('settings', t('palette.group.settings'), scored(Object.keys(SETTINGS), Q, (id) => [t('settings.' + id), [...SETTINGS[id].flatMap(allLangs), ...allLangs('palette.set.' + id)]], fuzzy), ({ x: id }) => {
      const hit = SETTINGS[id].slice(1).map((k) => t(k)).find((l) => TP.index.score(Q, l, [], { fuzzy }) >= 0);
      return { type: 'setting', sec: id, title: t('settings.' + id), sub: [t('nav.settings'), hit].filter(Boolean).join(' · '), icon: 'settings' };
    }));
    return groups;
  }

  /** "In bestanden": full-text hits for `words` (cached per query; a search is started when missing and the list
   *  re-renders when it arrives — typing is never blocked). */
  function ftItems(words) {
    const F = TP.fulltext;
    if (!F || !F.enabled()) return [];
    if (ft.q !== words) {
      if (ftWant !== words) {
        ftWant = words;
        F.search(words, { limit: PER_GROUP }).then((hits) => {
          if (ftWant !== words) return;
          ftWant = null;
          ft = { q: words, items: hits || [] };
          if (isOpen() && q.trim() === words) render(collect(q));
        });
      }
      return [];
    }
    return ft.items.map((h) => ({
      type: 'ft', hit: h, cid: h.cid, luId: h.luId, id: h.id, kind: 'file', title: h.title, course: h.course, page: h.page,
      sub: [h.course, F.where(h)].filter(Boolean).join(' · '), snip: F.snippetHtml(h.snippet), icon: 'doc',
    }));
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
    const isFile = (it.type === 'doc' && FILE_KINDS.has(it.kind)) || it.type === 'ft';
    const snip = it.type === 'ft' && it.snip ? `<span class="tp-pal-sub tp-pal-snip">${it.snip}</span>` : ''; // segments escaped by TP.fulltext.snippetHtml
    return `<div class="tp-pal-opt${it.type === 'ft' ? ' tp-pal-opt-ft' : ''}" role="option" id="tp-pal-o${i}" data-i="${i}" aria-selected="false"${isFile ? ' data-file="1"' : ''}>
  ${lead}<span class="tp-pal-main"><span class="tp-pal-name">${esc(it.title)}</span>${it.sub ? `<span class="tp-pal-sub">${esc(it.sub)}</span>` : ''}${snip}</span>
  <span class="tp-pal-enter" aria-hidden="true">${isFile ? `<kbd>${esc(TP.shell.mod)}↵</kbd> ${icon('download', { size: 13 })}` : '<kbd>↵</kbd>'}</span>
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
    if (items.length && groups.approx) {
      // only near matches (one typo): say so, the student may have meant something else
      html = `<p class="tp-pal-note" role="presentation">${esc(t('palette.approx'))}</p>${html}`;
    }
    if (!items.length) {
      // "still indexing" instead of a bare "No results" while the index fills (TP-030), and a next step (TP-032)
      const st = safe(() => TP.index.status(), {}) || {};
      const hints = [st.crawling ? t('palette.empty.indexing') : '', t('palette.empty.hint')].filter(Boolean);
      html = `<div class="tp-pal-empty" role="presentation">${TP.ui.noResults(q.trim())}${hints.map((h) => `<p class="tp-pal-hint">${esc(h)}</p>`).join('')}</div>`;
    }
    list.innerHTML = html;
    // the words that matched, marked in each title (TP-088); nothing for near matches
    safe(() => TP.index.highlight(list, groups.approx ? '' : q, '.tp-pal-name'));
    const keep = prevKey ? items.findIndex((it) => keyOf(it) === prevKey) : -1;
    setActive(keep >= 0 ? keep : (items.length ? 0 : -1), false);
    status();
  }
  const keyOf = (it) => [it.type, it.route, it.luId, it.cid, it.id, it.url, it.title, it.page, it.group, it.sec].join('|');

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
    if (!el) return;
    el.textContent = safe(() => TP.index.statusText(), '');
    const ftTxt = safe(() => (TP.fulltext ? TP.fulltext.statusText() : ''), '');
    if (ftTxt) {
      const s = document.createElement('span');
      s.className = 'tp-pal-ftstatus';
      s.textContent = (el.textContent ? ' · ' : '') + ftTxt;
      el.appendChild(s);
    }
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
    if (it.type === 'more') {
      // show the rest of that group; the first newly shown row becomes active
      const at = items.indexOf(it);
      expanded.add(it.group);
      render(collect(q));
      if (at >= 0 && at < items.length) setActive(at);
      dlg.querySelector('.tp-pal-input').focus();
      return;
    }
    if (it.type === 'nav') { close(false); S.navigate(it.route); return; }
    if (it.type === 'setting') { close(false); S.navigate('settings', { id: it.sec }); return; }
    if (it.type === 'kuloket') {
      close(false);
      safe(() => TP.kuloket.openedKuloket && TP.kuloket.openedKuloket());
      window.open(it.url, '_blank', 'noopener');
      return;
    }
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
    if (it.type === 'ft') {
      safe(() => Promise.resolve(TP.data.addRecent({ title: it.title, url: TP.data.ultraItemUrl(it.cid, it.id), courseName: it.course || '', courseLuId: it.luId || '', kind: 'file' })).catch(() => {}));
      close(false);
      // Both keep the key press' user activation (window.open / the download).
      if (mod) Promise.resolve(TP.data.ultraDownload(it.cid, it.id)).catch(() => S.toast(t('course.downloadFailed')));
      else TP.fulltext.open(it.hit);
      return;
    }
    if (it.type === 'announcement' && it.ev && TP.annSheet && !mod) {
      // The announcement sheet (src/views/announcements.js), stepping through this result group; it marks read itself.
      const list = items.filter((x) => x.type === 'announcement' && x.ev).map((x) => x.ev);
      const op = opener;
      close(false);
      TP.annSheet.open(it.ev, { list, opener: op });
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
      q = String(opts.q || '').slice(0, 200);
      input.value = q;
      items = []; active = -1;
      expanded = new Set(); teachersBy = null;
      try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
      // Back/Forward (or any route change) closes the palette instead of leaving it over another page (TP-033)
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('popstate', onRoute);
      render(collect(q));
      unsubIndex = safe(() => TP.index.on('change', () => { if (isOpen()) { status(); if (q.trim()) update(); } }), null);
      safe(() => TP.index.crawlIfStale().catch(() => {}));
      ft = { q: null, items: [] };
      if (TP.fulltext) {
        // new files indexed (here or in another tab) → refresh the footer and the "In bestanden" results
        unsubFt = safe(() => TP.fulltext.on('change', () => { if (isOpen()) { status(); ft = { q: null, items: [] }; if (q.trim()) update(); } }), null);
        safe(() => TP.fulltext.warm());
      }
    }
    input.focus();
    input.select();
    return true;
  }

  function onRoute() { close(false); }

  function close(returnFocus = true) {
    if (!dlg || !dlg.open) return false;
    try { dlg.close(); } catch (_) { dlg.removeAttribute('open'); }
    if (unsubIndex) { unsubIndex(); unsubIndex = null; }
    if (unsubFt) { unsubFt(); unsubFt = null; }
    window.removeEventListener('hashchange', onRoute);
    window.removeEventListener('popstate', onRoute);
    clearTimeout(announceTimer);
    if (returnFocus && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    opener = null;
    return true;
  }

  TP.palette = { open, close, isOpen, _collect: collect };
})();
