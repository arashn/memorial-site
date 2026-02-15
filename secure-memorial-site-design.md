# Secure Memorial Name Collection Website Design

## Purpose
Build a very simple website (one or two pages) for families and relatives of victims of the January 2026 Iran protests to submit names of people who were killed, injured, arrested/imprisoned, or missing/disappeared, while maximizing security under active hostile attack.

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

## Executive Summary
The safest design is **not** a traditional database-backed form app. Instead:
- Use a static frontend for minimal attack surface.
- Encrypt submissions in the browser using a public key.
- Store only ciphertext server-side.
- Decrypt and verify submissions offline by trusted operators.
- Publish only vetted records as a static memorial page.

This minimizes breach impact, reduces operational complexity, and keeps cost low.

Implementation details for this repository are in `implementation-blueprint.md`.

## Threat Model
Assume a capable adversary with significant resources:
- Targeted hacking attempts (app exploits, credential theft, phishing).
- DDoS attacks to disrupt availability.
- Mass spam/fake submissions to poison data.
- Potential legal/physical compromise of hosting accounts or infrastructure.

### Security Goals
- Confidentiality: protect submitter-provided sensitive data.
- Integrity: prevent tampering with records and publication pipeline.
- Availability: keep submission and memorial pages online despite abuse.
- Safety by design: collect the least data possible.

## Correct Architecture

## 1) Public Website (Static)
- Host as static files only.
- No server-rendered pages, no dynamic admin panel exposed publicly.
- Keep client JavaScript minimal and self-hosted.

Recommended stack:
- Cloudflare Pages for static hosting.
- Cloudflare DNS + CDN/WAF edge protection.

## 2) Submission Flow (Encrypted Intake)
1. User opens submission page.
2. User enters required fields (minimal schema).
3. Browser encrypts payload with project public key.
4. Client sends encrypted blob + anti-bot token to intake endpoint.
5. Backend verifies anti-bot token and rate limits request.
6. Backend stores only ciphertext and metadata needed for moderation.

Key design point:
- Backend must never see plaintext if avoidable.

## 3) Backend Intake (Minimal API)
- Use a minimal endpoint (e.g., Cloudflare Worker).
- Accept `POST /submit` only.
- Perform strict input validation and payload size limits.
- Verify Turnstile token server-side (required).
- Apply IP and fingerprint-based rate limits.
- Store encrypted submissions in object storage (R2 or equivalent).

## 4) Review and Publish
- Trusted reviewers export encrypted submissions.
- Decrypt offline on secured machine(s) only.
- Validate and deduplicate records.
- Publish approved entries to a static memorial list (generated offline).
- Deploy updated static list.

No live admin UI exposed to the internet.

## Data Minimization
Collect only what is necessary:
- Victim name (required).
- Date and location of death (if known).
- Short context statement (optional/limited length).
- Evidence attachment (optional, strict size/type limits).

Avoid collecting by default:
- Submitter name, phone, email, IP-linked identity fields.
- Any long free-text fields that can contain sensitive disclosures.

## Cryptography and Key Management
- Generate keys offline.
- Publish only the public encryption key in frontend config.
- Keep private decryption key off all servers.
- Store private key in hardware-backed storage where possible.
- Use split custody (2 trusted operators) for decryption key handling.
- Define and rehearse key-rotation procedures.

## Anti-Abuse Controls
- Cloudflare DDoS edge protection.
- Cloudflare Turnstile with mandatory server-side verification.
- Endpoint rate limiting and request shaping.
- Strict schema validation and max body size.
- Honeypot field to catch simplistic bots.
- Queue/quarantine all new submissions pending human review.

## Hardening Baseline
- HTTPS only.
- HSTS enabled.
- Strong CSP, frame denial, MIME sniff protection.
- Disable inline scripts where possible.
- No third-party analytics or trackers.
- Least-privilege API tokens and service accounts.
- Mandatory hardware-key MFA for infrastructure/admin accounts.
- Audit log retention policy with privacy constraints.

## Operational Security
- Separate roles: infrastructure admin, reviewer, publisher.
- Use dedicated devices for sensitive review/decryption work.
- Document incident response runbook:
  - DDoS surge handling.
  - Credential compromise response.
  - Key compromise response and rekey process.
  - Data tampering investigation.
- Test restore and recovery paths regularly.

