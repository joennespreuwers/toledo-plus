/* Toledo+ demo — in-memory "internet" for the demo page (demo/index.html) and the website screenshots
   (tools/screens.mjs). A browser port of tests/helpers/mock.js + kuloket-mock.js, fed by the fictitious
   data in demo/data/*.json. Plain ES2020, no modules: works as a <script> and via require() in Node.

     const router = TPDemoMock.create({ portal, ultra, kuloket }, { version: '1.4.0' });
     router.handle({ url, method, body, as }) → { ok, status, data, contentType }

   Date tokens in the data ("@ms:-2d", "@iso:+1d@23:59", KU Loket "day": 3) are relative to now. */
(function (root) {
  'use strict';
  var PORTAL = 'https://toledo.kuleuven.be';
  var ULTRA = 'https://ultra.edu.kuleuven.cloud';
  var KULOKET = 'https://webwsp.aps.kuleuven.be';
  var TIMEEDIT = 'https://cloud.timeedit.net';
  var API = 'https://api.toledoplus.be';
  var DAY = 864e5;
  var TOKEN = /^@(ms|iso):([+-]?\d+(?:\.\d+)?)d(?:@(\d\d):(\d\d))?$/;

  function resolveToken(str, now) {
    var m = TOKEN.exec(str);
    if (!m) return str;
    var d = new Date(now + Number(m[2]) * DAY);
    if (m[3] !== undefined) d.setHours(Number(m[3]), Number(m[4]), 0, 0);
    return m[1] === 'ms' ? d.getTime() : d.toISOString();
  }
  function materialize(v, now) {
    if (typeof v === 'string') return v.charAt(0) === '@' ? resolveToken(v, now) : v;
    if (Array.isArray(v)) return v.map(function (x) { return materialize(x, now); });
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).forEach(function (k) { if (k !== '_comment') o[k] = materialize(v[k], now); });
      return o;
    }
    return v;
  }

  // ---------- KU Loket helpers (SAP OData + TimeEdit iCal) ----------
  function dayOf(offset, now) {
    var d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }
  var sapDate = function (o) { return '/Date(' + Date.UTC(o.y, o.m, o.d) + ')/'; };
  var dur = function (s) { var m = /PT(\d+)H(\d+)M/.exec(s); return { h: +m[1], mi: +m[2] }; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var icsLocal = function (o, t) { return '' + o.y + pad(o.m + 1) + pad(o.d) + 'T' + pad(t.h) + pad(t.mi) + '00'; };

  function odataEvents(K, filter, now) {
    var m = /date ge datetime'(\d{4})-(\d\d)-(\d\d)T00:00:00' and date le datetime'(\d{4})-(\d\d)-(\d\d)T00:00:00'/.exec(filter || '');
    var lo = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : -Infinity;
    var hi = m ? Date.UTC(+m[4], +m[5] - 1, +m[6]) : Infinity;
    var out = [];
    K.events.forEach(function (e, i) {
      var day = dayOf(e.day, now);
      var ms = Date.UTC(day.y, day.m, day.d);
      if (ms < lo || ms > hi) return;
      out.push({
        __metadata: { type: 'ZC_EP_SCHEDULE_SRV.Event' },
        event_GUID: '00000000-0000-0000-0000-' + String(i + 1).padStart(12, '0') + '-' + e.day,
        eventID: String(1000 + i), date: sapDate(day), start_time: e.start, end_time: e.end,
        ola_description: e.ola_description, ects_code: e.ects_code, groupinfo_general: '', groupinfo_detail: e.groupinfo_detail,
        workFormDesc: e.workFormDesc, event_type: 'LES', url_ects: 'https://example.edu/ects/' + e.ects_code,
        EventTeacherSet: { results: (e.teachers || []).map(function (n) { return { name: n, url_wiwo: '' }; }) },
        EventLocationSet: { results: e.location ? [Object.assign({ buildingNumber: '' }, e.location)] : [] },
      });
    });
    return out;
  }
  function odataExams(K, expand, now) {
    return K.exams.map(function (x, i) {
      var day = dayOf(x.day, now);
      var r = { evaluationId: 'EV' + (i + 1), moduleCode: x.moduleCode, moduleTitle: x.moduleTitle, evaluationText: x.evaluationText,
        examDate: sapDate(day), examBegtime: x.start, examEndtime: x.end, groupInfo: x.groupInfo,
        evaluationStatus: 'P', periodId: '1', academicYear: '2026' };
      if (expand) { r.toLocation = { results: [x.location] }; r.toStaff = { results: x.staff.map(function (n) { return { name: n }; }) }; }
      return r;
    });
  }
  function icsFeed(K, now) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TimeEdit//demo//EN', 'X-WR-CALNAME:TimeEdit demo'];
    K.events.forEach(function (e, i) {
      var day = dayOf(e.day, now);
      var room = e.location ? e.location.roomName : '';
      L.push('BEGIN:VEVENT', 'UID:demo-' + i + '@example.edu', 'DTSTAMP:20260101T000000Z',
        'DTSTART;TZID=Europe/Brussels:' + icsLocal(day, dur(e.start)), 'DTEND;TZID=Europe/Brussels:' + icsLocal(day, dur(e.end)),
        'SUMMARY:' + e.ola_description + ' (' + e.ects_code + ')', 'LOCATION:' + room.replace(/,/g, '\\,'),
        'DESCRIPTION:Docent: ' + (e.teachers || []).join('\\, ') + '\\nType: ' + e.workFormDesc, 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n') + '\r\n';
  }

  // ---------- Ultra helpers ----------
  function allNodes(tree) {
    var out = {};
    (function walk(l) { l.forEach(function (x) { out[x.id] = x; if (x._kids) walk(x._kids); }); })(tree);
    return out;
  }
  function strip(l) {
    return l.map(function (x) { var r = {}; Object.keys(x).forEach(function (k) { if (k !== '_kids' && k !== '_attachments') r[k] = x[k]; }); return r; });
  }

  function create(raw, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var P = materialize(raw.portal, now);
    var U = materialize(raw.ultra, now);
    var K = raw.kuloket;
    var version = opts.version || '0.0.0';
    var treeCache = {};

    function treeFor(cid) {
      if (U.trees[cid]) return U.trees[cid];
      if (treeCache[cid]) return treeCache[cid];
      var i = 0; var suffix = cid.replace(/\W/g, '');
      var walk = function (l) {
        return l.map(function (x) {
          var id = '_d' + suffix + 'x' + (i++) + '_1';
          return Object.assign({}, x, { id: id,
            links: [{ href: '/ultra/redirect?redirectType=nautilus&courseId=' + cid + '&contentId=' + id }],
            _attachments: x._attachments ? x._attachments.map(function (a) { return Object.assign({}, a, { id: '_att' + id }); }) : undefined,
            _kids: x._kids ? walk(x._kids) : undefined });
        });
      };
      return (treeCache[cid] = walk(U.defaultTree));
    }

    function ultraApi(path, url) {
      var m;
      var p = path.replace(/^\/learn\/api\/public\/v\d+/, '');
      if (p === '/users/me') return { id: '_me_1', userName: 'r0000000', name: { given: 'Student', family: 'Voorbeeld' } };
      if (p === '/calendars/items') {
        var since = Date.parse(url.searchParams.get('since') || 0) || 0;
        var until = Date.parse(url.searchParams.get('until') || 0) || Infinity;
        return { results: U.calendarItems.filter(function (i) { var t = Date.parse(i.end); return t >= since && t <= until; }) };
      }
      if ((m = p.match(/^\/courses\/courseId:(.+)$/))) {
        var lu = decodeURIComponent(m[1]);
        return Object.keys(U.courses).map(function (k) { return U.courses[k]; }).find(function (x) { return x.courseId === lu; }) || null;
      }
      if ((m = p.match(/^\/courses\/([^/]+)$/))) return U.courses[decodeURIComponent(m[1])] || null;
      if (!(m = p.match(/^\/courses\/([^/]+)(\/.*)$/))) return null;
      var cid = decodeURIComponent(m[1]); var rest = m[2];
      if (!U.courses[cid]) return null;
      var tree = treeFor(cid);
      var nodes = allNodes(tree);
      if (rest === '/contents') return { results: strip(tree) };
      if ((m = rest.match(/^\/contents\/([^/]+)\/children$/))) { var n1 = nodes[m[1]]; return n1 ? { results: strip(n1._kids || []) } : null; }
      if ((m = rest.match(/^\/contents\/([^/]+)\/attachments$/))) { var n2 = nodes[m[1]]; return n2 ? { results: n2._attachments || [] } : null; }
      if (/\/download$/.test(rest)) return null; // no files in the demo
      if ((m = rest.match(/^\/contents\/([^/]+)$/))) { var n3 = nodes[m[1]]; return n3 ? strip([n3])[0] : null; }
      var anns = U.announcements[cid] || [];
      if (rest === '/announcements') return { results: anns };
      if ((m = rest.match(/^\/announcements\/([^/]+)$/))) return anns.find(function (a) { return a.id === m[1]; }) || null;
      if (rest === '/gradebook/columns') return { results: U.columns[cid] || [] };
      if (rest === '/users') return { results: U.instructors[cid] || [] };
      return null;
    }

    function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (o && k in o) r[k] = o[k]; }); return r; }
    var ok = function (data, ct) { return { ok: true, status: 200, data: data, contentType: ct || 'application/json; charset=utf-8' }; };
    var notFound = function () { return { ok: false, status: 404, data: null, contentType: 'application/json; charset=utf-8' }; };

    /** One request → {ok, status, data, contentType}. data is parsed JSON (or text for the iCal feed). */
    function handle(req) {
      var url; try { url = new URL(req.url); } catch (_) { return notFound(); }
      var method = String(req.method || 'GET').toUpperCase();
      var body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { /* keep text */ } }
      var path = url.pathname;

      if (url.origin === PORTAL) {
        var pm = path.match(/^\/portal\/api\/(.+)$/);
        if (!pm) return notFound();
        var p = pm[1];
        if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
          if (p === 'batch/events' && Array.isArray(body)) {
            body.forEach(function (b) { var e = P.events.find(function (x) { return x.id === b.id; }); if (e) Object.assign(e, pick(b, ['read', 'seen', 'dismissed'])); });
            return ok(body);
          }
          var em = p.match(/^enrollments\/([^/]+)$/);
          if (em) { var en = P.enrollments.find(function (x) { return x.id === decodeURIComponent(em[1]); }); if (en && body) Object.assign(en, pick(body, ['favorite'])); return en ? ok(en) : notFound(); }
          return notFound();
        }
        var map = { enrollments: P.enrollments, events: P.events, upcoming: P.upcoming, 'emails/unread': P.mail, links: P.links };
        return p in map ? ok(JSON.parse(JSON.stringify(map[p]))) : notFound();
      }
      if (url.origin === ULTRA) {
        if (path.indexOf('/learn/api/') !== 0) return notFound();
        if (method === 'PATCH') return ok(body || {});
        var r = ultraApi(path, url);
        return r === null ? notFound() : ok(JSON.parse(JSON.stringify(r)));
      }
      if (url.origin === KULOKET) {
        var kp = path.replace(/^\/sap\/opu\/odata\/sap\//, '');
        if (kp === 'ZC_EP_SCHEDULE_SRV/Events') return ok({ d: { results: odataEvents(K, url.searchParams.get('$filter'), now) } });
        if (kp === 'ZC_IER_SRV/EvaluationSet') return ok({ d: { results: odataExams(K, !!url.searchParams.get('$expand'), now) } });
        if (kp === 'ZC_EP_ICAL_SRV/StudentSet') return ok({ d: { results: [{ Studentnumber: 'r0000000', Schedulelink: K.icsLink }] } });
        return notFound();
      }
      if (url.origin === TIMEEDIT) return ok(icsFeed(K, now), 'text/calendar; charset=utf-8');
      if (url.origin === API) {
        if (method === 'GET' && path === '/v1/latest') return ok({ version: version, url: 'https://toledoplus.be/', notes: '' });
        if (method === 'POST' && /^\/v1\/(ping|forget|feedback)$/.test(path)) return ok({ ok: true });
        return notFound();
      }
      return notFound();
    }

    return { handle: handle, portal: P, ultra: U, kuloket: K, now: now };
  }

  var api = { create: create, materialize: materialize, PORTAL: PORTAL, ULTRA: ULTRA, KULOKET: KULOKET, TIMEEDIT: TIMEEDIT, API: API };
  root.TPDemoMock = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
