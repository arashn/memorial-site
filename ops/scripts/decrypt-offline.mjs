#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

function usage() {
  process.stderr.write(
    [
      "Usage:",
      "  node ops/scripts/decrypt-offline.mjs --key <private-key.json> --in <file-or-dir> [--out <output.ndjson>]",
      "",
      "Options:",
      "  --key   Path to JSON file containing private_key_jwk (from generate-x25519-keypair.mjs output)",
      "  --in    Path to exported submission JSON file or directory of JSON files",
      "  --out   Output path for NDJSON (default: stdout)",
      "  --help  Show this help"
    ].join("\n") + "\n"
  );
}

function parseArgs(argv) {
  const args = { key: "", input: "", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      usage();
      process.exit(0);
    }
    if (token === "--key") {
      args.key = argv[++i] || "";
      continue;
    }
    if (token === "--in") {
      args.input = argv[++i] || "";
      continue;
    }
    if (token === "--out") {
      args.out = argv[++i] || "";
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.key || !args.input) {
    usage();
    throw new Error("Missing required arguments --key and --in");
  }

  return args;
}

function b64ToBytes(value) {
  return Buffer.from(value, "base64");
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function collectJsonFiles(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) return [targetPath];
  if (!stat.isDirectory()) throw new Error(`Input path is not a file or directory: ${targetPath}`);

  const files = [];
  async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        files.push(full);
      }
    }
  }

  await walk(targetPath);
  files.sort();
  return files;
}

function extractEnvelope(record) {
  if (!record || typeof record !== "object") throw new Error("record_not_object");

  const top = record;
  const env = top.envelope && typeof top.envelope === "object" ? top.envelope : top;

  const ciphertext = env.ciphertext_b64;
  const nonce = env.nonce_b64;
  const eph = env.ephemeral_pubkey_b64;

  if (typeof ciphertext !== "string" || !ciphertext) throw new Error("missing_ciphertext_b64");
  if (typeof nonce !== "string" || !nonce) throw new Error("missing_nonce_b64");
  if (typeof eph !== "string" || !eph) throw new Error("missing_ephemeral_pubkey_b64");

  const nonceBytes = b64ToBytes(nonce);
  const ephBytes = b64ToBytes(eph);

  if (nonceBytes.length !== 12) throw new Error(`invalid_nonce_length:${nonceBytes.length}`);
  if (ephBytes.length !== 32) throw new Error(`invalid_ephemeral_pubkey_length:${ephBytes.length}`);

  return {
    ciphertext,
    nonceBytes,
    ephBytes,
    metadata: {
      submission_id: typeof top.submission_id === "string" ? top.submission_id : null,
      received_at: typeof top.received_at === "string" ? top.received_at : null,
      key_id: typeof top.key_id === "string" ? top.key_id : null,
      enc_alg: typeof top.enc_alg === "string" ? top.enc_alg : null
    }
  };
}

async function importPrivateKey(privateJwk) {
  return subtle.importKey("jwk", privateJwk, { name: "X25519" }, false, ["deriveBits"]);
}

async function decryptEnvelope(privateKey, envelope) {
  const ephemeralPub = await subtle.importKey(
    "raw",
    envelope.ephBytes,
    { name: "X25519" },
    false,
    []
  );

  const sharedBits = await subtle.deriveBits(
    { name: "X25519", public: ephemeralPub },
    privateKey,
    256
  );

  const aesKey = await subtle.importKey(
    "raw",
    sharedBits,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const plaintextBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv: envelope.nonceBytes },
    aesKey,
    b64ToBytes(envelope.ciphertext)
  );

  const plaintext = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(plaintext);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const privateKeyFile = await loadJson(args.key);
  const privateJwk =
    privateKeyFile && typeof privateKeyFile === "object" && privateKeyFile.private_key_jwk
      ? privateKeyFile.private_key_jwk
      : privateKeyFile;

  if (!privateJwk || typeof privateJwk !== "object") {
    throw new Error("Invalid key file: expected private_key_jwk object or JWK object");
  }

  const privateKey = await importPrivateKey(privateJwk);
  const files = await collectJsonFiles(args.input);

  const sink = args.out
    ? createWriteStream(args.out, { encoding: "utf8", flags: "w" })
    : process.stdout;

  let ok = 0;
  let failed = 0;

  for (const filePath of files) {
    try {
      const record = await loadJson(filePath);
      const envelope = extractEnvelope(record);
      const decrypted = await decryptEnvelope(privateKey, envelope);
      const output = {
        source_file: filePath,
        ...envelope.metadata,
        decrypted
      };
      sink.write(`${JSON.stringify(output)}\n`);
      ok += 1;
    } catch (error) {
      failed += 1;
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to decrypt ${filePath}: ${msg}\n`);
    }
  }

  if (args.out && sink !== process.stdout) {
    await new Promise((resolve, reject) => {
      sink.end((err) => (err ? reject(err) : resolve()));
    });
  }

  process.stderr.write(`Done. decrypted=${ok} failed=${failed}\n`);

  if (ok === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal: ${msg}\n`);
  process.exit(1);
});