## Attack Vectors and Residual Risk
| Attack vector | Primary mitigations in this design | Residual risk |
|---|---|---|
| Network MITM (user <-> site/API) | HTTPS-only, HSTS, valid TLS certs, DNSSEC, registrar MFA | User device trust-store compromise, local malware, coercive network controls |
| DNS hijack/domain takeover | DNSSEC, domain lock, hardware-key MFA on registrar/DNS accounts | Registrar social-engineering or insider compromise |
| CDN/edge/script injection | Strict CSP, self-hosted minimal JS, no third-party scripts, locked deployment pipeline | Compromise of build/release credentials or origin source repository |
| Server/API compromise | Static frontend, minimal intake API, least privilege, no plaintext at rest (ciphertext only) | Service disruption, metadata exposure, abuse of API credentials |
| Database/object-store theft | Client-side encryption before submission, private key never on server | Traffic analysis via metadata, future risk if private key is later compromised |
| Admin credential phishing/account takeover | Hardware security keys (phishing-resistant MFA), role separation, least privilege | Session hijack on infected admin endpoints, insider misuse |
| DDoS (L3/L4/L7) | CDN edge absorption, WAF/rate limiting, minimal dynamic surface | Sustained large attacks can still cause degradation or force paid scaling |
| Spam/fake submissions | Turnstile (server-side verify), schema checks, rate limits, honeypot, moderation queue | Adaptive human-driven spam and coordinated poisoning attempts |
| Input-based exploitation (XSS/SSRF/injection) | Strict validation, size/type limits, no server-side HTML rendering of untrusted input | Parser/library zero-days, logic flaws in custom code |
| Supply-chain compromise (deps/CI) | Pin dependencies, minimal dependency count, signed releases, CI hardening | Zero-day in trusted packages or compromised maintainer accounts |
| Reviewer workstation compromise | Offline decryption on dedicated hardened devices, no private key on servers | Malware or physical compromise of reviewer endpoints |
| Private key compromise | Offline generation/storage, split custody, rotation/revocation runbook | Historical confidentiality loss for submissions encrypted to compromised key |
| Insider threat | Two-person controls for decryption/publishing, audit trails, role separation | Collusion between insiders or coercion |
| Legal seizure/host-country pressure | Minimize retained data, ciphertext storage only, jurisdiction-aware hosting choices | Coercive demands can still affect availability and operations |

## Simplicity and Pages
Keep to one or two pages:
- `/submit`: encrypted submission form.
- `/memorial`: public vetted names.

Optional:
- `/safety`: submitter safety guidance and threat warnings.

## Cost Expectations
- Static hosting and basic intake can be very low cost initially.
- Cloudflare free tier may be sufficient at low/medium traffic.
- Under sustained hostile traffic, paid tiers are likely required.

Important tradeoff:
- “Maximally secure” and “always zero cost” are not compatible under nation-state-level pressure.

## Build vs. Existing Secure Platforms
If strong anonymous whistleblower workflows are needed immediately, consider deploying a mature platform:
- SecureDrop
- GlobaLeaks

These can reduce custom security engineering risk but increase operational complexity.

## Practical Implementation Checklist
Status updated: February 13, 2026.

- [x] Register domain and enable DNSSEC.
- [x] Set up static site hosting (Cloudflare Pages).
- [x] Implement client-side encryption in submit page.
- [x] Build minimal intake endpoint (`POST /api/v1/submissions`).
- [x] Enforce Turnstile server-side verification.
- [x] Add rate limits, schema validation, size limits.
- [x] Store only encrypted payloads.
- [x] Establish offline decryption + verification workflow.
- [ ] Create static memorial generation pipeline (currently paused while memorial publishing is disabled).
- [x] Add security headers and hardening.
- [ ] Enforce hardware-key MFA for all privileged accounts (pending).
- [ ] Write and test incident response runbook (runbook drafted; testing pending).

## References
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Pages/Functions pricing: https://developers.cloudflare.com/pages/functions/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- OWASP HTTP Headers Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
- OWASP CSP Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html
- Cloudflare DNSSEC guidance: https://developers.cloudflare.com/registrar/get-started/enable-dnssec/
- NIST phishing-resistant authenticators: https://pages.nist.gov/800-63-4/sp800-63b/authenticators/
- SecureDrop threat model: https://docs.securedrop.org/en/stable/threat_model/threat_model.html
- GlobaLeaks threat model: https://docs.globaleaks.org/en/stable/technical/security/threat-model.html
