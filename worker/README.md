# Toledo+ API (`api.toledoplus.be`)

A small Cloudflare Worker (plain ES module, no framework, no runtime dependencies) behind three extension features:

| Route | What | Auth / limits |
|---|---|---|
| `POST /v1/ping` | Anonymous daily usage signal `{id, v, browser, lang}` → `204` | extension origin; 10/hour per hashed IP |
| `POST /v1/forget` | Opt-out: deletes the install id's rows → `204` | extension origin; 10/hour per hashed IP |
| `POST /v1/feedback` | In-extension feedback → D1 (+ optional GitHub issue) → `201 {ok:true}` | extension origin; 5/hour + 20/day per hashed IP, 10/day per install id, 500/day global |
| `GET /v1/latest` | `{version, url, notes}` for the update banner | public, `Cache-Control: public, max-age=600` |
| `GET /v1/stats` | JSON: installs, 1/7/28-day actives, by version/browser/language, feedback counts | `Authorization: Bearer $STATS_TOKEN` |
| `GET /v1/stats.html` | Dashboard page; asks for the token, keeps it in `sessionStorage`, calls `/v1/stats` | token never in a URL |

All POST routes: `Content-Type: application/json`, body ≤ 8 KB, unknown fields rejected (`400 {error:'invalid', field}`),
`Origin` must be `chrome-extension://<id>` or `extension://<id>` (optionally pinned with `EXTENSION_IDS`).
A rate-limited request gets `429` with `Retry-After` (seconds).

## Setup

Requirements: Node ≥ 22, a Cloudflare account, the `toledoplus.be` zone on Cloudflare (for the custom domain).

```bash
cd worker
npm install                      # wrangler (dev dependency only)
npx wrangler login

# 1. Database
npx wrangler d1 create toledo-plus          # copy the database_id into wrangler.toml
npx wrangler d1 execute toledo-plus --remote --file=schema.sql
npx wrangler d1 execute toledo-plus --local  --file=schema.sql   # for `wrangler dev`

# 2. Secrets (never commit these)
openssl rand -hex 32 | npx wrangler secret put SALT          # required: hashes IPs for rate limiting
openssl rand -hex 32 | npx wrangler secret put STATS_TOKEN   # enables /v1/stats(.html)
npx wrangler secret put GITHUB_TOKEN                         # optional, see below

# 3. Vars in wrangler.toml: LATEST_VERSION / LATEST_URL / LATEST_NOTES (or the D1 `config` table, see below)

# 4. Custom domain: uncomment the `routes` block in wrangler.toml once toledoplus.be is active on Cloudflare
#    (`custom_domain = true` creates the DNS record and certificate).

# 5. Deploy
npx wrangler deploy
curl -s https://api.toledoplus.be/v1/latest
```

**GitHub token** — a *fine-grained* personal access token, repository access **only** `joennespreuwers/toledo-plus`,
permission **Issues: Read and write**, nothing else. Make sure the labels `feedback`, `needs-triage`, `bug` and
`enhancement` exist (add `feedback` to `.github/labels.json`). Without the token, feedback is only stored in D1.

**Rate limiting** — the exact hourly/daily windows are fixed-window counters in D1 (`ratelimit` table). The
`[[ratelimits]]` binding `RL` (Workers Rate Limiting API, wrangler ≥ 4.36, period 10 or 60 s) is an extra,
approximate per-location burst guard (6 requests/minute per route + hashed IP). If the binding is missing or fails,
the D1 limiter still applies.

**Publishing a release** — after uploading the zip to GitHub Releases, either set the vars and redeploy, or without
a redeploy:

```bash
npx wrangler d1 execute toledo-plus --remote --command \
  "INSERT OR REPLACE INTO config (key, value) VALUES ('latest_version','1.4.0'), ('latest_url','https://github.com/joennespreuwers/toledo-plus/releases/tag/v1.4.0'), ('latest_notes','Agenda, KU Loket, feedback')"
```

The extension only links to `https://github.com/joennespreuwers/toledo-plus/…` or `https://toledoplus.be/…`;
any other URL is replaced by the releases page.

## Privacy

- **Usage ping**: a random UUID v4 per install (generated in the browser, deleted locally on opt-out, and removed
  here through `/v1/forget`), the extension version, a browser family (`chrome|edge|brave|opera|other`) and the UI
  language (`nl|en|fr`). At most once a day. No names, e-mail addresses, student numbers, courses, URLs or Toledo data.
- **No IP addresses are stored or logged.** Rate-limit keys are `SHA-256(SALT | UTC day | IP)` truncated to 128
  bits: not reversible without the secret, and not linkable across days. Counter rows are deleted after 2 days
  (daily cron). Keep Workers Logs / Logpush **off** (`[observability] enabled = false`): invocation logs would record
  the client IP. The worker logs only error messages, never request bodies.
- **Feedback** contains only what the user typed. The optional contact field stays in D1 and is never copied into the
  public GitHub issue; `@mentions` are neutralised. The install id is attached only while the usage signal is on and
  is not shown in the issue. The form tells users their message may become a public issue.
- **Retention**: `daily` rows and `installs` unseen for 400 days are deleted by the cron; feedback is kept until
  triaged (delete with `wrangler d1 execute … "DELETE FROM feedback WHERE id = …"`).
- Honeypot field `website`: a non-empty value gets a fake `201` and nothing is stored. More than 3 links → `422`.

## Feedback triage (twice-weekly agent)

With `GITHUB_TOKEN` set, every feedback becomes an issue titled `[Idea|Bug|Feedback] <first line>` with labels
`feedback`, `needs-triage` and `bug` (kind `bug`) or `enhancement` (kinds `idea`, `other`), and a table with kind,
version, browser, language, page and the D1 feedback id. The triage agent handles them like every other
`needs-triage` issue (AGENTS.md §5): `gh issue list --label feedback --label needs-triage --state open`.
Obvious test-only submissions (for example “testing this feature @ 23:29”) are stored with `status = 'spam'` and are
not mirrored to GitHub.
Reporters cannot be asked for more information on GitHub; if a reply is needed, the maintainer looks up the contact
by feedback id:

```bash
npx wrangler d1 execute toledo-plus --remote --command "SELECT id, created, kind, contact FROM feedback WHERE id = 42"
npx wrangler d1 execute toledo-plus --remote --command "UPDATE feedback SET status = 'triaged' WHERE id = 42"
```

Feedback that did not become an issue (no token or GitHub error) has `status = 'new'` and `github_issue IS NULL`.

## Tests

```bash
node --test tests/unit/worker.test.js      # from the repo root; uses node:sqlite as an in-memory D1, no wrangler
```
