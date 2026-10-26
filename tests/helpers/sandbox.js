'use strict';
// Loads extension scripts into a Node vm sandbox (no DOM) for fast unit tests.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');

/** A Date that starts at `start` and then runs with real time (new Date() / Date.now()), for deterministic
 *  tests that still let timers/throttles work. Move it with clock.set(ms) / clock.add(ms). */
function fixedClock(start) {
  const RealDate = Date;
  const clock = { base: start, at: RealDate.now() };
  const now = () => clock.base + (RealDate.now() - clock.at);
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now()); }
    static now() { return now(); }
  }
  clock.Date = FixedDate;
  clock.now = now;
  clock.set = (ms) => { clock.base = ms; clock.at = RealDate.now(); };
  clock.add = (ms) => { clock.base = now() + ms; clock.at = RealDate.now(); };
  return clock;
}

/**
 * @param o.origin    page origin (location)
 * @param o.language  navigator.language
 * @param o.now       pin Date.now()/new Date() to this ms (→ s.clock to move it)
 * @param o.globals   extra globals (chrome, fetch, document, …)
 */
function sandbox({ origin = 'https://ultra.edu.kuleuven.cloud', language = 'nl-BE', settings = {}, now, globals = {} } = {}) {
  const u = new URL(origin);
  const clock = now != null ? fixedClock(now) : null;
  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date: clock ? clock.Date : Date, Math, JSON, URL, URLSearchParams, Promise,
    AbortController, TextEncoder, queueMicrotask,
    location: { origin: u.origin, protocol: u.protocol, host: u.host, hostname: u.hostname, href: origin + '/', pathname: '/' },
    navigator: { language, languages: [language] },
    ...globals,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  return { ctx, load, clock, get TP() { return ctx.TP; }, setLanguage(l) { ctx.TP.settings = { get: () => ({ ...settings, language: l }) }; } };
}

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const list = (dir, re) => (exists(dir) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Noon today (local time): far from midnight and DST switches, so day arithmetic in tests is stable. */
function noonToday() { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); }

module.exports = { sandbox, exists, list, read, ROOT, fixedClock, noonToday };
