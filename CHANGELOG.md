# Changelog

Alle noemenswaardige wijzigingen aan Toledo+ staan hier. / All notable changes to Toledo+ are documented here.

Het formaat volgt [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) en het project gebruikt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **"Zet in zijbalk"**: choose which courses appear in the sidebar's "Vakken" group (and the icon rail) — from the course page header ("Zet in zijbalk" / "Uit zijbalk"), the small toggle on each course card, or the "In zijbalk" switch in Vakken › Bewerk. Purely local, nothing changes in Toledo. ⌘K still searches every course.
- **Mail button** back in the toolbar: envelope with a small grey unread count, opens Outlook web in a new tab. On phones it sits in the "Meer" sheet; the account menu keeps it too.
- **Greeting with your first name** ("Goedenavond, Alex"), read from Ultra (`users/me`) and kept only in local storage — never synced, never sent anywhere. Without a name the plain greeting stays.
- **Motion system** (`TP.motion`, native Web Animations + CSS, no library): views slide/fade in the direction you navigate (deeper from the right, back from the left, sidebar jumps fade), lists glide when you filter, search or reorder (FLIP — also across re-renders), new rows fade up, removed rows fade out while the rest closes the gap, first paint has a short staggered fade-up. Sheets, ⌘K, the detail sheet, menus and agenda popovers animate **in and out**; toasts slide in and stack; banners grow in; the segmented controls have a sliding pill, switches a spring thumb, the phone tab bar a sliding selection; buttons give a subtle press. Everything ≤ 350 ms, interruptible, never blocks input; **reduced motion** = short fades only.
- Agenda works like Google Calendar (Apple look): Dag / Week (optional Mon–Fri) / Maand / Lijst, "Vandaag", ‹ ›, go to date; the view you pick is remembered on this device.
- Week and day grid: 24 hours scrolling inside the calendar (08:00–19:00 visible, opens just before your first lesson), current-time line, deadlines as chips plus a marker at their time, overlapping lessons side by side.
- Month view with "+n meer", shaded weekends and optional week numbers; list view with day chips; mini month and filters in a side column on wide screens.
- Filters: lessons / exams / deadlines and per course (with colour dots).
- Lesson details: room, address and map link, teachers, group, "Open vak", "Zet in agenda" (.ics for one lesson); deadlines open the deadline sheet.
- Keyboard shortcuts in the Agenda (t, d, w, m, a/l, j/k, n/p, ←/→, g, ?; arrow keys between events). Swipe left/right in the phone day view. Periods slide in the direction you move.

### Changed
- The sidebar "Vakken" group lists only the courses you added and is hidden when there are none (settings v4: existing installs start with an empty group).
- **Layout on wide screens**: one centred content column (max 1240 px: main + side column) right of the sidebar instead of a strip next to an empty area; list views (Deadlines, Mededelingen, KU Loket, Instellingen) use a centred 760 px column. The toolbar's controls line up with the content edge at every width.
- Spacing pass along the design scale: welcome card padding and button spacing, side column width (280–340 px), day headers aligned with section titles, settings section gap.
- **Feels faster**: the course page shows its name, code and semester right away from cache (Ultra), "loading" is announced to screen readers (`aria-busy`), resting on a course link resolves the course so a click goes straight to the Ultra outline (no journey redirect), and going back restores where you had scrolled.
- Content-tree folders open with a fade instead of a height animation (smooth on slow laptops); small disclosures (Nieuw groups, documents, announcements, "Ouder dan een week") animate their height.
- KU Loket signed out: the timetable switches to your iCal feed on its own, keeps room, address and teachers for weeks seen earlier in KU Loket, and says so in one quiet line. The iCal link is re-read from KU Loket every 7 days.

### Fixed
- The sidebar (and icon rail / tab bar) could scroll horizontally; long course names now ellipsize and badges no longer push the width.
- Dutch greetings are spelled "Goedemorgen / Goedemiddag / Goedenavond" (was "Goeie…").
- Segmented controls (e.g. Mededelingen filter) no longer overflow at 320 px.
- The "sign in to KU Loket" state no longer sticks after you sign in again; "Nothing planned" only shows after the timetable actually loaded.
- Dialogs and menus no longer just vanish: they close with a short fade while focus returns immediately.

## [1.4.0] - 2026-10-26

Bundelt v1.2 (betrouwbaarheid), v1.3 (Agenda & KU Loket) en v1.4 (UX-opschoning) uit de review van 26 oktober. / Bundles v1.2 (reliability), v1.3 (Agenda & KU Loket) and v1.4 (UX cleanup) from the 26 October review.

