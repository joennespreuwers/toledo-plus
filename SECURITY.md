# Security & privacy policy

## Supported versions

Only the latest release receives fixes. Please update (see README → *Updaten*) before reporting.

## Reporting a vulnerability

Toledo+ runs inside students' logged-in Toledo sessions, so we take these seriously:
e.g. HTML from Toledo that escapes sanitizing (XSS inside the extension), data sent to a domain other than `toledo.kuleuven.be` / `ultra.edu.kuleuven.cloud`, or actions performed in Toledo without the user asking.

**Do not open a public issue.** Instead use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/joennespreuwers/toledo-plus/security/advisories/new) (Security tab → *Report a vulnerability*).
If that is unavailable, open a minimal public issue titled "Security contact request" **without details**, and the maintainer will contact you.

Please include: the version, browser, steps to reproduce with **synthetic** data (never real student data or session cookies), and impact. You will get a reply within 7 days. Fixes are released as a patch version and credited in the CHANGELOG unless you prefer otherwise.

## Out of scope

Vulnerabilities in Toledo, Blackboard Ultra or KU Leuven systems themselves – report those to KU Leuven ICTS.

## Design rules that keep users safe

- Remote HTML is always passed through `TP.util.sanitize`; text through `TP.util.esc`.
- No network requests outside the two Toledo origins (enforced in the e2e tests: any other request fails the suite).
- No analytics, no remote code, minimal permissions (`storage` + the two hosts).

See also [PRIVACY.md](PRIVACY.md).
