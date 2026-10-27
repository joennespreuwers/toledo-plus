'use strict';
// Toledo+ API worker (worker/src/index.js): validation, CORS, rate limits, feedback → GitHub issue, stats auth, privacy.
// Runs with plain `node --test`: an in-memory D1 shim on node:sqlite applies worker/schema.sql (no wrangler needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (_) { /* Node without node:sqlite → tests skip */ }
const SKIP = sqlite ? false : 'node:sqlite not available';

const loadWorker = () => import(pathToFileURL(path.join(ROOT, 'worker/src/index.js')).href);

/** Minimal D1 on node:sqlite: prepare().bind().first()/all()/run(), batch() in a transaction. */
function d1() {
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'worker/schema.sql'), 'utf8'));
  const plain = (r) => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first(col) { const r = plain(db.prepare(sql).get(...args)); return r && col ? r[col] : r; },
    async all() { return { success: true, results: db.prepare(sql).all(...args).map(plain) }; },
    async run() { return this._run(); },
    _run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    _db: db,
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = list.map((s) => s._run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    dump() {
      const out = {};
      for (const t of ['installs', 'daily', 'feedback', 'ratelimit', 'config']) out[t] = db.prepare(`SELECT * FROM ${t}`).all().map(plain);
      return out;
    },
    rows: (sql, ...a) => db.prepare(sql).all(...a).map(plain),
  };
}

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const EDGE = 'extension://abcdefghijklmnopabcdefghijklmnop';
const IP = '203.0.113.7';
const ID = '3f2b8c1e-5d4a-4c3b-9a8e-1b2c3d4e5f60';
const ID2 = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

function setup(extra = {}) {
  const clock = { t: T0 };
  const env = { DB: d1(), SALT: 'test-salt', STATS_TOKEN: 'stats-secret', LATEST_VERSION: '1.3.0',
    LATEST_URL: 'https://github.com/joennespreuwers/toledo-plus/releases/latest', LATEST_NOTES: 'Agenda en KU Loket', __now: () => clock.t, ...extra };
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  return { env, clock, ctx, waits };
}

async function call(W, s, method, p, { body, origin = EXT, ip = IP, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (ip) h['CF-Connecting-IP'] = ip;
  let payload;
  if (raw != null) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] ||= 'application/json'; }
  const res = await W.handle(new Request('https://api.toledoplus.be' + p, { method, headers: h, body: payload }), s.env, s.ctx);
  await Promise.all(s.waits.splice(0));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* html/text */ }
  return { status: res.status, headers: res.headers, text, json };
}

const ping = (over = {}) => ({ id: ID, v: '1.2.0', browser: 'chrome', lang: 'nl', ...over });
const fb = (over = {}) => ({ id: ID, kind: 'idea', text: 'Een donkere modus voor de agenda zou fijn zijn.', v: '1.2.0', browser: 'edge', lang: 'nl', page: 'agenda', website: '', ...over });

test('ping: upserts the install and one daily row per day → 204', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping() })).status, 204);
  s.clock.t += 3600e3;
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping({ v: '1.2.1' }) })).status, 204);
  const inst = s.env.DB.rows('SELECT * FROM installs');
  assert.equal(inst.length, 1);
  assert.equal(inst[0].version, '1.2.1');
  assert.equal(inst[0].first_seen, T0);
  assert.equal(inst[0].last_seen, T0 + 3600e3);
  assert.equal(s.env.DB.rows('SELECT * FROM daily').length, 1, 'same UTC day → one row');
  s.clock.t += 86400e3;
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  assert.equal(s.env.DB.rows('SELECT * FROM daily').length, 2);
});

