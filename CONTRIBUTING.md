# Bijdragen / Contributing

Fijn dat je wil helpen! Toledo+ is een klein studentenproject; kleine, gerichte bijdragen zijn het meest welkom.
Thanks for helping! Toledo+ is a small student project; small, focused contributions are most welcome.

## Issues

- **Bug of idee?** Gebruik de [issue-formulieren](https://github.com/joennespreuwers/toledo-plus/issues/new/choose). / Use the issue forms.
- **Vraag?** Gebruik [Discussions](https://github.com/joennespreuwers/toledo-plus/discussions).
- **Deel nooit echte persoonsgegevens** (namen, e-mail, r-nummers, inhoud van vakken) – ook niet in screenshots. / Never share real personal data.

Issues worden twee keer per week getrieerd (deels door een AI-agent, zie [AGENTS.md](AGENTS.md)). / Issues are triaged twice a week.

## Development

Requirements: Node 20+, Chrome or Edge. No build step: the extension is plain ES2020 scripts.

```bash
git clone https://github.com/joennespreuwers/toledo-plus.git
cd toledo-plus
npm install                         # installs Playwright (dev only)
npx playwright install chromium
npm test                            # unit + e2e
npm run test:e2e -- course          # only e2e files whose name contains "course"
HEADED=1 npm run test:e2e           # watch the browser
npm run pack                        # dist/toledo-plus-<version>.zip
```

Load the folder itself via `chrome://extensions` → Developer mode → *Load unpacked* to try it on the real Toledo.
After editing, press ↻ on the extension card and reload the Toledo tab — or run `npm run dev` to get a Chrome that reloads the extension on every save.

Read first: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (contract: modules, data API, view API) and [`docs/DESIGN.md`](docs/DESIGN.md) (design system, accessibility).

### Rules

1. **Only Toledo's own origins.** No requests to other domains, no analytics, no remote fonts/scripts/CDNs.
2. **Sanitize** remote HTML with `TP.util.sanitize`, escape text with `TP.util.esc`. Never `innerHTML` raw API data.
3. **Absolute URLs on Ultra** (`TP.util.abs`) – Ultra sets `<base href>` to a CDN. The e2e mock fails any request to `cdn.example.invalid`.
4. **NL / EN / FR complete** for every string you add (`TP.i18n.add`). Dutch is primary; tone: short, plain, "je".
5. **No real data.** Fixtures in `tests/fixtures/` are synthetic (`example.edu`, "Docent A"). A unit test checks this.
6. **Accessibility:** keyboard reachable, visible focus, labels on icon buttons, never colour alone, works at 390 px and 200 % zoom.
7. Keep settings few; no grades or submission status (the school does not use them).
8. Update `CHANGELOG.md` under **Unreleased**.

### Tests

- `tests/unit/*.test.js` – `node:test`, loads `src/**` scripts in a `vm` sandbox.
- `tests/e2e/*.e2e.js` – `node:test` + Playwright: Chromium with the unpacked extension and a fully mocked Toledo (`tests/helpers/mock.js`, fixtures in `tests/fixtures/*.json` with relative dates like `"@ms:+1d@23:59"`). Screenshots land in `tests/artifacts/` (git-ignored, uploaded by CI).
- Requests made by the extension's background worker are intercepted too (context-level routing).
- Playwright does not route the follow-up of a mocked 3xx, so signed download URLs are served by a throwaway local HTTPS server (`tests/helpers/files-server.js`, needs `openssl`).
- `EXT_DIR=path/to/unpacked npm run test:e2e` runs the suite against another build (e.g. an extracted release zip).

### Branches & pull requests

`main` is protected: nobody (maintainers included) pushes to it directly. Every change goes through a pull request.

1. Branch from an up-to-date `main`: `git switch main && git pull && git switch -c <type>/<short-slug>` — types: `feat/`, `fix/`, `ui/`, `docs/`, `chore/`, `agent/` (AI agents).
2. Commit small, push the branch, open a PR early (draft is fine) so others see what you're working on.
3. CI must be green; one approving review from another maintainer; resolve conversations. Merge with **Squash and merge**.
4. Keep the branch current with `git pull --rebase origin main` when `main` moves; fix conflicts locally.
5. Releases: bump the version in `manifest.json` + `package.json` and add a `## [x.y.z]` section to `CHANGELOG.md` in the PR. Merging it to `main` releases automatically (tag, zip, GitHub release, API "latest version").


One topic per PR, fill in the template checklist, include light + dark screenshots for UI changes. CI must be green.

By contributing you agree your work is licensed under the [MIT License](LICENSE) and you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
