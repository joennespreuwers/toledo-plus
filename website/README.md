# toledoplus.be

The product website for Toledo+: plain static HTML/CSS with a few lines of JS, plus an interactive demo. No build step, no external fonts/CDNs, no cookies, no analytics.

```
index.html            NL (primary)          en/index.html, fr/index.html
privacy.html          privacy policy (NL)   en/privacy.html, fr/privacy.html
404.html              served by GitHub Pages for unknown paths (root-absolute URLs)
assets/site.css       brand tokens (Inter, orange/ink), layout, motion (the app's --dur/--ease tokens); light/dark via
                      prefers-color-scheme or <html data-theme> (theme toggle; an inline <head> script applies it before paint)
                      and the hero screenshot follows it (.shot-light / .shot-dark)
assets/site.js        progressive enhancement: theme toggle Light ⇄ Dark (follows the system until the first click, which
                      flips the theme you see; localStorage 'tp-theme', shared with the demo), copy buttons,
                      scroll reveal, Lenis smooth wheel scrolling + anchor offsets (not under reduced motion, not on touch)
assets/fonts/         Inter (latin + latin-ext, variable) + OFL-Inter.txt — self-hosted, also used by the demo
assets/vendor/lenis/  Lenis 1.3.27 (MIT, LICENSE) — loaded on demand by site.js, never in /demo/
assets/img/           per language (nl/en/fr): overview-{light,dark}-<lang>.webp, overview-light-<lang>.png (no-WebP
                      fallback), og-<lang>.png (1200×630) — generated; each page uses only its own language's set
demo/                 toledoplus.be/demo/: the real extension UI with fake data (see below)
  index.html          page + demo bar ("Demo met nepdata · Installeer Toledo+ ›", NL/EN/FR)
  demo.js             chrome.* shim, network guard, link → in-page route mapping, loads the content scripts
  mock.js             in-memory Toledo / Ultra / KU Loket / TimeEdit / api.toledoplus.be (also used by screens.mjs)
  data/*.json         the fictitious dataset (same shape as tests/fixtures/*.json)
  ext/                copy of manifest.json, src/, ui.css, page.css, icons/ — gitignored, made at build time
tools/                dev-only, not deployed
  screens.mjs         regenerates the screenshots, og.png and the version text
  check.mjs           Playwright checks for the site and the demo
  sync-ext.mjs        copies the extension into demo/ext/ for local testing
CNAME                 toledoplus.be
robots.txt, sitemap.xml, favicon.ico, apple-touch-icon.png
```

## Preview locally

```bash
node website/tools/sync-ext.mjs        # once, and after extension changes (for the demo)
cd website && python3 -m http.server 8000
# site: http://localhost:8000   demo: http://localhost:8000/demo/
```

## Screenshots and version (after UI changes or a release)

```bash
NODE_PATH=$(npm root -g) node website/tools/screens.mjs
```

Loads the unpacked extension in Playwright's Chromium, serves `demo/data/*.json` through `demo/mock.js`
(everything else is blocked), opens the overview with the welcome card dismissed and banners/toasts hidden, once per app
language (setting `language` = nl, en, fr: the UI chrome matches the page, the fictitious data stays Dutch), and writes
`assets/img/overview-{light,dark}-<lang>.webp` (2400 px wide), `overview-light-<lang>.png` (1440 px fallback) and
`og-<lang>.png` (brand card). `index.html`, `en/` and `fr/` (and their privacy/terms pages) point at their own set.
It also writes the version from `manifest.json` into the three index pages (hero, download card, JSON-LD) and refreshes
`demo/ext/`. Uses `sharp` when installed (smaller PNGs), otherwise Chromium's encoder. Keep `assets/img/` under ~1.5 MB
(the script prints the sizes; `check.mjs` fails above that). Needs Playwright with Chromium (`npx playwright install chromium`).

The script only relies on `#tplus-root`'s shadow root having a `<main>` with content, so UI changes don't break it.
To change what the screenshots (and the demo) show, edit `demo/data/*.json`: fictitious, generic, a bit cheeky about
university admin, never real people, course codes or student data. Dates are relative (`"@ms:-2d"`, `"@iso:+1d@23:59"`,
KU Loket `"day": 3`).

## Check

```bash
NODE_PATH=$(npm root -g) node website/tools/check.mjs          # add --shots for screenshots in website/.screens/
```