test('ping: strict validation (uuid v4, semver, enums, no extra fields, JSON only, 8 KB)', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  const cases = [
    [{ body: ping({ id: '3f2b8c1e-5d4a-1c3b-9a8e-1b2c3d4e5f60' }) }, 400, 'id'], // v1 uuid
    [{ body: ping({ id: ID.toUpperCase() }) }, 400, 'id'],
    [{ body: ping({ v: '1.2' }) }, 400, 'v'],
    [{ body: ping({ v: '1.2.0; drop table' }) }, 400, 'v'],
    [{ body: ping({ browser: 'firefox' }) }, 400, 'browser'],
    [{ body: ping({ lang: 'de' }) }, 400, 'lang'],
    [{ body: { ...ping(), email: 'x' } }, 400, 'email'],
    [{ body: { id: ID, v: '1.2.0', browser: 'chrome' } }, 400, 'lang'],
    [{ body: [ping()] }, 400],
    [{ raw: '{nope', headers: { 'Content-Type': 'application/json' } }, 400],
    [{ raw: JSON.stringify(ping()), headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ raw: JSON.stringify({ ...ping(), pad: 'x'.repeat(9000) }), headers: { 'Content-Type': 'application/json' } }, 413],
  ];
  for (const [i, [opts, status, field]] of cases.entries()) {
    const r = await call(W, s, 'POST', '/v1/ping', { ip: `198.51.100.${i}`, ...opts }); // invalid requests count too
    assert.equal(r.status, status, JSON.stringify(opts).slice(0, 80));
    if (field) assert.equal(r.json.field, field);
  }
  assert.equal(s.env.DB.rows('SELECT * FROM installs').length, 0);
  assert.equal((await call(W, s, 'GET', '/v1/ping')).status, 405);
  assert.equal((await call(W, s, 'GET', '/v1/nope')).status, 404);
});

test('CORS: only extension origins; preflight; POST without Origin refused; optional id allowlist', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  const pre = await call(W, s, 'OPTIONS', '/v1/feedback', { headers: { 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), EXT);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await call(W, s, 'OPTIONS', '/v1/feedback', { origin: 'https://evil.example.com' })).status, 403);
  assert.equal((await call(W, s, 'OPTIONS', '/v1/feedback', { origin: 'https://toledo.kuleuven.be' })).status, 403);
  const edge = await call(W, s, 'POST', '/v1/ping', { body: ping(), origin: EDGE });
  assert.equal(edge.status, 204);
  assert.equal(edge.headers.get('access-control-allow-origin'), EDGE);
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping(), origin: null })).status, 403);
  const web = await call(W, s, 'POST', '/v1/ping', { body: ping(), origin: 'https://evil.example.com' });
  assert.equal(web.status, 403);
  assert.equal(web.headers.get('access-control-allow-origin'), null);
  const latest = await call(W, s, 'GET', '/v1/latest', { origin: 'https://evil.example.com' });
  assert.equal(latest.status, 200, 'latest is public');
  assert.equal(latest.headers.get('access-control-allow-origin'), null);

  const pinned = setup({ EXTENSION_IDS: 'ponmlkjihgfedcbaponmlkjihgfedcba' });
  assert.equal((await call(W, pinned, 'POST', '/v1/ping', { body: ping() })).status, 403);
  assert.equal((await call(W, pinned, 'POST', '/v1/ping', { body: ping(), origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba' })).status, 204);
});

test('rate limit: ping 10/hour per hashed IP → 429 with Retry-After; other IPs and the next hour pass', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  for (let i = 0; i < 10; i++) assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping() })).status, 204);
  const r = await call(W, s, 'POST', '/v1/ping', { body: ping() });
  assert.equal(r.status, 429);
  assert.equal(r.json.error, 'rate_limited');
  assert.equal(r.headers.get('retry-after'), '3600', 'T0 is on the hour → full window left');
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping(), ip: '198.51.100.9' })).status, 204);
  s.clock.t += 3600e3;
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping() })).status, 204);
});

test('rate limit: the Workers Rate Limiting binding is used as a burst guard when present', { skip: SKIP }, async () => {
  const W = await loadWorker();
  const keys = [];
  const s = setup({ RL: { limit: async ({ key }) => { keys.push(key); return { success: keys.length < 3 }; } } });
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping() })).status, 204);
  assert.equal((await call(W, s, 'POST', '/v1/ping', { body: ping() })).status, 204);
  const r = await call(W, s, 'POST', '/v1/ping', { body: ping() });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.ok(keys.every((k) => /^ping:[0-9a-f]{32}$/.test(k)), 'binding key = route + hashed IP');
  const broken = setup({ RL: { limit: async () => { throw new Error('binding down'); } } });
  assert.equal((await call(W, broken, 'POST', '/v1/ping', { body: ping() })).status, 204, 'binding failure falls back to D1');
});

