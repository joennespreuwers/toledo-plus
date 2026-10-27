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
    focusUsed: false, // params.focus already applied
    onlyNew: false,   // F3: "Alleen nieuw" filter
  };
  let cur = null;

  // ---------- tree helpers ----------
  const H = (n) => (n && n.contentHandler && n.contentHandler.id) || '';
  const isFolder = (n) => !!n && (n.hasChildren || Array.isArray(n.kids) || /x-bb-(folder|lesson|module)/.test(H(n)));
  const created = (n) => ms(n.created || n.modified);
  // F3/B10: "new" = what the Nieuw feed reports for this course (unread portal events, matched by content id or
  // title) + items created after the previous visit. The header count and the blue dots use the same source.
  const normT = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let feedNew = { ids: new Set(), titles: new Set(), events: [] };
  function computeFeedNew() {
    const lu = st.luId || (st.data && st.data.course && st.data.course.courseId) || null;
    const out = { ids: new Set(), titles: new Set(), events: [] };
    if (lu) {
      let groups = [];
      try { groups = TP.data.feed() || []; } catch { groups = []; }
      for (const g of groups) {
        if (g.luId !== lu) continue;
        for (const e of g.items || []) {
          if (e.read) continue;
          out.events.push(e);
          const id = itemIdOf(e.url);
          if (id) out.ids.add(id);
          out.titles.add(normT(e.title));
        }
      }
    }
    feedNew = out;
  }
  function itemIdOf(url) {
    let u = String(url || '');
    try { u = decodeURIComponent(u); } catch { /* raw */ }
    return (u.match(/content_?[iI]d=(_\d+_\d+)/) || u.match(/contents?\/(_\d+_\d+)/) || u.match(/outline\/[a-z]+\/(_\d+_\d+)/) || [])[1] || null;
  }
  const isNew = (n) => (!!st.prevVisit && ms(n.created) > st.prevVisit) || feedNew.ids.has(n.id) || (!!n.title && feedNew.titles.has(normT(n.title)));
  /** "4 nieuw" = exactly the rows with a dot on this page: new files/pages in the tree + unread announcements (TP-086).
   *  Unread Toledo notifications of this course without a row here (e.g. "Opdracht 2 beschikbaar") are counted apart
   *  ("+2 meldingen", they are in Overzicht › Nieuw), so no number points at something the page can't show. */
  function newCount(leaves) {
    return newParts(leaves).dots;
  }
  function newParts(leaves) {
    const fresh = leaves.filter((x) => isNew(x.node));
    const ann = annShown().filter((x) => x.unread);
    const ids = new Set(fresh.map((x) => x.node.id));
    const titles = new Set(fresh.map((x) => normT(x.node.title)));
    const annIds = new Set(ann.map((x) => x.item && x.item.event && String(x.item.event.id)).filter(Boolean));
    const extra = feedNew.events.filter((e) => {
      const id = itemIdOf(e.url);
      return !(id && ids.has(id)) && !titles.has(normT(e.title)) && !annIds.has(String(e.id));
    }).length;
    return { dots: fresh.length + ann.length, extra };
  }

  // ---------- announcements: read state from the matching portal event (TP-089) ----------
  function annMeta() {
    const c = st.luId && TP.data.course ? TP.data.course(st.luId) : null;
    return { cid: st.cid, luId: st.luId || (st.data && st.data.course && st.data.course.courseId) || null, name: (c && c.name) || TP.util.courseName((st.data && st.data.course && st.data.course.name) || ''), color: c ? c.color : null };
  }
  const ANN_MAX = 8;
  /** Non-draft announcements, newest first, each with its sheet item and `unread` (portal read state; without a matching
   *  portal event: created after the previous visit). → [{a, item, unread}] (all of them; the page shows ANN_MAX). */
  function annAll() {
    const list = ((st.data && st.data.announcements) || []).filter((a) => !a.draft).slice().sort((a, b) => ms(b.created) - ms(a.created));
    const meta = annMeta();
    return list.map((a) => {
      let item = null;
      try { item = TP.annSheet ? TP.annSheet.fromUltra(a, meta) : null; } catch { item = null; }
      const unread = item && item.event ? !item.event.read : (!!st.prevVisit && ms(a.created) > st.prevVisit);
      return { a, item, unread };
    });
  }
  const annShown = () => annAll().slice(0, ANN_MAX);
  function flatten(nodes, path = [], out = []) {
    for (const n of nodes || []) {
      if (isFolder(n)) flatten(n.kids, path.concat(n.title || ''), out);
      else out.push({ node: n, path });
    }
    return out;
  }
  const countLeaves = (n) => (isFolder(n) ? (n.kids || []).reduce((s, k) => s + countLeaves(k), 0) : 1);
  const newest = (n) => (isFolder(n) ? Math.max(ms(n.modified), ...(n.kids || []).map(newest)) : created(n));
  function findNode(id, nodes) {
    for (const n of (nodes === undefined ? st.data && st.data.roots : nodes) || []) {
      if (n.id === id) return { node: n };
      const k = n.kids ? findNode(id, n.kids) : null;
      if (k) return k;
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
  // TP.shell.focus: the same control by its data-fk / folder id; when it is gone the next row or the section heading.
  const snapFocus = (root) => TP.shell.focus.snap(root);
  const restoreFocus = (root, f) => TP.shell.focus.restore(f, { scope: root });
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
    // Perceived speed: on Ultra we only know the cid; the luId from state.cidMap lets the header (name, code,
    // semester) come straight from the cached enrollments instead of waiting for the course to load.
    if (!st.luId && st.cid) {
      try { const m = (TP.state.get() || {}).cidMap || {}; st.luId = Object.keys(m).find((k) => m[k] === st.cid) || null; } catch { st.luId = null; }
    }
    st.data = null; st.partial = true; st.error = null; st.prevVisit = 0; st.openIds = null; st.busy.clear(); st.focusUsed = false;
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
      applyFocus();
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
    const staff = (st.data && st.data.staff) || [];
    // Teacher chips: phones/tablets only; ≥1100px the "Docenten" card in the side column says it (CSS).
    const teachers = staff.length ? `<ul class="cv-teachers" role="list">${staff.map((s) => `<li>${s.email
      ? `<a href="mailto:${esc(s.email)}">${TP.ui.icon('mail', { size: 14 })}<span>${esc(s.name)}</span><span class="cv-sr">, ${esc(t('course.mailSuffix'))}</span></a>`
      : `<span>${esc(s.name)}</span>`}</li>`).join('')}</ul>` : '';

    let sub = '';
    if (st.data && !st.error) {
      if (st.partial) sub = `${spinner()}<span>${esc(t('course.loading'))}</span>`;
      else {
        const leaves = flatten(st.data.roots);
        const { dots: fresh, extra } = newParts(leaves);
        sub = `<span>${esc(t('course.items', { n: leaves.length }))}${fresh ? ` · <span class="cv-sub-new" title="${esc(t('course.newDots', { n: fresh }))}">${esc(t('course.newCount', { n: fresh }))}</span>` : ''}`
          + `${extra ? ` · <span class="cv-sub-extra" title="${esc(t('course.extraHint'))}">${esc(t('course.extraCount', { n: extra }))}</span>` : ''}</span>`;
      }
    }
    // Phones: the page is long; chips jump to its sections (TP-012). Buttons, not #anchors (the portal router owns the hash).
    const jumps = st.data && !st.error && !st.partial
      ? `<nav class="cv-jump" aria-label="${esc(t('course.jump'))}">${[['content', 'course.content'], ['deadlines', 'course.deadlines'], ['announcements', 'course.announcements'], ['teachers', 'course.teachers']]
        .map(([id, k]) => `<button type="button" class="cv-jump-chip" data-action="jump" data-jump="${id}" data-fk="jump:${id}">${esc(t(k))}</button>`).join('')}</nav>`
      : '';
    const lu = st.luId || (st.data && st.data.course && st.data.course.courseId) || null;
    const inSb = !!(lu && TP.shell.inSidebar && TP.shell.inSidebar(lu));
    // Page actions live where every view has them: right of the large title (TP.shell head actions).
    const acts = [];
    if (lu && TP.shell.setInSidebar) acts.push({ id: 'sidebar', label: t(inSb ? 'shell.sbRemove' : 'shell.sbAdd'), icon: inSb ? 'sidebarRemove' : 'sidebarAdd', onClick: () => onSidebar(lu) });
    acts.push({ id: 'classic', label: t('course.classic'), icon: 'classic', onClick: () => onClassic() });
    try { cur && cur.setActions && cur.setActions(acts); } catch { /* ignore */ }
    return `
      <header class="cv-head">
        <div class="cv-head-main">
          <p class="cv-sub">${sub || (st.error ? '' : `${spinner()}<span>${esc(t('course.loading'))}</span>`)}</p>
          ${teachers}
          ${jumps}
          ${TP.fulltext && st.cid && !st.error ? TP.fulltext.courseBox(st.cid) /* full-text: "Doorzoek alle bestanden" (src/core/fulltext.js) */ : ''}
        </div>
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
      // One clean accessible name: "Slides_les4.pdf, PDF, gisteren, Les 4, nieuw" (no "·"/"—" separators or a stray ", open", TP-013).
      const name = [n.title, label, date ? TP.fmt.ago(date) : '', opts.showPath ? pathTxt : '', fresh ? t('course.new').toLowerCase() : ''].filter(Boolean).join(', ');
      return `
        <div class="cv-row cv-leaf" data-lq="${lq}" style="--depth:${depth}">
          <button type="button" class="cv-row-main" data-action="open" data-id="${esc(n.id)}" data-fk="o${fk}" aria-label="${esc(name)}">${dot}${ico}${main}</button>
          <button type="button" class="cv-mini" data-action="download" data-id="${esc(n.id)}" data-fk="d${fk}" aria-label="${esc(t('course.download', { title: n.title }))}" ${busy ? 'aria-busy="true" disabled' : ''}>${busy ? spinner() : TP.ui.icon('download', { size: 17 })}</button>
        </div>`;
    }
    if (h === 'resource/x-bb-document' && String(n.body || '').trim()) {
      return `
        <details class="cv-doc" data-keep="${esc(fk)}" data-lq="${esc([n.title, label, pathTxt, TP.util.plain(n.body)].join(' ').toLowerCase())}">
          <summary class="cv-row cv-row-main" style="--depth:${depth}" data-fk="s${fk}">${dot}${ico}${main}<span class="cv-chev">${TP.ui.icon('chevronRight', { size: 14 })}</span></summary>
          <div class="cv-doc-body" style="--depth:${depth}">
            <div class="cv-prose tp-prose">${TP.util.sanitize(n.body, { base: ULTRA + '/' })}</div>
            <a class="cv-doc-link" href="${esc(itemLink(n))}" data-recent="${esc(n.id)}">${esc(t('course.openToledo'))}</a>
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
      body: n.failed ? `<div class="cv-folder-err" style="--depth:${d}">${TP.ui.errorRow(t('course.folderError'), 'retry')}</div>`
        : kids || (loading ? '' : `<p class="cv-empty-folder">${esc(t('course.folderEmpty'))}</p>`),
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
    let items = flatten(st.data.roots).sort((a, b) => created(b.node) - created(a.node));
    if (st.onlyNew) items = items.filter((x) => isNew(x.node));
    items = items.slice(0, 5);
    if (!items.length) return '';
    return sec('recent', t('course.recent'), TP.ui.group(items.map((x) => leafHtml(x, { showPath: true })).join(''), { cls: 'cv-group' }));
  }

  // "Alleen nieuw": keep new leaves and the folders that lead to them.
  function pruneNew(nodes) {
    const out = [];
    for (const n of nodes || []) {
      if (isFolder(n)) {
        const kids = pruneNew(n.kids);
        if (kids.length) out.push({ ...n, kids });
      } else if (isNew(n)) out.push(n);
    }
    return out;
  }

  function treeHtml() {
    const all = st.data.roots || [];
    const roots = st.onlyNew && !st.partial ? pruneNew(all) : all;
    const newToggle = !st.partial && all.length
      ? [{ action: 'only-new', label: t('course.onlyNew'), icon: st.onlyNew ? 'checkCircle' : 'circle', attrs: { 'data-fk': 'only-new', 'aria-pressed': st.onlyNew ? 'true' : 'false' } }]
      : [];
    if (!st.partial && newCount(flatten(all)) > 0) newToggle.push({ action: 'read-new', label: t('course.readNew'), icon: 'check', attrs: { 'data-fk': 'read-new' } });
    // B1: a failed top level is an error, not "Nog geen inhoud".
    if (!st.partial && st.data.contentsError && !all.length) {
      const auth = st.data.contentsError.auth;
      return sec('content', t('course.content'), TP.ui.group(TP.ui.errorRow(t(auth ? 'course.error' : 'course.contentsError'), 'retry'), { cls: 'cv-group' }));
    }
    if (!roots.length) {
      const empty = st.onlyNew && all.length ? t('course.noNew') : t('course.noContent');
      return sec('content', t('course.content'), st.partial ? TP.ui.skeleton(5) : TP.ui.group(TP.ui.empty(empty), { cls: 'cv-group' }), { actions: newToggle });
    }
    const latest = roots.filter(isFolder).sort((a, b) => newest(b) - newest(a))[0];
    const folderIds = [];
    (function walk(ns) { for (const n of ns || []) if (isFolder(n)) { folderIds.push(n.id); walk(n.kids); } })(roots);
    const openSet = st.onlyNew ? new Set(folderIds) : (st.openIds || new Set(latest ? [latest.id] : []));
    const allOpen = folderIds.length > 0 && folderIds.every((id) => openSet.has(id));
    const actions = newToggle.concat(folderIds.length && !st.onlyNew ? [{ action: 'toggle-all', label: t(allOpen ? 'course.collapseAll' : 'course.expandAll'), attrs: { 'data-fk': 'toggle-all', 'data-open': allOpen ? '1' : '0' } }] : []);
    const saved = st.openIds;
    if (st.onlyNew) st.openIds = openSet;
    const body = `<div class="cv-tree" data-tree>${TP.ui.group(roots.map((n) => nodeHtml(n, [], 0, latest && latest.id)).join(''), { cls: 'cv-group' })}</div>`;
    st.openIds = saved;
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
    // Overdue (not done) stays, however old (B2) — same rule as the Deadlines view.
    const late = all.filter((d) => !d.done && d.due < now).reverse();
    const up = all.filter((d) => d.due >= now);
    const past = all.filter((d) => d.done && d.due < now).slice(-2).reverse();
    const row = (d) => {
      const overdue = !d.done && d.due < now;
      const urgent = !d.done && !overdue && TP.fmt.daysUntil(d.due) <= urgentDays;
      const tone = d.done ? 'muted' : overdue ? 'overdue' : urgent ? 'urgent' : 'normal';
      const trail = overdue
        ? `<span class="cv-due is-overdue">${esc(TP.viewsA.overdueText(d.due))}</span>`
        : `<span class="cv-due${urgent ? ' is-urgent' : ''}">${urgent ? `<span class="cv-sr">${esc(t('va.urgent'))}: </span>` : ''}${esc(TP.fmt.rel(d.due))}</span>`;
      const inner = `${TP.ui.dateTile(d.due, { tone })}
        <span class="cv-main"><span class="cv-name cv-strong" title="${esc(d.title)}">${esc(d.title)}</span>
        <span class="cv-meta">${esc(TP.fmt.date(d.due, { weekday: 'long' }))} · ${esc(TP.fmt.time(d.due))}</span></span>${trail}`;
      const lq = esc(String(d.title || '').toLowerCase());
      const cls = `cv-row cv-dl${d.done ? ' is-done' : ''}${overdue ? ' is-overdue' : urgent ? ' is-urgent' : ''}`;
      // The row shows the assignment in this course (unfolded + highlighted); a small icon opens it in Toledo.
      const id = itemIdOf(d.url);
      const inTree = id && st.data && findNode(id);
      const ext = d.url ? `<a class="cv-mini cv-ext" href="${esc(d.url)}" target="_blank" rel="noopener" aria-label="${esc(t('course.openToledoLabel', { title: d.title }))}" title="${esc(t('course.openToledo'))}">${TP.ui.icon('external', { size: 15 })}</a>` : '';
      if (inTree) return `<div class="${cls} cv-dl-split" data-lq="${lq}"><button type="button" class="cv-row-main cv-dl-main" data-action="focus-item" data-id="${esc(id)}" data-fk="dl:${esc(id)}">${inner}</button>${ext}</div>`;
      return d.url
        ? `<a class="${cls} cv-row-main" href="${esc(d.url)}" target="_blank" rel="noopener" data-lq="${lq}">${inner}<span class="cv-sr">${esc(t('course.newTab'))}</span></a>`
        : `<div class="${cls}" data-lq="${lq}">${inner}</div>`;
    };
    const rows = late.map(row).join('') + up.map(row).join('') + past.map(row).join('');
    return sec('deadlines', t('course.deadlines'), TP.ui.group(rows || TP.ui.empty(t('course.noDeadlines')), { cls: 'cv-group' }));
  }

  // Next lesson of this course from KU Loket (Agent B; optional), in the side column.
  function nextLessonHtml() {
    const K = TP.kuloket;
    if (!K || typeof K.peekLessons !== 'function') return '';
    const c = courseModel();
    const lu = st.luId || (c && c.luId);
    const code = (c && c.code) || '';
    const now = Date.now();
    let list = null;
    try { list = K.peekLessons({ from: now, to: now + 21 * DAY }); } catch { list = null; }
    if (!Array.isArray(list)) return '';
    const next = list.filter((l) => l && l.end > now && ((lu && l.courseLuId === lu) || (code && l.courseCode === code)))
      .sort((a, b) => a.start - b.start)[0];
    if (!next) return '';
    const L = next.location || {};
    const loc = [L.room || L.mnemonic, L.building].filter(Boolean).join(' · ');
    const who = (next.teachers || []).filter(Boolean).join(', ');
    const when = `${TP.fmt.date(next.start, { weekday: 'long', day: 'numeric', month: 'short' })} · ${TP.fmt.time(next.start)}–${TP.fmt.time(next.end)}`;
    const inner = `${TP.ui.dateTile(next.start)}<span class="cv-main"><span class="cv-name cv-strong">${esc(next.kind === 'examen' ? t('course.exam') : (next.title || t('course.lesson')))}</span>
      <span class="cv-meta cv-wrap">${esc(when)}</span>${loc ? `<span class="cv-meta cv-wrap">${TP.ui.icon('location', { size: 12 })} ${esc(loc)}</span>` : ''}${who ? `<span class="cv-meta cv-wrap">${esc(who)}</span>` : ''}</span>`;
    const lq = esc(String(next.title || '').toLowerCase());
    const body = TP.ui.group(`<a class="cv-row cv-row-main cv-lesson" href="${esc(TP.shell.href('agenda'))}" data-lq="${lq}">${inner}<span class="cv-trail">${TP.ui.icon('chevronRight', { size: 14 })}</span></a>`, { cls: 'cv-group' });
    return sec('next', t('course.nextLesson'), body);
  }

  function announcementsHtml() {
    const all = annAll();
    const items = all.slice(0, ANN_MAX);
    const rows = items.map(({ a, unread }) => {
      const when = ms(a.created);
      const fresh = unread;
      // The row opens the announcement sheet (TP.annSheet: full text, up/down through this list).
      return `
        <button type="button" class="cv-row cv-row-main cv-ann" data-action="ann" data-id="${esc(a.id)}" data-fk="an:${esc(a.id)}" aria-haspopup="dialog" data-lq="${esc((String(a.title || '') + ' ' + TP.util.plain(a.body || '')).toLowerCase())}">
            <span class="cv-new">${fresh ? `<span class="cv-new-dot" role="img" aria-label="${esc(t('course.new'))}"></span>` : ''}</span>
            <span class="cv-main"><span class="cv-name${fresh ? ' cv-strong' : ''}" title="${esc(a.title)}">${esc(a.title)}</span><span class="cv-meta">${esc(when ? TP.fmt.ago(when) : '')}</span></span>
            <span class="cv-chev">${TP.ui.icon('chevronRight', { size: 14 })}</span>
        </button>`;
    }).join('');
    // More than ANN_MAX: say how many and link to Mededelingen filtered on this course (TP-094).
    const lu = st.luId || (st.data && st.data.course && st.data.course.courseId) || '';
    const more = all.length > items.length && lu
      ? `<a class="cv-row cv-row-main cv-more" href="${esc(TP.shell.href('announcements', { id: lu }))}" data-lq=""><span class="cv-main"><span class="cv-name">${esc(t('course.annAll', { n: all.length }))}</span></span><span class="cv-chev">${TP.ui.icon('chevronRight', { size: 14 })}</span></a>`
      : '';
    return sec('announcements', t('course.announcements'), TP.ui.group((rows + more) || TP.ui.empty(t('course.noAnnouncements')), { cls: 'cv-group' }), { count: all.length > items.length ? all.length : undefined });
  }

  /** Announcement sheet for a row of the course's announcements section (prev/next through the visible rows). */
  function openAnnouncement(el) {
    if (!TP.annSheet || !st.data) return;
    const all = ((st.data && st.data.announcements) || []).filter((x) => !x.draft);
    const meta = annMeta();
    const sec = el.closest('section') || el.parentElement;
    const ids = [...sec.querySelectorAll('[data-action="ann"][data-id]')].filter((r) => !r.hidden && !r.closest('[hidden]')).map((r) => r.dataset.id);
    const items = ids.map((id) => all.find((x) => x.id === id)).filter(Boolean).map((x) => TP.annSheet.fromUltra(x, meta));
    const target = items.find((x) => x.aid === el.dataset.id);
    if (!target) return;
    TP.annSheet.open(target, {
      list: items,
      opener: el,
      onRead: () => setTimeout(() => paint(), 0), // the dot and the header count follow the read state
      rowFor: (it) => { try { return cur && cur.root.querySelector(`[data-action="ann"][data-id="${cssEsc(it.aid)}"]`); } catch { return null; } },
    });
  }

  function teachersHtml() {
    const staff = (st.data && st.data.staff) || [];
    if (!staff.length) return st.partial ? '' : sec('teachers', t('course.teachers'), TP.ui.group(TP.ui.empty(t('course.noTeachers')), { cls: 'cv-group' }));
    const rows = staff.map((s) => {
      const lq = esc(String(s.name || '').toLowerCase());
      const inner = `<span class="cv-ico">${TP.ui.icon('mail', { size: 16 })}</span><span class="cv-main"><span class="cv-name">${esc(s.name)}</span>${s.email ? `<span class="cv-meta">${esc(s.email)}</span>` : ''}</span>`;
      return s.email
        ? `<a class="cv-row cv-row-main" href="mailto:${esc(s.email)}" data-lq="${lq}">${inner}<span class="cv-sr">, ${esc(t('course.mailSuffix'))}</span></a>`
        : `<div class="cv-row" data-lq="${lq}">${inner}</div>`;
    }).join('');
    return sec('teachers', t('course.teachers'), TP.ui.group(rows, { cls: 'cv-group' }));
  }

  function paint(force) {
    const ctx = cur;
    if (!ctx) return;
    const root = ctx.root;
    // Async callers (progress, downloads) must not paint over another view after navigation.
    if (!force && !root.querySelector(':scope > .cv-view')) return;
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
      body = TP.ui.cols(sec('content', t('course.content'), TP.ui.skeleton(6)), sec('deadlines', t('course.deadlines'), TP.ui.skeleton(3, { lead: 'date' })));
    } else {
      computeFeedNew();
      body = TP.ui.cols(recentHtml() + treeHtml(), nextLessonHtml() + deadlinesHtml() + announcementsHtml() + teachersHtml());
    }
    const html = `<div class="cv-view">${headerHtml()}${body}<div class="cv-noresults" hidden></div></div>`;
    // Skeleton → content, partial → full tree, "Alleen nieuw": rows fade/glide instead of popping (TP.motion.flip).
    const swap = () => {
      root.innerHTML = html;
      if (hadView) root.querySelectorAll('.cv-view details[data-keep]').forEach((d) => { d.open = keep.has(d.dataset.keep); });
    };
    if (TP.motion && hadView) TP.motion.flip(root, swap); else swap();
    if (st.hl && st.hl.fk && Date.now() < st.hl.until) {
      const f = root.querySelector(`[data-tree] [data-fk="${cssEsc(st.hl.fk)}"]`);
      (f && (f.closest('.cv-leaf, details.cv-doc, details.cv-folder > summary') || f))?.classList.add('cv-focus');
    }
    root.dataset.busyOwn = '1';
    if (!st.error && (!st.data || st.partial)) root.setAttribute('aria-busy', 'true'); else root.removeAttribute('aria-busy');
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
    // course.css clamps a very long name to two lines; the full name stays in the tooltip (TP-118)
    try { const h1 = ctx.root.closest('main') && ctx.root.closest('main').querySelector('.tp-large-title'); if (h1) h1.title = courseName(); } catch { /* ignore */ }
    try { if (ctx.setSubtitle) ctx.setSubtitle(esc(eyebrowText())); } catch { /* ignore */ }
  }

  function render(ctx) {
    cur = ctx;
    bind(ctx.root); // page actions are set by headerHtml() on every paint (clearing them here would drop focus)
    const p = ctx.params || {};
    const key = p.cid ? 'c:' + p.cid : 'l:' + (p.luId || '');
    if (key !== st.key || (st.error && !st.data)) {
      if (key !== st.key) { st.q = ''; ctx.root.__cvTouched = false; }
      start(ctx);
    }
    paint(true);
    applyFocus();
  }

  // ---------- focus a content item (⌘K palette: params.focus or state.focus) ----------
  // Opens the containing folders, scrolls to the row and briefly highlights it.
  function pendingFocus() {
    const p = (cur && cur.params) || {};
    if (p.focus && !st.focusUsed) return { id: String(p.focus), param: true };
    const f = (TP.state.get() || {}).focus;
    if (f && f.id && Date.now() - (f.at || 0) < 120e3 && ((st.cid && f.cid === st.cid) || (st.luId && f.luId === st.luId))) return { id: String(f.id) };
    return null;
  }
  function pathTo(id, nodes, trail = []) {
    for (const n of nodes || []) {
      if (n.id === id) return trail;
      if (n.kids) { const r = pathTo(id, n.kids, trail.concat(n.id)); if (r) return r; }
    }
    return null;
  }
  function applyFocus() {
    if (!cur || !st.data || st.partial || st.error || !st.cid) return;
    const f = pendingFocus();
    if (!f) return;
    if (f.param) st.focusUsed = true;
    else Promise.resolve(TP.state.set({ focus: null })).catch(() => {});
    focusOn(f.id);
  }
  function focusOn(fid) {
    const f = { id: String(fid) };
    if (st.onlyNew) st.onlyNew = false;
    const trail = pathTo(f.id, st.data.roots);
    if (!trail) { TP.shell.toast?.(t('course.focusMissing')); return; }
    const node = findNode(f.id);
    const ids = node && isFolder(node.node) ? trail.concat(f.id) : trail;
    const root = cur.root;
    if (!st.openIds) st.openIds = new Set([...root.querySelectorAll('.cv-view details.cv-folder[open]')].map((d) => d.dataset.id));
    ids.forEach((id) => st.openIds.add(id));
    root.__cvTouched = true;
    if (st.q) { st.q = ''; }
    paint();
    persistOpen();
    const id = cssEsc(f.id);
    const doc = root.querySelector(`[data-tree] details.cv-doc[data-keep="t:${id}"]`);
    if (doc) doc.open = true;
    const el = root.querySelector(`[data-tree] [data-fk="ot:${id}"], [data-tree] [data-fk="at:${id}"], [data-tree] [data-fk="st:${id}"], [data-tree] details.cv-folder[data-id="${id}"] > summary`);
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    const row = el.closest('.cv-leaf, details.cv-doc, details.cv-folder > summary') || el;
    row.classList.add('cv-focus');
    // a re-render right after (data arriving) rebuilds the row: paint() puts the highlight back until it ends
    st.hl = { fk: el.dataset.fk || null, until: Date.now() + 2400 };
    setTimeout(() => { row.classList.remove('cv-focus'); cur?.root.querySelector('.cv-focus')?.classList.remove('cv-focus'); }, 2400);
  }

  // ---------- search ----------
  function applySearch(root, q) {
    const was = st.q;
    st.q = String(q || '').trim();
    const view = root.querySelector('.cv-view');
    if (!view) return;
    const rows = [...view.querySelectorAll('[data-lq]')];
    const m = TP.index.matcher(st.q, rows.map((el) => el.dataset.lq).concat([...view.querySelectorAll('details.cv-folder')].map((f) => f.dataset.fq || '')));
    if (m.empty) {
      st.q = '';
      if (was) paint(); // restore the remembered open state
      return;
    }
    rows.forEach((el) => { el.hidden = !m(el.dataset.lq); });
    // The tree lists every file already: "Recent toegevoegd" would show the same rows twice while searching (TP-087).
    view.querySelectorAll('.cv-sec[data-sec="recent"] [data-lq]').forEach((el) => { el.hidden = true; });
    const tree = view.querySelector('[data-tree]');
    if (tree) {
      const folders = [...tree.querySelectorAll('details.cv-folder')].reverse(); // children before parents
      for (const f of folders) {
        const self = m(f.dataset.fq || '');
        if (self) f.querySelectorAll('[data-lq], details.cv-folder').forEach((x) => { x.hidden = false; });
        const body = f.querySelector(':scope > .tp-disclosure-body');
        const anyKid = body ? [...body.children].some((k) => !k.hidden && !k.classList.contains('cv-empty-folder')) : false;
        f.hidden = !self && !anyKid;
        f.open = !f.hidden;
      }
    }
    // A page that matches only in its text: open it so the reason is visible (TP-088).
    view.querySelectorAll('details.cv-doc:not([hidden])').forEach((d) => {
      const name = d.querySelector('.cv-name');
      if (name && !m(name.textContent) && m(d.dataset.lq)) d.open = true;
    });
    TP.index.highlight(view, m, '.cv-name, .tp-summary .tp-row-title, details.cv-doc[open] .cv-prose');
    let any = false;
    view.querySelectorAll('.cv-sec').forEach((s) => {
      const hit = !!s.querySelector('[data-lq]:not([hidden]), details.cv-folder:not([hidden])');
      s.hidden = !hit;
      if (hit) any = true;
    });
    const nr = view.querySelector('.cv-noresults');
    if (nr) { nr.hidden = any; nr.innerHTML = any ? '' : TP.ui.noResults(typedQuery(root, st.q)); }
  }
  /** The query as the student typed it (the shell hands views a lowercased copy), for the "no results for …" line (TP-096). */
  function typedQuery(root, q) {
    try {
      const v = String(root.getRootNode().querySelector('[data-shell="search"]').value || '').trim();
      return v.toLowerCase() === q ? v : q;
    } catch { return q; }
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
      // true = saved, 'opened' = no download possible here (portal): opened in a new tab, false = failed (TP-085)
      const r = await TP.data.ultraDownload(st.cid, id, fileName);
      if (r === true) TP.shell.announce?.(t('course.downloaded'));
      else if (r === false) TP.shell.toast?.(t('course.downloadFailed'));
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

  /** "Zet in zijbalk": say it happened (the sidebar is not visible on a phone, TP-097). */
  function onSidebar(lu) {
    const on = TP.shell.setInSidebar(lu);
    const phone = !!(window.matchMedia && window.matchMedia('(max-width: 699px)').matches);
    const name = courseName();
    TP.shell.toast?.(phone && on ? t('course.sbPhone', { name }) : t(on ? 'shell.sbAdded' : 'shell.sbRemoved', { name }));
  }

  /** "Markeer nieuw als gelezen": the unread feed items + announcements of this course; the dots go, Undo brings them back. */
  async function onReadNew() {
    const events = feedNew.events.slice();
    for (const x of annShown()) if (x.unread && x.item && x.item.event) events.push(x.item.event);
    const prev = st.prevVisit;
    st.prevVisit = Date.now(); // "new since your last visit" dots count as seen too
    const r = await TP.data.markAllRead({ events });
    computeFeedNew();
    paint();
    cur?.root.querySelector('[data-sec="content"] .tp-sec-title')?.focus?.({ preventScroll: true });
    TP.ui.undoToast(t('course.readNewDone', { n: Math.max(r.unread, 1) }), async () => { await r.undo(); st.prevVisit = prev; computeFeedNew(); paint(); });
    r.synced.then((ok) => { if (!ok) TP.shell.toast?.(t('announcements.syncPending')); });
  }

  function jumpTo(id) {
    const sec = cur && cur.root.querySelector(`.cv-sec[data-sec="${cssEsc(id)}"]`);
    if (!sec) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    const h = sec.querySelector('.tp-sec-title');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
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

  // ↻ cleared the course cache (TP.data 'courseCache'): reload the course that is shown.
  try {
    TP.data.on('courseCache', () => {
      if (!cur || !cur.root.querySelector(':scope > .cv-view') || !st.cid) return;
      // keep what is on screen; the fresh tree replaces it when it arrives
      const token = ++st.token;
      st.error = null;
      load(token);
    });
  } catch { /* older data layer */ }

  function bind(root) {
    if (root.__tpCourseBound) return;
    root.__tpCourseBound = true;
    try { TP.fulltext && TP.fulltext.on('progress', () => { if (cur && st.cid) TP.fulltext.updateCourseBox(cur.root, st.cid); }); } catch { /* no full-text module */ }

    root.addEventListener('click', (ev) => {
      if (!ev.target.closest('.cv-view')) return;
      const a = ev.target.closest('[data-action]');
      if (a && root.contains(a)) {
        const act = a.dataset.action;
        if (act === 'open') { ev.preventDefault(); onOpen(a); return; }
        if (act === 'download') { ev.preventDefault(); onDownload(a); return; }
        if (act === 'toggle-all') { ev.preventDefault(); toggleAll(a); return; }
        if (act === 'retry') {
          ev.preventDefault();
          try { if (st.cid && TP.data.clearCourseCache) TP.data.clearCourseCache(st.cid); } catch { /* ignore */ }
          st.key = null; if (cur) render(cur); return;
        }
        if (act === 'only-new') {
          ev.preventDefault();
          st.onlyNew = !st.onlyNew;
          paint();
          TP.shell.announce?.(t(st.onlyNew ? 'course.onlyNewOn' : 'course.onlyNewOff'));
          return;
        }
        if (act === 'focus-item') { ev.preventDefault(); focusOn(a.dataset.id); return; }
        if (act === 'read-new') { ev.preventDefault(); onReadNew(); return; }
        if (act === 'jump') { ev.preventDefault(); jumpTo(a.dataset.jump); return; }
        if (act === 'ann') { ev.preventDefault(); openAnnouncement(a); return; }
        if (act.startsWith('ft-') && TP.fulltext) { // full-text: run / confirm / stop (src/core/fulltext.js)
          ev.preventDefault();
          TP.fulltext.courseAction(act, { cid: st.cid, luId: st.luId, roots: st.partial || !st.data ? null : st.data.roots, root });
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
    destroy(ctx) {
      st.q = '';
      try { ctx.root.closest('main')?.querySelector('.tp-large-title')?.removeAttribute('title'); } catch { /* ignore */ }
    },
  });
})();
