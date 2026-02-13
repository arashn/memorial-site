const API_URL = "/api/v1/submissions";
const FORM_VERSION = "2026-01-01";
const KEY_ID = "k-2026-01";
const ENC_ALG = "x25519-xsalsa20-poly1305";

const form = document.getElementById("submission-form");
const statusEl = document.getElementById("status");

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
  if (payload.location.length > 120) return false;
  if (payload.description.length > 600) return false;
  return true;
}

function encryptPayload(plaintext) {
  void plaintext;
  throw new Error("Client-side encryption is not implemented. Deploy only after replacing this function.");
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const button = form.querySelector("button");
  button.disabled = true;

  try {
    const payload = {
      victim_name: normalizeText(form.victim_name.value, 120),
      date_of_death: form.date_of_death.value || null,
      location: normalizeText(form.location.value, 120),
      description: normalizeText(form.description.value, 600),
      evidence_refs: [],
      submitter_contact: null
    };

    if (!validatePayload(payload)) {
      setStatus("Submission rejected: check required fields and length limits.");
      return;
    }

    const turnstileToken = getTurnstileToken();
    if (!turnstileToken) {
      setStatus("Complete the anti-bot check and try again.");
      return;
    }

    const envelope = encryptPayload(payload);
    const body = {
      version: FORM_VERSION,
      ...envelope,
      enc_alg: ENC_ALG,
      key_id: KEY_ID,
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
      setStatus("Submission accepted and queued for review.");
      return;
    }

    if (res.status === 429) {
      setStatus("Too many requests. Please wait and try again.");
      return;
    }

    setStatus("Submission failed. Please try again later.");
  } catch {
    setStatus("Submission failed. Please try again later.");
  } finally {
    button.disabled = false;
  }
});