Every page in light/dark at 320/390/768/1440/2560: no horizontal scroll, no console errors, no requests outside the
site, images with alt/width/height, internal links and anchors resolve. Every page references only its own language's og/hero images. Theme toggle (every click flips the visible theme with
the system in light and in dark, icon/label/screenshot follow, stored choice applied before paint,
text/link/button contrast ≥ 4.5:1 in both themes), Lenis + anchor offset + keyboard scrolling, reduced motion (no Lenis, nothing hidden, no
running animations) and no-JS (nothing hidden). Demo: all routes, a course page and ⌘K in
NL/EN/FR, light/dark, desktop/phone, with no console errors and no requests outside the page origin; the demo bar's
"‹ Terug naar toledoplus.be" link (→ "‹ Home" at 320 px) and theme toggle (Light ⇄ Dark like the site, drives the app's appearance setting); motion stays on in the demo.

## The demo

`demo/index.html` loads `mock.js` + `demo.js`, which fake the bits of the extension platform the content scripts use
(`chrome.storage.sync/local`, `chrome.runtime.getURL/getManifest/sendMessage`) and then load the content scripts from
`demo/ext/` in `manifest.json` order. `TP.net` sees Toledo/Ultra/KU Loket as cross-origin and asks the "background
relay" (`chrome.runtime.sendMessage`), which the demo answers from `mock.js`. Links to Toledo, Ultra or a course's
journey link become in-page routes (`#/home?tplus=course&id=<learningUnitId>`); anything else shows a toast. Nothing in
`src/` knows about the demo. Settings and read state live in memory only and reset on reload.

`demo/ext/` is not in git: `.github/workflows/pages.yml` copies the extension files into the Pages artifact, so the
demo always runs the code on `main` (the workflow also runs when `src/**`, `manifest.json`, `ui.css`, `page.css` or
`icons/**` change).

### demo.toledoplus.be

GitHub Pages serves one custom domain, so the demo lives at `https://toledoplus.be/demo/`. To make
`demo.toledoplus.be` work too (Cloudflare, zone `toledoplus.be`):

1. **DNS → Add record:** type `AAAA`, name `demo`, IPv6 `100::`, **Proxied** (orange cloud). (A dummy target: Cloudflare
   answers before it is ever used.)
2. **Rules → Redirect Rules → Create rule:** *When incoming requests match* → Custom filter expression:
   `(http.host eq "demo.toledoplus.be")`. *Then* → Static, URL `https://toledoplus.be/demo/`, status **301**,
   *Preserve query string* on. Deploy.

## Publish on GitHub Pages

Deployment is done by `.github/workflows/pages.yml` on every push to `main` that touches `website/**` or the extension
files above (or manually via *Actions → Website → Run workflow*). It assembles `_site/` = `website/` minus `tools/`,
`README.md` and `.screens/`, plus `demo/ext/`.

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the workflow once). The first run creates the `github-pages` environment.
3. **Settings → Pages → Custom domain:** `toledoplus.be` → Save. (The `CNAME` file in this folder already says the same.)
4. Once the DNS check passes (can take up to 24 h): tick **Enforce HTTPS**.

### DNS records for toledoplus.be

At your domain registrar / DNS provider:

| Type  | Name  | Value |
|-------|-------|-------|
| A     | `@`   | `185.199.108.153` |
| A     | `@`   | `185.199.109.153` |
| A     | `@`   | `185.199.110.153` |
| A     | `@`   | `185.199.111.153` |
| AAAA  | `@`   | `2606:50c0:8000::153` |
| AAAA  | `@`   | `2606:50c0:8001::153` |
| AAAA  | `@`   | `2606:50c0:8002::153` |
| AAAA  | `@`   | `2606:50c0:8003::153` |
| CNAME | `www` | `joennespreuwers.github.io` |

- Remove any other A/AAAA/ALIAS records on `@` (e.g. a registrar parking page).
- `api.toledoplus.be` is the Cloudflare Worker for the anonymous usage ping and feedback. It is **not** part of GitHub Pages: do not point it at GitHub. If the zone is on Cloudflare, set the Pages records above to **DNS only** (grey cloud) so GitHub can issue the HTTPS certificate. (`demo` is the exception: it must be **Proxied** for the redirect rule.)
- Optional but recommended: verify the domain under your GitHub account (*Settings → Pages → Verified domains*) so nobody else can claim it.

## Things to update by hand

- **Download link** points to `https://github.com/joennespreuwers/toledo-plus/releases/latest/download/toledo-plus.zip`, so every release must have an asset named exactly `toledo-plus.zip`.
- **Privacy policy:** keep `privacy.html` (+ `en/`, `fr/`) in sync with `PRIVACY.md` and `manifest.json` (`host_permissions`, the usage ping). Update the "Laatst bijgewerkt" date.
- `sitemap.xml` `lastmod` when content changes.

Every text exists in three languages; change all three. The site says "KU Leuven en de associatie" and never claims
affiliation: Toledo+ is an unofficial student project.
