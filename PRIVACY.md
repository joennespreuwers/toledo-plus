# Privacy

**Kort / In short:** Toledo+ toont je eigen Toledo- en KU Loket-gegevens op een andere manier. Er gaat geen tracking van wie je bent naar buiten: enkel een anoniem dagelijks signaal dat je kan uitzetten, en feedback als je die zelf verstuurt. / Toledo+ shows your own Toledo and KU Loket data differently. Nothing that identifies you leaves your browser: only an anonymous daily signal you can turn off, and feedback when you send it yourself.

## Wat Toledo+ gebruikt / What Toledo+ accesses

| | |
|---|---|
| **Websites** | `https://toledo.kuleuven.be/*`, `https://ultra.edu.kuleuven.cloud/*`, `https://webwsp.aps.kuleuven.be/*` (KU Loket: timetable, exam schedule, iCal link — read only), `https://cloud.timeedit.net/*` (your public timetable feed — read only), `https://icts-p-toledo-valvas.cloud.icts.kuleuven.be/*` (Ad Valvas: the page of a school notice you open in Toledo+ — read only) and `https://api.toledoplus.be/*` (Toledo+'s own API: usage signal, update check, feedback — see below). These are the `host_permissions` in `manifest.json`. |
| **Rechten / Permissions** | `storage`, and `declarativeNetRequestWithHostAccess` for exactly one rule (`rules/landing.json`): `https://toledo.kuleuven.be/` → `https://toledo.kuleuven.be/portal/`, to skip Toledo's general start page (Settings → Geavanceerd → *Sla de Toledo-startpagina over*). Nothing is read, blocked or changed otherwise. |
| **Sessie / Session** | Your existing, logged-in Toledo session in your own browser. Toledo+ never sees or stores your password. |
| **Gegevens / Data read** | Your enrollments, notifications, today/tomorrow schedule, unread-mail count, Toledo links, course content, announcements, deadline dates and teacher names/e-mail – exactly what Toledo already shows you. Grades and submissions are never read. |
| **Gegevens / Data written** | Only when you ask for it (and only if Settings → Synchronisatie → *Gelezen markeren in Toledo* / *Mark as read in Toledo* is on): marking notifications read/seen/dismissed (or unread again with "Markeer als ongelezen"). This goes to Toledo's own API. KU Loket is only read, never written. |
| **Opslag / Storage** | Settings (language, appearance, nicknames, colours, own deadlines, …) in `chrome.storage.sync` – synced by your browser vendor between your own browsers if you have browser sync on. A cache of Toledo data, visit times and "done" marks in `chrome.storage.local` on your device. The **search index** for ⌘K (titles, kinds and folder paths of the items in your courses – no file contents) is also kept only in `chrome.storage.local` on this device; it is never synced or sent anywhere. Settings → Zoeken turns off the background indexing of all courses (courses you open are still indexed, so ⌘K finds their items); "Index opnieuw opbouwen" clears and rebuilds it. **Logging out through Toledo+** (account menu → Afmelden) deletes everything fetched for that user — the Toledo/KU Loket cache, the personal iCal link, the search index, the first name, recently opened documents and (when on) the file index — so the next person on a shared browser sees nothing of it; settings, own deadlines and done/read marks stay. |
| **Ad Valvas** | When you open an Ad Valvas notice in Toledo+, its message page (`/student/messages/{id}/external`: title, sender, recipients, date, attachment links and text) is read with your own Ad Valvas session and shown in Toledo+. Nothing else on that site is read, nothing is ever written. The text is kept **only in memory** for at most 30 minutes (never on disk, never synced or sent anywhere); images in the message are not loaded. If Ad Valvas needs you to sign in, Toledo+ opens the notice in a new tab so KU Leuven's own sign-in completes there — Toledo+ never sees your password. |
| **Downloads** | Files are fetched from Toledo's own (signed) file storage links and saved through your browser. |
| **Inhoud van bestanden / File contents** (opt-in) | Only if you turn on Settings → Zoeken → *Inhoud van bestanden doorzoekbaar maken* (or confirm *Doorzoek alle bestanden* on a course page): the text of course files you open or download through Toledo+ (and, for that course action, all PDF/Word/PowerPoint/Excel/text files of that course, at most 300 MB a day) is extracted **on your device** and stored in the extension's own IndexedDB, so ⌘K can search inside them. Files are fetched only from Toledo's own download links, like a normal download. The text **never leaves your browser**, is not synced and is not sent to the developer or anyone else. *Wis bestandsindex* deletes it; removing the extension deletes it too. No extra browser permissions are used for this (PDF reading uses Mozilla's pdf.js, bundled inside the extension). |

## Anoniem gebruikssignaal / Anonymous usage signal

To know how many students use Toledo+ (it is installed by hand, so there is no store count), Toledo+ sends **at most once a day** a small message to `https://api.toledoplus.be` (a Cloudflare Worker run by the maintainer):

| Sent | Example |
|---|---|
| A random install id, created on your device (not linked to you) | `3f6c…-…` |
| Toledo+ version | `1.4.0` |
| Browser family | `chrome`, `edge`, … |
| Interface language | `nl` |

- **Never sent:** your name, student number, e-mail, courses, grades, Toledo or KU Loket data, pages you visit or anything you do in Toledo+. No cookies.
- **IP addresses are not stored.** For rate limiting the server keeps only a daily counter under a one-way hash of the IP (for IPv6: its /64 network prefix) with a secret salt and the date, so it cannot be linked across days; counters are deleted after 2 days.
- **On by default, easy to turn off:** Settings → Over → *Anoniem gebruikssignaal*, or in the welcome card (a toast confirms it). Turning it off deletes the install id on your device and asks the server (`POST /v1/forget`) to delete its rows for that id; if that request fails it is queued and retried on every start until the server confirms. *Alles terugzetten* (reset) does the same, and never turns a switch you turned off back on.
- **Update check** (separate switch, on by default): twice a day Toledo+ asks `GET /v1/latest` which version is newest, to show "Nieuwe versie beschikbaar". This sends nothing about you. The banner only ever links to this repository on GitHub or to toledoplus.be.

## Feedback

Settings → Over → *Feedback* or the account menu → *Feedback*. What you type, plus (if you leave the box ticked) version, browser, language and the page you were on, goes to `api.toledoplus.be`. **The install id is never sent with feedback**, so feedback cannot be linked to the usage rows. A contact address is only sent if you fill it in, and is **never** published. Your message (with version, browser, language and page) may be posted as a public GitHub issue on this repository so it can be worked on — don't put personal data in it. User text is shown verbatim in a code block, so it cannot create links, images or references; at most a few issues a day are created (the rest stays private until triaged). Feedback works even with the usage signal off.

## Op de server / On the server (retention)

| What | Kept |
|---|---|
| Install id + version, browser, language, first/last seen; one row per active day | Until you turn the signal off or reset (→ `/v1/forget`); otherwise deleted 400 days after the last signal |
| Feedback (text, contact if given, version, browser, language, page) | Until triaged; ask for removal in a Discussion |
| Rate-limit counters (hashed IP prefix or global, per hour/day) | 2 days |

Processors: Cloudflare (Workers + D1, hosting the API) and GitHub (public feedback issues, this repository).

## Wat Toledo+ níet doet / What Toledo+ does not do

- No tracking of who you are, no ads, no third-party trackers or crash reporting.
- No third-party services, fonts or CDNs. All code ships inside the extension.
- No sharing of your Toledo or KU Loket data with the developer, KU Leuven, LUCA or anyone else.
- No remote code: the extension never downloads or executes code.

## Gegevens wissen / Deleting your data

Settings → Geavanceerd → **Alles terugzetten** (*Reset everything*): settings back to their defaults (your usage-signal and update-check choices are kept), own deadlines deleted, and everything Toledo+ stored in this browser wiped — cache, KU Loket data and iCal link, search and file index, state, and the install id (whose server rows are then deleted through `/v1/forget`). Or remove the extension (`chrome://extensions` → Remove). On the server only the rows in the table above exist; if you remove the extension without turning the signal off first, they expire after 400 days. For feedback removal, open a Discussion.

## Onofficieel / Unofficial

Toledo+ is an independent student project, not affiliated with KU Leuven, LUCA School of Arts or Blackboard / Anthology Inc.. Your use of Toledo remains subject to KU Leuven's own terms and privacy policy.

Questions: open a [Discussion](https://github.com/joennespreuwers/toledo-plus/discussions). Security issues: see [SECURITY.md](SECURITY.md).
