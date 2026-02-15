# Implementation Blueprint: Secure Memorial Name Collection Site

## Scope
This blueprint defines a concrete, minimal implementation for this repository:
- Static public site with 2 pages: `/submit` and `/memorial`
- One intake API: `POST /api/v1/submissions`
- Client-side encryption before network transmission
- No plaintext victim data stored server-side
- Route-based localization: `/en/*` and `/fa/*` with no third-party translation services

## Current Deployment State (As of February 13, 2026)
- Completed:
  - Domain registered with registry lock.
  - Cloudflare zone configured with DNSSEC, TLS strict mode, and HSTS.
  - Cloudflare Pages project deployed for static site.
  - Worker service deployed for `/api/v1/*`.
  - R2 bucket created (`memorial-site-submissions-encrypted-prod`).
  - Submit form and client-side encryption implemented.
  - Turnstile widget added and server-side verification implemented.
- Pending / partial:
  - Hardware-key MFA for privileged accounts (not yet enabled).
  - Memorial publishing pipeline remains paused (memorial page disabled).

## 1) Repository Layout
Use this structure:

```text
.
├─ public/
│  ├─ index.html
│  ├─ submit.html                  # redirect to /en/submit.html
│  ├─ memorial.html                # redirect to /en/memorial.html
│  ├─ safety.html                  # redirect to /en/safety.html
│  ├─ en/
│  │  ├─ submit.html
│  │  ├─ memorial.html
│  │  └─ safety.html
│  ├─ fa/
│  │  ├─ submit.html
│  │  ├─ memorial.html
│  │  └─ safety.html
│  ├─ i18n/
│  │  ├─ en.json
│  │  └─ fa.json
│  ├─ keys/
│  │  └─ public-keyset.json
│  ├─ assets/
│  │  ├─ app.js
│  │  ├─ i18n.js
│  │  ├─ memorial.js
│  │  └─ styles.css
│  └─ memorial/
│     └─ names.json                # generated offline from verified records
├─ worker/
│  ├─ src/
│  │  └─ index.ts                  # Cloudflare Worker intake API
│  ├─ wrangler.jsonc
│  └─ package.json
├─ ops/
│  ├─ schema/
│  │  ├─ submission-envelope.schema.json
│  │  └─ memorial-entry.schema.json
│  ├─ keys/
│  │  └─ public-key.json           # public key only (safe to publish)
│  ├─ runbooks/
│  │  ├─ incident-response.md
│  │  └─ key-rotation.md
│  └─ scripts/
│     ├─ decrypt-offline.md
│     ├─ decrypt-offline.mjs
│     ├─ generate-memorial.md
│     └─ generate-x25519-keypair.mjs
└─ .github/
   └─ workflows/
      └─ deploy.yml
```

## 2) Exact Public Endpoints
Serve these static routes:
- `GET /submit` -> `public/submit.html`
- `GET /memorial` -> `public/memorial.html`
- `GET /safety` -> `public/safety.html`
- `GET /memorial/names.json` -> vetted, publish-safe records only

API endpoints (Worker):
- `POST /api/v1/submissions` (accept encrypted envelopes)
- `GET /api/v1/healthz` (returns static health object, no secrets)

Do not expose any admin endpoints publicly.

## 3) Submission Contract (Exact Fields)
The client sends only encrypted payload plus anti-abuse proof.

Request: `POST /api/v1/submissions`
`Content-Type: application/json`

```json
{
  "version": "2026-01-01",
  "ciphertext_b64": "BASE64_CIPHERTEXT",
  "nonce_b64": "BASE64_NONCE",
  "ephemeral_pubkey_b64": "BASE64_EPHEMERAL_PUBKEY",
  "enc_alg": "x25519-aes-256-gcm-v1",
  "key_id": "k-2026-01",
  "turnstile_token": "TOKEN",
  "client_ts": "2026-02-13T18:30:00Z",
  "honeypot": ""
}
```

Field rules:
- `version`: exact string, reject unknown versions
- `ciphertext_b64`: required, base64, max 64 KB encoded
- `nonce_b64`: required, base64, must decode to 12 bytes (AES-GCM IV)
- `ephemeral_pubkey_b64`: required, base64, must decode to 32 bytes (X25519 public key)
- `enc_alg`: must equal allowed value list
- `key_id`: required, must match active/previous allowed keys
- `turnstile_token`: required, non-empty
- `client_ts`: RFC3339 UTC, max skew 10 minutes
- `honeypot`: must be empty string

Response codes:
- `202 Accepted` -> valid and queued
- `400 Bad Request` -> schema/type/size/version failures
- `401 Unauthorized` -> Turnstile verification failed
- `409 Conflict` -> replay/idempotency violation
- `413 Payload Too Large` -> body too large
- `415 Unsupported Media Type` -> non-JSON
- `429 Too Many Requests` -> rate limit exceeded
- `500 Internal Server Error` -> generic failure (never leak stack traces)

