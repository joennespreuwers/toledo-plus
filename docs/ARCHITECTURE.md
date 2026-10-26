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
   - `GET /portal/api/enrollments` → `[{id, learningUnitId, title:"Filmtaal 1 [N50265]", type:'course'|'community', semester:'SEMESTER1'|'SEMESTER2'|'YEAR'|'UNKNOWN', academicYear:2627|0, color:1..16, favorite, available, link}]`
     (`link` = `https://icts-p-toledo-journey.cloud.icts.kuleuven.be/learningUnits/ultraLink?batchUid=<learningUnitId>` → redirects to the Ultra course outline)
   - `GET /portal/api/events` → `[{id, title, source:"Filmtaal 1 [N50265]"|"Ad Valvas", sourceId:<learningUnitId>|'advalvas', date:ms, type:'notifications'|'advalvas', eventType:'update'|'message', subType, read, seen, dismissed, url, author, color}]`
     subTypes: `content` (new file/page), `other` (assignment/item made available), `due` (deadline; `date` = due time),
     `course` (course became available – title = course name; **not useful in feeds, skip**), `announcement` (course announcement), `advalvas` (school notice).
   - `PATCH /portal/api/batch/events` body `[{id, type, subType, read:true}]` (or `seen:true` / `dismissed:true`) – marks events in Toledo itself.
   - `PATCH /portal/api/enrollments/{id}` body `{favorite:true|false}` – Toledo's own favorite star.
   - `GET /portal/api/upcoming` → today+tomorrow lessons `[{start, end, name, location:{mnemonic, roomNumber}('?' = unknown), source:{learningUnitId, link, color}}]`
   - `GET /portal/api/emails/unread` → `{value:129}`
   - `GET /portal/api/links` → groups `[{label, links:[{label, translation, url, action}]}]`; useful labels: `LOGOUT` (url `Shibboleth.sso/Logout`, resolve against `https://toledo.kuleuven.be/`), `NOTIFICATION-SETTINGS-ULTRA`, `TOLBIZZ-ENROLL`, `KULOKET-UURROOSTER`, `ADVALVAS`, `BB-CALENDAR-ULTRA`, `LUCA-CAL`, `LUCA-STUDENT-WEBMAIL`, `KULOKET-STUDENT`, …
5. Blackboard REST (same origin on ultra.edu.kuleuven.cloud, absolute URLs, `credentials:'include'`):
   - `GET /learn/api/public/v3/courses/{cid}` → `{id:'_200661_1', courseId:<learningUnitId>, name}`; `GET /learn/api/public/v3/courses/courseId:<learningUnitId>` also works for lookup.
   - `GET /learn/api/public/v1/courses/{cid}/contents?limit=200` and `/contents/{id}/children?limit=200` → `[{id, title, description?, body?(HTML, documents), created, modified, hasChildren, availability:{available}, contentHandler:{id:'resource/x-bb-folder'|'x-bb-lesson'|'x-bb-file'|'x-bb-document'|'x-bb-externallink'(+url)|'x-bb-blti-link'|'x-bb-asmt-test-link'|…, file:{fileName, mimeType}}, links:[{href:'/ultra/redirect?…'}]}]`
   - `…/contents/{id}/attachments` → `[{id, fileName, mimeType}]`
   - `GET /learn/api/public/v1/courses/{cid}/announcements?limit=20` → `[{id, title, body(HTML), created, draft}]`; single: `…/announcements/{aid}`
   - `GET /learn/api/public/v2/courses/{cid}/gradebook/columns?limit=200` → use **only** `name`, `grading.due`, `contentId` (school does not use grades).
   - `GET /learn/api/public/v1/courses/{cid}/users?role=Instructor&expand=user` → `user.name.given/family`, `user.contact.email`.
   - `GET /learn/api/public/v1/calendars/items?since=ISO&until=ISO&limit=100` → cross-course deadlines (`type:'GradebookColumn'`, `title`, `end`, `calendarName:"ULTRA-B-…: Filmtaal 1 [N50265]"`). Keep windows ≤ 60 days.
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
Content-script load order (both origins): `src/core/util.js, src/core/i18n.js, src/i18n/*.js, src/core/settings.js, src/core/net.js, src/core/data.js, src/core/index.js, src/core/ui.js, src/core/shell.js, src/core/palette.js, src/views/*.js, src/boot.js` (guarded by `tests/unit/manifest.test.js`).
Each file is an IIFE that attaches to `globalThis.TP` (`const TP = (globalThis.TP ||= {});`). No ES modules, no imports, no network except Toledo/Ultra.
CSS loaded into the shadow root by the shell, in this order: `ui.css`, then every `src/views/*.css` (list is `TP.shell.CSS` in shell.js; all must exist even if empty; all are web_accessible_resources).

