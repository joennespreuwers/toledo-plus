# AGENTS.md — instructions for AI agents

This file is for AI coding agents (Claude Code and others) working on Toledo+, including the **scheduled triage agent** that runs twice a week. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md).

## 1. Read first

1. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the contract: file ownership, load order, `TP.*` APIs, verified platform facts. It is authoritative; if code and doc disagree, fix the code or update the doc in the same PR.
2. [`docs/DESIGN.md`](docs/DESIGN.md) — design principles, tokens, components, accessibility checklist.
3. `CHANGELOG.md` and the last few merged PRs, to match the current style.

## 2. Architecture rules (non-negotiable)

- Manifest V3, **no build step**, plain ES2020 IIFEs on `globalThis.TP`; no ES modules, no npm runtime dependencies.
- All UI inside the `#tplus-root` **shadow root**; CSS files listed in `TP.shell.CSS` and in `web_accessible_resources`.
- **Network:** only `https://toledo.kuleuven.be`, `https://ultra.edu.kuleuven.cloud` (plus the signed file-storage redirect for downloads), read-only `https://webwsp.aps.kuleuven.be` (KU Loket) and `https://cloud.timeedit.net` (iCal), and the project's own `https://api.toledoplus.be` (exact paths only: `POST /v1/ping`, `POST /v1/forget`, `POST /v1/feedback`, `GET /v1/latest`; no cookies). Cross-origin via `TP.net` → `background.js` relay, best-effort with silent degradation. **Never add calls to other domains. The only usage signal is the anonymous daily ping in `src/core/telemetry.js` (random id, version, browser, language — opt-out in Settings); never extend it with identity, Toledo data or behaviour tracking. Never add remote fonts or remote code.** Do not add permissions to `manifest.json` without a maintainer-approved issue.
- On Ultra every URL must be absolute (`TP.util.abs`) – Ultra's `<base href>` points to a CDN.
- Remote HTML → `TP.util.sanitize`; text → `TP.util.esc`. No exceptions.
- Every user-facing string in **nl, en and fr** via `TP.i18n.add`. Dutch first; short, plain, informal-polite ("je").
- Never show grades or submission status. Keep settings ≤ ~10 groups; no widget builders, no gamification.
- Views use one delegated listener per event type on `ctx.root`, never on `document`.

## 3. Running tests

```bash
npm install && npx playwright install chromium   # once
npm run test:unit
npm run test:e2e                                 # headless Chromium + extension + mocked Toledo
npm run test:e2e -- settings                     # filter by file name
npm run pack                                     # zip into dist/
```

Without `node_modules`, `tests/helpers/pw.js` falls back to a global Playwright (`NODE_PATH=$(npm root -g)`).
Mocks: `tests/helpers/mock.js` serves both origins from `tests/fixtures/*.json`; it records `rec.patches` (PATCH bodies sent to Toledo), `rec.foreign` (must stay empty), `rec.cdn` (relative-URL bugs, must stay empty) and `rec.downloads`.

## 4. Never commit real student data

Fixtures, tests, screenshots, issue reproductions and PR descriptions use **synthetic** data only: teachers "Docent A/B", e-mails `@example.edu`, made-up course codes. If an issue contains real names, e-mails, student numbers or course content, **do not copy them** into the repo; paraphrase with synthetic data. `tests/unit/privacy.test.js` scans fixtures for real-looking e-mails.

## 5. Issue triage (scheduled: twice a week)

For every open issue labelled `needs-triage` (oldest first, max ~15 per run):

1. **Classify** – apply one type label (`bug`, `enhancement`, `question`) and any area labels (`ux`, `i18n`, `accessibility`). Remove `needs-triage`.
2. **Duplicates** – search open+closed issues; if duplicate, comment with the link, label `duplicate`, close.
3. **Questions** – answer briefly (in the reporter's language: NL/EN/FR), label `question`, point to Discussions, close if answered.
4. **Bugs** – try to **reproduce with mocks**: add or adjust fixtures/routes in `tests/` to mimic the reported data shape and write a failing e2e or unit test.
   - Reproduced → comment what you found, label `agent:ready` (if the fix is small and clear) or `help wanted`.
   - Not reproducible / info missing → label `needs-repro`, ask for exactly what is missing (browser + version, Toledo+ version, view, language, steps, console errors) in the reporter's language. Close after 21 days without reply.
5. **Feature requests** – check against the product principles in `docs/DESIGN.md`. Fits and is small → `agent:ready` or `good first issue`; large/unclear → ask a question; conflicts with principles (e.g. grades, tracking, other domains) → `wontfix` with a short, kind explanation.
6. **Work** – pick at most **3** `agent:ready` issues per run. Label `agent:in-progress`, create a branch `agent/<issue-number>-<slug>`, implement, open a PR.
7. Never close an issue only because a PR exists; let the merge close it (`Fixes #n`).
8. Post a short triage summary comment on the pinned "Triage log" discussion/issue if one exists.

### PR rules for agents

- **Small and focused**: one issue per PR, minimal diff, no drive-by refactors or formatting churn.
- Include a test that fails before and passes after (unit or e2e with mocks).
- `npm test` green locally; light + dark screenshots from `tests/artifacts/` for UI changes.
- NL/EN/FR strings complete; `CHANGELOG.md` entry under **Unreleased** (Added/Changed/Fixed).
- PR body: what, why, how tested, `Fixes #n`. Fill in the PR template checklist.
- Do not merge your own PRs; do not push to `main`; do not edit `.github/workflows` or `manifest.json` permissions unless the issue is explicitly about that and labelled by the maintainer.

### Triage rubric

| Situation | Labels | Action |
|---|---|---|
| Crash, blank page, data missing, wrong data, broken link/download | `bug` (+ priority in comment: P1 if it blocks using Toledo) | Reproduce with mocks; P1 → handle in this run |
| Layout/clarity/visual polish | `ux` (+ `bug` if broken, `enhancement` if new) | Screenshot compare in light/dark, 390/1440 |
| Missing or wrong translation | `i18n` | Fix all three languages; often `good first issue` |
| Keyboard, screen reader, contrast, zoom | `accessibility` (+ `bug`) | Treat as P1/P2; verify against DESIGN.md checklist |
| Toledo/Ultra changed its API or HTML | `bug`, `help wanted` | Update mocks to new shape first, then fix; note in CHANGELOG |
| Request for grades, tracking/analytics beyond the anonymous ping, other sites, heavy customization | `wontfix` | Explain the principle kindly, close |
| Unclear / missing info | `needs-repro` | Ask specific questions |
| Same as existing | `duplicate` | Link + close |

### Label meanings

| Label | Meaning |
|---|---|
| `bug` | Something doesn't work as intended |
| `enhancement` | New feature or improvement |
| `ux` | Design, layout, wording, clarity |
| `i18n` | Translations NL/EN/FR |
| `accessibility` | WCAG 2.2 AA, keyboard, screen reader, contrast |
| `good first issue` | Small, well-scoped, good for newcomers |
| `help wanted` | Maintainer would welcome outside help |
| `needs-triage` | New, not yet looked at (set by issue forms) |
| `needs-repro` | Can't reproduce; waiting for info |
| `wontfix` | Deliberately not doing this |
| `duplicate` | Already reported elsewhere |
| `question` | Support question, not a bug |
| `agent:ready` | Scoped and clear enough for an AI agent to implement |
| `agent:in-progress` | An agent is working on it; PR coming |

Labels are defined in `.github/labels.json` (synced by `.github/workflows/labels.yml`).
