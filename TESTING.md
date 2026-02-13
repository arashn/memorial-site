# End-to-End Testing Runbook

Replace these placeholders before running commands:
- `YOUR_DOMAIN` (example: `sepehrkojaee.com`)
- `PATH_TO_OFFLINE_KEY_JSON` (output from `ops/scripts/generate-x25519-keypair.mjs`)
- `PATH_TO_EXPORTED_SUBMISSIONS` (local folder of exported R2 JSON objects)

## 1) Public Site Smoke Test
Open in browser:
- `https://YOUR_DOMAIN/`
- `https://YOUR_DOMAIN/en/submit.html`
- `https://YOUR_DOMAIN/fa/submit.html`
- `https://YOUR_DOMAIN/en/memorial.html`
- `https://YOUR_DOMAIN/fa/memorial.html`

Expected:
- Pages load without browser CSP errors.
- Language switch links work.
- `/` redirects to locale submit page (unless manual mode is used).

## 2) Worker Route and Health Check
Run:
```bash
curl -i https://YOUR_DOMAIN/api/v1/healthz
```

Expected:
- HTTP `200`
- JSON body includes `{"status":"ok"...}`
- Security headers present (`Strict-Transport-Security`, `Content-Security-Policy`, etc.)

Negative method check:
```bash
curl -i -X POST https://YOUR_DOMAIN/api/v1/healthz
```

Expected:
- HTTP `405`

## 3) Turnstile Enforcement Check
In browser, open `/en/submit.html` and click submit without completing Turnstile.

Expected:
- UI message asking to complete anti-bot check.
- No successful submission.

## 4) Happy-Path Submission
1. Open submit page.
2. Fill form with test data.
3. Complete Turnstile.
4. Submit.

Expected:
- UI shows success text.
- Network tab shows `POST /api/v1/submissions` returns `202`.

## 5) Encrypted-at-Rest Verification
Inspect the newest object in R2 bucket `memorial-site-submissions-encrypted-prod`.

Expected object shape:
- `submission_id`
- `received_at`
- `key_id`
- `enc_alg`
- `envelope.ciphertext_b64`
- `envelope.nonce_b64`
- `envelope.ephemeral_pubkey_b64`

Must not contain plaintext fields like `victim_name` or `description`.

## 6) Offline Decryption Verification
Run on offline machine:
```bash
node ops/scripts/decrypt-offline.mjs \
  --key PATH_TO_OFFLINE_KEY_JSON \
  --in PATH_TO_EXPORTED_SUBMISSIONS \
  --out /tmp/decrypted.ndjson
```

Expected:
- Script finishes with `decrypted=<n> failed=<m>` in stderr.
- `/tmp/decrypted.ndjson` has one JSON line per successfully decrypted record.
- Decrypted payload matches test submission fields.

## 7) Replay Protection Check
Use the same submission envelope twice (same `ciphertext_b64` + `nonce_b64`).

Expected:
- First request: `202`
- Second request: `409` (`replay_detected`)

## 8) Rate Limit Check
Send rapid repeated requests from same client/IP.

Expected:
- Some requests succeed initially.
- Subsequent requests return `429` with `retry-after`.

## 9) Memorial Publish Check
1. Add a verified test entry to `public/memorial/names.json`.
2. Deploy Pages.
3. Load memorial pages.

Expected:
- Entry appears in both English and Persian memorial pages.
- No submitter-identifying data is present.

## 10) Headers and TLS Check
Run:
```bash
curl -I https://YOUR_DOMAIN/en/submit.html
curl -I https://YOUR_DOMAIN/api/v1/healthz
```

Expected:
- HTTPS works.
- Security headers are present.
- `Cache-Control` behavior matches config (`no-store` generally, short cache for memorial JSON).

## 11) Failure Triage Hints
- `/api/v1/healthz` works on `workers.dev` but not on domain:
  - Worker route/zone mapping issue.
- Submit fails with `401`:
  - Turnstile secret/site key mismatch or hostname mismatch.
- Submit fails with `400 invalid_key_id` or keyset errors:
  - Drift between `public/keys/public-keyset.json` and Worker `PUBLIC_KEYSET_JSON`.
- No data in R2:
  - Wrong `SUBMISSIONS_BUCKET` binding or deploy target mismatch.
