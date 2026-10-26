'use strict';
// Mock "internet" for the e2e tests, built on Playwright context routing.
// Context-level routes also intercept requests made by the extension's background
// service worker (the cross-origin relay) in Playwright ≥ 1.4x/Chromium; we set
// PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 for older versions too.
//
// Origins served:
//   https://toledo.kuleuven.be                     portal HTML + /portal/api/*
//   https://icts-p-toledo-journey.cloud.icts.kuleuven.be   ultraLink → 302 to the course outline
//   https://ultra.edu.kuleuven.cloud               Ultra HTML (with <base href> to a CDN!) + /learn/api/public/*
//   https://files.mock-storage.test                "S3": signed file downloads with ACAO:*
//
// NOTE: Playwright does not intercept the follow-up request of a 3xx produced by route.fulfill().
//  - download 302s therefore land on a real local HTTPS server (files-server.js, mapped via --host-resolver-rules);
//  - the journey ultraLink "redirect" is a tiny HTML page doing location.replace() instead of a 302.
//   https://cdn.example.invalid                    the <base href> target – any hit here is a relative-URL bug
// Any other http(s) request is recorded as `foreign` and aborted (privacy: no third-party calls).

const PORTAL = 'https://toledo.kuleuven.be';
const JOURNEY = 'https://icts-p-toledo-journey.cloud.icts.kuleuven.be';
const ULTRA = 'https://ultra.edu.kuleuven.cloud';
const FILES = 'https://files.mock-storage.test';
const CDN = 'https://cdn.example.invalid';
const API = 'https://api.toledoplus.be'; // Toledo+'s own API (ping/latest/feedback)

// Emulates the live portal's AngularJS router (verified live): any hash whose path is not a known
// route ('#/tplus/x', '#/home/tplus/x', '#!/x', …) is rewritten to '#/home' shortly after load/hashchange;
// the '?query' survives only on '#/home'. '/deep/*' stands in for the portal's real non-home pages.
const ANGULAR_ROUTER = `(function () {
  var KNOWN = /^(|\\/|\\/home\\/?|\\/deep\\/.+)$/;
  function check() {
    var h = location.hash;
    var path = (/^#([^?]*)/.exec(h) || ['', ''])[1];
    if (KNOWN.test(path)) return;
    window.__tpRouterBounces = (window.__tpRouterBounces || 0) + 1;
    setTimeout(function () { if (location.hash === h) location.hash = '#/home'; }, 50);
  }
  window.addEventListener('hashchange', check);
  check();
})();`;