## TP.util / TP.fmt (core)
```
TP.util.esc(s) → HTML-escaped string
TP.util.abs(path) → absolute URL on the current origin (passes http(s) URLs through)
TP.util.sanitize(html) → safe HTML string (drop script/style/iframe/object/embed/form/input/button/link/meta/base, on* attrs, style/class/id, javascript: urls; <a> get target=_blank rel=noopener)
TP.util.plain(html) → text
TP.util.courseName("Filmtaal 1 [N50265]") → "Filmtaal 1"   (also strips leading "- ")
TP.util.courseCode(title) → "N50265" | ""
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
State lives in `chrome.storage.local` key `state`.
```
await TP.settings.load()           // called once by boot; merges DEFAULTS deeply
TP.settings.get() → object (read-only snapshot)
await TP.settings.set(patchObject) // deep-merge patch, persist, notify
TP.settings.subscribe(fn(settings, changedTopKeys)) → unsubscribe
TP.settings.reset(), TP.settings.export() → JSON string, TP.settings.import(json)
TP.settings.course(luId) → { nickname:'', color:null, hidden:false, pinned:null }  (merged with defaults; pinned null = no explicit choice)
await TP.settings.setCourse(luId, patch)
TP.state.get(), await TP.state.set(patch), TP.state.subscribe(fn)
```
DEFAULTS (exact):
```
{
  v: 2,
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
  courses: { sort: 'activity', showCommunities: false, items: {} },  // sort: 'activity'|'name'|'manual'; items[luId] = {nickname,color,hidden,pinned}; manual order in courses.order: [luId]
  sync: { markReadInToledo: true, favoritesToToledo: true },  // favoritesToToledo: pinned == Toledo favourite
  search: { indexAll: true },         // background-crawl all current courses for the ⌘K document index
  custom: [],                         // custom deadlines [{id, title, courseLuId|'', due:ms}] — persisted under sync key 'custom'
}
```
State (local, not synced): `{ visits:{[courseId]:ms}, feedSeenAt:0, done:{[deadlineKey]:true}, recent:[{title,url,courseName,courseLuId,kind,ts}] (max 12), cache:{}, cidMap:{[luId]:cid}, openFolders:{[cid]:[id]}, ui:{sidebarCollapsed}, focus:{cid,luId,id,at}|absent }`.
`focus` is the palette's "show in course" hand-off (works across both origins); the course view consumes it (≤ 2 min old) and deletes it. The shell does not rerender on `ui`, `cache`, `visits`, `openFolders`, `recent`, `focus`.

## TP.net (data)
```
await TP.net.json(url, {method, body, headers}) → parsed JSON; throws Error with .status
await TP.net.blob(url) → Blob   (default credentials – for S3 downloads)
```
Same-origin URL → direct `fetch` (credentials:'include' except blob). Cross-origin (toledo ↔ ultra) → `chrome.runtime.sendMessage({type:'tp-fetch', url, method, body, headers})` handled by `background.js`, which does the fetch with `credentials:'include'` and returns `{ok, status, data}`. Cross-origin calls are **best-effort**: callers must handle failure (e.g. Ultra session not yet established) and degrade silently.

## TP.data (data)
Stale-while-revalidate: `TP.data.peek(key)` returns the last cached value (from `chrome.storage.local` `cache:<key>`, loaded at boot) or `null`; `TP.data.load(key, {force})` fetches, caches, emits `change`.
```
keys: 'enrollments','events','upcoming','mail','links','ultraDeadlines'
TP.data.on('change', fn(key)) / off
TP.data.on('course', fn({cid, result}))   // a full (non-partial) ultraCourse load finished – TP.index listens
await TP.data.refresh()              // loads all portal keys (+ ultraDeadlines best-effort); used by shell pull-to-refresh / ⌘R-like button
TP.data.lastUpdated() → ms|null

