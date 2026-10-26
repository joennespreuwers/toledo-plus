/* Toledo+ — TP.kuloket: timetable + exams from KU Loket (read-only), with the public TimeEdit iCal feed as fallback.
   Sources, in order:
     1. KU Loket OData ZC_EP_SCHEDULE_SRV/Events (needs the student's KU Loket session; via the TP.net relay).
     2. The TimeEdit iCal link (ZC_EP_ICAL_SRV/StudentSet → Schedulelink, stored once in chrome.storage.local
        'kuloket:icsUrl', or pasted by the student) when KU Loket answers with a login page.
     3. Exams: ZC_IER_SRV/EvaluationSet (+ $expand=toLocation,toStaff when supported).
   Cache: chrome.storage.local 'kuloket:lessons:<YYYY-Www>' = {t, source, items}, 'kuloket:exams' = {t, items},
   'kuloket:meta' = {weeks:[keys], lessons:status, exams:status}, 'kuloket:icsUrlT' = when the link was last read from
   KU Loket (re-read ≥ 7 days later while signed in). Stale-while-revalidate, refresh after 6 h; the last good timetable
   stays cached (≤ 26 weeks back) so the agenda renders instantly, also offline / signed out.
   Signed out (SSO session expired) + a known iCal link → the TimeEdit feed is used automatically (status.needsLogin);
   a week that came from KU Loket earlier keeps its richer details (room, address, teachers, group) when the
   feed has the same lesson.
   Times: KU Loket gives the day as UTC midnight + a wall-clock duration ("PT09H00M00S") in Europe/Brussels;
   we convert with the EU DST rule so results don't depend on the browser's time zone.
   Never throws to views; never logs the iCal link (it is a personal secret). */
