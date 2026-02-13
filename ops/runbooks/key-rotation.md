# Key Rotation Runbook

## Goal
Rotate submission encryption keys without breaking client submissions.

## Procedure
1. Generate a new X25519 keypair offline.
2. Add new public key with new `key_id` to `ops/keys/public-key.json` and `public/keys/public-keyset.json`.
3. Update Worker `PUBLIC_KEYSET_JSON` to include old and new keys.
4. Set new key as `active` in frontend keyset.
5. Deploy frontend and Worker together.
6. Verify new submissions arrive with new `key_id`.
7. Keep previous key for decryption during grace period.
8. Remove old key from active set after confirmation.

Example offline generation command:
- `node ops/scripts/generate-x25519-keypair.mjs > /secure/path/new-key.json`

## Verification
- Submit test record and confirm `key_id` in stored envelope.
- Decrypt test envelope using new private key offline.