// models (sync, computed from peek() + settings + state; return [] when no data yet)
TP.data.courses({includeHidden, includeCommunities, currentOnly}) → Course[]
  Course = { luId, enrollmentId, title, name (nickname||courseName), code, color (hex), colorKey, semester, year, type,
             favorite, pinned, hidden, available, link, unread (events count for feed rules), latest (ms) }
  "current" = type==='course' && academicYear === max academicYear over courses; communities have type 'community'.
TP.data.course(luId) → Course|null
TP.data.feed() → FeedGroup[]  (unread notifications, NOT subType 'due'|'course', not dismissed, date > state.feedSeenAt;
                               announcements only if settings.feed.includeAnnouncements)
  FeedGroup = { luId, course: Course|null, name, color, items: Event[] (newest first), latest, counts:{file,video,page,assignment,announcement} }
  sorted: pinned courses first, then groups with a deadline ≤ 48h, then latest desc
  Course.pinned: **pinned == Toledo favourite.** settings item pinned true/false wins; if unset (null) the course is pinned
  when settings.sync.favoritesToToledo && enrollment.favorite.
TP.data.kindOf(event|contentNode) → 'file'|'video'|'image'|'page'|'assignment'|'link'|'tool'|'folder'|'announcement'|'notice'
TP.data.deadlines({includeDone, horizonDays}) → Deadline[] sorted by due
  Deadline = { key, title, courseName, courseLuId, color, due, url|null, source:'toledo'|'ultra'|'custom', done, customId? }
  merges events subType 'due' + ultraDeadlines + settings.custom; dedupe by normalized title+course+due-day; done from state.done
TP.data.announcements({filter:'all'|'courses'|'school'|'unread'}) → Event[] (subType announcement|advalvas), newest first
TP.data.schedule() → { [dayKey]: Upcoming[] }
TP.data.link(label) → absolute url|null ; TP.data.quickLinks() → [{label, title, url}] (curated subset, titles from `translation`)

// mutations
await TP.data.markRead(events[])      // optimistic local update; PATCH batch/events if settings.sync.markReadInToledo
await TP.data.markFeedSeen()          // state.feedSeenAt = now (+ markRead of those events if sync enabled)
await TP.data.setPinned(luId, bool)   // the one pin control: settings item pinned + (if sync.favoritesToToledo) setFavorite; → false if the Toledo sync failed
await TP.data.setFavorite(luId, bool) // PATCH enrollments/{id} if settings.sync.favoritesToToledo (used by setPinned)
await TP.data.toggleDone(deadlineKey)
await TP.data.addCustomDeadline({title, courseLuId, due}) / removeCustomDeadline(id)
await TP.data.addRecent({title,url,courseName,courseLuId,kind})
TP.data.ics(deadlines) → string (VCALENDAR; VALARM per settings.deadlines.reminder; Europe/Brussels times as UTC)

// Ultra (same-origin on ultra, relay elsewhere)
await TP.data.ultraCourse(cid, onProgress?) → { course:{id, courseId, name}, roots: Node[], announcements, deadlines:[{title,due,url}], staff:[{name,email}] }
   Node = raw content item + kids:Node[]|undefined ; tree walked with bounded concurrency (6), depth ≤ 6, unavailable items dropped;
   onProgress(partialResult) called after metadata and after the walk.
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
