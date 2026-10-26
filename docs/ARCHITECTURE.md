# Toledo+ — architecture contract (v1.1)

Toledo+ is a Manifest V3 Chrome/Edge extension that **wraps** KU Leuven Toledo for students:
the portal (`https://toledo.kuleuven.be/portal/`) and Blackboard Learn Ultra (`https://ultra.edu.kuleuven.cloud/ultra/`)
are replaced by one consistent app shell (sidebar / tab bar / toolbar) with our own views.
No build step: plain ES2020 scripts, loaded as content scripts in a fixed order, sharing one global `TP` namespace
in the extension's isolated world. Everything renders inside a **shadow root** so Toledo's CSS can't leak in.

Read `docs/DESIGN.md` (design spec from research) before writing UI.

## Hard-won facts about the platform (verified live)

1. **Ultra sets `<base href>` to a CDN.** Every URL used on the Ultra origin must be absolute
   (`TP.util.abs(path)` = `location.origin + path`). Relative `fetch('/learn/…')` or `<a href="/ultra/…">` breaks.
2. **Ultra wraps `window.fetch` in the page world** – irrelevant for us: content scripts have their own fetch.
3. **File downloads**: `/learn/api/public/v1/courses/{cid}/contents/{id}/attachments/{aid}/download` 302-redirects to a signed S3 URL.
   Fetch it with **default credentials** (NOT `credentials:'include'` – S3 rejects credentialed CORS), then save the blob
   via `<a download>`. "Open" = `window.open(absUrl)`.
4. Portal API (same origin on toledo.kuleuven.be, `fetch` with `credentials:'include'`, header `Toledo-Language: nl|en`):
   - `GET /portal/api/enrollments` → `[{id, learningUnitId, title:"Filmtaal 1 [X10265]", type:'course'|'community', semester:'SEMESTER1'|'SEMESTER2'|'YEAR'|'UNKNOWN', academicYear:2627|0, color:1..16, favorite, available, link}]`
     (`link` = `https://icts-p-toledo-journey.cloud.icts.kuleuven.be/learningUnits/ultraLink?batchUid=<learningUnitId>` → redirects to the Ultra course outline)
   - `GET /portal/api/events` → `[{id, title, source:"Filmtaal 1 [X10265]"|"Ad Valvas", sourceId:<learningUnitId>|'advalvas', date:ms, type:'notifications'|'advalvas', eventType:'update'|'message', subType, read, seen, dismissed, url, author, color}]`
     subTypes: `content` (new file/page), `other` (assignment/item made available), `due` (deadline; `date` = due time),
     `course` (course became available – title = course name; **not useful in feeds, skip**), `announcement` (course announcement), `advalvas` (school notice).
   - `PATCH /portal/api/batch/events` body `[{id, type, subType, read:true}]` (or `seen:true` / `dismissed:true`) – marks events in Toledo itself.
   - `PATCH /portal/api/enrollments/{id}` body `{favorite:true|false}` – Toledo's own favorite star.
   - `GET /portal/api/upcoming` → today+tomorrow lessons `[{start, end, name, location:{mnemonic, roomNumber}('?' = unknown), source:{learningUnitId, link, color}}]`
   - `GET /portal/api/emails/unread` → `{value:129}`
   - `GET /portal/api/links` → groups `[{label, links:[{label, translation, url, action}]}]`; useful labels: `LOGOUT` (url `Shibboleth.sso/Logout`, resolve against `https://toledo.kuleuven.be/`), `NOTIFICATION-SETTINGS-ULTRA`, `TOLBIZZ-ENROLL`, `KULOKET-UURROOSTER`, `ADVALVAS`, `BB-CALENDAR-ULTRA`, `LUCA-CAL`, `LUCA-STUDENT-WEBMAIL`, `KULOKET-STUDENT`, …
5. Blackboard REST (same origin on ultra.edu.kuleuven.cloud, absolute URLs, `credentials:'include'`):
   - `GET /learn/api/public/v3/courses/{cid}` → `{id:'_900661_1', courseId:<learningUnitId>, name}`; `GET /learn/api/public/v3/courses/courseId:<learningUnitId>` also works for lookup.
   - `GET /learn/api/public/v1/courses/{cid}/contents?limit=200` and `/contents/{id}/children?limit=200` → `[{id, title, description?, body?(HTML, documents), created, modified, hasChildren, availability:{available}, contentHandler:{id:'resource/x-bb-folder'|'x-bb-lesson'|'x-bb-file'|'x-bb-document'|'x-bb-externallink'(+url)|'x-bb-blti-link'|'x-bb-asmt-test-link'|…, file:{fileName, mimeType}}, links:[{href:'/ultra/redirect?…'}]}]`
   - `…/contents/{id}/attachments` → `[{id, fileName, mimeType}]`
   - `GET /learn/api/public/v1/courses/{cid}/announcements?limit=20` → `[{id, title, body(HTML), created, draft}]`; single: `…/announcements/{aid}`
   - `GET /learn/api/public/v2/courses/{cid}/gradebook/columns?limit=200` → use **only** `name`, `grading.due`, `contentId` (school does not use grades).
   - `GET /learn/api/public/v1/courses/{cid}/users?role=Instructor&expand=user` → `user.name.given/family`, `user.contact.email`.
   - `GET /learn/api/public/v1/calendars/items?since=ISO&until=ISO&limit=100` → cross-course deadlines (`type:'GradebookColumn'`, `title`, `end`, `calendarName:"ULTRA-B-…: Filmtaal 1 [X10265]"`). Keep windows ≤ 60 days.
   - Item deep link: `abs('/ultra/redirect?redirectType=nautilus&courseId={cid}&contentId={id}')`.
6. The school does **not** use the gradebook (grades/submission status) nor discussions. Never show grades/submission state.
7. **The portal's AngularJS router rewrites every unknown hash path to `#/home`** (`#/tplus/x`, `#/home/tplus/x`, `#!/x` – verified live),
   but keeps a query string on `#/home`. Toledo+ portal routes therefore live in that query: `#/home?tplus=<route>[&id=<param>]`.
   Never invent another hash path; the e2e portal mock emulates this router so regressions are caught.

## Files and ownership

