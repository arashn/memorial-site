# Offline Decrypt Procedure

1. Export encrypted objects from R2 to an offline machine.
2. Validate envelope against `ops/schema/submission-envelope.schema.json`.
3. Decrypt using private key in offline environment.
4. Validate plaintext fields and remove malformed records.
5. Hand off review candidates to verification team.

Never move private keys to online systems.
