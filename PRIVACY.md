# Privacy

**Kort / In short:** Toledo+ toont je eigen Toledo- en KU Loket-gegevens op een andere manier. Er gaat geen tracking van wie je bent naar buiten: enkel een anoniem dagelijks signaal dat je kan uitzetten, en feedback als je die zelf verstuurt. / Toledo+ shows your own Toledo and KU Loket data differently. Nothing that identifies you leaves your browser: only an anonymous daily signal you can turn off, and feedback when you send it yourself.

## Wat Toledo+ gebruikt / What Toledo+ accesses

| | |
|---|---|
| **Websites** | `https://toledo.kuleuven.be/*`, `https://ultra.edu.kuleuven.cloud/*`, `https://webwsp.aps.kuleuven.be/*` (KU Loket: timetable, exam schedule, iCal link — read only), `https://cloud.timeedit.net/*` (your public timetable feed — read only) and `https://api.toledoplus.be/*` (Toledo+'s own API, see below). These are the `host_permissions` in `manifest.json`. |
| **Sessie / Session** | Your existing, logged-in Toledo session in your own browser. Toledo+ never sees or stores your password. |
| **Gegevens / Data read** | Your enrollments, notifications, today/tomorrow schedule, unread-mail count, Toledo links, course content, announcements, deadline dates and teacher names/e-mail – exactly what Toledo already shows you. Grades and submissions are never read. |
| **Gegevens / Data written** | Only when you ask for it (and only if *Sync with Toledo* is on): marking notifications read/seen/dismissed. This goes to Toledo's own API. KU Loket is only read, never written. |
| **Opslag / Storage** | Settings (language, appearance, nicknames, colours, own deadlines, …) in `chrome.storage.sync` – synced by your browser vendor between your own browsers if you have browser sync on. A cache of Toledo data, visit times and "done" marks in `chrome.storage.local` on your device. The **search index** for ⌘K (titles, kinds and folder paths of the items in your courses – no file contents) is also kept only in `chrome.storage.local` on this device; it is never synced or sent anywhere. Settings → Zoeken turns off the background indexing of all courses (courses you open are still indexed, so ⌘K finds their items); "Index opnieuw opbouwen" clears and rebuilds it. |
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
- **IP addresses are not stored.** For rate limiting the server keeps only a one-way hash of the IP with a salt that changes every day, so it cannot be linked across days.
- **On by default, easy to turn off:** Settings → Over → *Anoniem gebruikssignaal*, or in the welcome card. Turning it off deletes the install id on your device and asks the server to delete its rows for that id.
- **Update check** (separate switch, on by default): Toledo+ asks `GET /v1/latest` which version is newest, to show "Nieuwe versie beschikbaar". This sends nothing about you.

## Feedback

Settings → Over → *Feedback* or the account menu → *Feedback*. What you type, plus (if you leave the box ticked) version, browser and language, goes to `api.toledoplus.be`. A contact address is only sent if you fill it in, and is **never** published. Your message itself may be posted as a public GitHub issue on this repository so it can be worked on — don't put personal data in it. Feedback works even with the usage signal off.

## Wat Toledo+ níet doet / What Toledo+ does not do

- No tracking of who you are, no ads, no third-party trackers or crash reporting.
- No third-party services, fonts or CDNs. All code ships inside the extension.
- No sharing of your Toledo or KU Loket data with the developer, KU Leuven, LUCA or anyone else.
- No remote code: the extension never downloads or executes code.

## Gegevens wissen / Deleting your data

Settings → Data → **Reset**, or remove the extension (`chrome://extensions` → Remove). This deletes everything Toledo+ stored on your device. On the server only the anonymous usage rows (and feedback you sent) exist; turning the usage signal off deletes the rows for your install id. For feedback removal, open a Discussion.

## Onofficieel / Unofficial

Toledo+ is an independent student project, not affiliated with KU Leuven, LUCA School of Arts or Blackboard / Anthology Inc.. Your use of Toledo remains subject to KU Leuven's own terms and privacy policy.

Questions: open a [Discussion](https://github.com/joennespreuwers/toledo-plus/discussions). Security issues: see [SECURITY.md](SECURITY.md).
