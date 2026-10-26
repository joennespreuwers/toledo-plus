# toledoplus.be

The product website for Toledo+: plain static HTML/CSS with a few lines of JS. No build step, no external fonts/CDNs, no cookies, no analytics.

```
index.html            NL (primary)          en/index.html, fr/index.html
privacy.html          privacy policy (NL)   en/privacy.html, fr/privacy.html
404.html              served by GitHub Pages for unknown paths (root-absolute URLs)
assets/site.css       design tokens + layout (light/dark via prefers-color-scheme)
assets/site.js        copy buttons + reveal-on-scroll (optional; the site works without JS)
assets/img/           screenshots (WebP + PNG fallback, light/dark) and og.png (1200×630)
CNAME                 toledoplus.be
robots.txt, sitemap.xml, favicon.ico, apple-touch-icon.png
```

All screenshots use synthetic data (copied from `tests/artifacts/`). Keep the whole site under ~3 MB.

## Preview locally

```bash
cd website
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

Deployment is done by `.github/workflows/pages.yml` on every push to `main` that touches `website/**` (or manually via *Actions → Website → Run workflow*).

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
- `api.toledoplus.be` is the Cloudflare Worker for the anonymous usage ping and feedback. It is **not** part of GitHub Pages: do not point it at GitHub. If the zone is on Cloudflare, set the Pages records above to **DNS only** (grey cloud) so GitHub can issue the HTTPS certificate.
- Optional but recommended: verify the domain under your GitHub account (*Settings → Pages → Verified domains*) so nobody else can claim it.

## Things to update by hand

- **Version number** (hero line and download card) in `index.html`, `en/index.html`, `fr/index.html` (search for `1.1.0`, also in the JSON-LD `softwareVersion`).
- **Download link** points to `https://github.com/joennespreuwers/toledo-plus/releases/latest/download/toledo-plus.zip`, so every release must have an asset named exactly `toledo-plus.zip`.
- **Privacy policy:** keep `privacy.html` (+ `en/`, `fr/`) in sync with `PRIVACY.md` and `manifest.json` (`host_permissions`, the usage ping). Update the "Laatst bijgewerkt" date.
- **Screenshots:** re-export from `tests/artifacts/` (synthetic data only) as WebP (quality ~80) + PNG fallback for light; dark variants only need WebP. Keep `width`/`height` attributes at 1440×900 (phone 390×844).
- `sitemap.xml` `lastmod` when content changes.

Every text exists in three languages; change all three.
