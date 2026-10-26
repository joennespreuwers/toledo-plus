/* Toledo+ API — Cloudflare Worker (ES module, no dependencies).
 *
 * Routes (https://api.toledoplus.be):
 *   POST /v1/ping       {id, v, browser, lang}                      → 204   anonymous daily usage signal
 *   POST /v1/forget     {id}                                        → 204   opt-out: delete everything stored for this install id
 *   POST /v1/feedback   {id?, kind, text, contact?, v?, browser?, lang?, page?, website?}  → 201 {ok:true}
 *   GET  /v1/latest     → {version, url, notes}  (Cache-Control 10 min)
 *   GET  /v1/stats      → JSON dashboard data    (Authorization: Bearer STATS_TOKEN)
 *   GET  /v1/stats.html → dashboard page that asks for the token (kept in sessionStorage) and fetches /v1/stats
 *
 * Privacy: no raw IPs are stored or logged. Rate limits key on SHA-256(SALT | UTC day | IP), truncated; the salt
 * rotates daily by construction (the day is part of the hash input), and counter rows are deleted after 2 days.
 * Feedback `contact` stays in D1 and is never copied into the public GitHub issue.
 *
 * Bindings: DB (D1, required), RL (Workers Rate Limiting, optional burst limiter).
 * Secrets:  SALT (required for POST routes), STATS_TOKEN (enables /v1/stats), GITHUB_TOKEN (optional, creates issues).
 * Vars:     LATEST_VERSION, LATEST_URL, LATEST_NOTES, GITHUB_REPO (default joennespreuwers/toledo-plus),
 *           EXTENSION_IDS (optional comma list; when set only these extension ids pass CORS).
 */

export const MAX_BODY = 8 * 1024;
export const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;
export const BROWSERS = ['chrome', 'edge', 'brave', 'opera', 'other'];
export const LANGS = ['nl', 'en', 'fr'];
export const KINDS = ['idea', 'bug', 'other'];
export const PAGE = /^[a-z][a-z0-9-]{0,31}$/;
const DEFAULT_REPO = 'joennespreuwers/toledo-plus';
const HOUR = 3600;
const DAY_S = 86400;
const DAY_MS = DAY_S * 1000;

/** Fixed-window limits (in D1). `ip` = hashed IP, `install` = install id, `global` = everyone. */
export const LIMITS = {
  ping: [{ scope: 'ip', window: HOUR, limit: 10 }],
  forget: [{ scope: 'ip', window: HOUR, limit: 10 }],
  feedback: [
    { scope: 'ip', window: HOUR, limit: 5 },
    { scope: 'ip', window: DAY_S, limit: 20 },
    // checked after validation:
    { scope: 'install', window: DAY_S, limit: 10 },
    { scope: 'global', window: DAY_S, limit: 500 },
  ],
};

// ---------------------------------------------------------------- helpers

const nowMs = (env) => (env && typeof env.__now === 'function' ? env.__now() : Date.now());
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

class HttpError extends Error {
  constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; }
}

