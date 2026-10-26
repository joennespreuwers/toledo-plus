# Privacy

**Kort / In short:** Toledo+ toont je eigen Toledo-gegevens op een andere manier. Het stuurt niets naar ergens anders. / Toledo+ shows your own Toledo data differently. It sends nothing anywhere else.

## Wat Toledo+ gebruikt / What Toledo+ accesses

| | |
|---|---|
| **Websites** | Only `https://toledo.kuleuven.be/*` and `https://ultra.edu.kuleuven.cloud/*` (the `host_permissions` in `manifest.json`). |
| **Sessie / Session** | Your existing, logged-in Toledo session in your own browser. Toledo+ never sees or stores your password. |
| **Gegevens / Data read** | Your enrollments, notifications, today/tomorrow schedule, unread-mail count, Toledo links, course content, announcements, deadline dates and teacher names/e-mail – exactly what Toledo already shows you. Grades and submissions are never read. |
| **Gegevens / Data written** | Only when you ask for it (and only if *Sync with Toledo* is on): marking notifications read/seen/dismissed and, when you pin or unpin a course, setting its Toledo favourite. These go to Toledo's own API. |
| **Opslag / Storage** | Settings (language, appearance, nicknames, colours, own deadlines, …) in `chrome.storage.sync` – synced by your browser vendor between your own browsers if you have browser sync on. A cache of Toledo data, visit times and "done" marks in `chrome.storage.local` on your device. |
| **Downloads** | Files are fetched from Toledo's own (signed) file storage links and saved through your browser. |

## Wat Toledo+ níet doet / What Toledo+ does not do

- No analytics, telemetry, crash reporting, ads or trackers.
- No servers of its own and no third-party services, fonts or CDNs. All code ships inside the extension.
- No data sharing with the developer, KU Leuven, LUCA or anyone else.
- No remote code: the extension never downloads or executes code.

## Gegevens wissen / Deleting your data

Settings → Data → **Reset**, or remove the extension (`chrome://extensions` → Remove). This deletes everything Toledo+ stored. Nothing is stored anywhere else.

## Onofficieel / Unofficial

Toledo+ is an independent student project, not affiliated with KU Leuven, LUCA School of Arts or Blackboard / Anthology Inc.. Your use of Toledo remains subject to KU Leuven's own terms and privacy policy.

Questions: open a [Discussion](https://github.com/joennespreuwers/toledo-plus/discussions). Security issues: see [SECURITY.md](SECURITY.md).