const PORTAL_HTML = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Toledo</title>
<style>body{font-family:Arial;padding-top:60px;margin:0}.navbar{background:#0a3e72;color:#fff;padding:10px;position:fixed;top:0;left:0;right:0}</style></head>
<body><div id="app"><nav class="navbar">Toledo (klassiek)</nav><div class="main-content" id="classic-portal"><h3>Klassiek portaal</h3><p>Tegels…</p></div><footer>footer</footer></div>
<script>${ANGULAR_ROUTER}</script></body></html>`;

const ultraHtml = (title) => `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<base href="${CDN}/">
<title>${title}</title>
<style>html,body{overflow:hidden;height:100%;margin:0}#site-wrap{height:100%;background:#eee}</style></head>
<body><div id="site-wrap"><h1 id="ultra-classic">ULTRA KLASSIEK</h1>
<a id="go-item" href="#" onclick="history.pushState({},'',location.origin+'/ultra/courses/_900661_1/outline/file/_5000_1');return false">open item</a>
<a id="go-stream" href="#" onclick="history.pushState({},'',location.origin+'/ultra/stream');return false">stream</a></div></body></html>`;

const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });

function allNodes(tree) {
  const out = {};
  const walk = (l) => l.forEach((x) => { out[x.id] = x; if (x._kids) walk(x._kids); });
  walk(tree);
  return out;
}
const strip = (l) => l.map(({ _kids, _attachments, ...r }) => r);

/**
 * Install all routes on a BrowserContext.
 * @param ctx  Playwright BrowserContext
 * @param fx   result of fixtures.load()
 * @param opts { ultraDown?: boolean (Ultra API answers 401), portalDown?: boolean (portal API 500), latency?: ms,
 *               files?: files-server instance (set by launch) }
 * @returns recorder { requests, patches, foreign, cdn, downloads, unknown, find(fn), reset() }
 */
async function install(ctx, fx, opts = {}) {
  const rec = { requests: [], patches: [], foreign: [], cdn: [], downloads: [], unknown: [], api: [] };
  // Redirect targets are served by a real local HTTPS server (see files-server.js).
  if (opts.files) opts.files.onRequest((d) => { rec.downloads.push(d); rec.requests.push({ method: 'GET', url: d.url, headers: d.headers, body: null }); });
  rec.find = (fn) => rec.requests.filter(fn);
  rec.reset = () => { for (const k of ['requests', 'patches', 'foreign', 'cdn', 'downloads', 'unknown', 'api']) rec[k].length = 0; };
  const P = fx.portal; const U = fx.ultra;
  const delay = () => (opts.latency ? new Promise((r) => setTimeout(r, opts.latency)) : null);
  const log = (req) => {
    const entry = { method: req.method(), url: req.url(), body: req.postData(), headers: req.headers(), sw: !req.frame || safeIsSW(req) };
    rec.requests.push(entry);
    return entry;
  };

  // ---- Portal
  await ctx.route(`${PORTAL}/**`, async (route) => {
    const req = route.request(); const e = log(req); await delay();
    const u = new URL(req.url()); const m = u.pathname.match(/^\/portal\/api\/(.+)$/);
    if (m) {
      if (opts.portalDown) return json(route, { error: 'down' }, 500);
      const p = m[1]; const method = req.method();
      if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch (_) { body = req.postData(); }
        rec.patches.push({ method, path: u.pathname, body });
        if (p === 'batch/events' && Array.isArray(body)) {
          for (const b of body) { const ev = P.events.find((x) => x.id === b.id); if (ev) Object.assign(ev, pick(b, ['read', 'seen', 'dismissed'])); }
          return json(route, body);
        }
        const em = p.match(/^enrollments\/([^/]+)$/);
        if (em) { const en = P.enrollments.find((x) => x.id === decodeURIComponent(em[1])); if (en && body) Object.assign(en, pick(body, ['favorite'])); return json(route, en || {}, en ? 200 : 404); }
        rec.unknown.push(e); return json(route, {}, 404);
      }
      const map = { enrollments: P.enrollments, events: P.events, upcoming: P.upcoming, 'emails/unread': P.mail, links: P.links };
      if (p in map) return json(route, map[p]);
      rec.unknown.push(e); return json(route, { error: 'not mocked' }, 404);
    }
    if (u.pathname.startsWith('/Shibboleth.sso/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Afgemeld</title><p>Logged out (mock)</p>' });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PORTAL_HTML });
  });

  // ---- Journey redirect (enrollment.link)
  await ctx.route(`${JOURNEY}/**`, async (route) => {
    const req = route.request(); log(req);
    const lu = new URL(req.url()).searchParams.get('batchUid');
    const course = Object.values(U.courses).find((c) => c.courseId === lu);
    if (!course) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'unknown course' });
    const to = `${ULTRA}/ultra/courses/${course.id}/outline`;
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta http-equiv="refresh" content="0;url=${to}"><script>location.replace(${JSON.stringify(to)})</script>` });
  });

  // ---- Ultra
  await ctx.route(`${ULTRA}/**`, async (route) => {
    const req = route.request(); const e = log(req); await delay();
    const u = new URL(req.url()); const path = u.pathname;
    if (path.startsWith('/learn/api/')) {
      if (opts.ultraDown) return json(route, { status: 401, message: 'Unauthorized' }, 401);
      const r = ultraApi(U, path, u, rec, opts);
      if (r && r.redirect && !opts.files) { // no local storage server: serve the file inline
        const t = new URL(r.redirect); const fileName = decodeURIComponent(t.pathname.split('/').pop());
        rec.downloads.push({ url: r.redirect, fileName, headers: {}, via: 'inline' });
        return route.fulfill({ status: 200, headers: { 'content-type': t.searchParams.get('type') || 'application/octet-stream' }, body: Buffer.from(`MOCK FILE ${fileName}\n`) });
      }
      if (r && r.redirect) return route.fulfill({ status: 302, headers: { location: r.redirect, 'cache-control': 'no-store' } });
      if (r === null) { rec.unknown.push(e); return json(route, { status: 404, message: 'not mocked' }, 404); }
      return json(route, r);
    }
    const t = path.match(/^\/ultra\/courses\/([^/]+)/);
    const title = t && U.courses[t[1]] ? `Content / ${U.courses[t[1]].name}` : 'Blackboard Learn';
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: ultraHtml(title) });
  });

  // ---- "S3"
  await ctx.route(`${FILES}/**`, async (route) => {
    const req = route.request(); log(req);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,HEAD,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url()); const fileName = decodeURIComponent(u.pathname.split('/').pop());
    rec.downloads.push({ url: req.url(), fileName, headers: req.headers() });
    const mime = u.searchParams.get('type') || 'application/octet-stream';
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': mime }, body: Buffer.from(`MOCK FILE ${fileName}\n`) });
  });

  // ---- base-href CDN (must never be hit)
  await ctx.route(`${CDN}/**`, async (route) => { rec.cdn.push(route.request().url()); log(route.request()); return route.fulfill({ status: 404, body: 'relative URL bug' }); });

  // ---- Toledo+ API (anonymous ping + update check): answered here so no test has to ignore it.
  //      "latest" = the version under test, so no update banner appears (feedback.e2e overrides this route).
  const VERSION = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'manifest.json'), 'utf8')).version;
  await ctx.route(`${API}/**`, async (route) => {
    const req = route.request(); log(req);
    const u = new URL(req.url());
    rec.api.push({ method: req.method(), path: u.pathname });
    if (req.method() === 'GET' && u.pathname === '/v1/latest') return json(route, { version: VERSION, url: null, notes: '' });
    if (req.method() === 'POST' && (u.pathname === '/v1/ping' || u.pathname === '/v1/forget')) return route.fulfill({ status: 204 });
    rec.unknown.push({ method: req.method(), url: req.url() });
    return json(route, { error: 'not mocked' }, 404);
  });

  // ---- Everything else = third party → forbidden
  await ctx.route(/^https?:\/\//, async (route) => {
    const u = route.request().url();
    if ([PORTAL, JOURNEY, ULTRA, FILES, CDN, API].some((o) => u.startsWith(o))) return route.fallback();
    rec.foreign.push(u); log(route.request());
    return route.abort('blockedbyclient');
  });
  await require('./kuloket-mock').install(ctx, rec, opts); // KU Loket + TimeEdit (registered last → matched first)
  return rec;
}

function safeIsSW(req) { try { return !!req.serviceWorker(); } catch (_) { return false; } }
function pick(o, keys) { const r = {}; for (const k of keys) if (o && k in o) r[k] = o[k]; return r; }

function ultraApi(U, path, url, rec, opts = {}) {
  let m;
  const p = path.replace(/^\/learn\/api\/public\/v\d+/, '');
  // Fictitious student (greeting "Goedenavond, Alex"); opts.noUser → 404 (no name known)
  if (p === '/users/me') return opts.noUser ? null : { id: '_me_1', userName: 'r0000000', name: { given: 'Alex Jan', family: 'Voorbeeld', preferredDisplayName: 'GivenName' } };
  if (p === '/calendars/items') {
    const since = Date.parse(url.searchParams.get('since') || 0) || 0; const until = Date.parse(url.searchParams.get('until') || 0) || Infinity;
    return { results: U.calendarItems.filter((i) => { const t = Date.parse(i.end); return t >= since && t <= until; }) };
  }
  if ((m = p.match(/^\/courses\/courseId:(.+)$/))) {
    const lu = decodeURIComponent(m[1]); const c = Object.values(U.courses).find((x) => x.courseId === lu);
    return c || null;
  }
  if ((m = p.match(/^\/courses\/([^/]+)$/))) return U.courses[decodeURIComponent(m[1])] || null;
  if (!(m = p.match(/^\/courses\/([^/]+)(\/.*)$/))) return null;
  const cid = decodeURIComponent(m[1]); const rest = m[2];
  if (!U.courses[cid]) return null;
  const tree = U.trees[cid] || cloneTree(U, cid);
  const nodes = allNodes(tree);
  if (rest === '/contents') return { results: strip(tree) };
  if ((m = rest.match(/^\/contents\/([^/]+)\/children$/))) { const n = nodes[m[1]]; return n ? { results: strip(n._kids || []) } : null; }
  if ((m = rest.match(/^\/contents\/([^/]+)\/attachments$/))) { const n = nodes[m[1]]; return n ? { results: n._attachments || [] } : null; }
  if ((m = rest.match(/^\/contents\/([^/]+)\/attachments\/([^/]+)\/download$/))) {
    const n = nodes[m[1]]; const a = n && (n._attachments || []).find((x) => x.id === decodeURIComponent(m[2]));
    if (!a) return null;
    return { redirect: `${FILES}/bucket/${cid}/${encodeURIComponent(a.id)}/${encodeURIComponent(a.fileName)}?X-Amz-Signature=mock&type=${encodeURIComponent(a.mimeType)}` };
  }
  if ((m = rest.match(/^\/contents\/([^/]+)$/))) { const n = nodes[m[1]]; return n ? strip([n])[0] : null; }
  const anns = (U.announcements[cid] || []);
  if (rest === '/announcements') return { results: anns };
  if ((m = rest.match(/^\/announcements\/([^/]+)$/))) return anns.find((a) => a.id === m[1]) || null;
  if (rest === '/gradebook/columns') return { results: U.columns[cid] || [] };
  if (rest === '/users') return { results: U.instructors[cid] || [] };
  return null;
}

// Courses without an explicit tree get a small default one with unique ids.
const treeCaches = new WeakMap();
function cloneTree(U, cid) {
  if (!treeCaches.has(U)) treeCaches.set(U, {});
  const treeCache = treeCaches.get(U);
  if (treeCache[cid]) return treeCache[cid];
  let i = 0; const suffix = cid.replace(/\W/g, '');
  const walk = (l) => l.map((x) => {
    const id = `_d${suffix}x${i++}_1`;
    return { ...x, id, links: [{ href: `/ultra/redirect?redirectType=nautilus&courseId=${cid}&contentId=${id}` }], _attachments: x._attachments ? x._attachments.map((a) => ({ ...a, id: `_att${id}` })) : undefined, _kids: x._kids ? walk(x._kids) : undefined };
  });
  return (treeCache[cid] = walk(U.defaultTree));
}

module.exports = { install, PORTAL, ULTRA, FILES, CDN, JOURNEY, allNodes };