test('rate limit: feedback 5/hour and 20/day per IP, 500/day global; the client-chosen install id is no limit key', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  // 5/hour per IP
  for (let i = 0; i < 5; i++) assert.equal((await call(W, s, 'POST', '/v1/feedback', { body: fb({ id: undefined }) })).status, 201);
  assert.equal((await call(W, s, 'POST', '/v1/feedback', { body: fb({ id: undefined }) })).status, 429);
  // 20/day per IP (move hour by hour; the 6th request of each hour is refused)
  let ok = 5;
  for (let h = 1; h < 6; h++) {
    s.clock.t = T0 + h * 3600e3;
    for (let i = 0; i < 5; i++) if ((await call(W, s, 'POST', '/v1/feedback', { body: fb({ id: undefined }) })).status === 201) ok++;
  }
  assert.equal(ok, 20, 'only 20 per IP per day');

  // The install id is attacker-chosen (TP-180): it neither protects nor blocks anyone.
  const s2 = setup();
  let okId = 0;
  for (let i = 0; i < 12; i++) if ((await call(W, s2, 'POST', '/v1/feedback', { body: fb(), ip: `198.51.100.${i}` })).status === 201) okId++;
  assert.equal(okId, 12);

  // 500/day global
  const s3 = setup();
  const win = Math.floor(T0 / 1000 / 86400) * 86400;
  s3.env.DB._db.prepare('INSERT INTO ratelimit (key, window, count) VALUES (?, ?, ?)').run('feedback:global:86400:all', win, 500);
  const g = await call(W, s3, 'POST', '/v1/feedback', { body: fb() });
  assert.equal(g.status, 429);
  assert.ok(Number(g.headers.get('retry-after')) > 0);
  assert.equal(s3.env.DB.rows('SELECT * FROM feedback').length, 0);
});

test('rate limit: IPv6 is keyed on the /64 (rotating addresses in one prefix share one budget); IPv4-mapped = IPv4', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  assert.equal(W.ipPrefix('2001:db8:abcd:12:1::5'), '2001:db8:abcd:12::/64');
  assert.equal(W.ipPrefix('2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff'), '2001:db8:abcd:12::/64');
  assert.equal(W.ipPrefix('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(W.ipPrefix('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(W.ipPrefix('203.0.113.7'), '203.0.113.7');
  assert.equal(await W.ipKey(s.env, '2001:db8:abcd:12::1', T0), await W.ipKey(s.env, '2001:db8:abcd:12:dead:beef:0:1', T0));
  assert.notEqual(await W.ipKey(s.env, '2001:db8:abcd:12::1', T0), await W.ipKey(s.env, '2001:db8:abcd:13::1', T0));
  // 110 addresses in one /64 × 5 requests (the bug-bash attack): 5 accepted, not 348.
  const codes = {};
  for (let i = 0; i < 110; i++) {
    for (let j = 0; j < 5; j++) {
      const st = (await call(W, s, 'POST', '/v1/feedback', { body: fb({ id: undefined }), ip: `2001:db8:abcd:12::${(i * 5 + j).toString(16)}` })).status;
      codes[st] = (codes[st] || 0) + 1;
    }
  }
  assert.equal(codes[201], 5);
  // …and a student elsewhere is not locked out.
  assert.equal((await call(W, s, 'POST', '/v1/feedback', { body: fb({ id: undefined }), ip: '2001:db8:ffff:1::1' })).status, 201);
});

test('feedback → public issues are capped (per IP and per day); over the cap the feedback is stored without an issue', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup({ GITHUB_TOKEN: 'ghp_test' });
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { n++; return new Response(JSON.stringify({ number: n }), { status: 201 }); };
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call(W, s, 'POST', '/v1/feedback', { body: fb() })).status, 201);
    assert.equal(n, 3, '3 issues per IP per day');
    assert.equal(s.env.DB.rows('SELECT * FROM feedback').length, 5, 'all feedback stored');
    assert.equal(s.env.DB.rows("SELECT * FROM feedback WHERE status = 'new'").length, 2);
    const win = Math.floor(T0 / 1000 / 86400) * 86400;
    s.env.DB._db.prepare('INSERT OR REPLACE INTO ratelimit (key, window, count) VALUES (?, ?, ?)').run('issue:global:86400:all', win, 25);
    assert.equal((await call(W, s, 'POST', '/v1/feedback', { body: fb(), ip: '198.51.100.9' })).status, 201);
    assert.equal(n, 3, 'global issue cap');
  } finally { globalThis.fetch = realFetch; }
});

