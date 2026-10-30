# Changelog

Alle noemenswaardige wijzigingen aan Toledo+ staan hier. / All notable changes to Toledo+ are documented here.

Het formaat volgt [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) en het project gebruikt [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.7.0] - 2026-10-30

### Added
- **Zoeken, overal hetzelfde**: the toolbar search, the course search and ⌘K now match the same way: accents and word order don't matter ("chemie verslag", "economie"), course codes work with or without the space ("zx1003"), dates as you see them work ("morgen", "28 okt", "vr 30 okt", "30/10"), and one typo in a longer word still finds it ("programeren"). The same item is found by the same things everywhere (title, course, code, teacher/sender, date), and the matching words are highlighted.
- ⌘K finds KU Loket apps ("ISP", "MOBIB", "vrijstellingen") and individual settings ("iCal", "donker", "reset", "volledige tekst" open Instellingen at that section); view names also work in the other languages ("instellingen" in English).
- ⌘K shows 8 results per group and then "Nog n resultaten tonen" instead of silently dropping the rest; it opens with the text you already typed in the search field.
- **Afmelden wist je gegevens**: logging out through Toledo+ now deletes what was fetched for you (Toledo/KU Loket cache, your personal iCal link, the search index, your first name, recently opened documents) so the next person on a shared computer sees nothing of yours. Settings, own deadlines and done marks stay.
- Settings › Deadlines explains which deadlines you see and for how long; Advanced toggles each say what they do; "Alles terugzetten" says what it wipes.
- **Ad Valvas in Toledo+**: an Ad Valvas notice now opens with its full text, sender, recipients, date and attachments inside Toledo+ instead of only a link. The first time in a browser session Ad Valvas may ask you to sign in once: "Open en meld aan" opens the notice in a new tab (KU Leuven sign-in completes there) and when you come back Toledo+ loads it by itself. Needs one new read-only site permission (`icts-p-toledo-valvas.cloud.icts.kuleuven.be`, only the message page of a notice); the text stays in memory only (≤ 30 min), images in the message are not loaded.
- **Eigen deadlines bewerken**: in het detailvenster van een eigen deadline staat nu "Bewerk" (titel, vak, datum, uur), zonder te verwijderen en opnieuw toe te voegen. Verwijderen (in het venster of met ✕) geeft een melding met **Ongedaan maken**; een teruggezette deadline houdt zijn "Klaar".
- **Examens zijn volwaardig**: een examen opent een eigen venster (wanneer, hoe lang, lokaal, docent, "Zet in agenda", "Toon in agenda"); examens binnen 14 dagen staan bovenaan de Deadlines-kaart van het Overzicht en examens van vandaag/morgen in het Rooster; de Vak-filter op Deadlines toont het examen van dat vak in plaats van alle examens te verbergen.
- Deadlines › Te laat › "Ouder dan een week": één knop "Markeer deze n als klaar", met Ongedaan maken.
- Agenda: de getoonde datum staat in de link (`agenda&id=2026-11-09`); herladen of een gedeelde link opent dezelfde week, en ‹ › / j k zijn stappen in de geschiedenis (Terug gaat een week terug).
- Op een toestel dat niet op Belgische tijd staat, zeggen Deadlines, Agenda, KU Loket, het deadlinevenster en het formulier "Eigen deadline" in welke tijdzone de tijden staan (bv. "GMT+9").
- **Als gelezen markeren, met Ongedaan maken**: one "mark as read" everywhere that covers exactly what you see — under a search only the items found ("Markeer 5 gevonden als gelezen"), under a course filter only that course ("Markeer 3 als gelezen") — and a toast with **Ongedaan maken** (or ⌘Z / Ctrl+Z) for a few seconds. New: "{vak} als gelezen markeren" in an open Overzicht › Nieuw group, and "Markeer nieuw als gelezen" on the course page.
- Course page: jump chips (Inhoud, Deadlines, Mededelingen, Docenten) on phones; "Alle 19 mededelingen van dit vak" when a course has more than 8 (opens Mededelingen filtered on that course).
- Overzicht › Rooster shows KU Loket exams of today and tomorrow.
- Mededelingen and the Overzicht card show who sent an announcement (the search already matched it).
- **Mededeling openen = een venster**: every announcement (Mededelingen, Overzicht, the course page, ⌘K) opens in a sheet with title, course/source and colour dot, author, date, the full text, attachments, "Open in Ultra"/"Open in Ad Valvas" and "Markeer als ongelezen". Step through the current (filtered/searched) list with ↑/↓ or j/k or the arrow buttons; Esc returns to the row. Scale/fade on desktop, slides up from the bottom on phones. Opening marks it read (as before).
- "Kopieer link" in the deadline and announcement sheets: copies the item's Toledo link, to send to a groupmate.
- ⌘K results are real links: middle-click or Ctrl/⌘-click opens a result in a new tab, right-click copies its link (Ctrl/⌘-click on a file still downloads it).
- The slim bar on other Toledo pages links to Instellingen and has a ✕ to hide itself (turn it back on in Instellingen › Geavanceerd).