```
manifest.json            core
background.js            data   – cross-origin fetch relay (see TP.net)
page.css                 core   – injected into the host page: hides the original page when wrapped
ui.css                   core   – tokens + shared components (inside shadow root)
src/core/util.js         core   – TP.util, TP.fmt
src/core/i18n.js         core   – TP.i18n, TP.t
src/core/settings.js     core   – TP.settings, TP.state
src/core/ui.js           core   – TP.ui component helpers (HTML strings)
src/core/motion.js       core   – TP.motion: motion system (WAAPI + CSS; tokens mirror ui.css) — see addendum v1.5 › Motion
src/core/shell.js        core   – TP.shell: mount, layout (sidebar/rail), router, search, theme, deep bar, live region
src/core/palette.js      core   – TP.palette: the ⌘K command palette (dialog inside the shell's shadow root)
src/core/net.js          data   – TP.net (same-origin fetch or relay)
src/core/data.js         data   – TP.data (loading, cache, models, mutations)
src/core/index.js        data   – TP.index (local document index for ⌘K: storage, crawl, matching)
src/i18n/core.js         core   – strings for shell/common/settings labels used by shell
src/i18n/<view>.js       view owners – strings for their views
src/i18n/palette.js      core   – strings for the palette + index status line
src/views/overview.js(+.css)       views-A
src/views/deadlines.js(+.css)      views-A
src/views/planning.js(+.css)       views-A
src/views/announcements.js(+.css)  views-A
src/views/courses.js(+.css)        views-B
src/views/course.js(+.css)         views-B
src/views/settings.js(+.css)       views-B
src/boot.js              core   – starts everything on both origins
tests/**, package.json, .github/**, README*, CONTRIBUTING.md, AGENTS.md, scripts/**   tests+repo
legacy/                  read-only reference of the v0.2 prototype (has working tree-walk, sanitize, download code)
```
Content-script load order (both origins): `src/core/util.js, src/core/i18n.js, src/i18n/*.js, src/core/settings.js, src/core/net.js, src/core/data.js, src/core/index.js, src/core/ui.js, src/core/motion.js, src/core/shell.js, src/core/palette.js, src/views/*.js, src/boot.js` (guarded by `tests/unit/manifest.test.js`).
Each file is an IIFE that attaches to `globalThis.TP` (`const TP = (globalThis.TP ||= {});`). No ES modules, no imports, no network except Toledo/Ultra.
CSS loaded into the shadow root by the shell, in this order: `ui.css`, then every `src/views/*.css` (list is `TP.shell.CSS` in shell.js; all must exist even if empty; all are web_accessible_resources).

## TP.util / TP.fmt (core)
```
TP.util.esc(s) → HTML-escaped string
TP.util.abs(path) → absolute URL on the current origin (passes http(s) URLs through)
TP.util.sanitize(html) → safe HTML string (drop script/style/iframe/object/embed/form/input/button/link/meta/base, on* attrs, style/class/id, javascript: urls; <a> get target=_blank rel=noopener)
TP.util.plain(html) → text
TP.util.courseName("Filmtaal 1 [X10265]") → "Filmtaal 1"   (also strips leading "- ")
TP.util.courseCode(title) → "X10265" | ""
TP.util.pool(items, n, asyncFn) → results (bounded concurrency)
TP.util.debounce(fn, ms)
TP.util.uid() → string
TP.util.PALETTE = { blue:'#007AFF', purple:'#AF52DE', pink:'#FF2D55', red:'#FF3B30', orange:'#FF9500', yellow:'#FFCC00', green:'#34C759', mint:'#00C7BE', teal:'#30B0C7', cyan:'#32ADE6', indigo:'#5856D6', brown:'#A2845E', graphite:'#8E8E93' }
TP.util.colorForIndex(n 1..16) → hex   (deterministic mapping of Toledo color numbers onto PALETTE)
TP.fmt.date(ms, intlOpts) / TP.fmt.time(ms) / TP.fmt.rel(ms) ("vandaag"/"morgen"/"over 3 d"/"3 d geleden", localized)
TP.fmt.ago(ms) (time today, "gisteren", weekday <7d, else "12 okt"), TP.fmt.dayKey(ms) → 'YYYY-MM-DD', TP.fmt.daysUntil(ms) → int (calendar days)
```
All TP.fmt use `TP.i18n.locale()`.

## TP.i18n (core)
```
TP.i18n.add({ nl:{key:'…'}, en:{…}, fr:{…} })   // every view file registers its own strings; keys are namespaced: 'overview.title', 'course.download'
TP.t(key, vars?)  // "{n} items" interpolation; plurals: if vars.n is given, tries key+'.one'/key+'.other' first; fallback lang → en → nl → key
TP.i18n.lang() → 'nl'|'en'|'fr' (resolved from settings.language; 'system' uses navigator.language, default nl)
TP.i18n.locale() → 'nl-BE'|'en-GB'|'fr-BE'
TP.i18n.apiLang() → 'nl'|'en' (Toledo-Language header; fr → en)
```
All three languages must be complete for every key you add. Dutch is the primary language; tone: short, plain, informal-polite ("je").

