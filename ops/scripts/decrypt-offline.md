# Offline Decrypt Procedure

1. Export encrypted objects from R2 to an offline machine.
2. Validate envelope against `ops/schema/submission-envelope.schema.json`.
3. Decrypt using private key in offline environment.
   - Command:
     - `node ops/scripts/decrypt-offline.mjs --key /secure/path/new-key.json --in /secure/path/exported-submissions --out /secure/path/decrypted.ndjson`
   - The key file can be:
     - the full output from `ops/scripts/generate-x25519-keypair.mjs` (contains `private_key_jwk`)
     - or a raw JWK JSON file
   - Output is NDJSON with one decrypted record per line including source metadata.
4. Validate plaintext fields and remove malformed records.
5. Hand off review candidates to verification team.

Never move private keys to online systems.
