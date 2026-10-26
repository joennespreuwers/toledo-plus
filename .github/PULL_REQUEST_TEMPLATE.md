## Wat en waarom / What and why

<!-- Korte beschrijving. Link de issue: "Fixes #123". / Short description. Link the issue. -->

Fixes #

## Screenshots

| | Licht / Light | Donker / Dark |
|---|---|---|
| Desktop (1440) | | |
| Phone (390) | | |

## Checklist

- [ ] `npm test` slaagt lokaal (unit + e2e) / passes locally
- [ ] Nieuwe of gewijzigde teksten bestaan in **NL, EN en FR** / new strings in NL, EN and FR
- [ ] Screenshots in licht én donker (desktop en/of 390 px) / screenshots light and dark
- [ ] **Geen echte studentendata** in code, fixtures, tests of screenshots (alleen synthetische data, `example.edu`) / no real student data
- [ ] Geen netwerkverkeer buiten de toegestane hosts (manifest `host_permissions`), geen tracking / no traffic outside the allowed hosts, no tracking
- [ ] Remote HTML gaat door `TP.util.sanitize`, tekst door `TP.util.esc`
- [ ] Toetsenbord + schermlezer gecontroleerd (focus zichtbaar, labels) / keyboard + screen reader checked
- [ ] `CHANGELOG.md` bijgewerkt onder **Unreleased** / updated
- [ ] Kleine, gerichte PR (één onderwerp) / small, focused PR

### Ook bijwerken bij een nieuwe functie / Also update for a new feature — zie [docs/RELEASING.md](../docs/RELEASING.md)

- [ ] Nieuwe of andere gegevens/hosts/rechten → `PRIVACY.md` + `website/*privacy.html` (NL/EN/FR) + manifest-tests
- [ ] Zichtbaar voor gebruikers → functielijst op de website (NL/EN/FR) en README
- [ ] UI zichtbaar veranderd → screenshots + og-afbeelding opnieuw (`node website/tools/screens.mjs`)
- [ ] Nieuwe instelling → standaardwaarde + migratie in `settings.js`, rij in Instellingen, alle 3 talen
- [ ] Nieuwe `TP.*` API, view-hook of opslagsleutel → `docs/ARCHITECTURE.md`
- [ ] Versie **niet** verhoogd (behalve in een "Release X.Y.Z"-PR) — enkel een regel onder `## [Unreleased]`