### Added
- **Agenda** (replaces Planning; old `planning` links redirect): your full timetable from **KU Loket** (course, time, group, room, teacher) together with deadlines and exams — day, week and list views. Falls back to your public TimeEdit iCal feed when there is no KU Loket session. Settings → Agenda shows the KU Loket status and the iCal link (masked; paste / replace / remove).
- **Exam schedule (IER)** as an "Examens" group on top of Deadlines and in the Agenda, with countdown.
- **KU Loket hub**: grouped shortcuts to the KU Loket apps (ISP, attesten, financieel, faciliteiten, MOBIB, uurrooster, service desk, …).
- **Deadline detail sheet**: course, due date, source; *Open in vak*, *Open in Toledo*, mark done, *Zet in agenda* (single-event .ics).
- **"Nieuw" in course content**: blue dots, "n nieuw" in the course header (same source as the feed) and an *Alleen nieuw* filter.
- Next lesson in the course page side column; KU Loket lessons (room, teacher) in Overview › Rooster.
- **Banners**: "Je sessie is verlopen · Log opnieuw in", "Toledo+ is bijgewerkt · Herlaad", and "Nieuwe versie beschikbaar" (manual installs don't auto-update).
- **Feedback** from the extension (account menu or Settings → Over): idea / problem / other, optional contact (never published).
- **Anonymous usage signal** (on by default, switch in Settings → Over and the welcome card): at most once a day a random install id, version, browser and language to `api.toledoplus.be`. No name, student number or Toledo data; IPs are not stored. Turning it off deletes the id and the server rows. See PRIVACY.md.
- One-time welcome card on the Overview.
- `worker/`: the Cloudflare Worker behind `api.toledoplus.be` (ping, forget, feedback → optional GitHub issue, latest version, token-protected stats) with D1 storage and rate limiting.
- `website/`: the product site for toledoplus.be (NL/EN/FR) with an installer guide, deployed by `.github/workflows/pages.yml`. Releases now also carry a stable `toledo-plus.zip` asset.

### Changed
- **Pinning removed.** The sidebar shows "Vakken": your current courses in your chosen order (collapsible); no more coupling to Toledo favourites.
- Settings reduced to 10 groups; overview sections are reordered on a "Secties aanpassen…" subpage; course settings live in Vakken › Bewerk; "Geavanceerd" holds Toledo-page switches and export/import/reset.
- Consistent wording: "Te laat", "Ad Valvas", "Zet in agenda". Sidebar badges: no count on Overview; Deadlines grey (open) or red (overdue).
- Red/pink are no longer accent colours (a stored one becomes blue); default course colours are unique.
- Layout: content next to the sidebar on 1920–2560 px, lists capped at ~760 px, icon rail by default at 700–899 px, fixes at 320 px, "‹ Vakken" back button below 1100 px, ≥ 24 px link targets.
- Network: retry with backoff on 429/5xx; failed mark-read PATCHes are queued and sent later (keepalive, chunked).

### Fixed
- Endless skeletons and false empty states on load errors: every section now shows loading, an error row with *Opnieuw*, empty (only after a successful load) or content.
- Overdue deadlines older than 7 days disappeared — they now stay (collapsed "Ouder dan een week").
- New items with an older date never appeared in "Nieuw"; "read" was reset on refresh with Toledo sync off.
- One failing Ultra request cached an empty course; ↻ didn't refresh course content.
- Changes in one tab were invisible in others / could undo "done" marks.
- Opening an item and navigating immediately lost "Recent" and the read PATCH.
- Search on Overview didn't filter counts and left empty day headers; unread style was inconsistent.
- Duplicate deadlines (23:59 vs 00:00) and lost "done"/ICS UID after a deadline moved.
- Storage-quota rejection, `ping` attribute not stripped, flaky DST test.

## [1.1.0] - 2026-10-26

### Added
- **⌘K command palette** (also Ctrl+K, `/` when you're not typing, the ⌘K button in the toolbar field, and "Zoek overal" in the phone More sheet): one search across navigation, courses, **documents in all your courses**, deadlines and announcements. Case- and accent-insensitive, every word must match the title, folder path or course; title prefix ranks first. ↑/↓ to move, ↵ to open, ⌘↵/Ctrl+↵ to download a file. Empty query shows Recent + navigation. A centred glass sheet on desktop, full-screen on phones; modal dialog with a combobox/listbox (`aria-activedescendant`), focus trapped and returned on close.
- **Document index** (`TP.index`): a compact, local index of every current course's content tree in `chrome.storage.local` (capped at ~2 MB). Updated whenever you open a course and by a background crawl (≤ once per 24 h per course, two at a time, started 5 s after load when the browser is idle). On the portal the crawl goes through the relay and fails silently without an Ultra session; the palette footer says so ("Open een vak om het te indexeren").
- "Show in course": opening a folder, page or assignment from the palette opens the course with the containing folders unfolded and the row scrolled into view and briefly highlighted (course view `params.focus` / `state.focus`).
- Settings → **Zoeken**: "Documenten in alle vakken indexeren" (on by default), "Index opnieuw opbouwen" and a status line.

### Changed
- **Collapsed sidebar = icon rail.** ⌘\ / Ctrl+\ and the toolbar button switch between the expanded sidebar (240 px) and a 64 px icon rail: centred icons with tooltips, counts as a dot (red badge only for overdue), pinned courses as coloured circles with their initials, Toledo+ mark on top, Settings at the bottom. Remembered in `state.ui.sidebarCollapsed`. Between 700 and 899 px the rail is the default and expanding shows the full sidebar as an overlay.
- The toolbar search field keeps filtering the current view; ⌘K and `/` now open the palette.

### Fixed
- The sidebar and toolbar scrolled away with the page: `<body>` became a scroll container (both `html` and `body` had `overflow: auto`), which defeats `position: sticky`. Only `<html>` scrolls now, so the sidebar stays put at full height and only the content column scrolls (portal and Ultra).

## [1.0.0] - 2026-10-26

Volledige wrapper rond Toledo (portaal + Blackboard Ultra). / Full wrapper around Toledo (portal + Blackboard Ultra).

### Added
- App shell for both origins: sidebar (≥ 700 px) or floating tab bar (< 700 px), toolbar with search (⌘K or `/`), refresh, account menu (unread mail, classic Toledo, log out), skip link, live region.
- Views: **Overview**, **Courses**, **Course**, **Deadlines**, **Planning**, **Announcements**, **Settings**.
- Interface in **Dutch, English and French** (follows the browser by default); `lang` attribute follows the UI language.
- Settings that apply instantly and sync across your browsers: language, appearance (system/light/dark), accent colour, density (compact/standard/comfortable), start page, overview sections (show/hide + reorder), feed options, deadline horizon and reminder, Toledo sync, wrapper switches, export/import/reset.
- Per-course customization: nickname, colour, pin, hide; communities and older academic years in an archive.
- Compact "New" feed: one row per course with a summary ("2 files · 1 video"), top *n* courses with "Show all".
- Deadlines view merging Toledo deadlines, Ultra calendar items and your own deadlines; mark as done; export to `.ics` with reminder.
- Planning view (today + tomorrow from Toledo, with a link to the KU Loket timetable).
- Announcements view (course announcements + Ad Valvas) with filters.
- Read-sync with Toledo: marking items read in Toledo+ marks them read in Toledo too (can be turned off).
- Slim "deep bar" on Ultra/portal pages Toledo+ does not replace, with a link back to the course.
- Test suite (unit + Playwright e2e with fully synthetic mock data), CI, release packaging, issue forms.

### Changed
- All rendering moved into a shadow root with a shared design system following Apple's HIG and WCAG 2.2 AA.
- **Pin = favourite**: one pin control ("Vastzetten") instead of a separate pin and star. Pinned courses appear in the sidebar's "Vastgezet" group and first in lists. With "Vastgezette vakken als favoriet in Toledo" on, pinning also sets the course's Toledo favourite and your Toledo favourites count as pinned. Existing settings migrate automatically.
- Settings: "Startpagina", "Overzicht-secties" and "Nieuw" are one **Overzicht** group; the "Bijgewerkt hh:mm" line is no longer shown on the settings page.
- Course header shows "13 items · 3 nieuw" in secondary text (no coloured dot; the "nieuw" part only when there is something new).
- Search: one centred empty state per view (magnifier, "Geen resultaten", "voor “x”") instead of a grey line, in every view.
- Storage: your own deadlines are stored under their own sync key (`custom`, falling back to local storage when sync is full) so they can no longer push the settings over the sync quota; changes made in other tabs, including to the local fallback, now show up right away.

### Fixed
- Portal routing: Toledo's AngularJS router rewrote Toledo+ routes to `#/home`; routes now live in the query string (`#/home?tplus=<route>`), old `#/tplus/…` links are converted in place.
- Sanitizer hardening for remote HTML: also drops `svg`, `math`, `template`, `noscript`, `textarea`/`select`, `frame`s; catches `javascript:` URLs hidden with tabs, newlines or leading control characters, in `srcset` and `xlink:href`; relative URLs are made absolute (Ultra's CDN `<base href>`); links get `rel="noopener noreferrer"`.
- Contrast: secondary text (`--label-2`) raised to ≥ 4.5:1 on the page background, tint-coloured text contrast-checked per accent, stronger separators and controls under "increase contrast".
- Settings stay within `storage.sync`'s 8 KB per-item limit: default per-course values are not stored, with a local fallback when sync refuses a write.
- E2E: the "More" sheet screenshot waits for its opening animation.

## [0.2.1] - 2026-10-24

### Fixed
- Ultra sets `<base href>` to a CDN: all URLs on the Ultra origin are now absolute, which fixes broken API calls, links and downloads on course pages.

## [0.2.0] - 2026-10-23

### Added
- Course view on `ultra.edu.kuleuven.cloud/ultra/courses/<id>/outline`: recently added, full content tree with expandable folders, search inside the course, one-click open/download, course deadlines, announcements and teachers.
- "Classic" button to fall back to Ultra, with a pill to switch back.

## [0.1.0] - 2026-10-22

### Added
- Prototype home overlay on the Toledo portal: deadlines (incl. own deadlines and `.ics` export), new items per course, today/tomorrow schedule, announcements, current courses; light/dark following the system.

[Unreleased]: https://github.com/joennespreuwers/toledo-plus/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/joennespreuwers/toledo-plus/compare/v0.2.1...v1.0.0
[0.2.1]: https://github.com/joennespreuwers/toledo-plus/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/joennespreuwers/toledo-plus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joennespreuwers/toledo-plus/releases/tag/v0.1.0
