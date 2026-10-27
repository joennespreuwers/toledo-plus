# Security & privacy policy

## Supported versions

Only the latest release receives fixes. Please update (see README → *Updaten*) before reporting.

## Reporting a vulnerability

Toledo+ runs inside students' logged-in Toledo sessions, so we take these seriously:
e.g. HTML from Toledo that escapes sanitizing (XSS inside the extension), data sent anywhere other than the hosts below (or more than the documented payloads to `api.toledoplus.be`), or actions performed in Toledo without the user asking.

**Do not open a public issue.** Instead use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/joennespreuwers/toledo-plus/security/advisories/new) (Security tab → *Report a vulnerability*).
If that is unavailable, open a minimal public issue titled "Security contact request" **without details**, and the maintainer will contact you.

Please include: the version, browser, steps to reproduce with **synthetic** data (never real student data or session cookies), and impact. You will get a reply within 7 days. Fixes are released as a patch version and credited in the CHANGELOG unless you prefer otherwise.

## Out of scope

Vulnerabilities in Toledo, Blackboard Ultra or KU Leuven systems themselves – report those to KU Leuven ICTS.

## Design rules that keep users safe

- Remote HTML is always passed through `TP.util.sanitize` (element denylist + attribute allowlist; remote images load lazily with `referrerpolicy="no-referrer"`, media never autoplays); text through `TP.util.esc`.
- Network: only the `host_permissions` hosts — `toledo.kuleuven.be`, `ultra.edu.kuleuven.cloud` (+ Toledo's signed file-storage redirect for downloads), read-only `webwsp.aps.kuleuven.be` (KU Loket), `cloud.timeedit.net` (iCal) and `icts-p-toledo-valvas.cloud.icts.kuleuven.be` (exactly `GET /student/messages/{id}/external`), and the project's own `api.toledoplus.be` for exactly `POST /v1/ping` (anonymous daily signal: random id, version, browser, language), `POST /v1/forget`, `POST /v1/feedback` (what the user typed) and `GET /v1/latest`, without cookies. Cross-origin calls go through the allowlist in `background.js`; the e2e suite fails on any other request.
- Permissions: `storage` and `declarativeNetRequestWithHostAccess` for one redirect rule (`rules/landing.json`: Toledo's start page → the portal). No analytics beyond the documented anonymous signal (opt-out), no remote code.
- The API worker (`worker/`) treats `Origin` as a CORS gate only: limits are per IP (IPv6 /64) and global, public issues from feedback are capped, and user text in issues is fenced. Abuse of these limits is in scope.

See also [PRIVACY.md](PRIVACY.md).