function isExtensionOrigin(origin, env) {
  const m = /^(chrome-extension|extension):\/\/([a-z0-9]{16,64})$/.exec(origin || '');
  if (!m) return false;
  const ids = String((env && env.EXTENSION_IDS) || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !ids.length || ids.includes(m[2]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || !isExtensionOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };

function respond(status, body, headers = {}) {
  const h = { ...BASE_HEADERS, ...headers };
  if (body === null || body === undefined) return new Response(null, { status, headers: h });
  if (typeof body === 'string') return new Response(body, { status, headers: h });
  h['Content-Type'] = 'application/json; charset=utf-8';
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pseudonymous per-day IP key: never reversible without the secret salt, unlinkable across days. */
export async function ipKey(env, ip, ms) {
  return (await sha256Hex(`${env.SALT}|${dayStr(ms)}|${ip || 'unknown'}`)).slice(0, 32);
}

/** Constant-time string comparison (compares SHA-256 digests). */
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0 && String(a).length === String(b).length;
}

/** Increment a fixed-window counter; → {ok, retryAfter}. */
export async function hit(env, key, windowSec, limit, ms) {
  const s = Math.floor(ms / 1000);
  const win = Math.floor(s / windowSec) * windowSec;
  const row = await env.DB.prepare(
    'INSERT INTO ratelimit (key, window, count) VALUES (?, ?, 1) ON CONFLICT (key, window) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(key, win).first();
  const count = row && typeof row.count === 'number' ? row.count : 1;
  return count > limit ? { ok: false, retryAfter: Math.max(1, win + windowSec - s) } : { ok: true };
}

async function enforce(env, route, scopes, ids, ms) {
  for (const l of LIMITS[route].filter((x) => scopes.includes(x.scope))) {
    const who = l.scope === 'global' ? 'all' : ids[l.scope];
    if (!who) continue;
    const r = await hit(env, `${route}:${l.scope}:${l.window}:${who}`, l.window, l.limit, ms);
    if (!r.ok) throw new HttpError(429, 'rate_limited', { retryAfter: r.retryAfter });
  }
}

/** Optional Workers Rate Limiting binding (approximate, per location, 10 s/60 s periods) as a burst guard. */
async function burst(env, route, ipHash) {
  if (!env.RL || typeof env.RL.limit !== 'function') return;
  try {
    const { success } = await env.RL.limit({ key: `${route}:${ipHash}` });
    if (!success) throw new HttpError(429, 'rate_limited', { retryAfter: 60 });
  } catch (e) {
    if (e instanceof HttpError) throw e; // binding failures fall back to the D1 limiter only
  }
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) throw new HttpError(415, 'unsupported_media_type');
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'too_large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY) throw new HttpError(413, 'too_large');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(buf)); } catch (_) { throw new HttpError(400, 'invalid_json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json');
  return body;
}

const bad = (field) => new HttpError(400, 'invalid', { field });

function onlyKeys(body, allowed) {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw bad(k);
}

/** Text cleanup: CRLF → LF, control chars (except \n and \t) removed, trimmed. */
export function cleanText(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '').trim();
}
const cpLen = (s) => [...s].length;

export function validatePing(b) {
  onlyKeys(b, ['id', 'v', 'browser', 'lang']);
  if (typeof b.id !== 'string' || !UUID4.test(b.id)) throw bad('id');
  if (typeof b.v !== 'string' || !SEMVER.test(b.v)) throw bad('v');
  if (!BROWSERS.includes(b.browser)) throw bad('browser');
  if (!LANGS.includes(b.lang)) throw bad('lang');
  return { id: b.id, v: b.v, browser: b.browser, lang: b.lang };
}

export function validateForget(b) {
  onlyKeys(b, ['id']);
  if (typeof b.id !== 'string' || !UUID4.test(b.id)) throw bad('id');
  return { id: b.id };
}

export function validateFeedback(b) {
  onlyKeys(b, ['id', 'kind', 'text', 'contact', 'v', 'browser', 'lang', 'page', 'website']);
  const out = {};
  if (b.id != null) { if (typeof b.id !== 'string' || !UUID4.test(b.id)) throw bad('id'); out.id = b.id; }
  if (!KINDS.includes(b.kind)) throw bad('kind');
  out.kind = b.kind;
  if (typeof b.text !== 'string') throw bad('text');
  out.text = cleanText(b.text);
  if (cpLen(out.text) < 10 || cpLen(out.text) > 4000) throw bad('text');
  if (b.contact != null) {
    if (typeof b.contact !== 'string') throw bad('contact');
    const c = cleanText(b.contact).replace(/\s+/g, ' ');
    if (cpLen(c) > 200) throw bad('contact');
    if (c) out.contact = c;
  }
  if (b.v != null) { if (typeof b.v !== 'string' || !SEMVER.test(b.v)) throw bad('v'); out.v = b.v; }
  if (b.browser != null) { if (!BROWSERS.includes(b.browser)) throw bad('browser'); out.browser = b.browser; }
  if (b.lang != null) { if (!LANGS.includes(b.lang)) throw bad('lang'); out.lang = b.lang; }
  if (b.page != null) { if (typeof b.page !== 'string' || !PAGE.test(b.page)) throw bad('page'); out.page = b.page; }
  if (b.website != null && typeof b.website !== 'string') throw bad('website');
  out.honeypot = typeof b.website === 'string' && b.website.trim() !== '';
  out.links = (out.text.match(/https?:\/\/|www\./gi) || []).length;
  return out;
}

/** Obvious test submissions from the feedback form: store as spam, do not create a GitHub issue. */
export function isTestFeedback(text) {
  let t = String(text || '').toLowerCase().trim();
  while (t && '.!?'.includes(t[t.length - 1])) t = t.slice(0, -1).trimEnd();
  const at = t.lastIndexOf('@');
  if (at >= 0) {
    const clock = t.slice(at + 1).trim();
    const parts = clock.split(':');
    const hh = parts.length === 2 ? Number(parts[0]) : NaN;
    const mm = parts.length === 2 ? Number(parts[1]) : NaN;
    const validClock = parts.length === 2 &&
      /^\d{1,2}$/.test(parts[0]) &&
      /^\d{2}$/.test(parts[1]) &&
      Number.isInteger(hh) &&
      Number.isInteger(mm) &&
      hh >= 0 && hh <= 23 &&
      mm >= 0 && mm <= 59;
    if (validClock) t = t.slice(0, at).trim();
  }
  t = t.replace(/\s+/g, ' ');
  return t === 'test' ||
    t === 'testing' ||
    t === 'just test' ||
    t === 'just testing' ||
    t === 'test this feature' ||
    t === 'testing this feature' ||
    t === 'just test this feature' ||
    t === 'just testing this feature';
}

// ---------------------------------------------------------------- GitHub

/** Neutralise @mentions so public issues never ping people. */
const noMentions = (s) => String(s).replace(/@(?=[A-Za-z0-9_-])/g, '@​');

export function issueFor(fb, rowId) {
  const first = fb.text.split('\n').map((l) => l.trim()).find(Boolean) || fb.kind;
  const short = cpLen(first) > 72 ? [...first].slice(0, 71).join('') + '…' : first;
  const label = { idea: 'Idea', bug: 'Bug', other: 'Feedback' }[fb.kind];
  const quoted = noMentions(fb.text).split('\n').map((l) => `> ${l}`).join('\n');
  const rows = [['Kind', fb.kind], ['Version', fb.v], ['Browser', fb.browser], ['Language', fb.lang], ['Page', fb.page], ['Feedback id', rowId]]
    .map(([k, v]) => `| ${k} | ${v == null || v === '' ? '—' : String(v).replace(/\|/g, '\\|')} |`).join('\n');
  return {
    title: `[${label}] ${noMentions(short)}`,
    body: `${quoted}\n\n| Field | Value |\n|---|---|\n${rows}\n\n` +
      '_Sent from the in-extension feedback form. Contact details, if any, are stored privately and are not shown here._',
    labels: ['feedback', 'needs-triage', fb.kind === 'bug' ? 'bug' : 'enhancement'],
  };
}

async function createIssue(env, fb, rowId) {
  const repo = env.GITHUB_REPO || DEFAULT_REPO;
  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'toledo-plus-api',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(issueFor(fb, rowId)),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  await env.DB.prepare("UPDATE feedback SET github_issue = ?, status = 'issued' WHERE id = ?").bind(data.number, rowId).run();
  return data.number;
}

// ---------------------------------------------------------------- routes

async function ping(request, env, ms) {
  const b = validatePing(await readJson(request));
  const day = dayStr(ms);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO installs (id, first_seen, last_seen, version, browser, lang) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, version = excluded.version, browser = excluded.browser, lang = excluded.lang',
    ).bind(b.id, ms, ms, b.v, b.browser, b.lang),
    env.DB.prepare(
      'INSERT INTO daily (day, id, version, browser, lang) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT (day, id) DO UPDATE SET version = excluded.version, browser = excluded.browser, lang = excluded.lang',
    ).bind(day, b.id, b.v, b.browser, b.lang),
  ]);
  return respond(204, null);
}