Example `202` response:

```json
{
  "status": "accepted",
  "submission_id": "sub_01JABCDEF...",
  "received_at": "2026-02-13T18:30:01Z"
}
```

## 4) Plaintext Payload (Encrypted Client-Side)
This object exists only in browser memory before encryption:

```json
{
  "victim_name": "string, required, 1-120 chars",
  "incident_type": "required enum: killed | injured | arrested_or_imprisoned | missing_or_disappeared",
  "date_of_death": "YYYY-MM-DD, optional (legacy alias of Gregorian incident date)",
  "date_of_incident_gregorian": "YYYY-MM-DD, optional",
  "date_of_incident_jalali": "YYYY/MM/DD, optional",
  "location": "string, optional, <= 120 chars",
  "description": "string, optional, <= 600 chars",
  "evidence_refs": ["optional array of opaque references"],
  "submitter_contact": null
}
```

Rules:
- Do not include submitter identity by default.
- Trim all fields, normalize Unicode, reject control chars.
- Enforce client-side limits before encryption and server-side envelope limits after encryption.

## 5) API Security Controls (Exact)
Apply these controls in Worker:
- Allow methods: `POST` for `/api/v1/submissions`, `GET` for `/api/v1/healthz`
- Reject everything else with `405`.
- Enforce `Content-Type: application/json`.
- Max request body: `70 KB`.
- Per-IP rate limit: `5/min`, burst `10`, and global adaptive rules.
- Verify Turnstile token server-side for every submission.
- Add replay protection using hash of `ciphertext_b64 + nonce_b64` with TTL 24h.
- Write only encrypted envelope + minimal metadata:
  - `received_at`
  - `submission_id`
  - `key_id`
  - abuse score/rate-limit bucket

Never persist:
- Raw IP (if possible), user-agent full string, plaintext form data.