test('issue body: user text is a fenced block (no #refs, SHAs, links or images); title refs broken; any link spelling counts as spam', { skip: SKIP }, async () => {
  const W = await loadWorker();
  const text = 'see #1 and owner/repo#3 and deadbeefdeadbeefdeadbeefdeadbeefdeadbeef ```x``` ![x](//tracker.example/p.png) [login](//phish.example)';
  const issue = W.issueFor({ kind: 'bug', text: '#12 deadbeef1 fails\n' + text }, 7);
  assert.match(issue.body, /^````text\n/, 'fence longer than any run of backticks inside');
  assert.ok(issue.body.includes('\n````\n'), 'closing fence');
  assert.ok(!/^> /m.test(issue.body), 'no blockquote rendering');
  assert.ok(!/#1\d/.test(issue.title) && !/#12/.test(issue.title), 'title #ref broken');
  assert.ok(!/deadbeef1/.test(issue.title), 'title SHA broken');
  const s = setup();
  const st = async (t) => (await call(W, s, 'POST', '/v1/feedback', { body: fb({ text: t, id: undefined }), ip: String(Math.random()) })).status;
  assert.equal(await st('kijk ![a](//t.example/a.png) [b](//p.example) <img src=x> en //c.example/x hier'), 422);
  assert.equal(await st('Een pad als a/b//c is geen link, en 2 // 3 ook niet'), 201);
});

test('latest: the update URL must be this project on GitHub or toledoplus.be (no ../ escapes)', { skip: SKIP }, async () => {
  const W = await loadWorker();
  assert.equal(W.safeLatestUrl('https://github.com/joennespreuwers/toledo-plus/releases/latest', {}), 'https://github.com/joennespreuwers/toledo-plus/releases/latest');
  assert.equal(W.safeLatestUrl('https://toledoplus.be/#update', {}), 'https://toledoplus.be/#update');
  assert.equal(W.safeLatestUrl('https://github.com/joennespreuwers/toledo-plus/../../evil-org/evil-repo/releases/latest', {}), null);
  assert.equal(W.safeLatestUrl('https://github.com/joennespreuwers/toledo-plus/%2e%2e/%2e%2e/evil/x', {}), null);
  assert.equal(W.safeLatestUrl('https://toledoplus.be.evil.example/x', {}), null);
  assert.equal(W.safeLatestUrl('https://u:p' + '@' + 'toledoplus.be/x', {}), null);
  assert.equal(W.safeLatestUrl('http://toledoplus.be/x', {}), null);
  const s = setup({ LATEST_URL: 'https://github.com/joennespreuwers/toledo-plus/../../evil-org/x' });
  const r = await call(W, s, 'GET', '/v1/latest');
  assert.equal(r.json.url, null);
});

test('feedback: validation, spam heuristics and honeypot', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  const st = async (body) => (await call(W, s, 'POST', '/v1/feedback', { body, ip: String(Math.random()) })).status;
  assert.equal(await st(fb({ text: 'te kort' })), 400);
  assert.equal(await st(fb({ text: 'x'.repeat(4001) })), 400);
  assert.equal(await st(fb({ text: '          \n\n   abc       ' })), 400, 'length counts trimmed text');
  assert.equal(await st(fb({ kind: 'praise' })), 400);
  assert.equal(await st(fb({ contact: 'x'.repeat(201) })), 400);
  assert.equal(await st(fb({ page: 'https://toledo.kuleuven.be/portal' })), 400, 'route name only');
  assert.equal(await st(fb({ studentNumber: 'r0000000' })), 400, 'unknown fields rejected');
  assert.equal(await st(fb({ text: 'Kijk http://a.example http://b.example http://c.example www.d.example' })), 422);
  assert.equal(await st(fb({ text: 'Twee links: https://a.example en https://b.example zijn ok' })), 201);
  assert.equal(await st(fb({ website: 'http://spam.example' })), 201, 'honeypot: pretend success');
  assert.equal(await st(fb({ id: undefined, v: undefined, browser: undefined, lang: undefined, page: undefined, contact: undefined })), 201, 'metadata optional');
  const rows = s.env.DB.rows('SELECT * FROM feedback ORDER BY id');
  assert.equal(rows.length, 2, 'honeypot submission not stored');
  assert.equal(rows[1].install_id, null);
  assert.equal(rows[1].version, null);
});

