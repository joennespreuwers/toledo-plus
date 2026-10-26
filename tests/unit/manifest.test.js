'use strict';
// Guards the packaging contract from docs/ARCHITECTURE.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { exists, list, read } = require('../helpers/sandbox');

const manifest = JSON.parse(read('manifest.json'));
// Toledo + Ultra, plus (v1.3) KU Loket and the public TimeEdit iCal feed — mirrored by the relay allowlist in background.js.
const ORIGINS = ['https://toledo.kuleuven.be/*', 'https://ultra.edu.kuleuven.cloud/*', 'https://webwsp.aps.kuleuven.be/*', 'https://cloud.timeedit.net/*', 'https://api.toledoplus.be/*'];

test('manifest basics', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.background && manifest.background.service_worker, 'background.service_worker missing');
  assert.ok(exists(manifest.background.service_worker), `${manifest.background.service_worker} missing`);
  for (const p of Object.values(manifest.icons || {})) assert.ok(exists(p), `icon ${p} missing`);
});

test('version matches package.json and CHANGELOG', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.version, pkg.version, 'manifest.json and package.json versions differ');
  assert.ok(read('CHANGELOG.md').includes(`## [${manifest.version}]`), `CHANGELOG.md has no entry for ${manifest.version}`);
});

test('privacy: only Toledo origins, minimal permissions', () => {
  assert.deepEqual([...(manifest.host_permissions || [])].sort(), [...ORIGINS].sort());
  const allowed = new Set(['storage']);
  for (const p of manifest.permissions || []) assert.ok(allowed.has(p), `unexpected permission "${p}" – needs a maintainer-approved issue (see AGENTS.md)`);
  assert.ok(!manifest.optional_host_permissions, 'no optional host permissions');
  const csp = JSON.stringify(manifest.content_security_policy || {});
  assert.ok(!/unsafe-eval|https?:/.test(csp), 'CSP must not allow eval or remote sources');
});

test('the relay allowlist equals the host permissions', () => {
  const bg = read('background.js');
  const m = bg.match(/const TP_ALLOWED = \{([\s\S]*?)\};/);
  assert.ok(m, 'TP_ALLOWED not found in background.js');
  const origins = [...m[1].matchAll(/'(https:\/\/[^']+)'\s*:/g)].map((x) => x[1] + '/*').sort();
  assert.deepEqual(origins, [...ORIGINS].sort());
});

test('content scripts follow the documented load order and exist', () => {
  const scripts = manifest.content_scripts || [];
  assert.ok(scripts.length >= 1);
  const matches = scripts.flatMap((s) => s.matches);
  assert.ok(matches.some((m) => m.startsWith('https://toledo.kuleuven.be/')), 'portal not matched');
  assert.ok(matches.some((m) => m.startsWith('https://ultra.edu.kuleuven.cloud/')), 'ultra not matched');
  for (const s of scripts) {
    for (const f of [...(s.js || []), ...(s.css || [])]) assert.ok(exists(f), `content script file ${f} missing`);
    const js = s.js || [];
    const idx = (f) => js.indexOf(f);
    const order = ['src/core/util.js', 'src/core/i18n.js', 'src/core/settings.js', 'src/core/net.js', 'src/core/data.js', 'src/core/index.js', 'src/core/ui.js', 'src/core/shell.js', 'src/core/palette.js', 'src/boot.js'];
    for (const f of order) assert.ok(idx(f) >= 0, `${f} not loaded in content script for ${s.matches}`);
    for (let i = 1; i < order.length; i++) assert.ok(idx(order[i - 1]) < idx(order[i]), `${order[i - 1]} must load before ${order[i]}`);
    for (const f of list('src/i18n', /\.js$/)) {
      assert.ok(idx(f) > idx('src/core/i18n.js') && idx(f) < idx('src/core/settings.js'), `${f} must load between i18n.js and settings.js`);
    }
    for (const f of list('src/views', /\.js$/)) {
      assert.ok(idx(f) > idx('src/core/palette.js'), `${f} must load after palette.js`);
      assert.ok(idx(f) > idx('src/core/shell.js') && idx(f) < idx('src/boot.js'), `${f} must load between shell.js and boot.js`);
    }
    assert.equal(js[js.length - 1], 'src/boot.js', 'boot.js must be last');
  }
});

test('shadow-root CSS: every view has a stylesheet, listed in TP.shell.CSS and web-accessible', () => {
  assert.ok(exists('src/core/shell.js'), 'src/core/shell.js missing');
  const shell = read('src/core/shell.js');
  const m = shell.match(/\bCSS(?:_FILES)?\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'TP.shell.CSS list not found in shell.js');
  const css = [...m[1].matchAll(/['"`]([^'"`]+\.css)['"`]/g)].map((x) => x[1]);
  assert.equal(css[0], 'ui.css', 'ui.css must be first');
  const war = (manifest.web_accessible_resources || []).flatMap((w) => w.resources);
  const isWar = (f) => war.some((r) => r === f || (r.endsWith('*') && f.startsWith(r.slice(0, -1))) || (r.includes('*') && new RegExp('^' + r.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$').test(f)));
  for (const f of css) {
    assert.ok(exists(f), `${f} listed in TP.shell.CSS but missing`);
    assert.ok(isWar(f), `${f} not in web_accessible_resources`);
  }
  for (const f of list('src/views', /\.js$/)) {
    const c = f.replace(/\.js$/, '.css');
    assert.ok(exists(c), `${c} missing (must exist, even if empty)`);
    assert.ok(css.includes(c), `${c} not listed in TP.shell.CSS`);
  }
});

test('no remote code or dynamic evaluation in extension sources', () => {
  const files = ['background.js', ...list('src/core', /\.js$/), ...list('src/views', /\.js$/), ...list('src/i18n', /\.js$/), 'src/boot.js'].filter(exists);
  const bad = [];
  for (const f of files) {
    const s = read(f);
    if (/\beval\s*\(/.test(s)) bad.push(`${f}: eval()`);
    if (/new\s+Function\s*\(/.test(s)) bad.push(`${f}: new Function()`);
    if (/importScripts\s*\(\s*['"`]https?:/.test(s)) bad.push(`${f}: remote importScripts`);
    if (/<script[^>]+src=["']https?:/i.test(s)) bad.push(`${f}: remote <script>`);
    if (/fonts\.googleapis|googletagmanager|google-analytics|sentry\.io|segment\.(io|com)|mixpanel|plausible|hotjar/i.test(s)) bad.push(`${f}: third-party service`);
  }
  assert.deepEqual(bad, []);
});