async function forget(request, env) {
  const { id } = validateForget(await readJson(request));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM installs WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM daily WHERE id = ?').bind(id),
    env.DB.prepare('UPDATE feedback SET install_id = NULL WHERE install_id = ?').bind(id),
  ]);
  return respond(204, null);
}

async function feedback(request, env, ctx, ms) {
  const fb = validateFeedback(await readJson(request));
  if (fb.honeypot) return respond(201, { ok: true }); // pretend success, store nothing
  if (fb.links > 3) throw new HttpError(422, 'spam');
  await enforce(env, 'feedback', ['install', 'global'], { install: fb.id }, ms);
  const status = isTestFeedback(fb.text) ? 'spam' : 'new';
  const row = await env.DB.prepare(
    'INSERT INTO feedback (created, install_id, kind, text, contact, version, browser, lang, page, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  ).bind(ms, fb.id || null, fb.kind, fb.text, fb.contact || null, fb.v || null, fb.browser || null, fb.lang || null, fb.page || null, status).first();
  if (status === 'new' && env.GITHUB_TOKEN && row && row.id != null) {
    const job = createIssue(env, fb, row.id).catch((e) => console.log('github issue failed:', String(e && e.message || e)));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job); else await job;
  }
  return respond(201, { ok: true });
}

async function configValues(env) {
  const cfg = {};
  try {
    const { results } = await env.DB.prepare("SELECT key, value FROM config WHERE key IN ('latest_version', 'latest_url', 'latest_notes')").all();
    for (const r of results || []) cfg[r.key] = r.value;
  } catch (_) { /* table missing → env vars only */ }
  return cfg;
}

