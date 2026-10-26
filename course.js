/* Toledo+ course view — replaces a Blackboard Ultra course outline (/ultra/courses/<id>/outline)
   with an inset-grouped overview: recent items, full content tree, deadlines, announcements, teachers.
   Data: Blackboard public REST API on the same origin, using the user's session. */
(() => {
  'use strict';

  const ROUTE = /^\/ultra\/courses\/(_\d+_\d+)\/outline\/?$/;
  const local = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
    set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
  };
  const DAY = 864e5;
  const PORTAL = 'https://toledo.kuleuven.be/portal/#/home';

  const ICON = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chev: '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6"/></svg>',
    disc: '<svg class="disc" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6"/></svg>',
    back: '<svg width="10" height="17" viewBox="0 0 10 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 1.5 1.5 8.5l7 7"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    film: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
    image: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    task: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
    link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    tool: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/></svg>',
    down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    open: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    mail: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const courseName = (s) => String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^-\s*/, '');
  const courseCode = (s) => (String(s || '').match(/\[([^\]]+)\]\s*$/) || [])[1] || '';
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysUntil = (t) => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
  const fmt = (t, o) => new Intl.DateTimeFormat('nl-BE', o).format(new Date(t));
  const hm = (t) => fmt(t, { hour: '2-digit', minute: '2-digit' });
  const relDay = (t) => { const n = daysUntil(t); return n === 0 ? 'vandaag' : n === 1 ? 'morgen' : n < 0 ? `${-n} d geleden` : `over ${n} d`; };
  const ago = (t) => { const n = -daysUntil(t); if (n <= 0) return 'vandaag ' + hm(t); if (n === 1) return 'gisteren'; if (n < 7) return fmt(t, { weekday: 'long' }); return fmt(t, { day: 'numeric', month: 'short', year: n > 300 ? 'numeric' : undefined }); };
  const plain = (html) => { const d = new DOMParser().parseFromString(html || '', 'text/html'); return (d.body.textContent || '').replace(/\s+/g, ' ').trim(); };

  // Blackboard returns course HTML (announcements, documents). Keep markup, drop anything active.
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta,base').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
        if (n.startsWith('on') || n === 'style' || n === 'class' || n === 'id' || ((n === 'href' || n === 'src') && v.startsWith('javascript:'))) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    });
    return doc.body.innerHTML;
  }

  // Ultra sets <base href> to its CDN, so every relative URL must be made absolute.
  const abs = (p) => (/^https?:/.test(p) ? p : location.origin + (p.startsWith('/') ? p : '/' + p));
  async function api(path) {
    const r = await fetch(abs(path), { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  async function pool(items, n, fn) {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
    return out;
  }

  const handlerOf = (c) => c.contentHandler?.id || '';
  const isFolder = (c) => c.hasChildren || /x-bb-(folder|lesson|module)/.test(handlerOf(c));
  function kindOf(c) {
    const h = handlerOf(c);
    const mime = c.contentHandler?.file?.mimeType || '';
    if (isFolder(c)) return ['folder', 'Map'];
    if (h === 'resource/x-bb-file') {
      if (mime.startsWith('video/')) return ['film', 'Video'];
      if (mime.startsWith('image/')) return ['image', 'Afbeelding'];
      const ext = (c.contentHandler?.file?.fileName || c.title || '').split('.').pop().toUpperCase();
      return ['doc', ext && ext.length <= 5 ? ext : 'Bestand'];
    }
    if (h === 'resource/x-bb-document') return ['text', 'Pagina'];
    if (/asmt|assignment|test|survey/.test(h)) return ['task', 'Opdracht'];
    if (h === 'resource/x-bb-externallink') return ['link', 'Link'];
    if (h === 'resource/x-bb-blti-link' || h === 'resource/x-bb-lti-link') return ['tool', 'Tool'];
    return ['text', 'Item'];
  }
  const ultraLink = (cid, c) => abs(c.links?.[0]?.href || `/ultra/redirect?redirectType=nautilus&courseId=${cid}&contentId=${c.id}`);

  // ---------- state ----------
  let enabled = true, host = null, shadow = null, cid = null, data = null, lastPath = '', visits = {};

  const routeCid = () => (location.pathname.match(ROUTE) || [])[1] || null;
  if (routeCid()) document.documentElement.classList.add('tplus-on');

  local.get(['courseEnabled', 'visits']).then((v) => {
    enabled = v.courseEnabled !== false;
    visits = v.visits || {};
    tick();
    setInterval(tick, 400); // Ultra navigates client-side; follow URL changes.
  });

  function tick() {
    if (location.pathname === lastPath && host?.isConnected !== false) return;
    lastPath = location.pathname;
    const id = routeCid();
    const on = enabled && !!id;
    document.documentElement.classList.toggle('tplus-on', on);
    whenBody(() => {
      updateSwitch(!!id && !enabled);
      if (on) mount(id);
    });
  }
  function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); }

  function updateSwitch(show) {
    let b = document.getElementById('tplus-switch');
    if (!show) { b?.remove(); return; }
    if (b) return;
    b = document.createElement('button');
    b.id = 'tplus-switch'; b.type = 'button'; b.className = 'left';
    b.textContent = 'Toledo+';
    b.title = 'Toon dit vak in Toledo+';
    b.addEventListener('click', async () => { enabled = true; await local.set({ courseEnabled: true }); lastPath = ''; tick(); });
    document.body.appendChild(b);
  }

  function mount(id) {
    if (!host || !host.isConnected) {
      host = document.createElement('div');
      host.id = 'tplus-root';
      shadow = host.attachShadow({ mode: 'open' });
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = chrome.runtime.getURL('ui.css');
      shadow.appendChild(link);
      const shell = document.createElement('div'); shell.className = 'tplus-shell';
      shadow.appendChild(shell);
      shadow.addEventListener('click', onClick);
      shadow.addEventListener('input', onInput);
      document.addEventListener('keydown', onKey);
      document.body.prepend(host);
    }
    if (cid !== id) { cid = id; data = null; render(); load(id); } else render();
  }

  async function load(id) {
    const base = `/learn/api/public`;
    const [course, top, ann, cols, staff] = await Promise.allSettled([
      api(`${base}/v3/courses/${id}`),
      api(`${base}/v1/courses/${id}/contents?limit=200`),
      api(`${base}/v1/courses/${id}/announcements?limit=20`),
      api(`${base}/v2/courses/${id}/gradebook/columns?limit=200`),
      api(`${base}/v1/courses/${id}/users?role=Instructor&expand=user&limit=20`),
    ]);
    if (cid !== id) return;
    if (course.status === 'rejected' && top.status === 'rejected') {
      data = { error: 'Blackboard gaf geen gegevens terug voor dit vak. Ben je nog aangemeld?' }; render(); return;
    }
    // Walk folders (bounded depth/concurrency) so search and "recent" cover everything.
    const roots = (top.value?.results || []).filter((c) => c.availability?.available !== 'No');
    async function children(node, depth) {
      if (!isFolder(node) || depth > 6) return;
      try {
        const r = await api(`${base}/v1/courses/${id}/contents/${node.id}/children?limit=200`);
        node.kids = (r.results || []).filter((c) => c.availability?.available !== 'No');
      } catch { node.kids = []; }
      await pool(node.kids, 6, (k) => children(k, depth + 1));
    }
    data = { partial: true, course: course.value || {}, roots, announcements: [], deadlines: [], staff: [] };
    data.announcements = (ann.value?.results || []).filter((a) => !a.draft).sort((a, b) => new Date(b.created) - new Date(a.created));
    data.deadlines = (cols.value?.results || []).filter((c) => c.grading?.due)
      .map((c) => ({ title: c.name, due: new Date(c.grading.due).getTime(), url: c.contentId ? abs(`/ultra/redirect?redirectType=nautilus&courseId=${id}&contentId=${c.contentId}`) : null }))
      .sort((a, b) => a.due - b.due);
    data.staff = (staff.value?.results || []).map((m) => m.user).filter(Boolean)
      .map((u) => ({ name: [u.name?.given, u.name?.family].filter(Boolean).join(' '), email: u.contact?.email }));
    data.lastVisit = visits[id] || 0;
    render();
    await pool(roots, 6, (r) => children(r, 1));
    if (cid !== id) return;
    data.partial = false;
    render();
    visits[id] = Date.now();
    local.set({ visits });
  }

  // ---------- render ----------
  function flatten(nodes, path = [], out = []) {
    for (const n of nodes || []) {
      if (isFolder(n)) flatten(n.kids, path.concat(n.title), out);
      else out.push({ node: n, path });
    }
    return out;
  }
  const countLeaves = (n) => isFolder(n) ? (n.kids || []).reduce((s, k) => s + countLeaves(k), 0) : 1;
  const newest = (n) => isFolder(n) ? Math.max(new Date(n.modified || 0).getTime(), ...(n.kids || []).map(newest)) : new Date(n.created || n.modified || 0).getTime();
  const isNew = (n) => data.lastVisit && new Date(n.created || 0).getTime() > data.lastVisit;

  function render() {
    const shell = shadow.querySelector('.tplus-shell');
    const name = data?.course?.name || document.title.split(' / ').pop() || 'Vak';
    const nav = navHTML(name);
    if (!data) { shell.innerHTML = nav + `<main class="page"><section class="hero"><div><p class="eyebrow">Vak</p><h1>${esc(courseName(name))}</h1></div></section><div class="group">${'<div class="skeleton"></div>'.repeat(6)}</div></main>`; return; }
    if (data.error) { shell.innerHTML = nav + `<main class="page"><div class="group"><p class="error">${esc(data.error)}</p></div><p class="sec-foot"><button class="btn btn-plain" data-action="classic">Toon de klassieke weergave</button></p></main>`; return; }
    const openState = captureOpen();
    shell.innerHTML = `${nav}
      <main class="page">
        ${heroHTML(name)}
        <div class="cols">
          <div class="col-main">
            ${recentHTML()}
            ${treeHTML()}
          </div>
          <aside class="col-side">
            ${deadlinesHTML()}
            ${annHTML()}
          </aside>
        </div>
      </main>
      <footer class="foot"><span>Toledo+ · gegevens rechtstreeks uit Blackboard</span><button type="button" data-action="classic">Klassieke weergave</button></footer>`;
    restoreOpen(openState);
  }
  // Keep folders the user opened open across re-renders (the tree fills in progressively).
  function captureOpen() { return new Set([...shadow.querySelectorAll('details[open][data-id]')].map((d) => d.dataset.id)); }
  function restoreOpen(set) { if (!set.size) return; shadow.querySelectorAll('details[data-id]').forEach((d) => { if (set.has(d.dataset.id)) d.open = true; }); }

  function navHTML(name) {
    return `
    <header class="nav">
      <div class="nav-inner">
        <a class="brand" href="${PORTAL}" aria-label="Toledo+ start"><span class="brand-mark">T</span>Toledo+</a>
        <nav class="crumbs" aria-label="Kruimelpad"><a href="${PORTAL}">Vakken</a><span aria-hidden="true">›</span><span class="here">${esc(courseName(name))}</span></nav>
        <label class="search">
          ${ICON.search}
          <span class="sr-only">Zoek in dit vak</span>
          <input type="search" data-role="search" placeholder="Zoek in dit vak" autocomplete="off">
          <kbd>⌘K</kbd>
        </label>
        <div class="nav-actions">
          <button type="button" class="btn btn-plain" data-action="classic">Klassiek</button>
        </div>
      </div>
    </header>`;
  }

  function heroHTML(name) {
    const leaves = flatten(data.roots).length;
    const fresh = flatten(data.roots).filter((x) => isNew(x.node)).length;
    const staff = data.staff.map((s) => s.email ? `<a href="mailto:${esc(s.email)}">${ICON.mail} ${esc(s.name)}</a>` : `<span>${esc(s.name)}</span>`).join('');
    const sub = data.partial ? '<span class="spin" aria-hidden="true"></span> Inhoud laden…'
      : `${leaves} ${leaves === 1 ? 'item' : 'items'}${fresh ? ` · <strong>${fresh} nieuw</strong> sinds je laatste bezoek` : ''}`;
    return `
    <section class="hero">
      <div>
        <p class="eyebrow">${esc(courseCode(name) || 'Vak')}</p>
        <h1>${esc(courseName(name))}</h1>
        <p class="sub">${sub}</p>
        ${staff ? `<div class="teachers">${staff}</div>` : ''}
      </div>
    </section>`;
  }

  function leafRow(x, opts = {}) {
    const n = x.node;
    const [k, label] = kindOf(n);
    const h = handlerOf(n);
    const date = new Date(n.created || n.modified || 0).getTime();
    const meta = [opts.showPath && x.path.length ? x.path.join(' › ') : '', label, date ? ago(date) : ''].filter(Boolean).join(' · ');
    const q = esc([n.title, ...x.path, label].join(' ').toLowerCase());
    const dot = isNew(n) ? '<span class="new-dot" aria-label="Nieuw"></span>' : '';
    const isFile = h === 'resource/x-bb-file';
    const isDoc = h === 'resource/x-bb-document' && (n.body || '').trim();
    const ext = h === 'resource/x-bb-externallink' ? n.contentHandler?.url : null;
    const href = ext || ultraLink(cid, n);
    const main = `<span class="ico">${ICON[k]}</span><div class="main"><div class="title">${esc(n.title)}</div><div class="meta">${esc(meta)}</div></div>`;
    if (isDoc && !opts.showPath) {
      return `<details class="folder" data-q="${q}" data-id="${esc(n.id)}" style="--inset:58px"><summary>${dot}${main}${ICON.disc}</summary><div class="doc-body">${sanitize(n.body)}</div></details>`;
    }
    if (isFile) {
      return `<div class="row" data-q="${q}" style="--inset:58px">${dot}
        <button type="button" class="row-main" data-action="open" data-id="${esc(n.id)}" style="display:flex;align-items:center;gap:12px">${main}</button>
        <div class="row-actions"><button type="button" class="mini-btn" data-action="download" data-id="${esc(n.id)}" aria-label="Download ${esc(n.title)}">${ICON.down}</button></div>
      </div>`;
    }
    return `<a class="row" href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener"' : ''} data-q="${q}" style="--inset:58px">${dot}${main}${ext ? ICON.open : ICON.chev}</a>`;
  }

  function nodeHTML(n, path, openId) {
    if (!isFolder(n)) return leafRow({ node: n, path });
    const count = countLeaves(n);
    const loading = !n.kids;
    const kids = (n.kids || []).map((k) => nodeHTML(k, path.concat(n.title), null)).join('');
    const fresh = flatten(n.kids || []).some((x) => isNew(x.node));
    const t = newest(n);
    return `
    <details class="folder" data-id="${esc(n.id)}" data-folder ${openId === n.id ? 'open' : ''} style="--inset:58px">
      <summary data-q="${esc([n.title, ...path].join(' ').toLowerCase())}">
        ${fresh ? '<span class="new-dot" aria-label="Bevat nieuwe items"></span>' : ''}
        <span class="ico folder">${ICON.folder}</span>
        <div class="main"><div class="title strong">${esc(n.title)}</div><div class="meta">${loading ? 'laden…' : `${count} ${count === 1 ? 'item' : 'items'}`}${t ? ' · ' + esc(ago(t)) : ''}</div></div>
        ${ICON.disc}
      </summary>
      <div class="folder-body">${kids || (loading ? '<div class="skeleton"></div>' : '<p class="empty">Leeg</p>')}</div>
    </details>`;
  }

  function treeHTML() {
    if (!data.roots.length) return `<section><div class="sec-head"><h2>Inhoud</h2></div><div class="group"><p class="empty">Nog geen inhoud in dit vak.</p></div></section>`;
    // Open the most recently changed top-level folder by default.
    const latest = data.roots.filter(isFolder).sort((a, b) => newest(b) - newest(a))[0];
    return `
    <section aria-labelledby="tp-tree">
      <div class="sec-head"><h2 id="tp-tree">Inhoud</h2><button type="button" class="btn btn-plain" data-action="toggle-all">Alles uitklappen</button></div>
      <div class="group" data-tree>${data.roots.map((n) => nodeHTML(n, [], latest?.id)).join('')}</div>
    </section>`;
  }

  function recentHTML() {
    if (data.partial) return '';
    const items = flatten(data.roots).sort((a, b) => new Date(b.node.created || 0) - new Date(a.node.created || 0)).slice(0, 5);
    if (!items.length) return '';
    return `
    <section aria-labelledby="tp-rec">
      <div class="sec-head"><h2 id="tp-rec">Recent toegevoegd</h2></div>
      <div class="group">${items.map((x) => leafRow(x, { showPath: true })).join('')}</div>
    </section>`;
  }

  function deadlinesHTML() {
    const now = Date.now();
    const up = data.deadlines.filter((d) => d.due >= now - DAY / 2);
    const past = data.deadlines.filter((d) => d.due < now - DAY / 2).slice(-2).reverse();
    const row = (d, done) => {
      const urgent = !done && daysUntil(d.due) <= 14;
      const inner = `
        <div class="date-tile ${urgent ? 'urgent' : ''}" style="${done ? 'opacity:.6' : ''}"><span class="d">${fmt(d.due, { day: 'numeric' })}</span><span class="m">${esc(fmt(d.due, { month: 'short' }).replace('.', ''))}</span></div>
        <div class="main"><div class="title strong" style="font-size:15px">${esc(d.title)}</div><div class="meta" style="font-size:13px">${esc(fmt(d.due, { weekday: 'long' }))} · ${esc(hm(d.due))}</div></div>
        <div class="trail due ${urgent ? 'urgent' : ''}" style="font-size:13px">${esc(relDay(d.due))}</div>`;
      return d.url ? `<a class="row" href="${esc(d.url)}" data-q="${esc(d.title.toLowerCase())}" style="--inset:80px">${inner}</a>` : `<div class="row" style="--inset:80px">${inner}</div>`;
    };
    const body = up.map((d) => row(d, false)).join('') + past.map((d) => row(d, true)).join('');
    return `
    <section aria-labelledby="tp-dl">
      <div class="sec-head"><h2 id="tp-dl">Deadlines</h2></div>
      <div class="group">${body || '<p class="empty">Geen opdrachten met een deadline.</p>'}</div>
    </section>`;
  }

  function annHTML() {
    const items = data.announcements.slice(0, 6).map((a, i) => {
      const t = new Date(a.created).getTime();
      const fresh = data.lastVisit && t > data.lastVisit;
      return `
      <details class="ann" ${i === 0 && fresh ? 'open' : ''} data-q="${esc((a.title + ' ' + plain(a.body)).toLowerCase())}">
        <summary>
          <div class="title ${fresh ? 'strong' : ''}" style="font-size:15px;display:flex;gap:8px;align-items:center">${fresh ? '<span class="new-dot"></span>' : ''}${esc(a.title)}</div>
          <div class="meta" style="font-size:13px;color:var(--label-2);margin-top:2px">${esc(ago(t))}</div>
        </summary>
        <div class="doc-body">${sanitize(a.body)}</div>
      </details>`;
    }).join('');
    return `
    <section aria-labelledby="tp-ann">
      <div class="sec-head"><h2 id="tp-ann">Aankondigingen</h2></div>
      <div class="group">${items || '<p class="empty">Geen aankondigingen.</p>'}</div>
    </section>`;
  }

  // ---------- interactions ----------
  const findIn = (id, nodes) => { for (const n of nodes || []) { if (n.id === id) return n; const k = findIn(id, n.kids || []); if (k) return k; } return null; };
  const findNode = (id) => findIn(id, data?.roots);

  async function attachmentUrl(id) {
    const r = await api(`/learn/api/public/v1/courses/${cid}/contents/${id}/attachments`);
    const a = r.results?.[0];
    return a ? abs(`/learn/api/public/v1/courses/${cid}/contents/${id}/attachments/${a.id}/download`) : null;
  }

  async function onClick(ev) {
    const t = ev.target.closest('[data-action]');
    if (!t) return;
    const act = t.dataset.action;
    if (act === 'classic') { ev.preventDefault(); enabled = false; await local.set({ courseEnabled: false }); lastPath = ''; tick(); return; }
    if (act === 'toggle-all') {
      const all = [...shadow.querySelectorAll('[data-tree] details[data-folder]')];
      const open = !all.every((d) => d.open);
      all.forEach((d) => { d.open = open; });
      t.textContent = open ? 'Alles inklappen' : 'Alles uitklappen';
      return;
    }
    if (act === 'open' || act === 'download') {
      const n = findNode(t.dataset.id);
      const old = t.innerHTML;
      if (act === 'download') t.innerHTML = '<span class="spin" aria-hidden="true"></span>';
      try {
        const url = await attachmentUrl(t.dataset.id);
        if (!url) { location.href = ultraLink(cid, n); return; }
        if (act === 'download') {
          // Download redirects to S3; fetch with default credentials (S3 rejects credentialed CORS) and save as blob.
          const blob = await (await fetch(url)).blob();
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = n?.contentHandler?.file?.fileName || n?.title || '';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
        } else {
          window.open(url, '_blank', 'noopener');
        }
      } catch { location.href = ultraLink(cid, n); }
      finally { if (act === 'download') t.innerHTML = old; }
    }
  }

  function onInput(ev) {
    if (ev.target.dataset.role !== 'search') return;
    const q = ev.target.value.trim().toLowerCase();
    const tree = shadow.querySelector('[data-tree]');
    // Leaves and announcements
    shadow.querySelectorAll('[data-q]').forEach((el) => {
      if (el.tagName === 'SUMMARY') return;
      el.hidden = !!q && !el.dataset.q.includes(q);
    });
    // Folders: show if their own name matches or any descendant is visible; open them while searching.
    if (tree) {
      const folders = [...tree.querySelectorAll('details[data-folder]')].reverse();
      for (const f of folders) {
        const self = f.querySelector(':scope > summary').dataset.q.includes(q);
        const anyKid = [...f.querySelectorAll(':scope > .folder-body > *')].some((k) => !k.hidden);
        if (q && self) f.querySelectorAll('[data-q]').forEach((x) => { if (x.tagName !== 'SUMMARY') x.hidden = false; });
        f.hidden = !!q && !self && !anyKid;
        if (q) f.open = !f.hidden;
      }
    }
    shadow.querySelectorAll('section').forEach((s) => {
      const rows = [...s.querySelectorAll('[data-q]')].filter((x) => x.tagName !== 'SUMMARY');
      s.hidden = !!q && rows.length > 0 && !rows.some((x) => !x.hidden) && !s.querySelector('details[data-folder]:not([hidden])');
    });
  }

  function onKey(ev) {
    if (!document.documentElement.classList.contains('tplus-on') || !shadow) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); shadow.querySelector('[data-role="search"]')?.focus(); }
  }
})();
