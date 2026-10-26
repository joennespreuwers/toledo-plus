# Toledo+

**A calmer, clearer Toledo.** Toledo+ is a free browser extension for Chrome and Edge that wraps KU Leuven Toledo (the portal *and* the Blackboard Ultra course pages) into one consistent app: deadlines first, one compact feed of what's new, and every course page in the same shape.

> **Unofficial.** Toledo+ is an independent student project and is not affiliated with KU Leuven, LUCA School of Arts or Blackboard/Anthology. It simply uses your own Toledo session.

🇧🇪 [Lees dit in het Nederlands](README.md)

## Screenshots

| Overview | Course | Settings |
|---|---|---|
| ![Overview (light)](docs/screenshots/overview-light.png) | ![Course (light)](docs/screenshots/course-light.png) | ![Settings (light)](docs/screenshots/settings-light.png) |
| ![Overview (dark)](docs/screenshots/overview-dark.png) | ![Course (dark)](docs/screenshots/course-dark.png) | ![Settings (dark)](docs/screenshots/settings-dark.png) |

<sub>Screenshots use fictional data.</sub>

## Features

- **Overview** – deadlines, what's new since your last visit (compact, per course), continue where you left off, your courses, today's and tomorrow's schedule, announcements.
- **Courses** – current academic year only; communities and older years in the archive. Give courses a **nickname** and **colour**, pin or hide them.
- **Course page** – recently added, the full content tree as expandable folders, search across all folders, one-click open/download, deadlines, announcements and teachers.
- **Deadlines** – Toledo deadlines + Ultra calendar + your own deadlines in one list; tick them off; export to your calendar (.ics) with a reminder.
- **Planning** and **Announcements** (course announcements and Ad Valvas, with filters).
- **Read = read in Toledo**: items you mark as read in Toledo+ are marked read in Toledo too (can be turned off).
- **Nederlands, English, Français**; light/dark; accent colour; density; show/hide and reorder sections.
- Search with **⌘K** or **/**. Works on laptop and phone widths (tab bar at the bottom).
- **Classic Toledo** is always one click away (account menu); the *Toledo+* button turns it back on.

## Install

Toledo+ is not (yet) in the Chrome Web Store. Installing takes a minute:

1. Download **`toledo-plus-<version>.zip`** from the [latest release](https://github.com/joennespreuwers/toledo-plus/releases/latest).
2. Unzip it to a permanent location (e.g. `Documents/Toledo+`). Don't delete that folder later: the browser loads the extension from there.
3. Open the extensions page:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
4. Turn on **Developer mode** (top right in Chrome, bottom left in Edge).
5. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
6. Open [toledo.kuleuven.be/portal](https://toledo.kuleuven.be/portal) and log in as usual.

> Chrome may warn at startup that developer-mode extensions are running – that's normal for extensions outside the Web Store.

### Updating

1. Download the new zip from [Releases](https://github.com/joennespreuwers/toledo-plus/releases).
2. Replace the contents of your Toledo+ folder with the new files.
3. Go to `chrome://extensions` (or `edge://extensions`) and click ↻ (reload) on Toledo+.
4. Reload your Toledo tab. Your settings are kept.

Your version is shown in **Settings → About**. Watch the repository (*Watch → Custom → Releases*) to be notified of new versions.

## Privacy

Toledo+ only reads what Toledo already shows you, through your own session on `toledo.kuleuven.be` and `ultra.edu.kuleuven.cloud`. Settings are stored in your browser. **No analytics, no trackers, no servers of its own, no other websites.** Details: [PRIVACY.md](PRIVACY.md).

## Problems or ideas?

- 🐞 **Bug:** [report a bug](https://github.com/joennespreuwers/toledo-plus/issues/new?template=bug_report.yml)
- ✨ **Idea:** [request a feature](https://github.com/joennespreuwers/toledo-plus/issues/new?template=feature_request.yml)
- 💬 **Question:** [Discussions](https://github.com/joennespreuwers/toledo-plus/discussions)
- 🔒 **Security:** see [SECURITY.md](SECURITY.md)

Please **don't post real personal data** (names, e-mails, student numbers, course content) in issues or screenshots. Issues are reviewed twice a week.

## Development

```bash
git clone https://github.com/joennespreuwers/toledo-plus.git && cd toledo-plus
npm install && npx playwright install chromium
npm test            # unit + e2e (headless Chromium with the extension and a mocked Toledo)
npm run pack        # dist/toledo-plus-<version>.zip
```

No build step: load the folder directly with *Load unpacked*. Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/DESIGN.md`](docs/DESIGN.md) first.

### Project structure

```
manifest.json        MV3 manifest
background.js        cross-origin fetch relay (portal ↔ Ultra)
page.css             hides the original page, "Toledo+" pill in classic mode
ui.css               design tokens + shared components (inside the shadow root)
src/core/            util, i18n, settings, net, data, ui, shell
src/i18n/            translations (nl/en/fr) per view
src/views/           overview, courses, course, deadlines, planning, announcements, settings (+ .css)
src/boot.js          starts everything on both origins
tests/               unit (node:test) + e2e (Playwright) with synthetic fixtures
scripts/             pack.mjs (zip), setup-github.sh, run-tests.mjs
docs/                architecture and design
legacy/              v0.2 prototype (reference only)
```

## Contributing

Very welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). AI agents: [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © 2026 Joenne Spreuwers
