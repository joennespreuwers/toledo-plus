'use strict';
// Boots the data layer (util, i18n, settings/state, net, data) in a vm sandbox with a fake chrome.
// Several boots sharing one `world` act like tabs of the same browser.
process.env.TZ = process.env.TZ || 'Europe/Brussels';
const { sandbox, noonToday } = require('./sandbox');
const { world, fakeChrome, tick } = require('./fake-chrome');

/**
 * @param o.world     shared fake-chrome world (default: a new one)
 * @param o.now       pinned now (default: today 12:00 local) — pass null for the real clock
 * @param o.settings  settings patch applied after load
 * @param o.net       stub for TP.net ({json, blob, isSameOrigin, isStale}) — default: records calls, returns null
 * @param o.realNet   load src/core/net.js instead (then pass o.fetch and/or o.onMessage)
 * @param o.origin, o.fetch, o.onMessage, o.chrome (fakeChrome opts)
 */
async function boot(o = {}) {
  const w = o.world || world();
  const chrome = fakeChrome(w, Object.assign({}, o.chrome || {}, o.onMessage ? { onMessage: o.onMessage } : {}));
  const s = sandbox({ origin: o.origin || 'https://toledo.kuleuven.be', now: o.now === null ? undefined : (o.now || noonToday()), globals: { chrome, fetch: o.fetch } });
  s.load('src/core/util.js');
  s.load('src/core/i18n.js');
  s.load('src/core/settings.js');
  const calls = [];
  if (o.realNet) s.load('src/core/net.js');
  else {
    s.ctx.TP.net = Object.assign({
      calls,
      json: async (url, opts) => { calls.push({ url, opts }); return null; },
      isSameOrigin: () => false,
      isStale: () => !chrome.runtime.id,
    }, o.net || {});
  }
  s.load('src/core/data.js');
  await s.TP.settings.load();
  if (o.settings) await s.TP.settings.set(o.settings);
  await s.TP.data.init();
  return { s, TP: s.TP, chrome, world: w, calls, clock: s.clock };
}

/** Wait for debounced writes (state 150 ms, cache 400 ms) and onChanged delivery. */
const settle = (ms = 500) => tick(ms);

module.exports = { boot, settle, world, fakeChrome, tick };
