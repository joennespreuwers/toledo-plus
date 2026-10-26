# Werkplan v1.2–v1.4 (parallel)

Bron: `docs/REVIEW-2026-10-26.md`. De maintainer besliste: **alle bugs fixen**, **vastzetten (pin) verdwijnt** (zijbalk toont gewoon de huidige vakken in de gekozen volgorde; geen koppeling met Toledo-favorieten meer), **alle voorstellen uitvoeren**, geen issues aanmaken.

Scaffolding is al gedaan (niet opnieuw doen): routes `agenda` (vervangt `planning`, alias `planning → agenda` in `ROUTE_ALIASES` — nog te bedraden in `shell.js` routing) en `kuloket`; nav/tab-items; iconen `agenda`, `kuloket`; i18n `nav.agenda`, `nav.kuloket`; manifest: host permissions + content-script-volgorde met `src/core/kuloket.js`, `src/i18n/agenda.js`, `src/i18n/kuloket.js`, `src/views/agenda.js`, `src/views/kuloket.js` (+ css); relay-allowlist uitgebreid met `https://webwsp.aps.kuleuven.be` en `https://cloud.timeedit.net`. `src/views/planning.*` en `src/i18n/planning.js` staan niet meer in het manifest en worden door Agent B verwijderd.

## Eigenaarschap (strikt — enkel je eigen bestanden aanpassen)

| Agent | Bestanden |
|---|---|
| **A — Betrouwbaarheid (v1.2)** | `src/core/data.js`, `src/core/net.js`, `src/core/settings.js`, `src/core/index.js`, `background.js`, `tests/unit/**` (behalve nieuwe kuloket-tests), `tests/helpers/**` (mocks: alleen toevoegingen, overleg via docs), `.github/workflows/**`, `scripts/**`, `tests/fixtures/**` (fictieve codes) |
| **B — Agenda & KU Loket (v1.3)** | `src/core/kuloket.js`, `src/views/agenda.*`, `src/views/kuloket.*`, `src/i18n/agenda.js`, `src/i18n/kuloket.js`, verwijderen van `src/views/planning.*` + `src/i18n/planning.js`, `tests/e2e/agenda.e2e.js`, `tests/e2e/kuloket.e2e.js`, `tests/unit/kuloket.test.js`, `tests/fixtures/kuloket.json`; KU Loket-mocks in een NIEUW bestand `tests/helpers/kuloket-mock.js` dat `mock.js` optioneel inlaadt (één regel in mock.js toevoegen is toegestaan) |
| **C — UX-opschoning (v1.4)** | `src/core/shell.js`, `src/core/ui.js`, `src/core/palette.js`, `src/core/util.js`, `ui.css`, `page.css`, `src/views/{overview,deadlines,announcements,courses,course,settings}.*`, `src/i18n/{core,overview,deadlines,announcements,courses,course,settings,palette}.js`, `tests/e2e/{portal,settings,ultra,layout,palette,rail,sanitize}.e2e.js` |

Geen enkele agent draait git. Iedereen houdt `NODE_PATH=$(npm root -g) npm test` groen voor zijn deel; de maintainer integreert.

## Contract tussen B en C

`TP.kuloket` (Agent B, `src/core/kuloket.js`, laadt na data.js):
```
TP.kuloket.lessons({from, to}) → Promise<Lesson[]>      // cache-first; never throws (returns [] + status error)
  Lesson = { id, start(ms), end(ms), title (vak), courseCode, group, kind ('les'|'examen'), location:{room, building, street, city, mnemonic, url}, teachers:[name], courseLuId|null (match op code met TP.data.courses()), source:'kuloket'|'ics' }
TP.kuloket.peekLessons({from,to}) → Lesson[]|null        // sync, from cache, for first paint
TP.kuloket.exams() → Promise<Exam[]> ; TP.kuloket.peekExams()
  Exam = { id, start, end, title, courseCode, text, location, teachers, courseLuId }
TP.kuloket.status() → { lessons:{ok,error,t,source}, exams:{...}, icsUrl:boolean }
TP.kuloket.links() → [{id, title, url, group}]          // KU Loket-apps (deep links #zr_xxxx-display)
TP.kuloket.on('change', fn)
```
Agent C gebruikt in **Overzicht › Rooster**: `TP.kuloket?.peekLessons({from: startOfToday, to: +2d})` met fallback naar `TP.data.schedule()`; toont lokaal/docent indien aanwezig; link "Agenda ›" naar route `agenda`. In **Deadlines** toont C examens (`TP.kuloket?.peekExams()`) als aparte groep "Examens" bovenaan wanneer er zijn. In de **vakpagina** kan C de volgende les tonen (`TP.kuloket.peekLessons` gefilterd op courseLuId/code) in de zijkolom.