### Changed
- Feedback never includes your usage-signal id any more; the page you were on is only sent with "Stuur versie, browser, taal en pagina mee". The sheet and the privacy page say what may become a public GitHub issue.
- Done deadlines stay under "Klaar" for 120 days after their due date (was 7), so a tick on an old item can be undone. Unfinished Toledo work from up to 120 days ago is found on the first load and once a day (was 14 days). Your own deadlines far in the future show on the Deadlines page.
- Teacher-written HTML (announcements, pages): remote images load lazily without sending the page address, audio/video never start or download by themselves, tracking attributes (`ping`, `referrerpolicy`, `srcset`, …) are removed; in-page `#links` stay in the page and relative links point to Ultra.
- Privacy page, terms, PRIVACY.md and SECURITY.md describe what the code does: update check, the one redirect permission, what is on the server and for how long, real Settings labels.
- API: rate limits per IPv6 /64 instead of per address, no limit trusts the (forgeable) Origin or install id, at most a few public GitHub issues per day from feedback, and feedback text in issues can no longer create links, images or cross-references.
- "Te laat" and "binnenkort" are told by the word, not only by the row tint: "3 d te laat" in red and "morgen / over 3 d" in amber, semibold, with a small alert/clock glyph (readable in greyscale, on a projector and in Windows High Contrast).
- Vakkleuren: rood, roze, oranje en geel zijn geen vakkleur meer (ze betekenen "te laat"/"binnenkort"); mint en cyaan (bijna gelijk aan blauwgroen/blauw) zijn vervangen; nieuw zijn marineblauw, bosgroen, pruim, olijf, leisteen en lavendel. Standaardkleuren van vakken kunnen daardoor veranderen; een kleur die je zelf koos blijft.
- KU Loket: de app-tegels gebruiken dezelfde accenttegel als de rest van Toledo+ in plaats van zes felle kleuren (rood was dezelfde als "te laat").
- Paginakop: de ondertitel en "Bijgewerkt hh:mm" staan op één regel, en paginaknoppen staan overal op de hoogte van de titel. "Bewerk" (Vakken) heeft een potlood-icoon zoals de andere paginaknoppen.
- Tekst onder 20 px heeft geen negatieve letterafstand meer (leesbaarder).
- Op touchscreens toont de ingeklapte zijbalk de namen onder de iconen en de aantallen als getal, en de "zijbalk"-knop op een vakkaart heeft een bijschrift. "Zet in zijbalk" toont een melding, en staat niet meer op de vakpagina op een telefoon (daar is geen zijbalk).
- "Binnenkort" (morgen, over 3 d) volgt hetzelfde patroon als "te laat", in amber: de rij krijgt een lichtgele achtergrond en de tijd staat in dezelfde stijl als de andere tijden (geen klok-icoon). Overzicht, Deadlines (ook examens binnen 3 dagen) en de vakpagina.
- Announcements no longer expand inline (Mededelingen and course page); Ad Valvas rows no longer leave Toledo+ on a plain click (⌘/Ctrl-click still opens the original page in a new tab).
- Course announcements from the portal now find their text also when the event links to a generic Ultra page (by id from the event, else by title in the course's announcements).
- "Zet in agenda" op Deadlines en in de Agenda zet hetzelfde in het bestand: openstaande, komende deadlines **én examens** (Deadlines volgt de Vak-filter en noemt het bestand dan naar het vak). Een examen heet in je agenda "Examen: …" en krijgt de herinnering uit Instellingen. De melding zegt dat het bestand een momentopname is.
- Agenda: met Werkweek (ma–vr) zegt een regel hoeveel er in het weekend valt (examen apart vermeld), met "Toon hele week". "Niets gepland" staat boven de kalender in plaats van als zwevend label over het rooster of de dagnummers. Op grote schermen toont de tijdlijn meer dan 11 uur. Een snelle korte veeg wisselt niet meer van week (minstens een kwart van de breedte). ‹ › en j/k stoppen twee jaar voor en na vandaag. Chips in week/maand tonen de volledige tekst bij hover; een deadline-chip zegt "tot 23:59".
- Datums en uren hebben één schrijfwijze (rijen "wo 28 okt 23:59", vensters "Woensdag 28 oktober · 23:59"; het jaar erbij als het niet dit jaar is); een les of examen dat na middernacht eindigt, toont "(+1)".
- Back closes an open deadline/announcement sheet and stays on the page (the sheet has its own history entry). Vakken › Bewerk is in the URL, so reload and Back keep or leave it.
- "Klassieke Toledo" says what it does: a short message by the Toledo+ button explains that classic Toledo stays on until you click Toledo+, and the button gets focus and is named "Terug naar Toledo+". One label everywhere ("Klassieke Toledo"; the sidebar footer said "Klassiek").
- Tab titles name the page ("Overzicht · Toledo+" instead of the greeting); sub-pages keep their parent ("Secties · Instellingen · Toledo+").
- Landscape phones and 200% zoom get the tab bar (slimmer there) instead of a sidebar rail that ran off the screen. On touch screens the collapsed sidebar shows small names under its icons; its counts show the number instead of a dot. The phone "Meer" tab gets a dot when announcements are unread. On 4K/ultrawide screens the content column uses more of the width.
- Rail initials skip little words ("Inleiding tot de economie" → IE, not IT).
- Wording: "1 dag te laat"/"over 3 dagen"/"2 dagen geleden" instead of "1 d", "3 d"; recent items say "3 dagen geleden" instead of a weekday next to "gisteren"; "Alles als gelezen markeren" (was "Alles gelezen"); "Klaar" in Vakken › Bewerk (was "Gereed"); one "opent in een nieuw tabblad"; a deadline's source reads "Toledo" (not "Toledo-melding"); "bestanden" instead of a mix of documenten/index/bestandsindex in search; ".ics-bestand" explained in Settings; "Ad Valvas" explained in English and French; the night greeting is "Hallo" instead of "Goedenacht"; French status and feedback wording.

### Fixed
- Deadlines search: after a query that hid a whole section (e.g. "Te laat"), the next query found nothing in that section and showed no "Geen resultaten" either. Sections are now checked again on every query.
- ⌘K: a query that only matches a course name no longer fills Documenten with every file of that course; "[" or "1" no longer list everything; a pasted wall of text is cut off in the "Geen resultaten" line; "Geen resultaten" while documents are still being indexed says so, with a hint what you can search for; the palette closes when you go Back; the placeholder ends in "…" on narrow phones.
- The empty search state shows your query as you typed it (not lowercased).
- **"Alles terugzetten" turned the anonymous usage signal and the update check back on.** It now keeps those choices, and really wipes everything Toledo+ kept in this browser (cache, KU Loket, indexes, install id — whose server copy is deleted too); the page reloads and confirms. The confirm button says how long it stays armed and announces when it disarms.
- Turning the usage signal off is confirmed with a message, and if the server could not be reached the deletion request is retried on every start until it succeeds.
- Importing settings: a file that is not a Toledo+ export, or one with invalid values (`"appearance":"banana"`, `"courses":null`), is refused with a message that says why, and nothing changes; a partial export now only changes what it contains (own deadlines are merged).
- An iCal link that is not a calendar feed (no `.ics` in the path) is no longer saved.
- The update banner only links to this project's GitHub page or toledoplus.be, also when a URL tries to escape with `../`.
- **KU Loket onbereikbaar** zei "Nog geen examens gepland" en "Vandaag geen lessen". Nu: "KU Loket is niet bereikbaar…" met **Opnieuw** (en bewaarde gegevens met die melding erbij); tijdens het laden een laadbalk in plaats van "geen examens".
- **Deadlinevenster bij weinig hoogte** (150 % zoom op 1366×768, 1366×600, 200 % zoom): "Markeer als klaar" en "Zet in agenda" vielen weg zonder te kunnen scrollen. Het venster scrolt nu; bij genoeg hoogte blijven de acties onderaan zichtbaar onder een lange opdrachttekst.
- Overzicht en Deadlines worden om middernacht en op het moment dat een deadline verstrijkt opnieuw getekend ("vandaag", "Te laat", de datum, de begroeting, de rode badge), ook als het tabblad open blijft; terugkomen op een andere dag tekent meteen opnieuw.
- "N d te laat" telt kalenderdagen (zoals "gisteren" en "over 3 d"): een deadline van dinsdag is woensdag de hele dag "1 d te laat".
- Zomer-/wintertijd: op 25 oktober en 28 maart staan lessen in de Agenda op het juiste uur (ze stonden een uur verschoven t.o.v. de uurlijnen); Rooster "Morgen" en KU Loket "Vandaag" gebruiken kalenderdagen (de nacht van de omschakeling toonde twee keer dezelfde dag of sloeg er een over).
- Een eigen deadline op een uur dat niet bestaat (de klok gaat vooruit) meldt "Bewaard om 03:30".
- Een eigen deadline ver in de toekomst (of in het verleden) staat nu in de lijst (in zijn eigen week, of bij "Te laat"), in plaats van alleen "toegevoegd" te melden.
- "Klaar" op een deadline die meer dan een week te laat is, laat hem niet meer uit elke lijst verdwijnen: hij blijft onder "Klaar" (tot 120 dagen).
- Deadlines › kop toont geen "0 open" meer als het laden mislukte.
- Deadlines past op 320 px (de Vak-keuze maakte de pagina breder).
- Agendabestanden: herinnering precies zo ver vóór de deadline als ingesteld (was 30 min vroeger); een ingevoegde regeleinde (CR) uit KU Loket/TimeEdit kan geen extra regels meer in het bestand zetten; lange regels worden per byte gevouwen (geen gebroken tekens); bestandsnaam afgekapt op een woordgrens; PRODID volgt de taal.
- Agenda: na een veeg naar de volgende week ging een tik tot ~1 s verloren; een herteken zonder nieuwe gegevens laat de pagina nu ongemoeid.
- Agenda › Ga naar datum: een ongeldige of te verre datum geeft een melding in het venster; open pop-overs schuiven mee als het venster van grootte verandert; de dagtitel op de telefoon is kort (geen verspringende werkbalk).
- Focus never drops to the top of the page after a re-render any more (one shared helper): after "Alles gelezen", "Klaar" in a deadline sheet, removing the iCal link, "Later" on the update banner, changing the language with the keyboard (focus stays on the language choice), moving a course in Vakken › Bewerk (focus follows the course) and switching to classic Toledo (focus lands on the "Toledo+" pill, now named "Terug naar Toledo+").
- Agenda mini calendar: one Tab stop instead of 42; the arrow keys move between days (Home/End, PageUp/PageDown for the month).
- Windows High Contrast (forced colours): switches, segmented controls, colour swatches, course dots, the mini-calendar selection, buttons, badges and the search field stay visible.
- Screen readers: a switch is named by its title only (the help text is its description); section counts are read as ", 3 items" instead of being glued to the heading ("Week van 16 nov 1"); "Geen resultaten" is announced; "Download" and "Open Ultra" in banners say they open a new tab.
- Printing: always the light palette (also in dark mode), without the sidebar, toolbar, filters, add form or row buttons; rows and headings stay together across pages; the Agenda prints the whole day instead of 11 hours, without the side column.
- Buttons had lost their font weight when they were a `<button>` (e.g. "Alles gelezen" 400 next to "Alle deadlines" 500); one "opens elsewhere" icon size and colour everywhere; the form fields of "Eigen deadline toevoegen" are all 36 px with the same select chevron; deadline and lesson titles on the course page use the body weight like everywhere else; KU Loket "Agenda" lost its typed "›".
- Touch: icon buttons (toolbar, done checkbox, open-in-Toledo, icon buttons) have a 44 px hit area on touch screens.
- "Alles gelezen" heet nu "Alles als gelezen markeren" (het is een actie, geen status). Overzicht › Nieuw zegt in één regel wat het telt; "Alle mededelingen" toont hoeveel er ongelezen zijn.
- The course header's "n nieuw" counts exactly the rows with a dot (new files/pages + unread announcements); Toledo notifications without a row on the page are shown apart as "+n meldingen".
- Vakken › Bewerk: rows use the page width, the controls line up with the nickname field, the row shows the official course name, and the help text says what Verbergen does (and doesn't) hide. Bewerk is part of the URL (a reload keeps it). Red and pink are no longer offered as course colour (they mean "te laat"); colours other courses use are dimmed and named "in gebruik".
- Course avatars in the collapsed sidebar use letters only, skip words like "tot de", keep a number ("Wiskunde II" → W2) and never repeat within the list.
- The update banner's "Later" is now "Verbergen" (it hides that version for good) and focus no longer drops to the page start.
- A very long course name is shown on two lines (full name in the tooltip). The tab title of Overzicht is "Overzicht", not the greeting.

### Fixed
- "Mark all read" in Mededelingen with a course picked marked every course; in Overzicht with a search active it marked everything; with "Markeer gelezen in Toledo" off the same announcements stayed unread elsewhere. Under "Ongelezen" the heading kept the old count and the rows stayed; focus dropped to the page start. When Toledo can't be told, a message now says it will be updated later.
- A failed ↻ no longer toasts "Bijgewerkt" with the current time; it says Toledo couldn't be reached and since when you're looking at saved data. A stamp from another day shows the date ("Bijgewerkt ma 26 okt 14:05"). Overzicht no longer stacks three error messages (and two "Bijgewerkt") over data that is still shown; Deadlines no longer says "0 open" when nothing could be loaded.
- A failed file download says "Download mislukt" instead of opening a tab with the error.
- Course page: an unread announcement gets its dot (also on a first visit); "Zoek in dit vak" no longer lists files twice, opens a page whose text matches, and repeats your query as typed; "Zet in zijbalk" confirms itself (also on a phone); file rows have one clean screen-reader name; the link under a page says "Open in Toledo"; forum/journal items are no longer called "Pagina"; deep folders keep room for their names on phones.
- Announcement and page texts keep bullets, numbering and nested lists, table borders, and long code lines scroll instead of being cut off. In-page "#…" links no longer open a duplicate tab; relative links in Ultra texts point to Ultra.
- Courses that share a Toledo colour number get different colours, as intended.
- Hiding every course leaves "Alle vakken zijn verborgen" with a "Toon alle vakken" button instead of an empty page. Imported nicknames are cut to 60 characters.
- Feedback: Escape, Annuleren and ✕ keep what you typed for the next time; closing while it sends still tells you the outcome; too long a message is no longer cut silently (and emoji count once); after an extension update it says to reload instead of "try again". The onboarding card links straight to Instellingen › Over.
- The first-start splash now always removes itself shortly after its planned end, even if its fade-out animation never reports back.
- A click outside the open account menu only closes the menu; it no longer also activates what was under the pointer.
- ⌘K closes when you go Back; an unknown Toledo+ address shows the start page and corrects the URL.
- Keyboard hints follow your OS: ⌘ on macOS, Ctrl+ on Windows/Linux. On a Mac Toledo+ showed "Ctrl K" because Chromium reports the platform as "macOS" (lowercase "mac"); every "⌘" in texts (⌘K, ⌘↵, ⌘\) now adapts.
- Website, installer: step 2 now says how to unzip (Windows: right-click → *Alles uitpakken*; Mac: double-click) and warns not to load Toledo+ from inside the zip; steps 2/5 and "Updaten" match the zip (a folder `toledo-plus` with `manifest.json`); Edge visitors see `edge://extensions` and Edge wording; an honest "a few minutes" with the developer-mode note up front; phones get a "install on a computer" note.
- Website: a menu on narrow screens instead of losing the section links; the header button says "Installeren" (it scrolls to the guide); the language switch keeps the section you are on; header links and copy feedback are accessible (≥ 24 px, "Gekopieerd" announced, forced-colors borders); the theme toggle's name says what it does and no longer shows as a dead circle on the privacy/terms pages; the 404 page speaks your language and has a working theme toggle; NL demo links open the Dutch demo; the FAQ puts "remove the extension" first; the search card says file contents are opt-in.
- Demo: the demo bar sits inside `<body>` with a skip link, follows a language change made in the app's settings (bar, URL, `<html lang>`, title), shows a loading line while the app starts, and "Klassieke Toledo" shows a short explanation with a way back instead of an empty page.

## [1.6.0] - 2026-10-27

### Changed
- Alle tabbladen gebruiken dezelfde breedte: Deadlines, Mededelingen, KU Loket en Instellingen springen niet meer naar een smallere kolom.
- Geen losse kleine teksten meer onderaan de pagina, ver van waar ze over gaan: de uitleg over het agendabestand staat in de melding na het downloaden, "alleen-lezen" bij KU Loket staat onder de titel, en herhaalde of overbodige hints (Agenda: iCal en sneltoetsen, Deadlines: "Klaar", Mededelingen: nieuw tabblad) zijn weg.
- Examens en lessen zien er overal hetzelfde uit: KU Loket gebruikt dezelfde rijen als Deadlines (examens) en Overzicht (lessen).
- "Te laat" is rustiger en zegt hoeveel: de rij krijgt een lichtrode achtergrond en toont "3 d te laat" (zonder ⚠-icoon, in dezelfde stijl als de andere tijden), overal hetzelfde (Overzicht, Deadlines, vakpagina, details). De gekleurde rand links van examens en "Te laat" is weg.
- Overzicht › Rooster: één kaart met "Vandaag" en "Morgen" erin, die gelijk begint met de kaart Deadlines ernaast; "Agenda" staat als knop in de sectiekop zoals bij de andere secties. "Alle deadlines" en "Alle mededelingen" staan er ook als knop in de sectiekop, niet meer als rij in de kaart.
- Agenda: "vandaag" (datum, minikalender, kolom, tijdlijn) is oranje in plaats van rood, en "Examen" in de details is niet meer rood: rood betekent alleen nog "te laat".
- De scheidingslijnen tussen rijen lopen overal over de volle breedte van de kaart (ze begonnen op wisselende plekken).
- Overzicht › Nieuw: de aantallen staan nu rechts onder elkaar, ook als de tijd ernaast "16:21", "gisteren" of "donderdag" is.
- Mededelingen: één filterlijst naast de lijst (Alles, Ongelezen en per vak of Ad Valvas, met aantallen; op de telefoon gewoon Alles | Ongelezen) in plaats van tabs; rijen tonen het vak met zijn kleur, de tijd rechts ("vandaag", "gisteren", "3 d geleden", exacte tijd bij hover) en "Nieuw" als pil in plaats van een oranje stip; titels blijven één regel; "Alles gelezen" staat bij de lijst. ⌄ leest een mededeling hier, ↗ opent Ad Valvas in een nieuw tabblad. Ook de kaart op het Overzicht.
- Paginaknoppen staan overal op dezelfde plek in dezelfde stijl: op de vakpagina staan "Zet in zijbalk" en "Klassieke Toledo" nu rechts van de titel zoals op de andere pagina's; "Doorzoek alle bestanden" is een gewone knop.

### Fixed
- `npm run dev` reloaded the extension endlessly since 1.5.1: Chrome writes the compiled network rules into `_metadata/`, which the file watcher saw as a change. That folder is now ignored, and no longer tracked in git (`.gitignore`), so working trees stay clean.

## [1.5.1] - 2026-10-26

### Changed
- The tab always shows the Toledo+ icon, on the portal and in Ultra (no more Toledo/Blackboard favicon).
- The mail badge shows the real number of unread e-mails instead of "99+".

### Fixed
- KU Loket afgemeld: Toledo+ vroeg het rooster om de paar minuten opnieuw op, en elke poging liet een aanmeldcookie achter. Na een tijd weigerde KU Loket alles (ook zelf aanmelden) met "Bad Request · Size of a request header field exceeds server limit". Nu stopt Toledo+ na één "niet aangemeld" 30 minuten met vragen (gedeeld over tabbladen); wie via "Aanmelden bij KU Loket" aanmeldt en terugkomt naar Toledo, of op "Opnieuw" klikt, krijgt meteen het rooster.
- Going to toledo.kuleuven.be now really skips the start page: a network-level redirect (declarativeNetRequest, exact URL only, no extra install warning) instead of only a content script. Still switchable in Settings › Geavanceerd.
- Zonder Ultra-sessie (Ultra nog niet geopend sinds het aanmelden) toonde Toledo+ "Je sessie is verlopen" terwijl Toledo gewoon werkte, en "Log opnieuw in" hielp niet. Nu verschijnt "Nog niet aangemeld bij Ultra" met een knop "Open Ultra"; terug in Toledo laden de deadlines vanzelf.
- The logo illustration in empty states was squished; it now uses the logo's real proportions.
- Website: stylesheets, scripts and images are versioned per deploy, so a fresh page never combines with a cached old stylesheet (the logo sat on the left).

### Added
- `npm run dev`: opens Chrome with the extension and reloads it on every save (web-ext, dev only; persistent profile in `.dev-profile/`).
- Releases are automatic: bumping the version in manifest.json on main tags the release, builds the zip and updates api.toledoplus.be's "latest version". worker/** changes on main deploy the API (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID secrets).

## [1.5.0] - 2026-10-26

### Added
- Zoeken in de inhoud van bestanden (⌘K › "In bestanden"): pdf, Word, PowerPoint, Excel en tekst, met paginanummer (of dianummer) en een gemarkeerd fragment; ↵ opent de pdf op die pagina, ⌘↵ downloadt. Opt-in via Instellingen › Zoeken › "Inhoud van bestanden doorzoekbaar maken"; bestanden die je via Toledo+ opent of downloadt worden meegenomen, en "Doorzoek alle bestanden" op een vakpagina leest alle bestanden van dat vak (één per keer, als je tabblad rust, max. 300 MB per dag). Alles blijft op je toestel; "Wis bestandsindex" verwijdert het. PDF-tekst via Mozilla's pdf.js (Apache-2.0), meegeleverd in de extensie; geen extra rechten.
- Toledo's startpagina wordt overgeslagen: je gaat meteen naar je overzicht of de aanmelding (uit te zetten in Instellingen › Geavanceerd › "Sla de Toledo-startpagina over"). "Herstel standaardinstellingen" wist ook de bestandsindex.
- **Brand (brandguide v1.0)**: Toledo+ now looks like itself, not like Toledo. The woven-plus logo (tile below 32 px, glyph above) and the "Toledo+" wordmark in the sidebar, icon rail, phone toolbar, deep bar, classic-mode pill and Instellingen › Over ("Onofficieel studentenproject" + version); a quiet "Toledo+ 1.4.0 · Klassiek" signature at the bottom of the sidebar.
- **Inter** everywhere in the app (self-hosted, OFL; declared in the document because Chrome ignores fonts inside shadow roots), with per-size tracking and tabular numbers for counts, times and dates.
- **Welcome card** is a branded intro: ink card with the logo, a short "this isn't Toledo, it's Toledo+" line, the three tips, the privacy line and one orange button.
- First start without cached data shows a short branded splash (≤ 0.4 s; fades only with reduced motion) instead of an empty shell. Empty states get a small illustration made from the logo's pills.
- Website: Inter self-hosted, brand colours and logo, dark mode on ink, a light/dark/system **theme toggle** (remembered, applied before the first paint, also drives the demo), entrance and scroll-reveal motion with the app's timings, smooth wheel scrolling (Lenis, self-hosted; off with reduced motion and on touch), animated FAQ and "Gekopieerd" feedback. The demo bar gets "‹ Terug naar toledoplus.be" and the same theme toggle; the og image is rebranded.

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
- **Colours**: the default accent is now Toledo+ orange (links #C2410C in light, #F5A35F in dark; filled buttons orange with ink text). Settings v5 switches installs that still had the old default blue to the brand accent once; other accent choices stay, and blue can be picked again. Light mode uses warm neutrals and ink text; dark mode sits on brand ink (#12151C / #1F2430 / #283040) instead of black and grey. Cards get soft layered shadows in light and hairlines in dark; icon tiles, switches, selection, focus ring and scrollbars follow the brand.
- **"Binnenkort" is amber, not orange** (clock icon + date), so a deadline state never looks like the accent; "te laat" keeps red with a warning icon and the word.
- Course page rows and teacher links: the accessible name now starts with the visible text ("Slides.pdf, openen") instead of "Open Slides.pdf" (WCAG 2.5.3); same for the ⌘K button in the search field.
- Loading shimmer stops after a few sweeps and the refresh spinner after ~10 s, so nothing keeps repainting the page; FLIP ghosts measure before they write (one layout instead of one per removed row).

- The sidebar "Vakken" group lists only the courses you added and is hidden when there are none (settings v4: existing installs start with an empty group).
- **Layout on wide screens**: one centred content column (max 1240 px: main + side column) right of the sidebar instead of a strip next to an empty area; list views (Deadlines, Mededelingen, KU Loket, Instellingen) use a centred 760 px column. The toolbar's controls line up with the content edge at every width.
- Spacing pass along the design scale: welcome card padding and button spacing, side column width (280–340 px), day headers aligned with section titles, settings section gap.
- **Feels faster**: the course page shows its name, code and semester right away from cache (Ultra), "loading" is announced to screen readers (`aria-busy`), resting on a course link resolves the course so a click goes straight to the Ultra outline (no journey redirect), and going back restores where you had scrolled.
- Content-tree folders open with a fade instead of a height animation (smooth on slow laptops); small disclosures (Nieuw groups, documents, announcements, "Ouder dan een week") animate their height.
- KU Loket signed out: the timetable switches to your iCal feed on its own, keeps room, address and teachers for weeks seen earlier in KU Loket, and says so in one quiet line. The iCal link is re-read from KU Loket every 7 days.

### Fixed
- The overdue date tile's month label reaches 5.9:1 (was 4.35:1 at 11 px).

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