## TP.settings / TP.state (core)
Settings live in `chrome.storage.sync` key `settings` (synced across the student's browsers), **except** the custom deadlines:
they are `settings.custom` in memory but stored under their own sync key `custom`, so they can't push the `settings` item over
the 8 KB per-item quota. Each item falls back to `chrome.storage.local` (`settingsLocal` / `customLocal`) when sync refuses a
write; on load the newer of sync/local wins (`settingsSavedAt` / `customSavedAt`). Default per-course values are not stored.
v1 settings with `custom` inside `settings` are migrated on load (written to `custom`, removed from `settings`, `v` → 2).
`storage.onChanged` handles `settings`/`custom` (sync) and `settingsLocal`/`customLocal` (local), so other tabs update live.
State lives in `chrome.storage.local`, **one item per top-level key** (`state:<key>`, see below).
```
await TP.settings.load()           // called once by boot; merges DEFAULTS deeply
TP.settings.get() → object (read-only snapshot)
await TP.settings.set(patchObject) // deep-merge patch, persist, notify
TP.settings.subscribe(fn(settings, changedTopKeys)) → unsubscribe
TP.settings.reset(), TP.settings.export() → JSON string, TP.settings.import(json)
TP.settings.course(luId) → { nickname:'', color:null, hidden:false }  (merged with defaults)
await TP.settings.setCourse(luId, patch)
await TP.settings.flush()          // write a throttled change now (also on pagehide); never rejects
TP.state.get(), await TP.state.set(patch, {replace?}), TP.state.subscribe(fn(state, keys)), await TP.state.flush(), TP.state.rev()
```
DEFAULTS (exact):
```
{
  v: 3,
  language: 'system',                 // 'system'|'nl'|'en'|'fr'
  appearance: 'system',               // 'system'|'light'|'dark'
  accent: 'blue',                     // key of TP.util.PALETTE (not 'graphite' only… all allowed)
  density: 'standard',                // 'compact'|'standard'|'comfortable'
  startPage: 'overview',              // 'overview'|'courses'|'deadlines'|'planning'
  wrap: { portal: true, courses: true, deepBar: true },
  overview: { sections: [ {id:'deadlines',on:true}, {id:'new',on:true}, {id:'recent',on:true}, {id:'courses',on:true},
                          {id:'schedule',on:true}, {id:'announcements',on:true}, {id:'links',on:false} ] },
  feed: { includeAnnouncements: false, maxCourses: 5 },
  deadlines: { horizonDays: 42, urgentDays: 3, reminder: '1d' },   // reminder: 'none'|'1h'|'1d'|'2d' (ICS VALARM)
  courses: { sort: 'activity', showCommunities: false, items: {} },  // sort: 'activity'|'name'|'manual'; items[luId] = {nickname,color,hidden}; manual order in courses.order: [luId]
  sync: { markReadInToledo: true },
  search: { indexAll: true },         // background-crawl all current courses for the ⌘K document index
  custom: [],                         // custom deadlines [{id, title, courseLuId|'', due:ms}] — persisted under sync key 'custom'
}
```
Migrations on load: v1/v2 → v3 drops `courses.items[*].pinned` and `sync.favoritesToToledo` (v1.2: **pins/favourites are gone**; `normalize()` strips them from every shape, also from other tabs/imports/old UI calls).

State (local, not synced), one `chrome.storage.local` item per key `state:<key>`:
```
visits:{[cid]:ms}  done:{[deadlineKey]:ms (when marked)}  recent:[{title,url,courseName,courseLuId,kind,ts}] (max 12)
cidMap:{[luId]:cid}  openFolders:{[cid]:[id]}  ui:{sidebarCollapsed}  focus:{cid,luId,id,at}|absent
feedSeen:{ids:{[eventId]:date} (max 2000), floor:ms}   // B3: seen = id in ids, or date ≤ floor (floor rises when ids are evicted)
read:{[eventId]:ms} (≤ 3000, ≤ 120 days)              // B4: local read-set, applied to cached/fresh events (also with sync off)
pendingRead:{[eventId]:{id,type,subType,t}} (≤ 1000)   // B7: mark-read PATCHes still to send; flushed first by refresh()
```
Writes are debounced (150 ms) **read-merge-write** per key: the stored value is read back and this tab's patches are applied on top.
Each write also stores `staterev:<key>` = `{n, by}`; when another tab wrote the same `n` concurrently, the losing tab re-applies its
(idempotent) patches. Other tabs' writes arrive via `storage.onChanged` and notify subscribers with the changed keys.
`TP.state.flush()` and `pagehide` write pending changes immediately. After an extension reload (context invalidated) writes are silent no-ops.
Migration: the v1.1 single `state` item is split into `state:<key>` items and removed; `feedSeenAt` → `feedSeen.floor`; `done:true` → timestamp; dead `cache` dropped.
Pruning (TP.data, after loads): read-set by age/size; done marks > 60 days old that no source references any more; visits/openFolders of non-current courses.
`focus` is the palette's "show in course" hand-off (works across both origins); the course view consumes it (≤ 2 min old) and deletes it. The shell does not rerender on `ui`, `visits`, `openFolders`, `recent`, `focus` (and should ignore `read`, `pendingRead`, `cidMap`: data changes come as `change` events).

## TP.net (data)
```
await TP.net.json(url, {method, body, headers, keepalive}) → parsed JSON (null for 204/empty); throws Error with .status
await TP.net.text(url, {headers}) → string     (non-JSON feeds, e.g. the TimeEdit iCal feed via the relay)
await TP.net.blob(url) → Blob   (default credentials – for S3 downloads)
TP.net.isStale() → true when chrome.runtime.id is gone (extension updated/reloaded; this content script is orphaned)
TP.net.resolve(path), TP.net.isSameOrigin(url)
```
Errors: `.status` (0 = network/timeout/relay), `.auth = true` = **session expired** (401/403, an HTML page where JSON was expected
– e.g. the SSO login page with 200 –, a redirect to another origin/login URL, relay `error:'redirected'|'html'`), `.stale = true`
(context invalidated; nothing is fetched), `.timeout`, `.relayDown` (no receiver), `.blocked` (relay allowlist).
GETs are retried on 429/5xx up to 2 times (Retry-After, else 600 ms × 2ⁿ, max 8 s); PATCH is never retried.
Same-origin URL → direct `fetch` (credentials:'include' except blob). Cross-origin → `chrome.runtime.sendMessage({type:'tp-fetch', url, method, body, headers, as, keepalive})` handled by `background.js`, which does the fetch with `credentials:'include'` and returns `{ok, status, data, retryAfter, error?}`.
background.js only accepts messages from this extension's content scripts on Toledo/Ultra (sender `id` + `origin`/`url`) or its own pages, and only:
GET/PATCH to `toledo.kuleuven.be` and `ultra.edu.kuleuven.cloud`, GET to `webwsp.aps.kuleuven.be` (KU Loket) and `cloud.timeedit.net`
(= `host_permissions`, guarded by `tests/unit/manifest.test.js`). Redirects off those origins → `error:'redirected'`; HTML instead of JSON → `error:'html'`.
Cross-origin calls are **best-effort**: callers must handle failure (e.g. Ultra session not yet established) and degrade silently.

## TP.data (data)
Stale-while-revalidate: `TP.data.peek(key)` returns the last cached value (from `chrome.storage.local` item `cache:<key>` = `{v, t, rev, range?}`, one item per key, loaded at boot; the v1.1 single `cache` item is migrated) or `null`; `TP.data.load(key, {force})` fetches, caches, emits `change`.
Multi-tab (B6): a fresh load has a newer `t`; an optimistic mutation (markRead) keeps `t` and bumps `rev`; other tabs adopt an entry when `(t, rev)` is newer.
```
keys: 'enrollments','events','upcoming','mail','links','ultraDeadlines'
TP.data.on('change', fn(key)) / off
TP.data.on('course', fn({cid, result}))   // a full (non-partial) ultraCourse load finished – TP.index listens
TP.data.on('error', fn(key))              // a load failed (cached data stays)
TP.data.on('auth', fn({expired, key}))     // session expired (expired:true) / back (false) — shell shows "Log opnieuw in" → TP.data.loginUrl()
TP.data.on('stale', fn())                  // extension updated/reloaded: shell shows "Herlaad"; data stops listeners, writes and loads
TP.data.on('courseCache', fn({cleared}))   // refresh() cleared the Ultra course cache — the course view should reload its course
await TP.data.refresh() → {ok, errors:{key:Error}, auth, stale}   // sends queued mark-reads, then loads all portal keys (+ ultraDeadlines
                                     // best-effort); clears the Ultra course cache; concurrent calls share one run; never rejects
await TP.data.maybeRefresh({maxAge=5 min}) → result|null   // refresh only when lastUpdated() is older; data.js calls it itself on visibilitychange→visible
await TP.data.flush()                // pending state/settings/cache writes + in-flight mark-read PATCHes; await before navigating away; never rejects
TP.data.status(key) → {loading, error, auth, t} ; TP.data.authExpired() → bool ; TP.data.loginUrl() → Toledo LOGIN link or the portal
TP.data.isStale() → bool ; TP.data.lastUpdated() → ms|null

// models (sync, computed from peek() + settings + state; return [] when no data yet)
TP.data.courses({includeHidden, includeCommunities, currentOnly}) → Course[]
  Course = { luId, enrollmentId, title, name (nickname||courseName), code, color (hex), colorKey, semester, year, type,
             hidden, available, link, unread (events count for feed rules), latest (ms) }        // no pinned/favorite since v1.2
  sorted: courses before communities, then settings.courses.sort: 'manual' (courses.order; others after, by name) | 'name' | 'activity' (latest, then name)
  "current" = type==='course' && academicYear === max academicYear over courses; communities have type 'community'.
TP.data.course(luId) → Course|null
TP.data.feed() → FeedGroup[]  (unread notifications – not read in Toledo nor in state.read –, NOT subType 'due'|'course', not dismissed,
                               not seen: id ∉ state.feedSeen.ids and date > state.feedSeen.floor (late-published items still appear);
                               announcements only if settings.feed.includeAnnouncements)
  FeedGroup = { luId, course: Course|null, name, color, items: Event[] (newest first), latest, counts:{file,video,page,assignment,announcement} }
  sorted: groups with a deadline ≤ 48h first, then latest desc
TP.data.kindOf(event|contentNode) → 'file'|'video'|'image'|'page'|'assignment'|'link'|'tool'|'folder'|'announcement'|'notice'
TP.data.deadlines({includeDone, horizonDays, pastDays=7}) → Deadline[] sorted by due
  Deadline = { key, keys:[all merged source keys], title, courseName, courseLuId, color, due, url|null, source:'toledo'|'ultra'|'custom',
               done, overdue (not done && due < now), ageDays (whole days past due, 0 when not due yet), customId? }
  merges events subType 'due' + ultraDeadlines + settings.custom; Toledo/Ultra duplicates = same normalized title + course with due
  within ±2 h (Toledo item wins, url filled from the duplicate); custom items never deduped. **Overdue items that are not done are
  always returned, however old** (views group them, e.g. "Ouder dan een week"); done items only until pastDays after due.
  Keys (v1.2, B13): 'd'+hash('t|'+event.id) (Toledo), 'd'+hash('u|'+calendarItem.id) (Ultra), 'c'+hash(customId) — a moved due date keeps
  its done mark and ICS UID; v1.1 day-based keys in state.done are migrated automatically. done = any of `keys` in state.done.
  Ultra calendar: refresh fetches now−14 d … now+max(horizonDays, largest horizon asked for in this tab) in ≤ 60-day windows (max 7);
  asking deadlines() for more (e.g. the Deadlines view's 366 days) loads the missing range lazily and emits 'change'. Overdue, not-done
  Ultra items that leave the fetch window are kept (≤ 365 days).
TP.data.announcements({filter:'all'|'courses'|'school'|'unread'}) → Event[] (subType announcement|advalvas), newest first
TP.data.schedule() → { [dayKey]: Upcoming[] }
TP.data.link(label) → absolute url|null ; TP.data.quickLinks() → [{label, title, url}] (curated subset, titles from `translation`)

// mutations
await TP.data.markRead(events[]) → bool  // optimistic (events read:true, rev bump) + state.read; if settings.sync.markReadInToledo:
                                      // PATCH batch/events in chunks of 100 with keepalive; failed chunks → state.pendingRead (→ false)
await TP.data.markFeedSeen()          // feed item ids → state.feedSeen (+ markRead of those events if sync enabled)
await TP.data.toggleDone(deadlineKey) → bool   // toggles every merged source key of that deadline
// removed in v1.2: TP.data.setFavorite, the pin concept (Course.pinned/favorite, sync.favoritesToToledo, Toledo favourite → pinned).
// TP.data.setPinned() is a temporary no-op (→ false, logs once) until the UI no longer calls it.
await TP.data.addCustomDeadline({title, courseLuId, due}) / removeCustomDeadline(id)
await TP.data.addRecent({title,url,courseName,courseLuId,kind})
TP.data.ics(deadlines) → string (VCALENDAR; VALARM per settings.deadlines.reminder; Europe/Brussels times as UTC)

// Ultra (same-origin on ultra, relay elsewhere)
await TP.data.ultraCourse(cid, onProgress?) → { course:{id, courseId, name}, roots: Node[], announcements, deadlines:[{title,due,url}], staff:[{name,email}],
                                                partial, failedFolders, contentsError?:{status, auth, message} }
   Node = raw content item + kids:Node[]|undefined (+ failed:true when its children could not be loaded after 2 retry rounds, 1 s / 3 s);
   tree walked with bounded concurrency (6), depth ≤ 6, unavailable items dropped; onProgress(partialResult) after metadata and after the walk.
   Cache (B5): only complete results (no contentsError, failedFolders 0), 10 min TTL, LRU of 5 courses; refresh() clears it.
TP.data.clearCourseCache(cid?)
await TP.data.ultraTree(cid, {concurrency=2}) → Node[]  // content tree only (same walk as ultraCourse), for the index crawl; rejects if the top level fails
await TP.data.ultraDownload(cid, contentId, fileName?)  // attachments → blob → save (no fileName → the attachment's own name)
await TP.data.ultraOpen(cid, contentId)               // window.open(download url or item link)
await TP.data.ultraAnnouncement(cid, aid) → {title, body}
TP.data.resolveCourseId(luId) → Promise<cid> (ultra courses/courseId:<luId>, cached in state)
```

## TP.index (data) — local document index for the ⌘K palette
```
chrome.storage.local 'index'     = { [cid]: { luId, name, t:ms, items: [[id, title, kind, path, parentId], …] } }
                                    kind = TP.data.kindOf | 'folder'; path = "Week 3 › Opdrachten"; capped at ~2 MB (oldest courses dropped)
chrome.storage.local 'indexMeta' = { lastCrawl, attempt, failed }
await TP.index.load()                 // lazy; boot calls it, then TP.index.schedule()
TP.index.schedule()                   // crawl 5 s after boot, in requestIdleCallback
await TP.index.crawl({force})         // never rejects; current courses (TP.data.courses) → resolveCourseId → ultraTree, pool of 2;
                                      // skips courses indexed < 24 h ago; on the portal (relay) backs off 1 h after failures;
                                      // skipped when settings.search.indexAll is false
await TP.index.crawlIfStale()         // = crawl() without force (palette open)
await TP.index.rebuild()              // clear + forced crawl (Settings → Zoeken)
TP.index.put(cid, {luId, name, roots})  // also called for every TP.data 'course' event (course view), even with indexAll off
TP.index.status() → { courses, items, lastCrawl, updated, crawling, progress:{done,total}, failed, enabled }
TP.index.statusText() → "Doorzoekt 214 documenten in 15 vakken · bijgewerkt 17:40" | "Index wordt opgebouwd…" | "Open een vak om het te indexeren"
TP.index.search(q, {limit}) → [{cid, luId, course, color, id, title, kind, path, parentId, score}]   (hidden courses skipped)
TP.index.score(q|words, title, extraStrings[]) → -1 no match | 0 via path/course | 1 substring | 2 word starts | 3 title prefix
     (lowercase, diacritics stripped, every query word must occur in title or extras) – also used by the palette for every group
TP.index.norm(s), TP.index.ancestors(cid, id) → [folderId…], TP.index.on('change', fn(status)) → unsubscribe
```
Privacy: the index holds titles/kinds/paths only, stays in `chrome.storage.local`, never leaves the browser.

## TP.palette (core) — ⌘K command palette
```
TP.palette.open({opener?, q?}) / close(returnFocus=true) / isOpen()
```
Opened by the shell: ⌘K / Ctrl+K (always, also while typing), `/` when not in an editable field, the ⌘K button inside the toolbar
search field (`data-shell="palette"`), and "Zoek overal" in the phone More sheet. The toolbar field itself keeps filtering the current view.
`<dialog class="tp-palette tp-glass">` appended to the shell app (showModal → top layer, inert background): combobox input
(`aria-controls`/`aria-activedescendant`) + `role=listbox` with `role=group` per result group; ↑/↓/PageUp/PageDown move, ↵ opens,
⌘↵/Ctrl+↵ downloads a file result, Esc/backdrop/close button close and return focus to the opener; Tab is trapped.
Groups (≤ 8 each): Navigatie (views incl. settings) · Vakken · Documenten (TP.index) · Deadlines · Mededelingen; empty query: Recent + Navigatie.
Open: files → `TP.data.ultraOpen(cid,id)` (⌘↵ → `ultraDownload`); folders/pages/assignments/links → `state.focus` + navigate to
`TP.shell.href('course', {cid})` (or rerender when that course is already shown); every document open → `TP.data.addRecent`.
Footer: `TP.index.statusText()`; opening the palette triggers `TP.index.crawlIfStale()`. Full-screen sheet below 700 px.

## TP.ui (core) — HTML-string helpers; views compose these, use `data-action` + event delegation
```
TP.ui.icon(name, {size=17}) → inline SVG (stroke, currentColor, aria-hidden)
  names: overview, courses, deadlines, planning, announcements, settings, search, chevronRight, chevronDown, chevronLeft, plus,
         check, checkCircle, circle, doc, film, image, page, task, link, tool, folder, download, external, mail, bell, pin, pinFill,
         star, starFill, eyeSlash, eye, xmark, arrowUp, arrowDown, refresh, sidebar, ellipsis, clock, megaphone, calendar, filter
TP.ui.section({id, title, count?, actions?:[{action,label,icon?,attrs?}], body, footer?}) → <section> with sec-head (Title 2)
TP.ui.group(innerHtml, {cls}) → inset grouped card
TP.ui.row({href?, action?, attrs?:{}, leading?, title, subtitle?, trailing?, chevron?, strong?, q?, cls?}) → <a>|<button>|<div> row (min 44px), q = search text (lowercase) → data-q
TP.ui.disclosure({id, open, summary:{leading,title,subtitle,trailing}, body, q?}) → <details> with chevron (APG disclosure semantics)
TP.ui.badge(n, {tone:'tint'|'red'|'gray', label}) ; TP.ui.dot(color, label?)
TP.ui.dateTile(ms, {tone:'normal'|'urgent'|'overdue'|'muted'})
TP.ui.empty(text, {timestamp?}) ; TP.ui.skeleton(rows=3) ; TP.ui.errorRow(text, retryAction='retry')
TP.ui.noResults(q) → search empty state (magnifier 32px label-3, "Geen resultaten" headline, "voor “x”" subhead); one per view
TP.ui.button(label, {action, icon, kind:'filled'|'tinted'|'plain'|'gray', attrs})
TP.ui.segmented(name, [{value,label}], value, {label})   → radiogroup of real <input type=radio>; listen for 'change' on root
TP.ui.toggle(name, checked, label, {description})        → <label> with <input type=checkbox role=switch>
TP.ui.select(name, [{value,label}], value, {label})
TP.ui.swatches(name, [{value, color, label}], value)     → radio swatches
TP.ui.cols(mainHtml, sideHtml) → two-column layout (side column becomes stacked below 1100px)
```

## TP.shell (core)
```
TP.shell.CSS = ['ui.css', 'src/views/overview.css', …all view css…]
TP.shell.register(route, view)  // route: 'overview'|'courses'|'course'|'deadlines'|'planning'|'announcements'|'settings'
TP.shell.navigate(route, params?) // same origin → in-place (hash on portal: '#/home?tplus=<route>[&id=<param>]'), else full navigation via TP.shell.href
TP.shell.href(route, params?) → absolute URL appropriate from the current origin
     overview/courses/deadlines/planning/announcements/settings → https://toledo.kuleuven.be/portal/#/home?tplus=<route>
     (plain '#/home' = settings.startPage; legacy '#/tplus/<route>[/<p>]' is still parsed and replaced in place via history.replaceState)
     course {luId} → enrollment.link (journey ultraLink) ; course {cid} on ultra → https://ultra.edu.kuleuven.cloud/ultra/courses/<cid>/outline
TP.shell.toast(text) ; TP.shell.announce(text) (aria-live polite)
TP.shell.app → the shell root element while the shell is shown (palette mounts into it), else null
TP.shell.mod → '⌘' on Apple platforms, 'Ctrl ' elsewhere (shortcut hints) ; TP.shell.isRail() → sidebar is the icon rail
TP.shell.rerender()               // re-run current view render (called on settings/data change for current view)
```
View contract:
```
TP.shell.register('overview', {
  title: () => TP.t('nav.overview'),     // toolbar large title
  searchPlaceholder: () => TP.t('overview.search'),   // optional; if absent search hidden
  showUpdated: false,                     // optional; hides the shell's "Bijgewerkt hh:mm" line (load errors still show)
  render(ctx) { … },                      // may be async; must be idempotent (called again on data/settings change)
  onSearch(ctx, q) { … },                 // optional; q lowercase trimmed; default behaviour: hide [data-q] not matching and empty sections,
                                          // then show TP.ui.noResults(q) once; custom handlers render TP.ui.noResults(q) in their own single slot
  onKey(ctx, ev) { … },                   // optional (v1.5): view shortcuts — the shell forwards window keydowns that are not typing, have no
                                          // ⌘/Ctrl/Alt, weren't handled (defaultPrevented) and with no detail sheet open (agenda: t/d/w/m/a/j/k/g/?…)
  destroy(ctx) { … }                      // optional
});
ctx = { root: HTMLElement (view container in shadow root), params, route, origin:'portal'|'ultra', setActions([{id,label,icon,onClick}]), setTitle(text), setSubtitle(html) }
Course view params: `{cid}` | `{luId}`, optional `focus: contentId` (also read from `state.focus`): once the tree is loaded it opens the containing folders, scrolls to the row, focuses it and highlights it for 2.4 s.
```
Views attach ONE delegated listener per event type on `ctx.root` in render's first call (guard with a flag on root), never on document.
Shell layout: skip link; sidebar ≥700px (glass, sticky full height – only the content column scrolls; sections: Overview, Courses, Deadlines, Planning, Announcements, then "Pinned" courses, Settings at bottom; counts trailing), bottom tab bar <700px (Overview, Courses, Deadlines, Planning, More→Search everywhere/Announcements/Settings); toolbar with large title, subtitle, search field filtering the view (with a ⌘K button opening the palette), refresh, account menu (mail badge→Outlook, Toledo classic toggle, logout).
Sidebar modes: **expanded** (240px) or **icon rail** (`.sb-rail`, 64px: centred icons with `title` tooltips, labels visually hidden but kept as accessible names, counts → dot, overdue → small red badge, pinned courses → coloured circles with two initials, Toledo+ mark on top). ≥900px: ⌘\ / Ctrl+\ and the toolbar button toggle, persisted in `state.ui.sidebarCollapsed`. 700–899px: the rail by default; toggling expands the full sidebar as an overlay (`.sb-open`, scrim, Esc). The toggle has `aria-expanded`. Grid columns animate (none under reduced motion). `page.css` keeps `<body>` at `overflow: visible` (only `<html>` scrolls) – otherwise body becomes a scroll container and sticky breaks. Theme: `data-appearance`, `data-density`, `--tint`, `--tint-text` on the shell root.
On Ultra pages that are not a course outline, and on portal routes other than '#/home' (incl. '#/home?…'), '#/', '': if `wrap.deepBar`, show a slim glass top bar (Toledo+ mark → overview, "‹ <course>" back link when the path has a course id, page stays the original) and pad the page top.
"Classic" mode: settings.wrap.portal/courses false → original page shows; a floating "Toledo+" pill (page.css) re-enables.

## Boot (core)
`src/boot.js`: `await TP.settings.load(); await TP.data.init();` decide origin + route; mount shell or deep bar; then `TP.index.load()` + `TP.index.schedule()`; on portal listen to `hashchange`, on Ultra poll `location.pathname` every 400ms (client-side routing). Hide the original page as early as possible (`document_start`, class `tplus-on` on `<html>`) to avoid a flash.

## Quality bar
WCAG 2.2 AA; keyboard reachable; works at 390px and 1440px; light + dark; NL/EN/FR complete; no console errors; no unhandled promise rejections; never `innerHTML` unsanitized remote HTML (use `TP.util.sanitize`), always `TP.util.esc` for text.

## Addendum v1.4 (2026-10-26)

- **Pinning is removed** (settings v3): no `pinned` per course, no favourite sync. The sidebar group is "Vakken" (current, non-hidden courses in `TP.shell.sortCourses` order). Sections above that still mention pins are historical.
- **Shell additions:** `TP.shell.detail(...)` (detail sheet, used for deadlines), `TP.shell.sortCourses`, banners `auth` / `stale` / `update`; `TP.util.courseColorKey`, `TP.util.accentKey`.
- **`TP.telemetry`** (`src/core/telemetry.js`, after `kuloket.js`): `schedule()` (called from `boot.js`), anonymous ping ≤ 1×/24 h from the portal only, `checkUpdate()` ≤ 1×/12 h, `on('update', fn)`, `pendingUpdate()`, `dismissUpdate(v)`, `sendFeedback(...)`. Settings `privacy.telemetry` and `privacy.updateCheck` (both default `true`). Opt-out deletes `telemetry:id` locally and calls `POST /v1/forget`.
- **`TP.feedback`** (`src/core/feedback.js`, after `palette.js`): `open({ page, opener })` — accessible sheet; works with telemetry off.
- **Relay:** `https://api.toledoplus.be` is allowed for exactly `POST /v1/ping`, `POST /v1/forget`, `POST /v1/feedback`, `GET /v1/latest`, without query/hash and with `credentials: 'omit'`.
- **Server:** `worker/` (Cloudflare Worker + D1); see `worker/README.md`.
- Load order (both origins): util, i18n, i18n/{core, overview, deadlines, announcements, courses, course, settings, agenda, kuloket, palette, feedback}, core/{settings, net, data, kuloket, telemetry, index, ui, motion (v1.5), shell, palette, feedback}, views/{overview, deadlines, announcements, courses, course, settings, agenda, kuloket}, boot.

## Addendum v1.5 (unreleased) — layout, sidebar subset, name, mail

- **Settings v4:** per-course `courses.items[luId].inSidebar` (default `false`, not stored when false). v3 → v4 only bumps `v`: existing users start with an empty sidebar group. Purely local to Toledo+ (synced across the student's own browsers like every setting; never sent to Toledo — no favourite/pin coupling).
- **`TP.shell` additions:** `inSidebar(luId) → bool`, `setInSidebar(luId, on?) → bool` (toggles when `on` is omitted; announces the change), `sidebarCourses() → Course[]` (non-hidden courses with `inSidebar`, incl. communities/older years when added explicitly, in `sortCourses` order). The sidebar/rail "Vakken" group shows exactly that list and is **omitted entirely when empty**. ⌘K is unaffected (searches every course). Toggles: course header ("Zet in zijbalk" / "Uit zijbalk", `data-action="sidebar"`), Vakken cards (trailing icon toggle, `aria-pressed`), Vakken › Bewerk (labelled switch `sidebar__<luId>`).
- **User's first name:** `TP.data.userName() → string` (sync, `''` when unknown) and `await TP.data.loadUser({force}) → string` (never rejects). Source: Ultra `GET /learn/api/public/v1/users/me` → `name.given`, first word only (same origin on Ultra, relay from the portal — already allowed, no allowlist change). No portal profile endpoint is known/used. Cached in **state** `me: {given, t}` (`chrome.storage.local`, never synced, never in telemetry/feedback/export); refreshed ≤ 1×/week, one attempt per tab after a failure, failures never set the auth banner. `refresh()` and the overview call it. Overview title: `overview.greet.named` = "{greet}, {name}" ("Goedenavond, Alex"); without a name the plain greeting.
- **Mail:** toolbar `a.tp-mail` (envelope, 36px, title/aria-label "Mail, n ongelezen mails (nieuw tabblad)", grey count badge) → `https://outlook.office.com/mail/` in a new tab. Hidden < 700px, where the More sheet has a Mail row; the account menu keeps its item. The avatar's unread dot only shows < 700px.
- **Content width:** `.tp-main` is one centred column in the area right of the sidebar: `--content-max` = `--content-wide` (1240px; main + side column `clamp(280px, 30%, 340px)`) or `--content-narrow` (760px + margins) when the view root contains `.tp-narrow` (shell sets `.tp-app[data-width="narrow"|"wide"]` after each render). Narrow views: deadlines, announcements, KU Loket, settings. The toolbar's trailing controls end at the content's right edge at every width.
- **No horizontal scroll in the navigation:** `.tp-sb-scroll` has `overflow-x: hidden`, lists are `minmax(0,1fr)` grids, labels ellipsize, counts/badges are `flex: none`; tab bar uses `minmax(0,1fr)` columns. Guarded by `tests/e2e/layout.e2e.js` (long fixture names, 320–2560, rail and expanded).

### Agenda (v1.5, Agent F)
- Per-device preferences in **state** `ui.agenda = { mode:'day'|'week'|'month'|'list', workweek, weekNums, show:{lesson, exam, deadline}, hidden:[courseKey] }`
  (`chrome.storage.local`, not synced).
- `TP.kuloket.peekRange({from, to})` → lessons + exams in a range from cache (sync); `TP.kuloket.status().lessons.needsLogin` = KU Loket
  session gone (the iCal feed is used automatically when a link is known). Storage key `kuloket:icsUrlT` = when the iCal link was last read
  from KU Loket (re-read every 7 days).
- `TP.agenda = { layout, rangeFor, stepAnchor, scrollHour, icsFor, courseKey, isoWeekNo, MODES, VISIBLE_HOURS }` — pure helpers exported for unit tests.
- View hook `onKey(ctx, ev)` (see the view contract above) carries the agenda's keyboard shortcuts.

### Motion — `TP.motion` (`src/core/motion.js`, loaded right after `ui.js`)
Native Web Animations + CSS only (decision and sources: DESIGN.md › Motion). Tokens: `TP.motion.DUR = {1:120, 2:200, 3:280, 4:350}` ms and
`TP.motion.EASE = {standard, out, in, spring, smooth}` mirror `--dur-1…4` / `--ease*` in `ui.css` (guarded by `tests/unit/motion.test.js`).
```
TP.motion.disabled                     // get/set; default follows <html data-tp-motion="off"> (the e2e harness sets it) → everything instant
TP.motion.reduced()                    // prefers-reduced-motion → helpers keep only opacity, ≤ 120 ms, no stagger/FLIP moves/VT
TP.motion.sync(themeRoot)              // sets data-motion="on|off" (CSS turns its own transitions off with it); the shell does this
TP.motion.animate(el, keyframes, {duration, delay, easing, fill, pseudoElement, keep}) → Animation|null   // the base; cancels el's running one
TP.motion.enter(el, {from:'up'|'down'|'left'|'right'|'scale'|'none', duration, delay}) → Animation|null
TP.motion.leave(el, {to, duration, onDone}) → Promise<finished>   // onDone (e.g. el.hidden = true) at the end; motion off → synchronously;
                                                                  // enter(el)/cancel(el) before the end aborts it (onDone not called)
TP.motion.leaving(el) → bool ; TP.motion.cancel(el) ; TP.motion.fade(el) ; TP.motion.highlight(el)   // tint pulse
TP.motion.transition(root, update, {direction:'forward'|'back'|'none', viewTransition}) → Promise
     // update() runs first (sync), then root slides 8 px / fades in. viewTransition:true → element-scoped VT where supported
     // (bounded boxes only: it snapshots the scope and blocks clicks inside it while running)
TP.motion.stagger(elements, {step=20, max=8}) → Animation[]        // first paint only; rows in the viewport
TP.motion.flip(container, mutate, {selector, highlight}) → mutate()'s result (awaits a returned promise)
     // FLIP across any DOM change, incl. innerHTML re-renders: elements matched by key — data-flip > data-banner > data-section >
     // .cv-sec[data-sec] > details[data-id] > data-q > data-lq (+ .tp-seg-pill by its input name). Moved → glide (relative to a moved
     // keyed ancestor), new → fade up (staggered), removed/hidden → inert ghost fades out. Viewport only, ≤ 600 keys, ≤ 12 ghosts.
     // Nested calls (a view painting inside the shell's flip) just run mutate. Mid-transition switches continue their thumb.
TP.motion.expand(el) / collapse(el, {onDone}) → height + opacity (small blocks only: banners)
TP.motion.detailsToggled(details)     // called by the shell's 'toggle' listener: .cv-folder/[data-motion-fade] fade their body in;
                                      // others rely on ::details-content (CSS) or get expand() on browsers without it
```
**What the shell already does for every view** (views need no code for this): route enter (`transition` with the navigation direction),
first-paint `stagger`, `flip` around every `renderView()` (data/settings re-renders) and around `onSearch`/the default filter,
`aria-busy` on the view root while it shows `.tp-skeleton` (views that paint asynchronously set `root.dataset.busyOwn = '1'` and manage
`aria-busy` themselves, like the course view), refresh highlight, menu/sheet/toast/banner/tab-bar/sidebar motion, scroll memory per route.
Dialogs (`.tp-sheet`, `.tp-palette`, `.tp-detail`, agenda `.ag-pop`) animate in and out in CSS (`@starting-style`, `allow-discrete`).

**What a view adds**: wrap re-renders it triggers itself (not via the shell) in `TP.motion.flip(root, () => render(ctx))`; give list rows
a stable key (`data-q`/`data-flip`); use `enter()` for content it swaps in place; never wait for an animation before changing the DOM.
Snippet (as used in the agenda — period navigation slides, the mode pill glides, popovers fade out before removal):
```js
function go(dir = 0) {                       // dir: 1 = next period, -1 = previous, 0 = mode change / today
  const view = ctx.root.querySelector(':scope > .ag-view');
  if (TP.motion && view && view.firstElementChild) TP.motion.flip(view, paint); else paint();   // pill + keyed rows glide
  const cal = ctx.root.querySelector('.ag-calwrap');
  if (TP.motion && cal) TP.motion.enter(cal, { from: dir > 0 ? 'right' : dir < 0 ? 'left' : 'none', duration: TP.motion.DUR[2] });
}
dialog.addEventListener('close', () => {    // CSS fades it out; remove the node afterwards (focus already returned)
  if (TP.motion && !TP.motion.disabled && !TP.motion.reduced()) setTimeout(() => dialog.remove(), TP.motion.DUR[2]); else dialog.remove();
});
```
- `TP.shell.toast(text)` stacks (max 3, newest at the bottom, same text = one toast); the container is `.tp-toasts` (shell + deep bar).
- `TP.ui.segmented()` renders a `.tp-seg-pill` as the last child (`--n` options; the checked index is derived in CSS).
- The phone tab bar has one `.tp-tab-ind` (`data-flip="tab-ind"`, `--i` = active index).
- `TP.shell.href('course', {luId})` returns the Ultra outline directly once the course id was resolved on hover (`onPrefetchHint`).
- Tests: `tests/helpers/launch.js` turns motion off unless `launch({motion:true})`; `reducedMotion:'reduce'` emulates the preference;
  `recordVideo` is passed through. The shared mock answers `POST /v1/ping`, `POST /v1/forget` and `GET /v1/latest` (current version, no
  update banner), recorded in `rec.api`, so `rec.foreign` must be empty everywhere.

## Addendum v1.5 — Full-text search of course files (`TP.fulltext`, Agent J)

Opt-in (`settings.search.fullText === true`; **not** in DEFAULTS, so it is off unless written). ⌘K gets a group **"In bestanden"**
(below Documenten): file title · course · "p. 14" / "dia 6" + a ± 80-character snippet with `<mark>`ed matches; ↵ opens the file
(PDF: `…/download#page=14` — the fragment survives the 302 to storage, so the browser viewer opens at that page), ⌘↵ downloads it.

**Execution contexts (why):**
```
content script (both origins)            hidden extension frame (chrome-extension://…)        module Worker (of the frame)
src/core/fulltext-engine.js  ─┐          src/core/fulltext-host.html → fulltext-host.mjs     src/core/fulltext-worker.mjs
src/core/fulltext.js  ────────┴─ port ─→  IndexedDB 'tplus-fulltext' + in-memory index  ─→   pdf.js (src/vendor/pdfjs) + zip/OOXML
  fetch (Ultra only), queue, budget        search, snippets, LRU cap, BroadcastChannel          text extraction, page by page
```
- **Fetching stays in the content script on the Ultra origin**: the download endpoint needs Ultra's session cookie and then 302s to a
  signed storage URL that rejects credentialed CORS (fact 3) — exactly the existing `TP.net.blob` path. On the portal nothing is fetched.
- **Extraction, storage and search run in a hidden `<iframe>` of a web-accessible extension page** (`src/core/fulltext-host.html`), created
  lazily by `fulltext.js` (only when the feature is on and needed). Chosen over an offscreen document because it (1) needs no new
  permission, (2) receives the file bytes as a **transferred ArrayBuffer over a MessagePort** (runtime messaging would JSON-encode them),
  (3) lives in the **extension origin**, so one IndexedDB is shared by `toledo.kuleuven.be`, `ultra.edu.kuleuven.cloud` and every tab
  (extension frames get unpartitioned storage on sites the extension has host permissions for — verified by `tests/e2e/fulltext.e2e.js`),
  (4) may start module workers from extension URLs (pdf.js), and (5) is an out-of-process frame: the Toledo page never janks.
  Page CSP does not apply to `chrome-extension:` frames. The frame starts a **module Worker** (`fulltext-worker.mjs`) for extraction;
  pdf.js runs inside it in its in-thread "fake worker" mode (`globalThis.pdfjsWorker`), imported lazily on the first PDF; the worker is
  terminated after 60 s idle.
- **Handshake** (page scripts must not reach the index): the content script sends `{type:'tp-ft-hello', nonce}` with
  `chrome.runtime.sendMessage` (only extension contexts can; the frame checks `sender.id`, `sender.tab`, Toledo origin), then posts
  `{type:'tp-ft-port', nonce}` + a `MessagePort` to the frame window (target origin = the extension origin). The frame accepts a port only
  for a fresh (≤ 30 s), unused nonce. `background.js` ignores the hello (unchanged).
- Vendored code is ES modules (`.mjs`) loaded only by the extension frame/worker; content scripts stay classic IIFEs.
  `fulltext-engine.js` is a classic script that is both a content script and a side-effect module import of the frame and worker
  (`globalThis.TPFT`). New files are listed in `web_accessible_resources` (the frame page and its module graph), which is also what puts
  them in the release zip (`scripts/pack.mjs`).

**Load order:** `src/i18n/fulltext.js` with the other i18n files; `src/core/fulltext-engine.js`, `src/core/fulltext.js` right after `index.js`.

```
TP.fulltext.enabled() → bool                       // settings.search.fullText === true
TP.fulltext.search(q, {limit}) → Promise<Hit[]>     // never rejects; [] when off. Hidden courses are skipped.
   Hit = { key:'cid:contentId', cid, luId, id (contentId), title, fileName, course, color, page, unit:'page'|'slide'|'', type, url, snippet:[[text, marked]] }
TP.fulltext.where(hit) → "p. 14" | "dia 6" | ''     ; TP.fulltext.snippetHtml(segs) → escaped HTML with <mark>
TP.fulltext.open(hit)                               // sync window.open (keeps user activation), PDF → #page=n; fallback TP.data.ultraOpen
TP.fulltext.warm() / status() → {enabled, files, skipped, bytes, known, active} / statusText() (palette footer) / settingsText()
TP.fulltext.indexCourse({cid, luId?, roots?}) → run ; cancelCourse(cid) ; wipe()
TP.fulltext.courseBox(cid) / updateCourseBox(root, cid) / courseAction(act, {cid, luId, roots, root})   // course view helpers
TP.fulltext.on('change'|'progress', fn) → unsubscribe
```
- **(a) Files opened/downloaded through Toledo+** (when on): `fulltext.js` wraps `TP.net.blob` — a blob fetched from
  `…/attachments/{aid}/download` is indexed from the **same bytes** (no second download) — and `TP.data.ultraOpen` — "open" streams into a
  new tab, so one idle-time fetch of that file is queued (Ultra only; supported types only).
- **(b) Course action** "Doorzoek alle bestanden" (course header, Ultra only): a confirm line states the number of files and the limits and
  turns the setting on; then a live progress line (`role=status`) with Stop. Files whose stored `modified` matches the tree are not fetched.
- **(c) Settings › Zoeken**: switch `s:search.fullText`, status ("12 bestanden doorzoekbaar (4,2 MB) · 3 overgeslagen"), "Wis bestandsindex".
- **Throttle:** one file at a time; each file waits for `requestIdleCallback` and a visible tab (paused while `document.hidden`);
  429/5xx → back-off 5 s × 2ⁿ (Retry-After wins, max 5 min), up to 4 retries per file; 401/403 → stop ("sessie verlopen"); ≤ 25 MB per
  file (Content-Length checked before reading, stream capped otherwise); **300 MB of downloads per day** (`chrome.storage.local`
  `fulltext:budget = {day, bytes}`, shared by tabs; tapped downloads cost nothing).
- **Supported:** PDF (text layer; scans without text → skipped, no OCR; password-protected → skipped), DOCX (pages from explicit and Word's
  rendered page breaks), PPTX (slide numbers), XLSX (shared strings), TXT/MD/CSV, HTML. Everything else is never downloaded for indexing.
  Limits per file: 2000 pages, 50 000 chars/page, 2 M chars.
- **Storage:** IndexedDB `tplus-fulltext` v1 in the extension origin: `files` (metadata incl. `attId`, `modified`, `size`, `url`, `skipped`,
  `used`), `pages` ([key, n] → text), `terms` ([key, n] → unique normalised words). Re-indexed when the attachment id, `modified` or size
  changes. Capped at 100 M chars (~200 MB): least recently used files are evicted. Skipped files are remembered (so they are not retried
  until they change). Each frame keeps an inverted index (term → pages; prefix search on a sorted vocabulary) built from `terms`; frames
  in other tabs are kept in sync with a `BroadcastChannel`.
- **Matching:** lowercase, diacritics stripped (NFKD), ligatures folded; every query word must occur on the same page as a word or a
  word prefix (exact > prefix; title match boosts); best page per file.

## Addendum v1.5 — Landing page skip (`src/landing.js`)
A standalone content script (own manifest entry, `run_at: document_start`, matches exactly `https://toledo.kuleuven.be/`,
`https://toledo.kuleuven.be/?*`, `https://toledo.kuleuven.be/index.html*` — never `/portal/*`) that does
`location.replace('https://toledo.kuleuven.be/portal/')` (the portal starts SSO when needed). It reads `chrome.storage` directly
(no TP core). It stays put when `settings.wrap.skipLanding === false` (sync `settings` or local `settingsLocal`; absent = skip),
right after a logout (referrer contains Logout/Shibboleth.sso, a `logout`/`error` URL parameter, or `tp:loggedOutAt` in
`chrome.storage.local`/`sessionStorage` < 5 min old — set by the shell's logout item), and at most once per 30 s
(`tp:landingBounceAt`, loop guard). Decision: pure `TPLanding.decide({url, referrer, settings, settingsLocal, loggedOutAt, bouncedAt, now})`.

## Addendum v1.6 — Brand (Agent I)

- **Settings v5:** `DEFAULTS.accent = 'brand'` (`TP.util.PALETTE.brand = '#EE8B35'`, the Toledo+ orange). On load, settings stored with `v < 5` whose
  `accent` is `'blue'` (the old default) or missing become `'brand'` once; any other accent is kept. `TP.util.accentKey()` falls back to `'brand'`;
  `TP.util.COURSE_COLORS` = palette keys offered as course colours (everything but `brand`); `TP.util.ACCENT_TEXT.brand = {l:'#C2410C', d:'#F5A35F'}`.
- **`TP.ui` additions:** `logo({variant:'tile'|'glyph'|'mono', size=28, title?, cls?})` → inline SVG (glyph below 32 px falls back to the tile),
  `wordmark()` → "Toledo+" (`.tp-wordmark`), `emptyArt(size)` → decorative pill illustration (`TP.ui.empty` shows it; `{art:false}` omits it).
  Any "T+" text mark should use `TP.ui.logo()` instead (`.tp-mark` stays styled for old markup).
- **Fonts:** the shell injects `<style id="tp-fonts">` into `document.head` (+ the same rules as an adopted constructable sheet) declaring
  family **"TP Inter"** from `chrome.runtime.getURL('fonts/inter-latin(-ext)-wght-normal.woff2')` (web_accessible_resources: `fonts/*.woff2`,
  `fonts/OFL-Inter.txt`). Shadow-root `@font-face` is ignored by Chrome. The demo maps `fonts/…` to `website/assets/fonts/`.
- **Shell:** sidebar brand = `TP.ui.logo` + wordmark (rail: tile only, the link has `aria-label`), `.tp-tb-brand` (phones), sidebar footer
  signature with `data-shell="classic-sig"` (same action as the account menu's `classic`), first-boot `.tp-splash` (no cached enrollments,
  motion on; ≤ 400 ms), deep bar uses the logo, classic pill (`#tplus-switch`) is an ink pill with the tile (page.css data URI).
- **Tokens:** see DESIGN.md › Tokens and › Brand (`--brand-*`, `--amber*` with `--orange*` as aliases, `--red-tile`, `--tint-tile`,
  `--shadow-card(-hover)`, `--r-tile`, `--ls-*`, `--fw-title`, `--scrollbar`).