## 6) Required Response Headers
Set on all static pages and API responses:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), microphone=(), camera=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'
Cache-Control: no-store
```

Notes:
- For `/memorial/names.json`, you may use short cache (e.g. `public, max-age=300`) for availability.
- Keep CSP strict; avoid inline scripts/styles.

## 7) Cloudflare Configuration (Concrete)
Cloudflare DNS/Zone:
- Enable DNSSEC.
- Enable Always Use HTTPS.
- Enable HTTP Strict Transport Security.
- Set SSL/TLS mode to `Full (strict)`.

WAF and DDoS:
- Enable managed WAF rules.
- Add custom rule for `/api/v1/submissions`:
  - challenge suspicious ASNs/countries as needed
  - block requests with missing/invalid content type
- Enable bot protection (supervised mode first, then tighten).

Turnstile:
- Place widget on submit page.
- Validate token only on server using secret key.

R2 (or equivalent object storage):
- Bucket: `submissions-encrypted-prod`
- Object key format: `YYYY/MM/DD/<submission_id>.json`
- Server-side encryption enabled.
- Lifecycle policy: move old objects to cheaper class if needed.

## 8) Environment Variables (Worker)
Required secrets/config:

```text
TURNSTILE_SECRET=...
PUBLIC_KEYSET_JSON={"active":"k-2026-01","keys":{"k-2026-01":"..."}}
MAX_BODY_BYTES=71680
RATE_LIMIT_PER_MIN=5
RATE_LIMIT_BURST=10
REPLAY_TTL_SECONDS=86400
ENVIRONMENT=production
```

Non-secret config can live in `wrangler.jsonc`; secrets must be stored with `wrangler secret put`.

## 9) Validation Schemas
Define two JSON Schemas in `ops/schema/`:
- `submission-envelope.schema.json`
  - validates the exact API request contract above
- `memorial-entry.schema.json`
  - validates public names file entries

`/memorial/names.json` entry shape:

```json
{
  "name": "string",
  "incident_type": "killed | injured | arrested_or_imprisoned | missing_or_disappeared",
  "date": "YYYY-MM-DD or null",
  "location": "string or null",
  "notes": "short string or null",
  "source_count": 1
}
```

Do not publish contact details or raw submitter statements verbatim.

## 10) Logging and Privacy
Log only operational metrics:
- request timestamp
- route
- status code
- coarse abuse/rate-limit result
- anonymous request fingerprint hash (rotating salt)

Do not log:
- submission ciphertext (unless required for debugging and only temporarily)
- Turnstile token
- raw IP/user-agent where avoidable

Set log retention windows explicitly (for example: 7-14 days for edge logs).

## 11) Offline Review Workflow
1. Export encrypted envelopes from storage to offline review machine.
2. Decrypt using private key stored off-server.
3. Validate decrypted payload against internal plaintext schema.
4. Deduplicate and verify claims.
5. Approve subset for publication.
6. Generate `public/memorial/names.json` from approved set.
7. Commit and deploy static update.

Controls:
- Two-person approval for publish step.
- Signed release tags for memorial updates.
- Keep decryption environment separate from browsing/email.

## 12) Concrete Deployment Checklist
Status updated: February 13, 2026.

Infrastructure bootstrapping:
- [ ] Register domain with registry lock and hardware-key MFA (partial: registry lock done; hardware-key MFA pending).
- [x] Configure Cloudflare zone, DNSSEC, TLS strict mode, HSTS.
- [x] Create Cloudflare Pages project for static site.
- [x] Create Worker service for `/api/v1/*`.
- [x] Create R2 bucket `memorial-site-submissions-encrypted-prod`.

Application setup:
- [x] Add submit form with strict client validation.
- [x] Implement client encryption using published public key (`key_id` pinned).
- [x] Add Turnstile widget on submit page.
- [x] Implement Worker request schema validation.
- [x] Implement server-side Turnstile verification.
- [x] Implement replay detection + rate limiting.
- [x] Persist encrypted envelope objects only.

Security hardening:
- [x] Set all required security headers.
- [x] Enforce method and content-type allowlists.
- [ ] Disable directory listing and default error leakage.
- [ ] Remove third-party scripts and analytics.
- [ ] Configure WAF rules and bot management.

Operations:
- [x] Write incident runbooks (DDoS, credential compromise, key compromise).
- [ ] Test backup/export/restore of encrypted envelope store.
- [ ] Test key-rotation process with staging keyset.
- [ ] Configure alerting for `429`, `5xx`, WAF spikes, and sudden traffic anomalies.
- [ ] Run tabletop exercise before public launch.

Launch gates (must pass):
- [ ] External security review completed.
- [ ] Pen-test of API and deployment pipeline completed.
- [ ] Dry-run of full submit -> decrypt -> verify -> publish cycle completed.
- [ ] On-call owner and emergency contacts documented.

## 13) Compliance and Assurance
There is no single HIPAA-equivalent certification for this use case. Use a layered assurance model.

Recommended baseline set:
- `NIST CSF 2.0` for program-level governance and risk management.
- `OWASP ASVS (Level 2 minimum, Level 3 for high-risk controls)` for application security requirements.
- `CIS Controls v8` for technical baseline controls.
- `ISO/IEC 27001` if formal ISMS certification is needed.
- `SOC 2 Type II` if third-party assurance reports are required by partners/donors.
- `ISO/IEC 27701` if you need stronger privacy program governance.
- `FIPS 140-3` validated crypto modules only if regulator/partner policy requires it.

Practical control mapping for this repo:
- Governance and risk:
  - [ ] Document and review threat model quarterly.
  - [ ] Maintain risk register and treatment plan.
  - [ ] Assign named security owner and incident commander backup.
- Identity and access:
  - [ ] Hardware security keys required for all privileged accounts.
  - [ ] Least-privilege role separation (infra/reviewer/publisher).
  - [ ] Quarterly access review and immediate deprovisioning process.
- Data protection:
  - [ ] Verify no plaintext victim submissions are stored server-side.
  - [ ] Keep private decryption keys offline with split custody.
  - [ ] Define and test key rotation at least every 6 months.
- Application and infrastructure security:
  - [ ] ASVS checklist completed and signed off before launch.
  - [ ] WAF/rate-limit/anti-bot controls validated under load.
  - [ ] Dependency and CI/CD hardening controls in place.
- Monitoring and response:
  - [ ] Alerting configured for auth anomalies, traffic spikes, and 5xx bursts.
  - [ ] Incident response tabletop completed before launch and every 6 months.
  - [ ] Post-incident review template and timeline capture process documented.
- Independent validation:
  - [ ] External penetration test completed before public launch.
  - [ ] Critical findings remediated and retested.
  - [ ] Annual reassessment scheduled.

Evidence package to maintain:
- Architecture diagrams and data-flow documents.
- Threat model revisions and risk register.
- Access-control reviews and MFA enforcement proof.
- Vulnerability scan/pentest reports and remediation records.
- Incident drill reports and runbook revision history.

## 14) Minimal Acceptance Tests
- `POST /api/v1/submissions` valid envelope returns `202`.
- Invalid Turnstile token returns `401`.
- Oversized request returns `413`.
- Missing required field returns `400`.
- Replay envelope returns `409`.
- Burst submissions trigger `429`.
- Static pages return required security headers.
- `memorial/names.json` validates against public schema.

## 15) Non-Goals (for launch)
- User accounts
- Searchable admin dashboard
- Rich media upload pipeline
- Real-time collaboration tools

Keeping these out of scope reduces attack surface substantially.