async function latest(env) {
  const cfg = await configValues(env);
  let version = cfg.latest_version || env.LATEST_VERSION || null;
  if (version && !SEMVER.test(version)) version = null;
  let url = cfg.latest_url || env.LATEST_URL || null;
  if (url && !/^https:\/\/[^\s]+$/.test(url)) url = null;
  const notes = String(cfg.latest_notes || env.LATEST_NOTES || '').slice(0, 500);
  return respond(200, { version, url, notes }, { 'Cache-Control': 'public, max-age=600' });
}

async function authorized(request, env) {
  if (!env.STATS_TOKEN) return false;
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  return !!m && safeEqual(m[1].trim(), env.STATS_TOKEN);
}

export async function computeStats(env, ms) {
  const today = dayStr(ms);
  const since = (n) => dayStr(ms - (n - 1) * DAY_MS);
  const one = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).first()) || {};
  const all = async (sql, ...args) => ((await env.DB.prepare(sql).bind(...args).all()).results || []);
  const cutoff28 = ms - 28 * DAY_MS;
  const group = (col) => all(`SELECT ${col} AS key, COUNT(*) AS count FROM installs WHERE last_seen >= ? GROUP BY ${col} ORDER BY count DESC`, cutoff28);
  const [total, d1, d7, d28, byVersion, byBrowser, byLang, daily, fbTotal, fb7, fbKind, fbStatus] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM installs'),
    one('SELECT COUNT(DISTINCT id) AS n FROM daily WHERE day = ?', today),
    one('SELECT COUNT(DISTINCT id) AS n FROM daily WHERE day >= ?', since(7)),
    one('SELECT COUNT(DISTINCT id) AS n FROM daily WHERE day >= ?', since(28)),
    group('version'), group('browser'), group('lang'),
    all('SELECT day, COUNT(*) AS count FROM daily WHERE day >= ? GROUP BY day ORDER BY day', since(28)),
    one('SELECT COUNT(*) AS n FROM feedback'),
    one('SELECT COUNT(*) AS n FROM feedback WHERE created >= ?', ms - 7 * DAY_MS),
    all('SELECT kind AS key, COUNT(*) AS count FROM feedback GROUP BY kind ORDER BY count DESC'),
    all('SELECT status AS key, COUNT(*) AS count FROM feedback GROUP BY status ORDER BY count DESC'),
  ]);
  return {
    generated: new Date(ms).toISOString(),
    installs: { total: total.n || 0 },
    active: { d1: d1.n || 0, d7: d7.n || 0, d28: d28.n || 0 },
    byVersion, byBrowser, byLang, daily,
    feedback: { total: fbTotal.n || 0, last7d: fb7.n || 0, byKind: fbKind, byStatus: fbStatus },
  };
}

