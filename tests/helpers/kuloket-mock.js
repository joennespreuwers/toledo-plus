'use strict';
// Mock routes for KU Loket (SAP OData on webwsp.aps.kuleuven.be) and the public TimeEdit iCal feed
// (cloud.timeedit.net), loaded by mock.js. Data: tests/fixtures/kuloket.json (synthetic).
//
// Options (mock.install opts.kuloket, also mutable at runtime via rec.kuloket):
//   loggedOut: true   → every OData call answers with an HTML SSO login page (like an expired KU Loket session)
//   examsEmpty: true  → EvaluationSet is empty (outside the exam period)
//   noExpand: true    → EvaluationSet with $expand answers 400 (expand not supported)
//   noIcsLink: true   → StudentSet has no Schedulelink
// Records: rec.kuloket.calls = [{path, query}], rec.kuloket.ics = number of ICS downloads.
process.env.TZ = process.env.TZ || 'Europe/Brussels';
const fs = require('fs');
const path = require('path');

const KULOKET = 'https://webwsp.aps.kuleuven.be';
const TIMEEDIT = 'https://cloud.timeedit.net';
const DAY = 864e5;

const LOGIN_HTML = '<!doctype html><html><head><title>KU Leuven Login</title></head><body><form action="https://idp.example.edu/login"><input name="username"></form></body></html>';

function load() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'kuloket.json'), 'utf8'));
}

/** Local calendar day (Europe/Brussels) `offset` days from today → {y, m, d}. */
function dayOf(offset, now = Date.now()) {
  const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}
const sapDate = (o) => `/Date(${Date.UTC(o.y, o.m, o.d)})/`;
const dur = (s) => { const m = /PT(\d+)H(\d+)M/.exec(s); return { h: +m[1], mi: +m[2] }; };
const pad = (n) => String(n).padStart(2, '0');
const icsLocal = (o, t) => `${o.y}${pad(o.m + 1)}${pad(o.d)}T${pad(t.h)}${pad(t.mi)}00`;

function odataEvents(fx, filter) {
  const m = /date ge datetime'(\d{4})-(\d\d)-(\d\d)T00:00:00' and date le datetime'(\d{4})-(\d\d)-(\d\d)T00:00:00'/.exec(filter || '');
  const lo = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : -Infinity;
  const hi = m ? Date.UTC(+m[4], +m[5] - 1, +m[6]) : Infinity;
  const out = [];
  fx.events.forEach((e, i) => {
    const day = dayOf(e.day);
    const ms = Date.UTC(day.y, day.m, day.d);
    if (ms < lo || ms > hi) return;
    out.push({
      __metadata: { type: 'ZC_EP_SCHEDULE_SRV.Event' },
      event_GUID: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}-${e.day}`,
      eventID: String(1000 + i),
      date: sapDate(day),
      start_time: e.start, end_time: e.end,
      ola_description: e.ola_description, ects_code: e.ects_code,
      groupinfo_general: '', groupinfo_detail: e.groupinfo_detail,
      workFormDesc: e.workFormDesc, event_type: 'LES',
      url_ects: `https://example.edu/ects/${e.ects_code}`,
      EventTeacherSet: { results: (e.teachers || []).map((n) => ({ name: n, url_wiwo: '' })) },
      EventLocationSet: { results: e.location ? [{ buildingNumber: '', ...e.location }] : [] },
    });
  });
  return out;
}

function odataExams(fx, expand) {
  return fx.exams.map((x, i) => {
    const day = dayOf(x.day);
    const r = {
      evaluationId: `EV${i + 1}`, moduleCode: x.moduleCode, moduleTitle: x.moduleTitle, evaluationText: x.evaluationText,
      examDate: sapDate(day), examBegtime: x.start, examEndtime: x.end, groupInfo: x.groupInfo,
      evaluationStatus: 'P', periodId: '1', academicYear: '2026',
    };
    if (expand) { r.toLocation = { results: [x.location] }; r.toStaff = { results: x.staff.map((n) => ({ name: n })) }; }
    return r;
  });
}

