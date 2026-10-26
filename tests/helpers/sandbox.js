'use strict';
// Loads extension scripts into a Node vm sandbox (no DOM) for fast unit tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');

function sandbox({ origin = 'https://ultra.edu.kuleuven.cloud', language = 'nl-BE', settings = {} } = {}) {
  const u = new URL(origin);
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON, URL, URLSearchParams, Promise,
    location: { origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, href: origin + '/', pathname: '/' },
    navigator: { language, languages: [language] },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return { ctx, load, get TP() { return ctx.TP; }, setLanguage(l) { ctx.TP.settings = { get: () => ({ ...settings, language: l }) }; } };
}

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const list = (dir, re) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

module.exports = { sandbox, exists, list, read, ROOT };