function statsPage() {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Toledo+ stats</title>
<style nonce="${nonce}">
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--fg:#000;--mut:#6b6b70;--line:rgba(60,60,67,.2);--tint:#0062cc}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--fg:#fff;--mut:#a1a1a6;--line:rgba(84,84,88,.6);--tint:#409cff}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto}h1{font-size:28px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.card{background:var(--card);border-radius:12px;padding:14px 16px}.card b{display:block;font-size:26px}.card span{color:var(--mut);font-size:13px}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}td:last-child,th:last-child{text-align:right}
h2{font-size:17px;margin:0 0 8px}form{display:flex;gap:8px;flex-wrap:wrap}input{flex:1;min-width:200px;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit}
button{padding:10px 16px;border-radius:8px;border:0;background:var(--tint);color:#fff;font:inherit;font-weight:600;cursor:pointer}button.plain{background:none;color:var(--tint)}
.err{color:#d70015}[hidden]{display:none!important}
</style></head><body><main>
<h1>Toledo+ stats</h1><p class="sub" id="sub">Anonymous usage and feedback counts.</p>
<section id="login" class="card" hidden><h2>Sign in</h2><form id="f"><label for="tok" class="sub">Stats token</label>
<input id="tok" type="password" autocomplete="current-password" required><button type="submit">Show</button></form><p id="err" class="err" role="alert"></p></section>
<section id="out" hidden><div class="grid" id="kpis"></div><div class="grid" id="tables"></div><button class="plain" id="logout" type="button">Sign out</button></section>
</main><script nonce="${nonce}">
(function(){
var K='tp-stats-token',$=function(i){return document.getElementById(i)};
function el(t,txt){var e=document.createElement(t);if(txt!=null)e.textContent=String(txt);return e}
function kpi(label,n){var c=el('div');c.className='card';c.appendChild(el('b',n));c.appendChild(el('span',label));return c}
function table(title,rows,k,v){var c=el('div');c.className='card';c.appendChild(el('h2',title));var t=el('table');
(rows||[]).forEach(function(r){var tr=el('tr');tr.appendChild(el('td',r[k]==null?'—':r[k]));tr.appendChild(el('td',r[v]));t.appendChild(tr)});
if(!(rows||[]).length){var tr=el('tr');tr.appendChild(el('td','—'));t.appendChild(tr)}c.appendChild(t);return c}
function login(msg){$('out').hidden=true;$('login').hidden=false;$('err').textContent=msg||'';$('tok').focus()}
function load(){var tok=sessionStorage.getItem(K);if(!tok)return login();
fetch('/v1/stats',{headers:{Authorization:'Bearer '+tok},cache:'no-store'}).then(function(r){
if(r.status===401){sessionStorage.removeItem(K);login('Wrong token.');return null}if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
.then(function(s){if(!s)return;var k=$('kpis'),t=$('tables');k.textContent='';t.textContent='';
k.appendChild(kpi('installs (total)',s.installs.total));k.appendChild(kpi('active today',s.active.d1));
k.appendChild(kpi('active 7 days',s.active.d7));k.appendChild(kpi('active 28 days',s.active.d28));
k.appendChild(kpi('feedback (total)',s.feedback.total));k.appendChild(kpi('feedback 7 days',s.feedback.last7d));
t.appendChild(table('Version (28 d)',s.byVersion,'key','count'));t.appendChild(table('Browser (28 d)',s.byBrowser,'key','count'));
t.appendChild(table('Language (28 d)',s.byLang,'key','count'));t.appendChild(table('Daily actives',s.daily,'day','count'));
t.appendChild(table('Feedback by kind',s.feedback.byKind,'key','count'));t.appendChild(table('Feedback by status',s.feedback.byStatus,'key','count'));
$('sub').textContent='Generated '+new Date(s.generated).toLocaleString();$('login').hidden=true;$('out').hidden=false})
.catch(function(e){login(String(e.message||e))})}
$('f').addEventListener('submit',function(ev){ev.preventDefault();sessionStorage.setItem(K,$('tok').value.trim());$('tok').value='';load()});
$('logout').addEventListener('click',function(){sessionStorage.removeItem(K);login()});
load();
})();
</script></body></html>`;
  return respond(200, html, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
  });
}

// ---------------------------------------------------------------- entry

const POST_ROUTES = { '/v1/ping': 'ping', '/v1/forget': 'forget', '/v1/feedback': 'feedback' };
const GET_ROUTES = ['/', '/v1/latest', '/v1/stats', '/v1/stats.html'];

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const cors = corsHeaders(request, env);
  const origin = request.headers.get('Origin');
  const ms = nowMs(env);
  const withCors = (res) => { for (const [k, v] of Object.entries(cors)) res.headers.set(k, v); return res; };

  try {
    if (request.method === 'OPTIONS') {
      if (!POST_ROUTES[path] && !GET_ROUTES.includes(path)) return respond(404, { error: 'not_found' });
      if (!origin || !isExtensionOrigin(origin, env)) return respond(403, { error: 'origin' });
      return respond(204, null, cors);
    }

    const route = POST_ROUTES[path];
    if (route) {
      if (request.method !== 'POST') return withCors(respond(405, { error: 'method' }, { Allow: 'POST, OPTIONS' }));
      // Calls come from the extension's background service worker (Origin: chrome-extension://<id>).
      if (!origin || !isExtensionOrigin(origin, env)) return respond(403, { error: 'origin' });
      if (!env.SALT) return withCors(respond(503, { error: 'misconfigured' }));
      const ipHash = await ipKey(env, request.headers.get('CF-Connecting-IP'), ms);
      await burst(env, route, ipHash);
      await enforce(env, route, ['ip'], { ip: ipHash }, ms);
      if (route === 'ping') return withCors(await ping(request, env, ms));
      if (route === 'forget') return withCors(await forget(request, env));
      return withCors(await feedback(request, env, ctx, ms));
    }

    if (GET_ROUTES.includes(path)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return withCors(respond(405, { error: 'method' }, { Allow: 'GET, OPTIONS' }));
      if (path === '/') return respond(200, 'Toledo+ API — https://github.com/' + (env.GITHUB_REPO || DEFAULT_REPO) + '\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      if (path === '/v1/latest') return withCors(await latest(env));
      if (path === '/v1/stats.html') return statsPage();
      if (!(await authorized(request, env))) return respond(env.STATS_TOKEN ? 401 : 404, { error: env.STATS_TOKEN ? 'unauthorized' : 'not_found' }, { 'WWW-Authenticate': 'Bearer' });
      return respond(200, await computeStats(env, ms));
    }

    return withCors(respond(404, { error: 'not_found' }));
  } catch (e) {
    if (e instanceof HttpError) {
      const h = e.status === 429 ? { 'Retry-After': String(e.extra.retryAfter || 60) } : {};
      const body = { error: e.code };
      if (e.extra.field) body.field = e.extra.field;
      return withCors(respond(e.status, body, h));
    }
    console.log('unhandled:', String(e && e.message || e)); // never log request data (may contain contact info)
    return withCors(respond(500, { error: 'server' }));
  }
}

/** Daily cleanup (cron): rate-limit counters > 2 days, daily rows and installs unseen for > 400 days. */
export async function cleanup(env, ms = nowMs(env)) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ratelimit WHERE window < ?').bind(Math.floor(ms / 1000) - 2 * DAY_S),
    env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(dayStr(ms - 400 * DAY_MS)),
    env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(ms - 400 * DAY_MS),
  ]);
}

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  scheduled: (event, env, ctx) => { ctx.waitUntil(cleanup(env)); },
};
