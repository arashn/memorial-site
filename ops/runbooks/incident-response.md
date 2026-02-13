# Incident Response Runbook

## Trigger Conditions
- Sustained 5xx rate above baseline
- Sudden surge in failed Turnstile validations
- Unexpected changes in deployment artifacts
- Suspected credential compromise

## Immediate Steps
1. Freeze deployments.
2. Enable stricter WAF challenge rules for `/api/v1/submissions`.
3. Rotate potentially exposed tokens/secrets.
4. Preserve relevant logs and timeline.
5. Announce incident channel and owner.

## Containment
1. Revoke compromised API tokens.
2. Rotate `TURNSTILE_SECRET`.
3. Force re-authentication for infra accounts.
4. If key compromise is suspected, trigger key rotation runbook.

## Recovery
1. Validate configuration integrity.
2. Re-run smoke tests for submission API.
3. Confirm encrypted objects are still accessible and intact.
4. Resume deployments with two-person review.

## Post-Incident
1. Document root cause and impact.
2. Add preventive controls.
3. Update this runbook and training.
