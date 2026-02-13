import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

function bytesToB64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

const keyPair = await subtle.generateKey(
  { name: "X25519" },
  true,
  ["deriveBits"]
);

const publicRaw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey);

const output = {
  generated_at: new Date().toISOString(),
  algorithm: "X25519",
  public_key_raw_b64: bytesToB64(publicRaw),
  private_key_jwk: privateJwk
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