## KU Loket — geverifieerde API's (live, sessie = KU Leuven SSO in dezelfde browser)

Basis `https://webwsp.aps.kuleuven.be/sap/opu/odata/sap/`, altijd `?sap-client=200&$format=json`, header `Accept: application/json`. GET werkt zonder CSRF-token. Zonder sessie: redirect naar login (HTML) → behandelen als "niet aangemeld bij KU Loket".
- Uurrooster: `ZC_EP_SCHEDULE_SRV/Events?$skip=0&$top=5000&$filter=(date ge datetime'2026-10-24T00:00:00' and date le datetime'2026-12-07T00:00:00')&$expand=EventTeacherSet,EventLocationSet`
  Velden: `event_GUID, eventID, date:"/Date(ms)/"` (dag, UTC-middernacht), `start_time:"PT09H00M00S"`, `end_time`, `ola_description` (vaknaam), `ects_code`, `groupinfo_general` (vaak "Locatie: …"), `groupinfo_detail`, `workFormDesc`, `url_ects`, `event_type`; `EventLocationSet.results[]: buildingNumber, roomNumber, roomName, buildingName, city, street, mnemonic, url_location`; `EventTeacherSet.results[]: name, url_wiwo`.
  Live voorbeeld: "Jaarwerk 1", groupinfo_detail "Jaarwerk 1 Groep E1 Fictie 2 Locatie: Besmelaan 83, Vorst", lokaal "B8300.83A (83A - leslokaal)", docent "Vanpuyvelde Philippe".
- Examenrooster: `ZC_IER_SRV/EvaluationSet` (nu leeg buiten examenperiode) velden `evaluationId, moduleCode, moduleTitle, evaluationText, examDate, examBegtime, examEndtime, groupInfo, evaluationStatus, periodId, academicYear`; per examen `toLocation`, `toStaff` navigaties; `ZC_IER_SRV/AcademicCalSet` geeft periodes.
- iCal-link: `ZC_EP_ICAL_SRV/StudentSet` → `Schedulelink` = `https://cloud.timeedit.net/be_kuleuven/web/public/s.ics?sid=…&type=…&field=…&value=…` (publiek, werkt zonder sessie → fallback-bron; bewaar de link lokaal, nooit loggen/tonen volledig).
- ISP: `ZC_ISP_ST_OPO_SRV` vereist sleutels — v1.3: alleen deeplink.
- KU Loket-apps (deeplinks `https://webwsp.aps.kuleuven.be/sap/bc/ui2/flp?sap-language=NL#<id>-display`):
  Studie & Examens: zr_1027 Overzicht inschrijvingen, zr_1013 Persoons- en contactgegevens, zr_0202 Selfservice attesten, zr_1012 Privacy, zr_1006 Financiële gegevens, zr_0442 ISP, zr_0332 Vrijstellingen, zr_0363 Examenrooster (IER), zr_1017 Studievoortgangsdossier · Inschrijving & aanvragen: zr_1009 Herinschrijving, zr_0122 Uitwisseling, zr_1001 Studiefinanciering, zr_0187 Statuten/faciliteiten aanvragen, zr_0358 Faciliteiten inzetten, zr_1010 MOBIB · Agenda: zr_0367 Uurrooster kalender, zr_0216 Uurrooster lijst, zr_1014 Agenda sync iCal · Bevraging: zr_0171 Studentenbevraging, zr_0184 Study Tracker · Veiligheid: zr_0097 Gevaarlijke stoffen, zr_0275 Attest medisch onderzoek · Ondersteuning: zr_1015 Lokalen en bezetting, zr_1005 Melding technisch defect, zr_0424 Overzicht meldingen, zr_1003 ICT-ondersteuningspunten, zr_1004 Service Desk, zr_1002 Handleiding.
