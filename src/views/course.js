/* Toledo+ — Course view (views-B).
   Route 'course' with {cid} (Ultra origin) or {luId} (resolved to a cid first).
   Header, recent items, full content tree (open folders remembered per course), deadlines,
   announcements and teachers. Renders progressively from TP.data.ultraCourse. */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});
  if (!TP.shell || !TP.shell.register) return;

  const t = (k, v) => TP.t(k, v);
  const esc = (s) => TP.util.esc(s);
  const ULTRA = 'https://ultra.edu.kuleuven.cloud';
  const DAY = 864e5;

  // Ultra sets <base href> to a CDN and we may also run on the portal: always build absolute Ultra URLs.
  const ultraAbs = (p) => (/^https?:/i.test(p || '') ? p : ULTRA + (String(p || '').startsWith('/') ? p : '/' + p));
  const cssEsc = (s) => (globalThis.CSS && CSS.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));
  const ms = (v) => { const n = typeof v === 'number' ? v : new Date(v || 0).getTime(); return Number.isFinite(n) ? n : 0; };

  const st = {
    key: null, cid: null, luId: null, token: 0,
    data: null, partial: true, error: null,
    prevVisit: 0, openIds: null, q: '',
    busy: new Set(), // content ids being downloaded
  };
  let cur = null;

  // ---------- tree helpers ----------
  const H = (n) => (n && n.contentHandler && n.contentHandler.id) || '';
  const isFolder = (n) => !!n && (n.hasChildren || Array.isArray(n.kids) || /x-bb-(folder|lesson|module)/.test(H(n)));
  const created = (n) => ms(n.created || n.modified);
  const isNew = (n) => !!st.prevVisit && ms(n.created) > st.prevVisit;
  function flatten(nodes, path = [], out = []) {
    for (const n of nodes || []) {
      if (isFolder(n)) flatten(n.kids, path.concat(n.title || ''), out);
      else out.push({ node: n, path });
    }
    return out;
  }
  const countLeaves = (n) => (isFolder(n) ? (n.kids || []).reduce((s, k) => s + countLeaves(k), 0) : 1);
  const newest = (n) => (isFolder(n) ? Math.max(ms(n.modified), ...(n.kids || []).map(newest)) : created(n));
  function findNode(id, nodes = st.data && st.data.roots) {
    for (const n of nodes || []) {
      if (n.id === id) return { node: n };
      const k = findNode(id, n.kids);
      if (k) return k;
    }
    return null;
  }
  function pathOf(id, nodes = st.data && st.data.roots, path = []) {
    for (const n of nodes || []) {
      if (n.id === id) return path;
      if (n.kids) { const p = pathOf(id, n.kids, path.concat(n.title || '')); if (p) return p; }
    }
    return null;
  }
  const itemLink = (n) => ultraAbs((n.links && n.links[0] && n.links[0].href) || `/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(st.cid)}&contentId=${encodeURIComponent(n.id)}`);

  const KIND_ICON = { file: 'doc', video: 'film', image: 'image', page: 'page', assignment: 'task', link: 'link', tool: 'tool', folder: 'folder', announcement: 'megaphone', notice: 'bell' };
  function kind(n) {
    let k = 'page';
    try { k = TP.data.kindOf(n) || 'page'; } catch { /* keep default */ }
    return k;
  }
  function kindLabel(n, k) {
    if (k === 'file') {
      const ext = String((n.contentHandler && n.contentHandler.file && n.contentHandler.file.fileName) || n.title || '').split('.').pop();
      if (ext && ext.length <= 5 && ext !== n.title) return ext.toUpperCase();
    }
    return t('course.kind.' + k);
  }

  // ---------- course meta ----------
  function courseModel() {
    const lu = st.luId || (st.data && st.data.course && st.data.course.courseId) || null;
    return lu && TP.data.course ? TP.data.course(lu) : null;
  }
  function courseName() {
    const c = courseModel();
    if (c && c.name) return c.name;
    const raw = st.data && st.data.course && st.data.course.name;
    return raw ? TP.util.courseName(raw) : '';
  }

  // ---------- focus / open state ----------
  function snapFocus(root) {
    const a = root.getRootNode().activeElement;
    if (!a || !root.contains(a)) return null;
    if (a.dataset && a.dataset.fk) return { fk: a.dataset.fk };
    const d = a.tagName === 'SUMMARY' && a.parentElement && a.parentElement.matches('details.cv-folder') ? a.parentElement : null;
    if (d) return { folder: d.dataset.id };
    return null;
  }
  function restoreFocus(root, f) {
    if (!f) return;
    const el = f.folder
      ? root.querySelector(`details.cv-folder[data-id="${cssEsc(f.folder)}"] > summary`)
      : root.querySelector(`[data-fk="${cssEsc(f.fk)}"]`);
    if (el) el.focus({ preventScroll: true });
  }
  function storedOpen(cid) {
    const all = (TP.state.get() || {}).openFolders || {};
    return Array.isArray(all[cid]) ? new Set(all[cid]) : null;
  }
  const persistOpen = TP.util.debounce(() => {
    if (!st.cid || !st.openIds) return;
    const all = { ...((TP.state.get() || {}).openFolders || {}) };
    all[st.cid] = [...st.openIds];
    Promise.resolve(TP.state.set({ openFolders: all })).catch(() => {});
  }, 400);

  // ---------- loading ----------
  function start(ctx) {
    const p = ctx.params || {};
    st.key = p.cid ? 'c:' + p.cid : 'l:' + (p.luId || '');
    st.cid = p.cid || null;
    st.luId = p.luId || null;
    st.data = null; st.partial = true; st.error = null; st.prevVisit = 0; st.openIds = null; st.busy.clear();
    const token = ++st.token;
    load(token);
  }

  async function load(token) {
    try {
      if (!st.cid) {
        if (!st.luId) throw Object.assign(new Error('no course'), { resolve: true });
        let cid = null;
        try { cid = await TP.data.resolveCourseId(st.luId); } catch { cid = null; }
        if (token !== st.token) return;
        if (!cid) throw Object.assign(new Error('resolve'), { resolve: true });
        st.cid = cid;
      }
      const cid = st.cid;
      st.prevVisit = ((TP.state.get() || {}).visits || {})[cid] || 0;
      st.openIds = storedOpen(cid);
      const res = await TP.data.ultraCourse(cid, (partial) => {
        if (token !== st.token || !partial) return;
        st.data = partial;
        st.partial = partial.partial !== false;
        paint();
      });
      if (token !== st.token) return;
      st.data = res || st.data;
      st.partial = false;
      if (!st.luId && st.data && st.data.course) st.luId = st.data.course.courseId || null;
      paint();
      const visits = { ...((TP.state.get() || {}).visits || {}), [cid]: Date.now() };
      await TP.state.set({ visits });
    } catch (e) {
      if (token !== st.token) return;
      st.error = e && e.resolve ? 'resolve' : 'load';
      st.partial = false;
      paint();
    }
  }

  // ---------- rendering ----------
  function spinner() { return '<span class="cv-spin" aria-hidden="true"></span>'; }

  function headerHtml() {
    const c = courseModel();
    const staff = (st.data && st.data.staff) || [];
    const teachers = staff.length ? `<ul class="cv-teachers" role="list">${staff.map((s) => `<li>${s.email
      ? `<a href="mailto:${esc(s.email)}" aria-label="${esc(t('course.mail', { name: s.name }))}">${TP.ui.icon('mail', { size: 14 })}<span>${esc(s.name)}</span></a>`
      : `<span>${esc(s.name)}</span>`}</li>`).join('')}</ul>` : '';

    let sub = '';
    if (st.data && !st.error) {
      if (st.partial) sub = `${spinner()}<span>${esc(t('course.loading'))}</span>`;
      else {
        const leaves = flatten(st.data.roots);
        const fresh = leaves.filter((x) => isNew(x.node)).length;
        sub = `<span>${esc(t('course.items', { n: leaves.length }))}</span>${fresh ? `<span class="cv-sub-new">${TP.ui.dot('var(--tint)')}<strong>${esc(t('course.newSince', { n: fresh }))}</strong></span>` : ''}`;
      }
    }
    const pinned = !!(c && c.pinned);
    const lu = st.luId || (c && c.luId);
    const actions = `
      ${lu ? `<button type="button" class="cv-btn" data-action="pin" data-fk="pin" aria-pressed="${pinned}">${TP.ui.icon(pinned ? 'pinFill' : 'pin', { size: 16 })}<span>${esc(t('course.pin'))}</span></button>` : ''}
      <button type="button" class="cv-btn" data-action="classic" data-fk="classic">${TP.ui.icon('external', { size: 16 })}<span>${esc(t('course.classic'))}</span></button>`;
    return `
      <header class="cv-head">
        <div class="cv-head-main">
          <p class="cv-sub">${c && c.color ? TP.ui.dot(c.color) : ''}${sub || (st.error ? '' : `${spinner()}<span>${esc(t('course.loading'))}</span>`)}</p>
          ${teachers}
        </div>
        <div class="cv-actions">${actions}</div>
      </header>`;
  }

  function leafHtml(x, opts = {}) {
    const n = x.node;
    const k = kind(n);
    const label = kindLabel(n, k);
    const date = created(n);
    const pathTxt = x.path.filter(Boolean).join(' › ');
    const meta = [label, date ? TP.fmt.ago(date) : '', opts.showPath ? pathTxt : ''].filter(Boolean).join(' · ');
    const lq = esc([n.title, label, pathTxt].join(' ').toLowerCase());
    const fresh = isNew(n);
    const dot = `<span class="cv-new">${fresh ? `<span class="cv-new-dot" role="img" aria-label="${esc(t('course.new'))}"></span>` : ''}</span>`;
    const ico = `<span class="cv-ico cv-ico-${esc(k)}">${TP.ui.icon(KIND_ICON[k] || 'doc', { size: 16 })}</span>`;
    const main = `<span class="cv-main"><span class="cv-name" title="${esc(n.title)}">${esc(n.title)}</span><span class="cv-meta">${esc(meta)}</span></span>`;
    const depth = Math.min(opts.depth || 0, 3);
    const h = H(n);
    const fk = (opts.showPath ? 'r:' : 't:') + n.id;

    if (h === 'resource/x-bb-file' || ((k === 'file' || k === 'video' || k === 'image') && !/link/.test(h))) {
      const busy = st.busy.has(n.id);
      return `
        <div class="cv-row cv-leaf" data-lq="${lq}" style="--depth:${depth}">
          <button type="button" class="cv-row-main" data-action="open" data-id="${esc(n.id)}" data-fk="o${fk}" aria-label="${esc(t('course.open', { title: n.title }))}">${dot}${ico}${main}</button>
          <button type="button" class="cv-mini" data-action="download" data-id="${esc(n.id)}" data-fk="d${fk}" aria-label="${esc(t('course.download', { title: n.title }))}" ${busy ? 'aria-busy="true" disabled' : ''}>${busy ? spinner() : TP.ui.icon('download', { size: 17 })}</button>
        </div>`;
    }
    if (h === 'resource/x-bb-document' && String(n.body || '').trim()) {
      return `
        <details class="cv-doc" data-keep="${esc(fk)}" data-lq="${esc([n.title, label, pathTxt, TP.util.plain(n.body)].join(' ').toLowerCase())}">
          <summary class="cv-row cv-row-main" style="--depth:${depth}" data-fk="s${fk}">${dot}${ico}${main}<span class="cv-chev">${TP.ui.icon('chevronRight', { size: 14 })}</span></summary>
          <div class="cv-doc-body" style="--depth:${depth}">
            <div class="cv-prose">${TP.util.sanitize(n.body)}</div>
            <a class="cv-doc-link" href="${esc(itemLink(n))}" data-recent="${esc(n.id)}">${esc(t('course.classic'))}</a>
          </div>
        </details>`;
    }
    const ext = h === 'resource/x-bb-externallink' && n.contentHandler && n.contentHandler.url ? n.contentHandler.url : null;
    const href = ext && /^https?:/i.test(ext) ? ext : itemLink(n);
    const blank = !!ext;
    return `
      <a class="cv-row cv-row-main cv-leaf" href="${esc(href)}" data-recent="${esc(n.id)}" data-lq="${lq}" data-fk="a${fk}" style="--depth:${depth}" ${blank ? 'target="_blank" rel="noopener"' : ''}>
        ${dot}${ico}${main}<span class="cv-trail">${TP.ui.icon(blank ? 'external' : 'chevronRight', { size: 14 })}${blank ? `<span class="cv-sr">${esc(t('course.newTab'))}</span>` : ''}</span>
      </a>`;
  }

  function folderHtml(n, path, depth, defaultOpen) {
    const loading = !Array.isArray(n.kids);
    const p2 = path.concat(n.title || '');
    const kids = (n.kids || []).map((k) => nodeHtml(k, p2, depth + 1, null)).join('');
    const fresh = !loading && flatten(n.kids).some((x) => isNew(x.node));
    const when = newest(n);
    const count = countLeaves(n);
    const open = st.openIds ? st.openIds.has(n.id) : defaultOpen === n.id;
    const meta = loading ? t('course.loadingFolder') : [t('course.items', { n: count }), when ? TP.fmt.ago(when) : ''].filter(Boolean).join(' · ');
    const d = Math.min(depth, 3);
    const leading = `<span class="cv-new">${fresh ? `<span class="cv-new-dot" role="img" aria-label="${esc(t('course.containsNew'))}"></span>` : ''}</span><span class="cv-ico cv-ico-folder">${TP.ui.icon('folder', { size: 16 })}</span>`;
    return TP.ui.disclosure({
      id: n.id,
      open,
      cls: 'cv-folder',
      attrs: { 'data-fq': p2.join(' ').toLowerCase(), style: `--depth:${d}` },
      summary: { leading, title: esc(n.title), strong: true, subtitle: `${loading ? spinner() : ''}${esc(meta)}` },
      body: kids || (loading ? '' : `<p class="cv-empty-folder">${esc(t('course.folderEmpty'))}</p>`),
    });
  }

  function nodeHtml(n, path, depth, defaultOpen) {
    return isFolder(n) ? folderHtml(n, path, depth, defaultOpen) : leafHtml({ node: n, path }, { depth });
  }

  function sec(id, title, body, opts = {}) {
    return `<div class="cv-sec" data-sec="${id}">${TP.ui.section({ id: 'cv-' + id, title: esc(title), count: opts.count, actions: opts.actions, body, footer: opts.footer })}</div>`;
  }

  function recentHtml() {
    if (st.partial) return '';
    const items = flatten(st.data.roots).sort((a, b) => created(b.node) - created(a.node)).slice(0, 5);
    if (!items.length) return '';
    return sec('recent', t('course.recent'), TP.ui.group(items.map((x) => leafHtml(x, { showPath: true })).join(''), { cls: 'cv-group' }));
  }

  function treeHtml() {
    const roots = st.data.roots || [];
    if (!roots.length) {
      return sec('content', t('course.content'), st.partial ? TP.ui.skeleton(5) : TP.ui.group(TP.ui.empty(t('course.noContent')), { cls: 'cv-group' }));
    }
    const latest = roots.filter(isFolder).sort((a, b) => newest(b) - newest(a))[0];
    const folderIds = [];
    (function walk(ns) { for (const n of ns || []) if (isFolder(n)) { folderIds.push(n.id); walk(n.kids); } })(roots);
    const openSet = st.openIds || new Set(latest ? [latest.id] : []);
    const allOpen = folderIds.length > 0 && folderIds.every((id) => openSet.has(id));
    const actions = folderIds.length ? [{ action: 'toggle-all', label: t(allOpen ? 'course.collapseAll' : 'course.expandAll'), attrs: { 'data-fk': 'toggle-all', 'data-open': allOpen ? '1' : '0' } }] : [];
    const body = `<div class="cv-tree" data-tree>${TP.ui.group(roots.map((n) => nodeHtml(n, [], 0, latest && latest.id)).join(''), { cls: 'cv-group' })}</div>`;
    return sec('content', t('course.content'), body, { actions });
  }

  function deadlinesHtml() {
    const s = TP.settings.get() || {};
    const urgentDays = (s.deadlines && s.deadlines.urgentDays) || 3;
    const lu = st.luId || (st.data && st.data.course && st.data.course.courseId);
    const list = [];
    for (const d of (st.data && st.data.deadlines) || []) list.push({ title: d.title, due: ms(d.due), url: d.url ? ultraAbs(d.url) : null, done: false });
    if (lu) {
      let all = [];
      try { all = TP.data.deadlines({ includeDone: true }) || []; } catch { all = []; }
      for (const d of all) if (d.courseLuId === lu) list.push({ title: d.title, due: ms(d.due), url: d.url, done: !!d.done });
    }
    const seen = new Map();
    for (const d of list) {
      if (!d.due) continue;
      const k = String(d.title || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + TP.fmt.dayKey(d.due);
      const prev = seen.get(k);
      if (!prev) seen.set(k, d); else { prev.done = prev.done || d.done; prev.url = prev.url || d.url; }
    }
    const now = Date.now();
    const all = [...seen.values()].sort((a, b) => a.due - b.due);
    const up = all.filter((d) => d.due >= now - DAY / 2);
    const past = all.filter((d) => d.due < now - DAY / 2).slice(-2).reverse();
    const row = (d) => {
      const overdue = !d.done && d.due < now;
      const urgent = !d.done && !overdue && TP.fmt.daysUntil(d.due) <= urgentDays;
      const tone = d.done || (d.due < now - DAY / 2 && !overdue) ? 'muted' : overdue ? 'overdue' : urgent ? 'urgent' : 'normal';
      const trail = overdue
        ? `<span class="cv-due is-overdue">${TP.ui.icon('clock', { size: 13 })}${esc(t('course.overdue'))}</span>`
        : `<span class="cv-due${urgent ? ' is-urgent' : ''}">${urgent ? TP.ui.icon('clock', { size: 13 }) : ''}${esc(TP.fmt.rel(d.due))}</span>`;
      const inner = `${TP.ui.dateTile(d.due, { tone })}
        <span class="cv-main"><span class="cv-name cv-strong" title="${esc(d.title)}">${esc(d.title)}</span>
        <span class="cv-meta">${esc(TP.fmt.date(d.due, { weekday: 'long' }))} · ${esc(TP.fmt.time(d.due))}</span></span>${trail}`;
      const lq = esc(String(d.title || '').toLowerCase());
      return d.url
        ? `<a class="cv-row cv-row-main cv-dl${d.done ? ' is-done' : ''}" href="${esc(d.url)}" data-lq="${lq}">${inner}</a>`
        : `<div class="cv-row cv-dl${d.done ? ' is-done' : ''}" data-lq="${lq}">${inner}</div>`;
    };
    const rows = up.map(row).join('') + past.map(row).join('');
    return sec('deadlines', t('course.deadlines'), TP.ui.group(rows || TP.ui.empty(t('course.noDeadlines')), { cls: 'cv-group' }));
  }

  function announcementsHtml() {
    const items = ((st.data && st.data.announcements) || []).filter((a) => !a.draft).slice().sort((a, b) => ms(b.created) - ms(a.created)).slice(0, 8);
    const rows = items.map((a, i) => {
      const when = ms(a.created);
      const fresh = !!st.prevVisit && when > st.prevVisit;
      return `
        <details class="cv-ann" data-keep="an:${esc(a.id)}" data-lq="${esc((String(a.title || '') + ' ' + TP.util.plain(a.body || '')).toLowerCase())}" ${i === 0 && fresh ? 'open' : ''}>
          <summary class="cv-row cv-row-main" data-fk="an:${esc(a.id)}">
            <span class="cv-new">${fresh ? `<span class="cv-new-dot" role="img" aria-label="${esc(t('course.new'))}"></span>` : ''}</span>
            <span class="cv-main"><span class="cv-name${fresh ? ' cv-strong' : ''}" title="${esc(a.title)}">${esc(a.title)}</span><span class="cv-meta">${esc(when ? TP.fmt.ago(when) : '')}</span></span>
            <span class="cv-chev">${TP.ui.icon('chevronRight', { size: 14 })}</span>
          </summary>
          <div class="cv-doc-body"><div class="cv-prose">${TP.util.sanitize(a.body || '')}</div></div>
        </details>`;
    }).join('');
    return sec('announcements', t('course.announcements'), TP.ui.group(rows || TP.ui.empty(t('course.noAnnouncements')), { cls: 'cv-group' }));
  }

  function teachersHtml() {
    const staff = (st.data && st.data.staff) || [];
    if (!staff.length) return st.partial ? '' : sec('teachers', t('course.teachers'), TP.ui.group(TP.ui.empty(t('course.noTeachers')), { cls: 'cv-group' }));
    const rows = staff.map((s) => {
      const lq = esc(String(s.name || '').toLowerCase());
      const inner = `<span class="cv-ico">${TP.ui.icon('mail', { size: 16 })}</span><span class="cv-main"><span class="cv-name">${esc(s.name)}</span>${s.email ? `<span class="cv-meta">${esc(s.email)}</span>` : ''}</span>`;
      return s.email
        ? `<a class="cv-row cv-row-main" href="mailto:${esc(s.email)}" data-lq="${lq}" aria-label="${esc(t('course.mail', { name: s.name }))}">${inner}</a>`
        : `<div class="cv-row" data-lq="${lq}">${inner}</div>`;
    }).join('');
    return sec('teachers', t('course.teachers'), TP.ui.group(rows, { cls: 'cv-group' }));
  }

  function paint() {
    const ctx = cur;
    if (!ctx) return;
    const root = ctx.root;
    const focus = snapFocus(root);
    // Keep folders the user opened during a progressive load (before openIds existed).
    if (!st.openIds && !st.q) {
      const live = root.querySelectorAll('.cv-view details.cv-folder');
      if (live.length) {
        const s = new Set();
        live.forEach((d) => { if (d.open) s.add(d.dataset.id); });
        if (root.__cvTouched) st.openIds = s;
      }
    }
    const hadView = !!root.querySelector('.cv-view');
    const keep = new Set([...root.querySelectorAll('.cv-view details[data-keep][open]')].map((d) => d.dataset.keep));
    let body;
    if (st.error) {
      body = TP.ui.group(TP.ui.errorRow(t(st.error === 'resolve' ? 'course.resolveError' : 'course.error'), 'retry'), { cls: 'cv-group' });
    } else if (!st.data) {
      body = TP.ui.cols(sec('content', t('course.content'), TP.ui.skeleton(6)), TP.ui.skeleton(3));
    } else {
      body = TP.ui.cols(recentHtml() + treeHtml(), deadlinesHtml() + announcementsHtml() + teachersHtml());
    }
    root.innerHTML = `<div class="cv-view">${headerHtml()}${body}<p class="cv-noresults" hidden></p></div>`;
    if (hadView) root.querySelectorAll('.cv-view details[data-keep]').forEach((d) => { d.open = keep.has(d.dataset.keep); });
    syncTitle();
    restoreFocus(root, focus);
    if (st.q) applySearch(root, st.q);
  }

  function eyebrowText() {
    const c = courseModel();
    const raw = (c && c.title) || (st.data && st.data.course && st.data.course.name) || '';
    const code = (c && c.code) || TP.util.courseCode(raw);
    const sem = c && c.semester && c.semester !== 'UNKNOWN' ? t('courses.sem.' + c.semester) : (c && c.type === 'community' ? t('courses.community') : '');
    return [code, sem].filter(Boolean).join(' · ');
  }
  function syncTitle() {
    const ctx = cur;
    if (!ctx) return;
    try { const n = courseName(); if (n && ctx.setTitle) ctx.setTitle(n); } catch { /* ignore */ }
    try { if (ctx.setSubtitle) ctx.setSubtitle(esc(eyebrowText())); } catch { /* ignore */ }
  }

  function render(ctx) {
    cur = ctx;
    bind(ctx.root);
    ctx.setActions([]);
    const p = ctx.params || {};
    const key = p.cid ? 'c:' + p.cid : 'l:' + (p.luId || '');
    if (key !== st.key || (st.error && !st.data)) {
      if (key !== st.key) { st.q = ''; ctx.root.__cvTouched = false; }
      start(ctx);
    }
    paint();
  }

  // ---------- search ----------
  function applySearch(root, q) {
    const was = st.q;
    st.q = q || '';
    const view = root.querySelector('.cv-view');
    if (!view) return;
    if (!st.q) {
      if (was) paint(); // restore the remembered open state
      return;
    }
    view.querySelectorAll('[data-lq]').forEach((el) => { el.hidden = !el.dataset.lq.includes(st.q); });
    const tree = view.querySelector('[data-tree]');
    if (tree) {
      const folders = [...tree.querySelectorAll('details.cv-folder')].reverse(); // children before parents
      for (const f of folders) {
        const self = (f.dataset.fq || '').includes(st.q);
        if (self) f.querySelectorAll('[data-lq], details.cv-folder').forEach((x) => { x.hidden = false; });
        const body = f.querySelector(':scope > .tp-disclosure-body');
        const anyKid = body ? [...body.children].some((k) => !k.hidden && !k.classList.contains('cv-empty-folder')) : false;
        f.hidden = !self && !anyKid;
        f.open = !f.hidden;
      }
    }
    let any = false;
    view.querySelectorAll('.cv-sec').forEach((s) => {
      const hit = !!s.querySelector('[data-lq]:not([hidden]), details.cv-folder:not([hidden])');
      s.hidden = !hit;
      if (hit) any = true;
    });
    const nr = view.querySelector('.cv-noresults');
    if (nr) { nr.hidden = any; nr.textContent = any ? '' : t('course.noResults', { q: st.q }); }
  }

  // ---------- interactions ----------
  function recentEntry(n) {
    const c = courseModel();
    return {
      title: n.title || '',
      url: H(n) === 'resource/x-bb-externallink' && n.contentHandler && /^https?:/i.test(n.contentHandler.url || '') ? n.contentHandler.url : itemLink(n),
      courseName: courseName(),
      courseLuId: st.luId || (c && c.luId) || '',
      kind: kind(n),
    };
  }
  function addRecent(n) {
    try { Promise.resolve(TP.data.addRecent(recentEntry(n))).catch(() => {}); } catch { /* ignore */ }
  }

  async function onOpen(btn) {
    const f = findNode(btn.dataset.id);
    if (!f) return;
    addRecent(f.node);
    btn.setAttribute('aria-busy', 'true');
    try { await TP.data.ultraOpen(st.cid, f.node.id); }
    catch { TP.shell.toast?.(t('course.openFailed')); }
    finally { btn.removeAttribute('aria-busy'); }
  }

  async function onDownload(btn) {
    const id = btn.dataset.id;
    const f = findNode(id);
    if (!f || st.busy.has(id)) return;
    st.busy.add(id);
    const old = btn.innerHTML;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = spinner();
    TP.shell.announce?.(t('course.downloading'));
    addRecent(f.node);
    const fileName = (f.node.contentHandler && f.node.contentHandler.file && f.node.contentHandler.file.fileName) || f.node.title || 'download';
    try {
      const ok = await TP.data.ultraDownload(st.cid, id, fileName);
      // false = TP.data fell back to opening the file/item in a new tab.
      if (ok) TP.shell.announce?.(t('course.downloaded'));
    } catch {
      TP.shell.toast?.(t('course.downloadFailed'));
    } finally {
      st.busy.delete(id);
      // The row may have been re-rendered meanwhile: update whatever button is live now.
      const live = cur && cur.root.querySelectorAll(`[data-action="download"][data-id="${cssEsc(id)}"]`);
      (live && live.length ? [...live] : [btn]).forEach((b) => {
        b.disabled = false; b.removeAttribute('aria-busy');
        b.innerHTML = b === btn ? old : TP.ui.icon('download', { size: 17 });
      });
    }
  }

  async function onClassic() {
    try { await TP.settings.set({ wrap: { courses: false } }); } catch { /* ignore */ }
    TP.shell.toast?.(t('course.classicToast'));
    if (location.origin !== ULTRA && st.cid) location.href = `${ULTRA}/ultra/courses/${encodeURIComponent(st.cid)}/outline`;
  }

  function toggleAll(btn) {
    const root = cur && cur.root;
    if (!root) return;
    const folders = [...root.querySelectorAll('[data-tree] details.cv-folder')];
    const open = btn.dataset.open !== '1';
    root.__cvTouched = true;
    st.openIds = new Set(open ? folders.map((d) => d.dataset.id) : []);
    folders.forEach((d) => { d.open = open; });
    btn.dataset.open = open ? '1' : '0';
    (btn.querySelector('span') || btn).textContent = t(open ? 'course.collapseAll' : 'course.expandAll');
    persistOpen();
  }

  function bind(root) {
    if (root.__tpCourseBound) return;
    root.__tpCourseBound = true;

    root.addEventListener('click', (ev) => {
      if (!ev.target.closest('.cv-view')) return;
      const a = ev.target.closest('[data-action]');
      if (a && root.contains(a)) {
        const act = a.dataset.action;
        if (act === 'open') { ev.preventDefault(); onOpen(a); return; }
        if (act === 'download') { ev.preventDefault(); onDownload(a); return; }
        if (act === 'toggle-all') { ev.preventDefault(); toggleAll(a); return; }
        if (act === 'classic') { ev.preventDefault(); onClassic(); return; }
        if (act === 'retry') { ev.preventDefault(); st.key = null; if (cur) render(cur); return; }
        if (act === 'pin') {
          ev.preventDefault();
          const c = courseModel();
          const lu = st.luId || (c && c.luId);
          if (lu) Promise.resolve(TP.settings.setCourse(lu, { pinned: !(c && c.pinned) })).then(() => paint()).catch(() => {});
          return;
        }
      }
      const link = ev.target.closest('a[data-recent]');
      if (link && root.contains(link)) {
        const f = findNode(link.dataset.recent);
        if (f) addRecent(f.node);
      }
    });

    // <details> 'toggle' doesn't bubble: capture it to remember open folders per course.
    root.addEventListener('toggle', (ev) => {
      const d = ev.target;
      if (!d.matches || !d.matches('.cv-view details.cv-folder') || st.q || !st.cid) return;
      if (!d.isConnected) return;
      if (!st.openIds) {
        // First explicit choice: start from what is currently open on screen.
        st.openIds = new Set([...root.querySelectorAll('.cv-view details.cv-folder[open]')].map((x) => x.dataset.id));
      }
      const had = st.openIds.has(d.dataset.id);
      if (d.open === had) return;
      if (d.open) st.openIds.add(d.dataset.id); else st.openIds.delete(d.dataset.id);
      root.__cvTouched = true;
      persistOpen();
    }, true);
  }

  TP.shell.register('course', {
    title: () => courseName() || t('course.title'),
    searchPlaceholder: () => t('course.search'),
    render,
    onSearch(ctx, q) { cur = ctx; applySearch(ctx.root, q); },
    destroy() { st.q = ''; },
  });
})();
