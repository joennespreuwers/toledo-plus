/* Toledo+ — replaces the Toledo portal home with a calmer overview.
   Data comes from the portal's own JSON API (/portal/api/*) using the user's session.
   Nothing is sent anywhere else; settings live in chrome.storage. */
(() => {
  'use strict';

  const API = '/portal/api/';
  const isHome = (h) => !h || h === '#' || h === '#/' || h.startsWith('#/home');
  const local = {
    get: (k) => new Promise((r) => chrome.storage.local.get(k, r)),
    set: (o) => new Promise((r) => chrome.storage.local.set(o, r)),
  };

  // Apple system colors, indexed by Toledo's course color number (1–16).
  const PALETTE = ['#007AFF', '#34C759', '#5856D6', '#FF9500', '#FF2D55', '#AF52DE', '#FF3B30', '#30B0C7',
    '#FFCC00', '#00C7BE', '#32ADE6', '#A2845E', '#5AC8FA', '#64D2FF', '#BF5AF2', '#5E5CE6'];
  const colorOf = (n) => PALETTE[((Number(n) || 1) - 1) % PALETTE.length];

  const ICON = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    mail: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
    chev: '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 1 6 6-6 6"/></svg>',
    doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    film: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>',
    task: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
    bell: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    page: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    cal: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>',
    plus: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const courseName = (s) => String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/^-\s*/, '');
  const courseCode = (s) => (String(s || '').match(/\[([^\]]+)\]\s*$/) || [])[1] || '';
  const DAY = 864e5;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const daysUntil = (t) => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
  const fmt = (t, o) => new Intl.DateTimeFormat('nl-BE', o).format(new Date(t));
  const hm = (t) => fmt(t, { hour: '2-digit', minute: '2-digit' });
  const relDay = (t) => {
    const n = daysUntil(t);
    if (n === 0) return 'vandaag';
    if (n === 1) return 'morgen';
    if (n === -1) return 'gisteren';
    if (n < 0) return `${-n} d geleden`;
    return `over ${n} d`;
  };
  const ago = (t) => {
    const n = -daysUntil(t);
    if (n <= 0) return hm(t);
    if (n === 1) return 'gisteren';
    if (n < 7) return fmt(t, { weekday: 'long' });
    return fmt(t, { day: 'numeric', month: 'short' });
  };
  const kindOf = (e) => {
    const t = (e.title || '').toLowerCase();
    if (e.subType === 'due' || e.subType === 'other') return ['task', 'Opdracht'];
    if (e.subType === 'announcement' || e.subType === 'advalvas') return ['bell', 'Mededeling'];
    if (/\.(mp4|mov|m4v|avi|mkv)$/.test(t)) return ['film', 'Video'];
    if (/\.[a-z0-9]{2,5}$/.test(t)) return ['doc', 'Bestand'];
    return ['page', 'Pagina'];
  };
  async function api(path) {
    const r = await fetch(API + path, { credentials: 'include', headers: { Accept: 'application/json', 'Toledo-Language': 'nl' } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  // ---------- state ----------
  let enabled = true;
  let host = null, shadow = null, data = null, loading = null, settings = { clearedAt: 0, custom: [] };

  if (isHome(location.hash)) document.documentElement.classList.add('tplus-on');
  local.get(['enabled', 'clearedAt', 'custom']).then((v) => {
    enabled = v.enabled !== false;
    settings.clearedAt = v.clearedAt || 0;
    settings.custom = Array.isArray(v.custom) ? v.custom : [];
    sync();
  });
  window.addEventListener('hashchange', sync);

  function whenBody(fn) {
    if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function sync() {
    const on = enabled && isHome(location.hash);
    document.documentElement.classList.toggle('tplus-on', on);
    whenBody(() => { ensureSwitch(); if (on) mount(); });
  }

  function ensureSwitch() {
    if (document.getElementById('tplus-switch')) return;
    const b = document.createElement('button');
    b.id = 'tplus-switch';
    b.type = 'button';
    b.textContent = 'Toledo+';
    b.title = 'Toon de Toledo+ startpagina';
    b.addEventListener('click', async () => {
      enabled = true; await local.set({ enabled: true });
      if (!isHome(location.hash)) location.hash = '#/home'; else sync();
    });
    document.body.appendChild(b);
  }

  function readInitials() {
    // The classic portal shows the user's initials in its navbar; reuse them if present.
    const nodes = document.querySelectorAll('nav a, nav button, nav span');
    for (const n of nodes) { const t = (n.textContent || '').trim(); if (/^[A-ZÀ-Ý]{2,3}$/.test(t)) return t; }
    return '';
  }

  function mount() {
    if (!host) {
      host = document.createElement('div');
      host.id = 'tplus-root';
      shadow = host.attachShadow({ mode: 'open' });
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('ui.css');
      shadow.appendChild(link);
      const shell = document.createElement('div');
      shell.className = 'tplus-shell';
      shadow.appendChild(shell);
      shadow.addEventListener('click', onClick);
      shadow.addEventListener('input', onInput);
      shadow.addEventListener('submit', onSubmit);
      document.addEventListener('keydown', onKey);
      document.body.prepend(host);
    }
    render();
    if (!data && !loading) load();
  }

  async function load() {
    loading = Promise.allSettled([api('enrollments'), api('events'), api('upcoming'), api('emails/unread'), api('links')]);
    const [enr, ev, up, mail, links] = await loading;
    loading = null;
    if (enr.status === 'rejected' && ev.status === 'rejected') {
      data = { error: 'Toledo gaf geen gegevens terug. Ben je nog aangemeld?' };
    } else {
      data = {
        enrollments: enr.value || [], events: ev.value || [], upcoming: up.value || [],
        mail: mail.value?.value ?? null, links: (links.value || []).flatMap((g) => g.links || []),
        initials: readInitials(),
      };
    }
    render();
  }

  // ---------- model ----------
  function model() {
    const now = Date.now();
    const enr = data.enrollments;
    const courses = enr.filter((e) => e.type === 'course');
    const year = Math.max(0, ...courses.map((c) => c.academicYear || 0));
    const byId = Object.fromEntries(enr.map((e) => [e.learningUnitId, e]));
    const events = data.events.filter((e) => !e.dismissed);

    const unread = events.filter((e) => e.type === 'notifications' && !e.read && e.date > settings.clearedAt && e.subType !== 'due');
    const groups = {};
    for (const e of unread) {
      const g = groups[e.sourceId] ||= { id: e.sourceId, name: courseName(e.source), color: colorOf(byId[e.sourceId]?.color ?? e.color), link: byId[e.sourceId]?.link || '#', items: [], latest: 0 };
      g.items.push(e); g.latest = Math.max(g.latest, e.date);
    }
    const updates = Object.values(groups).sort((a, b) => b.latest - a.latest);
    updates.forEach((g) => g.items.sort((a, b) => b.date - a.date));
    const unreadBy = Object.fromEntries(updates.map((g) => [g.id, g.items.length]));

    const seen = new Set();
    const deadlines = [];
    for (const e of events) {
      if (e.subType !== 'due' || e.date < now - DAY / 2) continue;
      const key = e.title + '|' + e.sourceId;
      if (seen.has(key)) continue; seen.add(key);
      deadlines.push({ title: e.title, course: courseName(e.source), color: colorOf(byId[e.sourceId]?.color ?? e.color), date: e.date, url: e.url, source: 'Toledo' });
    }
    for (const c of settings.custom) {
      const t = new Date(c.date).getTime();
      if (t >= now - DAY / 2) deadlines.push({ title: c.title, course: c.course || 'Eigen deadline', color: '#8E8E93', date: t, url: null, source: 'Eigen', id: c.id });
    }
    deadlines.sort((a, b) => a.date - b.date);

    const notices = events.filter((e) => e.subType === 'advalvas' || e.subType === 'announcement')
      .sort((a, b) => b.date - a.date).slice(0, 6);

    const current = courses.filter((c) => c.academicYear === year)
      .map((c) => ({ ...c, unread: unreadBy[c.learningUnitId] || 0 }))
      .sort((a, b) => (b.available - a.available) || (b.favorite - a.favorite) || (b.unread - a.unread) || courseName(a.title).localeCompare(courseName(b.title)));
    const others = enr.filter((e) => !(e.type === 'course' && e.academicYear === year))
      .sort((a, b) => courseName(a.title).localeCompare(courseName(b.title)));

    const days = {};
    for (const s of data.upcoming.slice().sort((a, b) => a.start - b.start)) (days[startOfDay(s.start).getTime()] ||= []).push(s);

    const link = (label) => {
      const l = data.links.find((x) => x.label === label);
      if (!l?.url) return null;
      return /^https?:/.test(l.url) ? l.url : location.origin + '/' + l.url.replace(/^\//, '');
    };

    return { updates, unreadTotal: unread.length, deadlines, notices, current, others, days, byId, link };
  }

  // ---------- render ----------
  function render() {
    const shell = shadow.querySelector('.tplus-shell');
    if (!data) { shell.innerHTML = navHTML(null) + `<main class="page">${heroHTML(null)}<div class="group">${'<div class="skeleton"></div>'.repeat(5)}</div></main>`; return; }
    if (data.error) { shell.innerHTML = navHTML(null) + `<main class="page"><div class="group"><p class="error">${esc(data.error)}</p></div><p class="sec-foot"><button class="btn btn-plain" data-action="classic">Toon de klassieke Toledo</button></p></main>`; return; }
    const m = model();
    shell.innerHTML = `
      ${navHTML(m)}
      <main class="page">
        ${heroHTML(m)}
        <div class="cols">
          <div class="col-main">
            ${deadlinesHTML(m)}
            ${updatesHTML(m)}
            ${coursesHTML(m)}
          </div>
          <aside class="col-side">
            ${scheduleHTML(m)}
            ${noticesHTML(m)}
          </aside>
        </div>
      </main>
      <footer class="foot">
        <span>Toledo+ · persoonlijke extensie · gegevens rechtstreeks uit Toledo</span>
        <button type="button" data-action="classic">Klassieke Toledo</button>
      </footer>`;
  }

  function navHTML(m) {
    const mail = data?.mail;
    const notif = m?.link('NOTIFICATION-SETTINGS');
    const enroll = m?.link('TOLBIZZ-ENROLL');
    const logout = m?.link('LOGOUT');
    return `
    <header class="nav">
      <div class="nav-inner">
        <a class="brand" href="#/home" aria-label="Toledo+ start"><span class="brand-mark">T</span>Toledo+</a>
        <label class="search">
          ${ICON.search}
          <span class="sr-only">Zoek in vakken, deadlines en updates</span>
          <input type="search" data-role="search" placeholder="Zoeken" autocomplete="off">
          <kbd>⌘K</kbd>
        </label>
        <div class="nav-actions">
          <a class="icon-btn" href="https://outlook.office.com/mail/" target="_blank" rel="noopener" aria-label="Mail${mail ? `, ${mail} ongelezen` : ''}">
            ${ICON.mail}${mail ? `<span class="badge">${mail > 99 ? '99+' : mail}</span>` : ''}
          </a>
          <details class="menu">
            <summary class="icon-btn" aria-label="Account en instellingen"><span class="avatar">${esc(data?.initials || '•••')}</span></summary>
            <div class="menu-pop" role="menu">
              ${notif ? `<a role="menuitem" href="${esc(notif)}">Meldingsinstellingen</a>` : ''}
              ${enroll ? `<a role="menuitem" href="${esc(enroll)}">Inschrijven in een vak</a>` : ''}
              <button type="button" role="menuitem" data-action="classic">Klassieke Toledo</button>
              ${logout ? `<hr><a role="menuitem" href="${esc(logout)}">Afmelden</a>` : ''}
            </div>
          </details>
        </div>
      </div>
    </header>`;
  }

  function heroHTML(m) {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Goeiemorgen' : h < 18 ? 'Goeiemiddag' : 'Goeienavond';
    const today = fmt(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' });
    let sub = 'Gegevens laden…';
    if (m) {
      const parts = [];
      const tomorrow = Object.entries(m.days).find(([d]) => daysUntil(Number(d)) <= 1 && daysUntil(Number(d)) >= 0);
      if (tomorrow) parts.push(`${daysUntil(Number(tomorrow[0])) === 0 ? 'Vandaag' : 'Morgen'} ${tomorrow[1].length} ${tomorrow[1].length === 1 ? 'les' : 'lessen'}.`);
      const next = m.deadlines[0];
      if (next) parts.push(`Volgende deadline <strong>${esc(relDay(next.date))}</strong>.`);
      parts.push(m.unreadTotal ? `${m.unreadTotal} nieuwe items.` : 'Je bent helemaal bij.');
      sub = parts.join(' ');
    }
    return `
    <section class="hero">
      <div>
        <p class="eyebrow">${esc(today)}</p>
        <h1>${greet}</h1>
        <p class="sub">${sub}</p>
      </div>
      ${m ? `<div class="hero-actions">
        <button type="button" class="btn btn-tinted" data-action="ics">${ICON.cal} Naar agenda</button>
      </div>` : ''}
    </section>`;
  }

  function deadlinesHTML(m) {
    const rows = m.deadlines.slice(0, 8).map((d) => {
      const n = daysUntil(d.date);
      const urgent = n <= 14;
      const inner = `
        <div class="date-tile ${urgent ? 'urgent' : ''}"><span class="d">${fmt(d.date, { day: 'numeric' })}</span><span class="m">${esc(fmt(d.date, { month: 'short' }).replace('.', ''))}</span></div>
        <div class="main">
          <div class="title strong">${esc(d.title)}${d.source === 'Eigen' ? '<span class="tag">Eigen</span>' : ''}</div>
          <div class="meta"><span class="dot" style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${d.color}"></span>${esc(d.course)} · ${esc(fmt(d.date, { weekday: 'long' }))}</div>
        </div>
        <div class="trail due ${urgent ? 'urgent' : ''}">${esc(relDay(d.date))}<small>${esc(hm(d.date))}</small></div>`;
      const q = esc((d.title + ' ' + d.course).toLowerCase());
      if (d.source === 'Eigen') return `<div class="row" data-q="${q}" style="--inset:80px">${inner}<button type="button" class="btn btn-plain" data-action="del" data-id="${esc(d.id)}" aria-label="Verwijder ${esc(d.title)}">Verwijder</button></div>`;
      return `<a class="row" href="${esc(d.url)}" data-q="${q}" style="--inset:80px">${inner}${ICON.chev}</a>`;
    }).join('');
    const courses = m.current.map((c) => `<option>${esc(courseName(c.title))}</option>`).join('');
    return `
    <section aria-labelledby="tp-dl">
      <div class="sec-head"><h2 id="tp-dl">Deadlines</h2><button type="button" class="btn btn-plain" data-action="add" aria-expanded="false">${ICON.plus} Toevoegen</button></div>
      <div class="group" data-section>
        ${rows || '<p class="empty">Geen openstaande deadlines op Toledo.</p>'}
        <form class="sheet" data-role="add" hidden>
          <label>Titel<input name="title" required placeholder="bv. Scène 1 uploaden"></label>
          <label>Vak<select name="course"><option value="">—</option>${courses}</select></label>
          <label>Datum en uur<input name="date" type="datetime-local" required></label>
          <div class="actions"><button class="btn btn-filled" type="submit">Bewaar</button><button class="btn btn-plain" type="button" data-action="add">Annuleer</button></div>
        </form>
      </div>
      <p class="sec-foot">Uit Toledo-opdrachten. Deadlines uit opdrachtbladen of frame.io voeg je zelf toe; ze blijven in deze browser.</p>
    </section>`;
  }

  function updatesHTML(m) {
    const blocks = m.updates.map((g) => {
      const shown = g.items.slice(0, 4);
      const rest = g.items.length - shown.length;
      const items = shown.map((e) => {
        const [k, label] = kindOf(e);
        return `<a class="item" href="${esc(e.url)}" data-q="${esc((e.title + ' ' + g.name).toLowerCase())}"><span class="kind" title="${label}">${ICON[k]}<span class="sr-only">${label}</span></span><span class="t">${esc(e.title)}</span></a>`;
      }).join('');
      return `
      <div class="course-block" data-section>
        <div class="course-head">
          <span class="dot" style="background:${g.color}"></span>
          <a class="name" href="${esc(g.link)}">${esc(g.name)}</a>
          <span class="pill">${g.items.length}</span>
          <time>${esc(ago(g.latest))}</time>
        </div>
        ${items}
        ${rest > 0 ? `<a class="more" href="${esc(g.link)}">en nog ${rest}</a>` : ''}
      </div>`;
    }).join('');
    return `
    <section aria-labelledby="tp-new">
      <div class="sec-head"><h2 id="tp-new">Nieuw <span class="count">${m.unreadTotal || ''}</span></h2>${m.unreadTotal ? '<button type="button" class="btn btn-plain" data-action="clear">Wis</button>' : ''}</div>
      <div class="group">${blocks || '<p class="empty">Niets nieuws sinds je laatste bezoek.</p>'}</div>
    </section>`;
  }

  function coursesHTML(m) {
    const card = (c) => {
      const sem = { SEMESTER1: 'Semester 1', SEMESTER2: 'Semester 2', YEAR: 'Jaarvak' }[c.semester] || (c.type === 'community' ? 'Community' : '');
      return `<a class="card ${c.available ? '' : 'dim'}" href="${esc(c.link)}" data-q="${esc(c.title.toLowerCase())}">
        <div class="top"><span class="swatch" style="background:${colorOf(c.color)}"></span>${c.unread ? `<span class="pill" aria-label="${c.unread} nieuw">${c.unread}</span>` : ''}</div>
        <div class="nm">${esc(courseName(c.title))}</div>
        <div class="cd">${esc([courseCode(c.title), sem, c.available ? '' : 'nog niet beschikbaar'].filter(Boolean).join(' · '))}</div>
      </a>`;
    };
    return `
    <section aria-labelledby="tp-c">
      <div class="sec-head"><h2 id="tp-c">Vakken</h2></div>
      <div class="grid">${m.current.map(card).join('')}</div>
      ${m.others.length ? `<details class="more-courses"><summary>Communities en vorige jaren (${m.others.length})</summary><div class="grid">${m.others.map(card).join('')}</div></details>` : ''}
    </section>`;
  }

  function scheduleHTML(m) {
    const entries = Object.entries(m.days);
    const body = entries.map(([d, list]) => {
      const n = daysUntil(Number(d));
      const label = n === 0 ? 'Vandaag' : n === 1 ? 'Morgen' : fmt(Number(d), { weekday: 'long', day: 'numeric', month: 'long' });
      return `<div class="day-label">${esc(label)} · ${esc(fmt(Number(d), { day: 'numeric', month: 'numeric' }))}</div>` + list.map((s) => {
        const loc = [s.location?.mnemonic, s.location?.roomNumber].filter((x) => x && x !== '?').join(' ');
        return `<a class="slot" href="${esc(s.source?.link || '#')}">
          <div class="time">${esc(hm(s.start))}<span>${esc(hm(s.end))}</span></div>
          <div class="bar" style="background:${colorOf(s.source?.color)}"></div>
          <div><div class="n">${esc(s.name)}</div><div class="w">${esc(loc || 'Lokaal niet vermeld')}</div></div>
        </a>`;
      }).join('');
    }).join('');
    return `
    <section aria-labelledby="tp-s">
      <div class="sec-head"><h2 id="tp-s">Rooster</h2></div>
      <div class="group">${body || '<p class="empty">Geen lessen vandaag of morgen.</p>'}</div>
    </section>`;
  }

  function noticesHTML(m) {
    const rows = m.notices.map((e) => `
      <a class="row" href="${esc(e.url)}" data-q="${esc((e.title + ' ' + e.source).toLowerCase())}">
        ${!e.read ? '<span class="dot" style="background:var(--tint);width:8px;height:8px" aria-label="Ongelezen"></span>' : '<span class="dot" style="background:transparent;width:8px;height:8px"></span>'}
        <div class="main"><div class="title ${e.read ? '' : 'strong'}" style="font-size:15px;line-height:1.33">${esc(e.title)}</div>
        <div class="meta" style="font-size:13px">${esc(courseName(e.source))} · ${esc(ago(e.date))}</div></div>
      </a>`).join('');
    return `
    <section aria-labelledby="tp-n">
      <div class="sec-head"><h2 id="tp-n">Mededelingen</h2></div>
      <div class="group">${rows || '<p class="empty">Geen mededelingen.</p>'}</div>
    </section>`;
  }

  // ---------- interactions ----------
  async function onClick(ev) {
    const a = ev.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'classic') { ev.preventDefault(); enabled = false; await local.set({ enabled: false }); sync(); }
    if (act === 'clear') { settings.clearedAt = Date.now(); await local.set({ clearedAt: settings.clearedAt }); render(); }
    if (act === 'ics') downloadICS(model().deadlines);
    if (act === 'add') {
      const f = shadow.querySelector('[data-role="add"]');
      f.hidden = !f.hidden;
      shadow.querySelectorAll('[data-action="add"][aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', String(!f.hidden)));
      if (!f.hidden) f.querySelector('input').focus();
    }
    if (act === 'del') {
      settings.custom = settings.custom.filter((c) => c.id !== a.dataset.id);
      await local.set({ custom: settings.custom }); render();
    }
  }
  async function onSubmit(ev) {
    const f = ev.target.closest('[data-role="add"]');
    if (!f) return;
    ev.preventDefault();
    const fd = new FormData(f);
    settings.custom.push({ id: String(Date.now()), title: fd.get('title'), course: fd.get('course'), date: fd.get('date') });
    await local.set({ custom: settings.custom });
    render();
  }
  function onInput(ev) {
    if (ev.target.dataset.role !== 'search') return;
    const q = ev.target.value.trim().toLowerCase();
    shadow.querySelectorAll('[data-q]').forEach((el) => { el.hidden = !!q && !el.dataset.q.includes(q); });
    shadow.querySelectorAll('.course-block').forEach((b) => {
      const any = [...b.querySelectorAll('[data-q]')].some((x) => !x.hidden) || (q && b.querySelector('.name').textContent.toLowerCase().includes(q));
      b.hidden = !!q && !any;
      if (any && q) b.querySelectorAll('[data-q]').forEach((x) => { if (b.querySelector('.name').textContent.toLowerCase().includes(q)) x.hidden = false; });
    });
    // Hide whole sections that have nothing left to show while searching.
    shadow.querySelectorAll('section').forEach((s) => {
      const rows = s.querySelectorAll('[data-q]');
      s.hidden = !!q && rows.length > 0 && ![...rows].some((x) => !x.hidden);
    });
  }
  function onKey(ev) {
    if (!document.documentElement.classList.contains('tplus-on')) return;
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      shadow.querySelector('[data-role="search"]')?.focus();
    }
  }

  function downloadICS(list) {
    const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const escI = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Toledo+//NL', 'CALSCALE:GREGORIAN'];
    for (const d of list) {
      lines.push('BEGIN:VEVENT',
        `UID:${stamp(d.date)}-${escI(d.title).slice(0, 40).replace(/\s+/g, '-')}@toledo-plus`,
        `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(d.date - 30 * 60e3)}`,
        `DTEND:${stamp(d.date)}`,
        `SUMMARY:${escI(`${d.course}: DEADLINE ${d.title}`)}`,
        d.url ? `URL:${d.url}` : '',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(d.title)}`, 'TRIGGER:-P1D', 'END:VALARM',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.filter(Boolean).join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'toledo-deadlines.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }
})();
