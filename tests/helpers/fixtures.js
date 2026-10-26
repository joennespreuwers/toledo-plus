'use strict';
// Loads the synthetic fixtures and turns relative date tokens into real dates, so the
// data is always "fresh" relative to the moment the test runs.
//
//   "@ms:-2d"         → epoch ms, now − 2 days
//   "@ms:+1d@23:59"   → epoch ms, local day (now + 1 day) at 23:59
//   "@iso:-0.3d"      → ISO 8601 string (Blackboard REST style)
//
// Local time = Europe/Brussels (tests set TZ and the browser timezoneId to it).
process.env.TZ = process.env.TZ || 'Europe/Brussels';
const fs = require('fs');
const path = require('path');

const DAY = 864e5;
const TOKEN = /^@(ms|iso):([+-]?\d+(?:\.\d+)?)d(?:@(\d\d):(\d\d))?$/;

function resolveToken(str, now) {
  const m = TOKEN.exec(str);
  if (!m) return str;
  const d = new Date(now + Number(m[2]) * DAY);
  if (m[3] !== undefined) d.setHours(Number(m[3]), Number(m[4]), 0, 0);
  return m[1] === 'ms' ? d.getTime() : d.toISOString();
}

function materialize(value, now) {
  if (typeof value === 'string') return value.startsWith('@') ? resolveToken(value, now) : value;
  if (Array.isArray(value)) return value.map((v) => materialize(v, now));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = materialize(v, now);
    return out;
  }
  return value;
}

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8'));
}

/** Fresh, mutable copy of all fixtures. */
function load(now = Date.now()) {
  return { now, portal: materialize(read('portal.json'), now), ultra: materialize(read('ultra.json'), now) };
}

module.exports = { load, materialize, resolveToken, DAY };