test('feedback: stored with contact in D1; GitHub issue without contact, with labels; mentions neutralised', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup({ GITHUB_TOKEN: 'ghp_test' });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ number: 42 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const text = 'De agenda toont niets op maandag\n\nStappen: open Agenda, kies week. cc @someone';
    const r = await call(W, s, 'POST', '/v1/feedback', { body: fb({ kind: 'bug', text, contact: 'student.a@example.edu' }) });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json, { ok: true });
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/joennespreuwers/toledo-plus/issues');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ghp_test');
  const issue = JSON.parse(calls[0].init.body);
  assert.equal(issue.title, '[Bug] De agenda toont niets op maandag');
  assert.deepEqual(issue.labels, ['feedback', 'needs-triage', 'bug']);
  assert.ok(!issue.body.includes('student.a@example.edu'), 'contact never in the public issue');
  assert.ok(!issue.body.includes(ID), 'install id not in the public issue');
  assert.ok(issue.body.includes('@​someone'), 'mention neutralised');
  assert.match(issue.body, /\| Version \| 1\.2\.0 \|/);
  const row = s.env.DB.rows('SELECT * FROM feedback')[0];
  assert.equal(row.contact, 'student.a@example.edu');
  assert.equal(row.github_issue, 42);
  assert.equal(row.status, 'issued');
  assert.equal(row.kind, 'bug');

  // ideas → enhancement; GitHub failure keeps the row (status new) and still answers 201
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  try {
    const r2 = await call(W, s, 'POST', '/v1/feedback', { body: fb() });
    assert.equal(r2.status, 201);
  } finally { globalThis.fetch = realFetch; }
  const row2 = s.env.DB.rows('SELECT * FROM feedback ORDER BY id DESC')[0];
  assert.equal(row2.status, 'new');
  assert.equal(row2.github_issue, null);
  assert.deepEqual(W.issueFor({ kind: 'idea', text: 'Een idee dat lang genoeg is' }, 1).labels, ['feedback', 'needs-triage', 'enhancement']);
  assert.ok(W.issueFor({ kind: 'other', text: 'x'.repeat(100) }, 1).title.length <= 84);

  const noTok = setup();
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return new Response('{}'); };
  try { assert.equal((await call(W, noTok, 'POST', '/v1/feedback', { body: fb() })).status, 201); } finally { globalThis.fetch = realFetch; }
  assert.equal(fetched, false, 'no GITHUB_TOKEN → no GitHub call');
});

test('privacy: no raw IP anywhere in D1; IP key rotates daily', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  await call(W, s, 'POST', '/v1/feedback', { body: fb() });
  await call(W, s, 'POST', '/v1/feedback', { body: fb({ website: 'bot' }) });
  const dump = JSON.stringify(s.env.DB.dump());
  assert.ok(!dump.includes(IP), 'raw IP stored');
  assert.ok(!dump.includes('203.0.113'), 'partial IP stored');
  const a = await W.ipKey(s.env, IP, T0);
  const b = await W.ipKey(s.env, IP, T0 + 86400e3);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b, 'daily rotation');
  assert.notEqual(a, await W.ipKey({ SALT: 'other' }, IP, T0), 'salted');
  assert.equal((await call(W, setup({ SALT: '' }), 'POST', '/v1/ping', { body: ping() })).status, 503, 'no SALT → refuse instead of weak hashing');
});