/** The TimeEdit feed for the same synthetic events (TZID Europe/Brussels, folded lines, one weekly RRULE). */
function icsFeed(fx) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimeEdit//mock//EN', 'X-WR-CALNAME:TimeEdit mock'];
  fx.events.forEach((e, i) => {
    const day = dayOf(e.day);
    const room = e.location ? e.location.roomName : '';
    L.push('BEGIN:VEVENT', `UID:mock-${i}@example.edu`, 'DTSTAMP:20260101T000000Z',
      `DTSTART;TZID=Europe/Brussels:${icsLocal(day, dur(e.start))}`, `DTEND;TZID=Europe/Brussels:${icsLocal(day, dur(e.end))}`,
      `SUMMARY:${e.ola_description} (${e.ects_code})`, `LOCATION:${room.replace(/,/g, '\\,')}`,
      // a long DESCRIPTION gets folded (continuation line starts with a space)
      `DESCRIPTION:Docent: ${(e.teachers || []).join('\\, ')}\\nGroep: ${e.groupinfo_detail.replace(e.ola_description, '').trim() || '-'}\\nType:`,
      ` ${e.workFormDesc}`, 'END:VEVENT');
  });
  const d = dayOf(3);
  L.push('BEGIN:VEVENT', 'UID:mock-weekly@example.edu', 'DTSTAMP:20260101T000000Z',
    `DTSTART;TZID=Europe/Brussels:${icsLocal(d, { h: 16, mi: 0 })}`, `DTEND;TZID=Europe/Brussels:${icsLocal(d, { h: 17, mi: 0 })}`,
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Engels voor film (X10500)', 'LOCATION:T001', 'DESCRIPTION:Docent: Docent H', 'END:VEVENT');
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

async function install(ctx, rec, opts = {}) {
  const fx = load();
  const K = Object.assign({ loggedOut: false, examsEmpty: false, noExpand: false, noIcsLink: false }, opts.kuloket || {});
  K.calls = []; K.ics = 0;
  rec.kuloket = K;
  const log = (req) => rec.requests.push({ method: req.method(), url: req.url(), body: req.postData(), headers: req.headers(), sw: true });
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });

  await ctx.route(`${KULOKET}/**`, async (route) => {
    const req = route.request(); log(req);
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/sap\/opu\/odata\/sap\//, '');
    K.calls.push({ path: p, query: Object.fromEntries(u.searchParams) });
    if (!u.pathname.startsWith('/sap/opu/odata/sap/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>KU Loket</title><p>KU Loket (mock)</p>' });
    if (req.method() !== 'GET') { rec.unknown.push({ url: req.url() }); return json(route, { error: 'read-only mock' }, 405); }
    if (K.loggedOut) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LOGIN_HTML });
    if (p === 'ZC_EP_SCHEDULE_SRV/Events') return json(route, { d: { results: odataEvents(fx, u.searchParams.get('$filter')) } });
    if (p === 'ZC_IER_SRV/EvaluationSet') {
      const expand = !!u.searchParams.get('$expand');
      if (expand && K.noExpand) return json(route, { error: { code: '/IWBEP/CM_MGW_RT/022', message: { value: 'Expand not supported' } } }, 400);
      return json(route, { d: { results: K.examsEmpty ? [] : odataExams(fx, expand) } });
    }
    if (p === 'ZC_EP_ICAL_SRV/StudentSet') return json(route, { d: { results: [{ Studentnumber: 'r0000000', Schedulelink: K.noIcsLink ? '' : fx.icsLink }] } });
    rec.unknown.push({ url: req.url() });
    return json(route, { error: { message: { value: 'not mocked' } } }, 404);
  });

  await ctx.route(`${TIMEEDIT}/**`, async (route) => {
    const req = route.request(); log(req);
    K.ics++;
    return route.fulfill({ status: 200, contentType: 'text/calendar; charset=utf-8', body: icsFeed(fx) });
  });
}

module.exports = { install, KULOKET, TIMEEDIT, icsFeed, odataEvents, load, dayOf };
