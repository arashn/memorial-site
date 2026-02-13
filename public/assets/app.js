import { getLocaleFromPath, loadMessages } from "/assets/i18n.js";

const API_URL = "/api/v1/submissions";
const FORM_VERSION = "2026-01-01";
const ENC_ALG = "x25519-aes-256-gcm-v1";
const KEYSET_URL = "/keys/public-keyset.json";

const form = document.getElementById("submission-form");
const statusEl = document.getElementById("status");
const locale = getLocaleFromPath();
let messages = {
  submit_rejected: "Submission rejected: check required fields and length limits.",
  complete_turnstile: "Complete the anti-bot check and try again.",
  submit_accepted: "Submission accepted and queued for review.",
  too_many_requests: "Too many requests. Please wait and try again.",
  submit_failed: "Submission failed. Please try again later.",
  encryption_unavailable: "Secure encryption is unavailable in this browser. Please use a modern, updated browser."
};

function setStatus(message) {
  statusEl.textContent = message;
}

function getTurnstileToken() {
  if (!window.turnstile) return "";
  const response = window.turnstile.getResponse();
  return typeof response === "string" ? response : "";
}

function normalizeText(value, maxLen) {
  return value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLen);
}

function validatePayload(payload) {
  if (!payload.victim_name || payload.victim_name.length > 120) return false;
  if (!["killed", "injured", "arrested_or_imprisoned", "missing_or_disappeared"].includes(payload.incident_type)) {
    return false;
  }
  if (payload.location.length > 120) return false;
  if (payload.description.length > 600) return false;
  return true;
}

function b64ToBytes(value) {
  const clean = value.replace(/\s+/g, "");
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function bytesToB64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function loadKeyset() {
  const res = await fetch(KEYSET_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("keyset_fetch_failed");
  const data = await res.json();
  if (!data || typeof data !== "object" || typeof data.active !== "string" || !data.keys || typeof data.keys !== "object") {
    throw new Error("keyset_invalid");
  }
  const keyId = data.active;
  const keyB64 = data.keys[keyId];
  if (typeof keyB64 !== "string" || !keyB64) throw new Error("key_not_found");
  return { keyId, keyB64 };
}

async function encryptPayload(plaintext, recipientPublicKeyB64) {
  if (!crypto?.subtle) throw new Error("subtle_unavailable");

  const recipientPublicKeyRaw = b64ToBytes(recipientPublicKeyB64);
  if (recipientPublicKeyRaw.length !== 32) throw new Error("invalid_recipient_key_length");

  const recipientPublicKey = await crypto.subtle.importKey(
    "raw",
    recipientPublicKeyRaw,
    { name: "X25519" },
    false,
    []
  );

  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "X25519", public: recipientPublicKey },
    ephemeral.privateKey,
    256
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(plaintext));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintextBytes
  );

  const ephemeralPubkeyRaw = await crypto.subtle.exportKey("raw", ephemeral.publicKey);

  return {
    ciphertext_b64: bytesToB64(new Uint8Array(ciphertext)),
    nonce_b64: bytesToB64(iv),
    ephemeral_pubkey_b64: bytesToB64(new Uint8Array(ephemeralPubkeyRaw))
  };
}

try {
  messages = { ...messages, ...(await loadMessages(locale)) };
} catch {
  // Keep default English strings when locale file is unavailable.
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const button = form.querySelector("button");
  button.disabled = true;

  try {
    const payload = {
      victim_name: normalizeText(form.victim_name.value, 120),
      incident_type: String(form.incident_type.value || ""),
      date_of_death: form.date_of_death.value || null,
      location: normalizeText(form.location.value, 120),
      description: normalizeText(form.description.value, 600),
      evidence_refs: [],
      submitter_contact: null
    };

    if (!validatePayload(payload)) {
      setStatus(messages.submit_rejected);
      return;
    }

    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      setStatus(messages.complete_turnstile);
      return;
    }

    const { keyId, keyB64 } = await loadKeyset();
    const envelope = await encryptPayload(payload, keyB64);

    const body = {
      version: FORM_VERSION,
      ...envelope,
      enc_alg: ENC_ALG,
      key_id: keyId,
      turnstile_token: turnstileToken,
      client_ts: new Date().toISOString(),
      honeypot: form.website.value || ""
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (res.status === 202) {
      form.reset();
      if (window.turnstile) window.turnstile.reset();
      setStatus(messages.submit_accepted);
      return;
    }

    if (res.status === 429) {
      setStatus(messages.too_many_requests);
      return;
    }

    setStatus(messages.submit_failed);
  } catch (error) {
    if (error instanceof Error && /subtle_unavailable|invalid_recipient_key_length|NotSupportedError|OperationError/i.test(error.message)) {
      setStatus(messages.encryption_unavailable);
    } else {
      setStatus(messages.submit_failed);
    }
  } finally {
    button.disabled = false;
  }
});