test('forget: deletes the install and its daily rows, unlinks feedback', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  await call(W, s, 'POST', '/v1/ping', { body: ping({ id: ID2 }) });
  await call(W, s, 'POST', '/v1/feedback', { body: fb() });
  assert.equal((await call(W, s, 'POST', '/v1/forget', { body: { id: ID } })).status, 204);
  assert.deepEqual(s.env.DB.rows('SELECT id FROM installs'), [{ id: ID2 }]);
  assert.deepEqual(s.env.DB.rows('SELECT id FROM daily'), [{ id: ID2 }]);
  assert.equal(s.env.DB.rows('SELECT install_id FROM feedback')[0].install_id, null);
  assert.equal((await call(W, s, 'POST', '/v1/forget', { body: { id: ID, x: 1 } })).status, 400);
});

test('latest: env vars, D1 config override, 10-minute cache', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  const r = await call(W, s, 'GET', '/v1/latest');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { version: '1.3.0', url: 'https://github.com/joennespreuwers/toledo-plus/releases/latest', notes: 'Agenda en KU Loket' });
  assert.equal(r.headers.get('cache-control'), 'public, max-age=600');
  assert.equal(r.headers.get('access-control-allow-origin'), EXT);
  s.env.DB._db.prepare("INSERT INTO config VALUES ('latest_version', '1.4.0'), ('latest_url', 'javascript:alert(1)')").run();
  const o = await call(W, s, 'GET', '/v1/latest');
  assert.equal(o.json.version, '1.4.0');
  assert.equal(o.json.url, null, 'non-https url dropped');
  const none = await call(W, setup({ LATEST_VERSION: '' }), 'GET', '/v1/latest');
  assert.equal(none.json.version, null);
});

test('stats: bearer auth (401/404), aggregates, dashboard page has strict CSP and no token', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  await call(W, s, 'POST', '/v1/ping', { body: ping({ id: ID2, browser: 'edge', lang: 'fr' }) });
  s.clock.t += 2 * 86400e3;
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  await call(W, s, 'POST', '/v1/feedback', { body: fb({ kind: 'bug' }) });
  assert.equal((await call(W, s, 'GET', '/v1/stats')).status, 401);
  assert.equal((await call(W, s, 'GET', '/v1/stats', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(W, s, 'GET', '/v1/stats?token=stats-secret')).status, 401, 'no token in the query string');
  const r = await call(W, s, 'GET', '/v1/stats', { headers: { Authorization: 'Bearer stats-secret' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.json.installs.total, 2);
  assert.deepEqual(r.json.active, { d1: 1, d7: 2, d28: 2 });
  assert.deepEqual(r.json.byBrowser.map((x) => x.key).sort(), ['chrome', 'edge']);
  assert.equal(r.json.daily.length, 2);
  assert.equal(r.json.feedback.total, 1);
  assert.deepEqual(r.json.feedback.byKind, [{ key: 'bug', count: 1 }]);
  assert.equal((await call(W, setup({ STATS_TOKEN: '' }), 'GET', '/v1/stats', { headers: { Authorization: 'Bearer ' } })).status, 404);

  const page = await call(W, s, 'GET', '/v1/stats.html');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(csp)[1];
  assert.ok(page.text.includes(`<script nonce="${nonce}">`));
  assert.ok(!page.text.includes('stats-secret'));
  assert.ok(page.text.includes('sessionStorage'));
  assert.ok(!/innerHTML/.test(page.text), 'dashboard renders with textContent only');
});

test('cleanup cron: old rate-limit counters and stale usage rows are deleted', { skip: SKIP }, async () => {
  const W = await loadWorker(); const s = setup();
  await call(W, s, 'POST', '/v1/ping', { body: ping() });
  s.clock.t += 3 * 86400e3;
  await call(W, s, 'POST', '/v1/ping', { body: ping({ id: ID2 }) });
  await W.cleanup(s.env);
  const windows = s.env.DB.rows('SELECT window FROM ratelimit').map((r) => r.window);
  assert.equal(windows.length, 1, 'counter from 3 days ago removed');
  s.clock.t += 401 * 86400e3;
  await W.cleanup(s.env);
  assert.equal(s.env.DB.rows('SELECT * FROM installs').length, 0);
  assert.equal(s.env.DB.rows('SELECT * FROM daily').length, 0);
  // default export wires fetch + scheduled
  assert.equal(typeof W.default.fetch, 'function');
  assert.equal(typeof W.default.scheduled, 'function');
});
