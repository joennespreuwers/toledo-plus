# Changelog

Alle noemenswaardige wijzigingen aan Toledo+ staan hier. / All notable changes to Toledo+ are documented here.

Het formaat volgt [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) en het project gebruikt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Read-sync with Toledo: marking items read in Toledo+ marks them read in Toledo too (can be turned off); favourites sync to Toledo's star.
- Slim "deep bar" on Ultra/portal pages Toledo+ does not replace, with a link back to the course.
- Test suite (unit + Playwright e2e with fully synthetic mock data), CI, release packaging, issue forms.

### Changed
- All rendering moved into a shadow root with a shared design system following Apple's HIG and WCAG 2.2 AA.

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
