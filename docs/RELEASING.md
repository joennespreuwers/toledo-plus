# Releasen & wat er bij een feature mee moet

Toledo+ bestaat uit meer dan de extensie: de website, de demo, de API en de docs volgen mee. Deze lijst zorgt dat een
nieuwe functie overal klopt. De PR-template bevat dezelfde checklist in het kort.

## Wat automatisch gaat (niets doen)

| Wat | Hoe |
|---|---|
| Git-tag `vX.Y.Z`, zip (`toledo-plus.zip` + `toledo-plus-X.Y.Z.zip`), GitHub-release met notities uit `CHANGELOG.md` | `release.yml` zodra een gewijzigde versie in `manifest.json` op `main` landt (na de tests) |
| `api.toledoplus.be/v1/latest` → nieuwe versie ("Nieuwe versie beschikbaar" in de extensie) | `release.yml` → job *worker* (`wrangler deploy --var LATEST_VERSION:…`) |
| API-code (`worker/**`) deployen + schema toepassen | `worker.yml` bij elke wijziging op `main` |
| Website + demo publiceren, versienummer op de site, cache-busting van css/js/afbeeldingen en de og-afbeelding | `pages.yml` bij elke wijziging aan `website/**`, `src/**`, `manifest.json`, … |
| Tests (unit + e2e) op elke PR | `ci.yml` |

Eenmalig nodig (repo › Settings › Secrets and variables › Actions): `CLOUDFLARE_API_TOKEN` (sjabloon *Edit Cloudflare
Workers* + *D1 Edit*) en `CLOUDFLARE_ACCOUNT_ID`. Zonder die secrets wordt de API-stap overgeslagen (met een waarschuwing).

## Een release maken

1. In je PR: verhoog de versie in **`manifest.json` én `package.json`** (SemVer: fix → patch, functie → minor).
2. Verplaats de items onder `## [Unreleased]` in `CHANGELOG.md` naar `## [X.Y.Z] - JJJJ-MM-DD`.
3. Merge naar `main`. Klaar — de rest gebeurt automatisch.

## Checklist per nieuwe functie

| Als je… | …werk dan ook bij |
|---|---|
| iets toevoegt dat gebruikers zien | `CHANGELOG.md` (Unreleased), de functielijst op de website (`website/index.html`, `en/`, `fr/`), `README.md`/`README.en.md` |
| de UI zichtbaar verandert | screenshots + `og.png`: `NODE_PATH=$(npm root -g) node website/tools/screens.mjs`, daarna `node website/tools/check.mjs` |
| teksten toevoegt | alle drie de talen in `src/i18n/*.js` (NL, EN, FR) |
| een instelling toevoegt | standaardwaarde + migratie (versie verhogen) in `src/core/settings.js`, rij in `src/views/settings.js` (max. 10 groepen), test |
| nieuwe gegevens leest, een nieuwe host of een nieuw recht nodig hebt | `PRIVACY.md`, `website/privacy.html` + `en/` + `fr/`, `host_permissions`/`permissions` in `manifest.json`, `background.js`-allowlist, `tests/unit/manifest.test.js`, `AGENTS.md` (netwerkregel) |
| iets naar `api.toledoplus.be` stuurt | `worker/` + `worker/schema.sql` (idempotent: `IF NOT EXISTS`), `TP_API_PATHS` in `background.js`, privacypagina's |
| een `TP.*`-API, view-hook, opslagsleutel of laadvolgorde wijzigt | `docs/ARCHITECTURE.md` (addendum) en de volgorde-test in `tests/unit/manifest.test.js` |
| kleuren, type of componenten wijzigt | `docs/DESIGN.md` (contrasttabel!) en de website (`website/assets/site.css`) |
| de demo iets nieuws moet tonen | nepdata in `website/demo/data/*.json` (fictief, met de bekende grapjes) |
| een bestand toevoegt dat in de extensie moet | controleer dat `npm run pack` het meeneemt (alleen bestanden waarnaar het manifest verwijst) |

## Branches

`main` is beschermd; alles via een PR (zie `CONTRIBUTING.md`). Releases zijn gewone PR's met een versieverhoging.