(() => {
  'use strict';
  const TP = (globalThis.TP ||= {});

  const HOST = 'https://webwsp.aps.kuleuven.be';
  const BASE = HOST + '/sap/opu/odata/sap/';
  const Q = 'sap-client=200&$format=json';
  const ICS_HOST = 'https://cloud.timeedit.net';
  const H = 3600e3, DAY = 864e5;
  const STALE = 6 * H;
  const RETRY = 2 * 60e3;       // min. time between failed attempts for the same week / exams
  const CHUNK_WEEKS = 6;
  const KEEP_WEEKS = 26;        // drop cached weeks older than this
  const P = 'kuloket:';
  const LINK_TTL = 7 * DAY;     // re-read the iCal link from KU Loket this often (it changes per academic year)
  const ICS_MEMO = 15 * 60e3;   // reuse a downloaded feed for this long (signed out: every new week would refetch it)
  const AUTH_SKIP = 2 * 60e3;   // right after a 'not signed in' answer, go straight to the feed

  // ------------------------------------------------------------------ Europe/Brussels time (EU DST rule)
  const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  function isDst(utcMs) {
    const y = new Date(utcMs).getUTCFullYear();
    return utcMs >= Date.UTC(y, 2, lastSunday(y, 2), 1) && utcMs < Date.UTC(y, 9, lastSunday(y, 9), 1);
  }
  const offset = (utcMs) => (isDst(utcMs) ? 2 : 1) * H;
  /** Wall-clock time in Brussels → epoch ms. Gap (spring forward) → shifted forward; overlap → first (CEST). */
  function bxl(y, mo, d, h = 0, mi = 0, s = 0) {
    const wall = Date.UTC(y, mo, d, h, mi, s);
    const summer = wall - 2 * H;
    return isDst(summer) ? summer : wall - H;
  }
  /** epoch ms → Brussels wall parts {y, m (0-based), d, h, mi, dow (0=Sun)} */
  function parts(ms) {
    const w = new Date(ms + offset(ms));
    return { y: w.getUTCFullYear(), m: w.getUTCMonth(), d: w.getUTCDate(), h: w.getUTCHours(), mi: w.getUTCMinutes(), dow: w.getUTCDay() };
  }

  /** "/Date(1761350400000)/" (also "/Date(…+0000)/", numbers, ISO strings) → ms | NaN */
  function sapDate(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    const m = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(String(v));
    if (m) return Number(m[1]);
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
  }
  /** The calendar day a SAP date stands for. It is UTC midnight of that day; +12 h also tolerates
   *  a Brussels-midnight encoding (22:00/23:00 UTC the day before). */
  function sapDay(v) {
    const ms = sapDate(v);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms + 12 * H);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }
  /** "PT09H30M00S" → {h, mi, s} | null */
  function duration(v) {
    const m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/i.exec(String(v || '').trim());
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return { h: Number(m[1] || 0), mi: Number(m[2] || 0), s: Number(m[3] || 0) };
  }
  function sapDateTime(dateV, timeV) {
    const day = sapDay(dateV);
    if (!day) return NaN;
    const t = duration(timeV) || { h: 0, mi: 0, s: 0 };
    return bxl(day.y, day.m, day.d, t.h, t.mi, t.s);
  }

  // ISO week of a Brussels calendar day
  function isoWeek(y, m, d) {
    const dt = new Date(Date.UTC(y, m, d));
    const dow = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dow);
    const yr = dt.getUTCFullYear();
    const wk = Math.ceil(((dt - Date.UTC(yr, 0, 1)) / DAY + 1) / 7);
    return `${yr}-W${String(wk).padStart(2, '0')}`;
  }
  const weekKeyOf = (ms) => { const p = parts(ms); return isoWeek(p.y, p.m, p.d); };
  const pad = (n) => String(n).padStart(2, '0');

  /** Weeks (Mon–Sun, Brussels) overlapping [from, to). */
  function weeksFor(from, to) {
    const out = [];
    const p = parts(from);
    const back = (p.dow + 6) % 7;
    let mon = new Date(Date.UTC(p.y, p.m, p.d - back));
    for (let i = 0; i < 120; i++) {
      const y = mon.getUTCFullYear(), m = mon.getUTCMonth(), d = mon.getUTCDate();
      const start = bxl(y, m, d);
      if (start >= to && out.length) break;
      const sun = new Date(Date.UTC(y, m, d + 6));
      out.push({ key: isoWeek(y, m, d), start, end: bxl(y, m, d + 7), mon: `${y}-${pad(m + 1)}-${pad(d)}`,
        sun: `${sun.getUTCFullYear()}-${pad(sun.getUTCMonth() + 1)}-${pad(sun.getUTCDate())}` });
      mon = new Date(Date.UTC(y, m, d + 7));
    }
    return out;
  }

  // ------------------------------------------------------------------ helpers
  const str = (v) => (v == null ? '' : String(v).trim());
  const results = (v) => (Array.isArray(v) ? v : (v && Array.isArray(v.results) ? v.results : (v && typeof v === 'object' ? [v] : [])));
  const httpsUrl = (u) => (/^https:\/\/[^\s"'<>]+$/i.test(str(u)) ? str(u) : '');
  const normCode = (s) => str(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normName = (s) => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const isIcsUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.origin === ICS_HOST && !x.username; } catch (_) { return false; } };

  function hashStr(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

  // ------------------------------------------------------------------ mapping: KU Loket event → Lesson
  function mapEvent(e) {
    if (!e || typeof e !== 'object') return null;
    const start = sapDateTime(e.date, e.start_time);
    let end = sapDateTime(e.date, e.end_time);
    if (!Number.isFinite(start)) return null;
    if (!Number.isFinite(end) || end <= start) end = start + H;
    const title = str(e.ola_description) || str(e.workFormDesc) || '—';
    const locs = results(e.EventLocationSet);
    const l = locs[0] || {};
    const infoTxt = [str(e.groupinfo_detail), str(e.groupinfo_general)].join(' ');
    const locInfo = (/Locatie:\s*([^|]+?)\s*$/i.exec(str(e.groupinfo_detail)) || /Locatie:\s*([^|]+?)\s*$/i.exec(str(e.groupinfo_general)) || [])[1] || '';
    const location = {
      room: str(l.roomName) || str(l.roomNumber),
      building: str(l.buildingName),
      street: str(l.street) || (locs.length ? '' : locInfo),
      city: str(l.city),
      mnemonic: str(l.mnemonic),
      url: httpsUrl(l.url_location),
    };
    let group = str(e.groupinfo_detail).replace(/\s*Locatie:.*$/i, '').trim();
    if (group && title && group.toLowerCase().startsWith(title.toLowerCase())) group = group.slice(title.length).trim();
    const kindTxt = `${str(e.workFormDesc)} ${str(e.event_type)}`;
    return {
      id: str(e.event_GUID) || `${str(e.eventID) || hashStr(title + infoTxt)}-${start}`,
      start, end, title,
      courseCode: str(e.ects_code),
      group,
      form: str(e.workFormDesc),
      kind: /exam|evaluat/i.test(kindTxt) ? 'examen' : 'les',
      location,
      teachers: results(e.EventTeacherSet).map((x) => str(x.name)).filter(Boolean),
      url: httpsUrl(e.url_ects),
      courseLuId: null,
      source: 'kuloket',
    };
  }

  // KU Loket exam → Exam
  function mapExam(x) {
    if (!x || typeof x !== 'object') return null;
    const start = sapDateTime(x.examDate, x.examBegtime);
    if (!Number.isFinite(start)) return null;
    let end = sapDateTime(x.examDate, x.examEndtime);
    if (!Number.isFinite(end) || end <= start) end = start + 3 * H;
    const l = results(x.toLocation)[0] || {};
    const staff = results(x.toStaff).map((s) => str(s.name) || str(s.fullName) || [str(s.firstName), str(s.lastName)].filter(Boolean).join(' ')).filter(Boolean);
    return {
      id: str(x.evaluationId) || `${str(x.moduleCode)}-${start}`,
      start, end,
      title: str(x.moduleTitle) || str(x.evaluationText) || '—',
      courseCode: str(x.moduleCode),
      text: str(x.evaluationText),
      group: str(x.groupInfo),
      location: {
        room: str(l.roomName) || str(l.roomNumber) || str(l.locationName) || str(l.room),
        building: str(l.buildingName), street: str(l.street), city: str(l.city), mnemonic: str(l.mnemonic),
        url: httpsUrl(l.url_location || l.url),
      },
      teachers: staff,
      courseLuId: null,
      kind: 'examen',
    };
  }

  // ------------------------------------------------------------------ ICS (TimeEdit)
  const unesc = (s) => String(s).replace(/\\([\\;,nN])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));

  function icsDate(value, params) {
    const v = str(value);
    let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (m || (params && /^date$/i.test(params.VALUE || ''))) {
      m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
      if (!m) return null;
      return { ms: bxl(+m[1], +m[2] - 1, +m[3]), allDay: true };
    }
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
    if (!m) return null;
    const a = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    // Z → UTC; TZID (TimeEdit: Europe/Brussels) or floating → Brussels wall time.
    return { ms: m[7] ? Date.UTC(...a) : bxl(...a), allDay: false };
  }

  function parseIcs(text) {
    const raw = String(text || '').replace(/\r\n|\r/g, '\n').split('\n');
    const lines = [];
    for (const l of raw) {
      if ((l.startsWith(' ') || l.startsWith('\t')) && lines.length) lines[lines.length - 1] += l.slice(1);
      else lines.push(l);
    }
    const out = [];
    let ev = null;
    for (const line of lines) {
      if (/^BEGIN:VEVENT$/i.test(line)) { ev = { ex: [] }; continue; }
      if (/^END:VEVENT$/i.test(line)) { if (ev) out.push(...expand(ev)); ev = null; continue; }
      if (!ev) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const head = line.slice(0, i); const value = line.slice(i + 1);
      const [name, ...ps] = head.split(';');
      const params = {};
      for (const p of ps) { const j = p.indexOf('='); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, ''); }
      const N = name.toUpperCase();
      if (N === 'DTSTART') ev.start = icsDate(value, params);
      else if (N === 'DTEND') ev.end = icsDate(value, params);
      else if (N === 'DURATION') ev.dur = duration(value);
      else if (N === 'SUMMARY') ev.summary = unesc(value);
      else if (N === 'LOCATION') ev.location = unesc(value);
      else if (N === 'DESCRIPTION') ev.description = unesc(value);
      else if (N === 'UID') ev.uid = value.trim();
      else if (N === 'RRULE') ev.rrule = value.trim();
      else if (N === 'EXDATE') for (const v of value.split(',')) { const d = icsDate(v, params); if (d) ev.ex.push(d.ms); }
      else if (N === 'STATUS') ev.status = value.trim().toUpperCase();
    }
    return out;
  }

  function expand(ev) {
    if (!ev.start || ev.status === 'CANCELLED') return [];
    let len;
    if (ev.end && ev.end.ms > ev.start.ms) len = ev.end.ms - ev.start.ms;
    else if (ev.dur) len = (ev.dur.h * 3600 + ev.dur.mi * 60 + ev.dur.s) * 1000 || H;
    else len = ev.start.allDay ? DAY : H;
    const base = { uid: ev.uid || '', summary: str(ev.summary), location: str(ev.location), description: str(ev.description), allDay: ev.start.allDay };
    const occ = [ev.start.ms];
    const rr = {};
    for (const kv of String(ev.rrule || '').split(';')) { const [k, v] = kv.split('='); if (k && v) rr[k.toUpperCase()] = v; }
    if (rr.FREQ === 'WEEKLY' || rr.FREQ === 'DAILY') {
      const step = (rr.FREQ === 'WEEKLY' ? 7 : 1) * Math.max(1, Number(rr.INTERVAL) || 1);
      const count = Math.min(Number(rr.COUNT) || 200, 200);
      const until = rr.UNTIL ? (icsDate(rr.UNTIL, {}) || {}).ms : Infinity;
      const p = parts(ev.start.ms); const sec = new Date(ev.start.ms).getUTCSeconds();
      for (let k = 1; occ.length < count && k < 400; k++) {
        const ms = bxl(p.y, p.m, p.d + k * step, p.h, p.mi, sec); // keep the wall-clock time across DST
        if (ms > until) break;
        occ.push(ms);
      }
    }
    const ex = new Set(ev.ex);
    return occ.filter((ms) => !ex.has(ms)).map((ms) => ({ ...base, start: ms, end: ms + len }));
  }

  const CODE_RE = /\b([A-Z][A-Z0-9]{4,6})\b/;
  function mapIcs(e) {
    const desc = e.description || '';
    const lines = desc.split('\n').map((s) => s.trim()).filter(Boolean);
    const field = (re) => { for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); } return ''; };
    const teacherTxt = field(/^(?:docent(?:en)?|teachers?|lecturers?|staff|enseignants?)\s*:\s*(.+)$/i);
    const codeM = [e.summary, desc].map((s) => CODE_RE.exec(s || '')).find((m) => m && /\d{3}/.test(m[1]));
    let title = e.summary.replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s*\(([A-Z][A-Z0-9]{4,6})\)\s*$/, '').trim();
    if (codeM) title = title.replace(new RegExp(`^${codeM[1]}\\s*[-–:]?\\s*`), '').trim();
    const kindTxt = `${e.summary} ${field(/^(?:type|activiteit|activity|werkvorm)\s*:\s*(.+)$/i)}`;
    return {
      id: `ics-${hashStr(e.uid || title)}-${e.start}`,
      start: e.start, end: e.end,
      title: title || '—',
      courseCode: codeM ? codeM[1] : '',
      group: field(/^(?:groep|group|groupe)\s*:\s*(.+)$/i),
      form: field(/^(?:type|activiteit|activity|werkvorm)\s*:\s*(.+)$/i),
      kind: /\bexam|examen\b/i.test(kindTxt) ? 'examen' : 'les',
      allDay: !!e.allDay,
      location: { room: e.location, building: '', street: '', city: '', mnemonic: '', url: '' },
      teachers: teacherTxt ? teacherTxt.split(/\s*[;,]\s*|\s+&\s+/).filter(Boolean) : [],
      url: '',
      courseLuId: null,
      source: 'ics',
    };
  }

  // ------------------------------------------------------------------ course matching
  let matchMemo = { sig: '', byCode: new Map(), byName: new Map(), names: [] };
  function matcher() {
    let cs = [];
    try { cs = (TP.data && TP.data.courses && TP.data.courses({ includeHidden: true })) || []; } catch (_) { cs = []; }
    const sig = cs.map((c) => c.luId + (c.year || '')).join('|');
    if (sig === matchMemo.sig) return matchMemo;
    const byCode = new Map(), byName = new Map(), names = [];
    const sorted = cs.slice().sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0)); // current year wins
    for (const c of sorted) {
      const code = normCode(c.code || (TP.util && TP.util.courseCode ? TP.util.courseCode(c.title) : ''));
      if (code && !byCode.has(code)) byCode.set(code, c.luId);
      const n = normName(TP.util && TP.util.courseName ? TP.util.courseName(c.title || '') : c.title);
      if (n && !byName.has(n)) { byName.set(n, c.luId); names.push([n, c.luId]); }
    }
    matchMemo = { sig, byCode, byName, names };
    return matchMemo;
  }
  function matchCourse(item, M = matcher()) {
    const code = normCode(item.courseCode);
    if (code) {
      if (M.byCode.has(code)) return M.byCode.get(code);
      for (const [k, lu] of M.byCode) if (k.length >= 5 && (code.startsWith(k) || k.startsWith(code))) return lu;
    }
    const n = normName(item.title);
    if (!n) return null;
    if (M.byName.has(n)) return M.byName.get(n);
    if (n.length >= 6) {
      for (const [k, lu] of M.names) if (k.length >= 6 && (n.startsWith(k + ' ') || k.startsWith(n + ' '))) return lu;
    }
    return null;
  }
  const withCourse = (list) => { const M = matcher(); return list.map((x) => ({ ...x, courseLuId: matchCourse(x, M) })); };

  // ------------------------------------------------------------------ storage
  const hasStore = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const mem = { weeks: new Map(), exams: null, icsUrl: '', icsUrlT: 0, meta: { weeks: [] }, ics: null, authAt: 0 };
  function sget(keys) {
    return new Promise((res) => {
      if (!hasStore()) { res({}); return; }
      try { const r = chrome.storage.local.get(keys, (v) => res(v || {})); if (r && typeof r.then === 'function') r.then((v) => res(v || {}), () => res({})); } catch (_) { res({}); }
    });
  }
  function sset(obj) {
    return new Promise((res) => {
      if (!hasStore()) { res(); return; }
      try { const r = chrome.storage.local.set(obj, () => res()); if (r && typeof r.then === 'function') r.then(res, res); } catch (_) { res(); }
    });
  }
  function sremove(keys) {
    return new Promise((res) => {
      if (!hasStore() || !chrome.storage.local.remove) { res(); return; }
      try { const r = chrome.storage.local.remove(keys, () => res()); if (r && typeof r.then === 'function') r.then(res, res); } catch (_) { res(); }
    });
  }

  const status = {
    lessons: { ok: null, error: null, t: null, source: null, needsLogin: false },
    exams: { ok: null, error: null, t: null },
  };

  function persistMeta() {
    mem.meta = { weeks: [...mem.weeks.keys()].sort(), lessons: status.lessons, exams: status.exams };
    return sset({ [P + 'meta']: mem.meta });
  }

  async function putWeek(key, entry) {
    mem.weeks.set(key, entry);
    await sset({ [P + 'lessons:' + key]: entry });
  }

  let loaded = false;
  const ready = (async () => {
    try {
      const a = await sget([P + 'meta', P + 'exams', P + 'icsUrl', P + 'icsUrlT']);
      const meta = a[P + 'meta'] || {};
      if (meta.lessons && typeof meta.lessons === 'object') Object.assign(status.lessons, meta.lessons);
      if (meta.exams && typeof meta.exams === 'object') Object.assign(status.exams, meta.exams);
      if (a[P + 'exams'] && Array.isArray(a[P + 'exams'].items)) mem.exams = a[P + 'exams'];
      if (typeof a[P + 'icsUrl'] === 'string' && isIcsUrl(a[P + 'icsUrl'])) mem.icsUrl = a[P + 'icsUrl'];
      if (mem.icsUrl) mem.icsUrlT = Number(a[P + 'icsUrlT']) || 0;
      const cutoff = weekKeyOf(Date.now() - KEEP_WEEKS * 7 * DAY);
      const keys = (Array.isArray(meta.weeks) ? meta.weeks : []).filter((k) => typeof k === 'string');
      const keep = keys.filter((k) => k >= cutoff);
      const drop = keys.filter((k) => k < cutoff);
      if (keep.length) {
        const w = await sget(keep.map((k) => P + 'lessons:' + k));
        for (const k of keep) { const e = w[P + 'lessons:' + k]; if (e && Array.isArray(e.items)) mem.weeks.set(k, e); }
      }
      if (drop.length) { await sremove(drop.map((k) => P + 'lessons:' + k)); persistMeta(); }
    } catch (_) { /* start empty */ }
    loaded = true;
    emit('change', 'init');
    listenStorage();
  })();

  function listenStorage() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        let changed = false;
        for (const [k, c] of Object.entries(changes)) {
          if (!k.startsWith(P)) continue;
          const nv = c.newValue;
          if (k.startsWith(P + 'lessons:')) {
            const wk = k.slice((P + 'lessons:').length); const cur = mem.weeks.get(wk);
            if (nv && Array.isArray(nv.items) && (!cur || (nv.t || 0) > (cur.t || 0))) { mem.weeks.set(wk, nv); changed = true; }
          } else if (k === P + 'exams') {
            if (nv && Array.isArray(nv.items) && (!mem.exams || (nv.t || 0) > (mem.exams.t || 0))) { mem.exams = nv; changed = true; }
          } else if (k === P + 'icsUrl') {
            const u = typeof nv === 'string' && isIcsUrl(nv) ? nv : '';
            if (u !== mem.icsUrl) { mem.icsUrl = u; mem.ics = null; changed = true; }
          }
        }
        if (changed) emit('change', 'storage');
      });
    } catch (_) { /* not in an extension context */ }
  }

  // ------------------------------------------------------------------ events
  const listeners = {};
  function on(evt, fn) { (listeners[evt] ||= new Set()).add(fn); return () => off(evt, fn); }
  function off(evt, fn) { listeners[evt] && listeners[evt].delete(fn); }
  function emit(evt, arg) { for (const fn of [...(listeners[evt] || [])]) { try { fn(arg); } catch (e) { console.warn('[Toledo+] kuloket listener', e); } } }

  // ------------------------------------------------------------------ network
  function kerr(kind, st) { const e = new Error('kuloket: ' + kind); e.kind = kind; e.status = st || 0; return e; }

  /** GET an OData path; 'auth' error when KU Loket answers with a login page / redirect / 401. */
  async function odata(path) {
    if (!TP.net || !TP.net.text) throw kerr('network');
    let txt;
    try {
      txt = await TP.net.text(BASE + path, { headers: { Accept: 'application/json' } });
    } catch (e) {
      const s = (e && e.status) || 0;
      // The relay reports ok:false with a 2xx/3xx status when it was redirected off-origin (SSO login).
      if (s === 401 || s === 403 || (s >= 200 && s < 400)) throw kerr('auth', s);
      throw kerr(s ? 'http' : 'network', s);
    }
    const t = str(txt);
    if (!t || t[0] === '<') throw kerr('auth', 200);
    let j;
    try { j = JSON.parse(t); } catch (_) { throw kerr('auth', 200); }
    if (j && j.error) throw kerr('http', 400);
    const d = j && j.d !== undefined ? j.d : j;
    return Array.isArray(d) ? d : (d && Array.isArray(d.results) ? d.results : (d && Array.isArray(d.value) ? d.value : (j && Array.isArray(j.value) ? j.value : d)));
  }

  const lastTry = new Map(); // week key | 'exams' | 'ics' | 'icslink' → ms
  const tooSoon = (k) => Date.now() - (lastTry.get(k) || 0) < RETRY;

  function setLessonStatus(patch) {
    Object.assign(status.lessons, patch);
    persistMeta();
  }

  let inflight = new Map(); // week key → promise

  /** Fetch these weeks from KU Loket (≤ 6 weeks per request); fall back to ICS on 'auth'. */
  function fetchWeeks(weeks) {
    const todo = weeks.filter((w) => !inflight.has(w.key));
    const wait = weeks.filter((w) => inflight.has(w.key)).map((w) => inflight.get(w.key));
    if (!todo.length) return Promise.all(wait).then(() => {});
    todo.sort((a, b) => a.start - b.start);
    const chunks = [];
    for (const w of todo) {
      const c = chunks[chunks.length - 1];
      if (c && c.length < CHUNK_WEEKS && w.start - c[c.length - 1].start <= 7 * DAY + 2 * H) c.push(w);
      else chunks.push([w]);
    }
    const p = (async () => {
      let authFail = false, netFail = null;
      // Just told "not signed in": don't ask KU Loket again for every week, use the feed straight away.
      if (mem.icsUrl && Date.now() - mem.authAt < AUTH_SKIP) { authFail = true; chunks.length = 0; }
      for (const c of chunks) {
        c.forEach((w) => lastTry.set(w.key, Date.now()));
        const filter = `(date ge datetime'${c[0].mon}T00:00:00' and date le datetime'${c[c.length - 1].sun}T00:00:00')`;
        const path = `ZC_EP_SCHEDULE_SRV/Events?${Q}&$skip=0&$top=5000&$filter=${encodeURIComponent(filter)}&$expand=EventTeacherSet,EventLocationSet`;
        try {
          const rows = results(await odata(path));
          const now = Date.now();
          const byWeek = new Map(c.map((w) => [w.key, []]));
          for (const r of rows) {
            const l = mapEvent(r);
            if (!l) continue;
            const k = weekKeyOf(l.start);
            if (byWeek.has(k)) byWeek.get(k).push(l);
          }
          for (const [k, items] of byWeek) await putWeek(k, { t: now, source: 'kuloket', items: items.sort((a, b) => a.start - b.start) });
          mem.authAt = 0;
          setLessonStatus({ ok: true, error: null, t: now, source: 'kuloket', needsLogin: false });
        } catch (e) {
          if (e.kind === 'auth') { authFail = true; mem.authAt = Date.now(); break; }
          netFail = e.kind || 'network';
        }
      }
      if (authFail) {
        const ok = mem.icsUrl ? await fetchIcs(todo) : false;
        if (!ok) setLessonStatus({ ok: false, error: mem.icsUrl ? 'ics' : 'auth', needsLogin: true });
      } else if (netFail) {
        setLessonStatus({ ok: false, error: netFail });
      } else if (!mem.icsUrl || Date.now() - (mem.icsUrlT || 0) > LINK_TTL) {
        fetchIcsLink(); // remember (or refresh) the iCal link while we have a session: the fallback for later
      }
      await persistMeta();
      emit('change', 'lessons');
    })().catch((e) => { console.warn('[Toledo+] kuloket lessons', e && e.message); })
      .finally(() => { todo.forEach((w) => inflight.delete(w.key)); });
    todo.forEach((w) => inflight.set(w.key, p));
    return Promise.all([p, ...wait]).then(() => {});
  }

  /** Lessons from the feed grouped per ISO week; the parsed feed is reused for ICS_MEMO. → Map|null */
  async function icsWeeks() {
    const url = mem.icsUrl;
    if (!url || !TP.net || !TP.net.text) return null;
    if (mem.ics && mem.ics.url === url && Date.now() - mem.ics.t < ICS_MEMO) return mem.ics.byWeek;
    lastTry.set('ics', Date.now());
    let txt;
    try { txt = await TP.net.text(url); } catch (_) { return null; }
    if (!/BEGIN:VCALENDAR/i.test(String(txt || ''))) return null;
    const byWeek = new Map();
    for (const ev of parseIcs(txt)) {
      const l = mapIcs(ev);
      const k = weekKeyOf(l.start);
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k).push(l);
    }
    mem.ics = { url, t: Date.now(), byWeek };
    return byWeek;
  }

  /** Same lesson in a KU Loket week we saw before? → keep its richer details (room, address, teachers, group). */
  function enrich(items, prev) {
    if (!prev || !Array.isArray(prev.items) || !prev.items.length) return items;
    const pool = prev.source === 'kuloket' ? prev.items : prev.items.filter((x) => x.detailsFrom === 'kuloket');
    if (!pool.length) return items;
    return items.map((l) => {
      const code = normCode(l.courseCode); const name = normName(l.title);
      const k = pool.find((x) => x.start === l.start && x.end === l.end
        && ((code && normCode(x.courseCode) === code) || (name && (normName(x.title) === name || normName(x.title).startsWith(name) || name.startsWith(normName(x.title))))));
      if (!k) return l;
      const room = l.location && l.location.room;
      const sameRoom = !room || (k.location && [k.location.room, k.location.mnemonic].some((r) => r && (r.includes(room) || room.includes(r))));
      return {
        ...l,
        title: k.title || l.title,
        courseCode: l.courseCode || k.courseCode,
        group: l.group || k.group,
        form: l.form || k.form,
        teachers: l.teachers && l.teachers.length ? l.teachers : (k.teachers || []),
        location: sameRoom && k.location ? { ...k.location } : l.location,
        url: l.url || k.url || '',
        detailsFrom: 'kuloket',
      };
    });
  }

  /** Fallback when KU Loket says "not signed in": fill every week the TimeEdit feed covers (plus the requested ones). → ok */
  async function fetchIcs(requested) {
    const feed = await icsWeeks();
    if (!feed) return false;
    const now = Date.now();
    const byWeek = new Map((requested || []).map((w) => [w.key, []]));
    for (const [k, items] of feed) byWeek.set(k, items);
    for (const [k, items] of byWeek) {
      const cur = mem.weeks.get(k);
      if (cur && cur.source === 'kuloket' && now - cur.t < STALE) continue; // fresher, richer data
      await putWeek(k, { t: now, source: 'ics', items: enrich(items, cur).sort((a, b) => a.start - b.start) });
    }
    setLessonStatus({ ok: true, error: null, t: now, source: 'ics', needsLogin: true });
    return true;
  }

  /** Read the personal iCal link (ZC_EP_ICAL_SRV/StudentSet → Schedulelink) while signed in and keep it locally.
   *  Never logged or shown in full. Re-read after LINK_TTL so a new academic year's link is picked up. */
  async function fetchIcsLink() {
    if ((mem.icsUrl && Date.now() - (mem.icsUrlT || 0) <= LINK_TTL) || tooSoon('icslink')) return;
    lastTry.set('icslink', Date.now());
    try {
      const rows = results(await odata(`ZC_EP_ICAL_SRV/StudentSet?${Q}`));
      const link = rows.map((r) => str(r && r.Schedulelink).replace(/^webcals?:\/\//i, 'https://')).find(isIcsUrl);
      if (!link) return;
      const changed = link !== mem.icsUrl;
      mem.icsUrl = link; mem.icsUrlT = Date.now();
      if (changed) mem.ics = null;
      await sset({ [P + 'icsUrl']: link, [P + 'icsUrlT']: mem.icsUrlT });
      if (changed) emit('change', 'icsUrl');
    } catch (_) { /* optional */ }
  }

  // ------------------------------------------------------------------ public: lessons
  function collect(from, to) {
    const ws = weeksFor(from, to);
    const out = [];
    let any = false;
    for (const w of ws) {
      const e = mem.weeks.get(w.key);
      if (!e) continue;
      any = true;
      for (const l of e.items) if (l.start < to && l.end > from) out.push(l);
    }
    return any ? withCourse(out.sort((a, b) => a.start - b.start)) : null;
  }
  const isStale = (w) => { const e = mem.weeks.get(w.key); return !e || Date.now() - (e.t || 0) > STALE; };
  function range(o) {
    const from = Number(o && o.from); const to = Number(o && o.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return { from, to: Math.min(to, from + 400 * DAY) };
  }

  let bgTimer = null; const bgWeeks = new Map();
  function scheduleRevalidate(weeks) {
    for (const w of weeks) if (!tooSoon(w.key) && !inflight.has(w.key)) bgWeeks.set(w.key, w);
    if (!bgWeeks.size || bgTimer) return;
    bgTimer = setTimeout(() => {
      bgTimer = null;
      const ws = [...bgWeeks.values()]; bgWeeks.clear();
      fetchWeeks(ws).catch(() => {});
    }, 0);
  }

  /** Lessons in [from, to). Cache-first: fresh cache → returned; missing weeks → fetched; stale → revalidated in background. */
  async function lessons(o = {}) {
    try {
      const r = range(o);
      if (!r) return [];
      await ready;
      const ws = weeksFor(r.from, r.to);
      const missing = ws.filter((w) => !mem.weeks.has(w.key) && (o.force || !tooSoon(w.key)));
      const stale = ws.filter((w) => mem.weeks.has(w.key) && isStale(w));
      if (o.force) await fetchWeeks(ws);
      else if (missing.length) await fetchWeeks(missing.concat(stale));
      else if (stale.length) scheduleRevalidate(stale);
      return collect(r.from, r.to) || [];
    } catch (e) {
      console.warn('[Toledo+] kuloket.lessons', e && e.message);
      return [];
    }
  }

  /** Sync, for first paint: cached lessons in range, or null when nothing is cached (yet). Triggers a revalidate. */
  function peekLessons(o = {}) {
    try {
      const r = range(o);
      if (!r || !loaded) return null;
      const ws = weeksFor(r.from, r.to);
      const need = ws.filter(isStale);
      if (need.length) scheduleRevalidate(need);
      return collect(r.from, r.to);
    } catch (_) { return null; }
  }

  /** Sync: cached lessons in range plus where they came from and how old the oldest week is.
   *  → { items: Lesson[]|null (null = nothing cached for this range yet), t: ms|null, source: 'kuloket'|'ics'|'mixed'|null, complete } */
  function peekRange(o = {}) {
    const items = peekLessons(o);
    const r = range(o);
    if (!r || !loaded) return { items: null, t: null, source: null, complete: false };
    const ws = weeksFor(r.from, r.to);
    const es = ws.map((w) => mem.weeks.get(w.key)).filter(Boolean);
    const srcs = [...new Set(es.map((e) => e.source))];
    return {
      items,
      t: es.length ? Math.min(...es.map((e) => e.t || 0)) : null,
      source: srcs.length > 1 ? 'mixed' : (srcs[0] || null),
      complete: es.length === ws.length,
    };
  }

  // ------------------------------------------------------------------ public: exams
  let examsInflight = null;
  function fetchExams() {
    if (examsInflight) return examsInflight;
    lastTry.set('exams', Date.now());
    examsInflight = (async () => {
      let rows;
      try {
        try { rows = await odata(`ZC_IER_SRV/EvaluationSet?${Q}&$expand=toLocation,toStaff`); } catch (e) {
          if (e.kind === 'auth' || e.kind === 'network') throw e;
          rows = await odata(`ZC_IER_SRV/EvaluationSet?${Q}`); // $expand not supported
        }
        const items = results(rows).map(mapExam).filter(Boolean).sort((a, b) => a.start - b.start);
        mem.exams = { t: Date.now(), items };
        await sset({ [P + 'exams']: mem.exams });
        Object.assign(status.exams, { ok: true, error: null, t: mem.exams.t });
      } catch (e) {
        Object.assign(status.exams, { ok: false, error: (e && e.kind) || 'network' });
      }
      await persistMeta();
      emit('change', 'exams');
    })().catch(() => {}).finally(() => { examsInflight = null; });
    return examsInflight;
  }
  const examsStale = () => !mem.exams || Date.now() - (mem.exams.t || 0) > STALE;

  async function exams(o = {}) {
    try {
      await ready;
      if (o.force || (!mem.exams && !tooSoon('exams'))) await fetchExams();
      else if (examsStale() && !tooSoon('exams')) fetchExams();
      return mem.exams ? withCourse(mem.exams.items) : [];
    } catch (_) { return []; }
  }
  function peekExams() {
    try {
      if (!loaded) return null;
      if (examsStale() && !tooSoon('exams')) setTimeout(() => { if (!tooSoon('exams')) fetchExams(); }, 0);
      return mem.exams ? withCourse(mem.exams.items) : null;
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------------ public: status, iCal link, links
  function getStatus() {
    return {
      lessons: { ok: status.lessons.ok, error: status.lessons.error, t: status.lessons.t, source: status.lessons.source, needsLogin: !!status.lessons.needsLogin },
      exams: { ok: status.exams.ok, error: status.exams.error, t: status.exams.t },
      icsUrl: !!mem.icsUrl,
      loaded,
    };
  }

  /** Store (or clear with '') the personal TimeEdit iCal link. → true when accepted. Never logged. */
  async function setIcsUrl(url) {
    const u = str(url).replace(/^webcals?:\/\//i, 'https://');
    if (!u) { mem.icsUrl = ''; mem.ics = null; await sremove([P + 'icsUrl', P + 'icsUrlT']); emit('change', 'icsUrl'); return true; }
    if (!isIcsUrl(u)) return false;
    mem.icsUrl = u; mem.icsUrlT = Date.now(); mem.ics = null;
    lastTry.delete('ics');
    for (const k of [...lastTry.keys()]) if (/^\d{4}-W/.test(k)) lastTry.delete(k);
    await sset({ [P + 'icsUrl']: u, [P + 'icsUrlT']: mem.icsUrlT });
    emit('change', 'icsUrl');
    return true;
  }
  function getIcsUrlMasked() {
    if (!mem.icsUrl) return '';
    try { const x = new URL(mem.icsUrl); const seg = x.pathname.split('/').filter(Boolean)[0] || ''; return `${x.host}/${seg}${seg ? '/' : ''}…••••`; } catch (_) { return '••••'; }
  }

  const APPS = [
    ['zr_1027', 'study', 'doc'], ['zr_1013', 'study', 'person'], ['zr_0202', 'study', 'download'], ['zr_1012', 'study', 'eyeSlash'],
    ['zr_1006', 'study', 'page'], ['zr_0442', 'study', 'courses'], ['zr_0332', 'study', 'checkCircle'], ['zr_0363', 'study', 'deadlines'],
    ['zr_1017', 'study', 'folder'],
    ['zr_1009', 'enrol', 'refresh'], ['zr_0122', 'enrol', 'external'], ['zr_1001', 'enrol', 'page'], ['zr_0187', 'enrol', 'task'],
    ['zr_0358', 'enrol', 'tool'], ['zr_1010', 'enrol', 'link'],
    ['zr_0367', 'agenda', 'calendar'], ['zr_0216', 'agenda', 'filter'], ['zr_1014', 'agenda', 'refresh'],
    ['zr_0171', 'survey', 'megaphone'], ['zr_0184', 'survey', 'clock'],
    ['zr_0097', 'safety', 'warning'], ['zr_0275', 'safety', 'checkCircle'],
    ['zr_1015', 'support', 'overview'], ['zr_1005', 'support', 'tool'], ['zr_0424', 'support', 'bell'], ['zr_1003', 'support', 'info'],
    ['zr_1004', 'support', 'mail'], ['zr_1002', 'support', 'doc'],
  ];
  const GROUPS = ['study', 'enrol', 'agenda', 'survey', 'safety', 'support'];
  const sapLang = () => { const l = TP.i18n && TP.i18n.lang ? TP.i18n.lang() : 'nl'; return l === 'nl' ? 'NL' : l === 'fr' ? 'FR' : 'EN'; };
  const appUrl = (id) => `${HOST}/sap/bc/ui2/flp?sap-language=${sapLang()}#${id}-display`;
  const tr = (k) => (TP.t ? TP.t(k) : k);
  function links() {
    return APPS.map(([id, group, icon]) => ({ id, title: tr('kuloket.app.' + id), desc: tr('kuloket.app.' + id + '.desc'), url: appUrl(id), group, icon }));
  }

  /** Force-refresh everything for a range (toolbar/refresh). */
  async function refresh(o = {}) {
    const r = range(o);
    mem.authAt = 0; mem.ics = null; // ask KU Loket again (the student may just have signed in)
    await Promise.all([r ? lessons({ ...r, force: true }) : null, exams({ force: true })]);
  }

  TP.kuloket = {
    lessons, peekLessons, peekRange, exams, peekExams, refresh,
    status: getStatus, on, off,
    links, GROUPS, appUrl, scheduleUrl: () => appUrl('zr_0367'), icalAppUrl: () => appUrl('zr_1014'), loginUrl: () => appUrl('zr_0367'),
    setIcsUrl, getIcsUrlMasked,
    ready: () => ready,
    _test: { bxl, parts, isDst, sapDate, sapDay, duration, sapDateTime, isoWeek, weekKeyOf, weeksFor, mapEvent, mapExam, parseIcs, mapIcs, matchCourse, isIcsUrl, enrich, mem, lastTry, status },
  };
})();
