import { getLocaleFromPath, loadMessages } from "/assets/i18n.js";

const API_URL = "/api/v1/submissions";
const FORM_VERSION = "2026-01-01";
const ENC_ALG = "x25519-aes-256-gcm-v1";
const KEYSET_URL = "/keys/public-keyset.json";
const STATS_URL = "/api/v1/stats";

const form = document.getElementById("submission-form");
const statusEl = document.getElementById("status");
const submissionCountLineEl = document.getElementById("submission-count-line");
const locale = getLocaleFromPath();
let messages = {
  submit_rejected: "Submission rejected: check required fields and length limits.",
  complete_turnstile: "Complete the anti-bot check and try again.",
  submit_accepted: "Submission accepted and queued for review.",
  too_many_requests: "Too many requests. Please wait and try again.",
  submit_failed: "Submission failed. Please try again later.",
  encryption_unavailable: "Secure encryption is unavailable in this browser. Please use a modern, updated browser.",
  invalid_incident_date: "Invalid incident date format.",
  submissions_count_label: "Submissions received so far: {count}",
  submissions_count_unavailable: "Submission count is currently unavailable."
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
  if (payload.date_of_death !== null && !/^\d{4}-\d{2}-\d{2}$/.test(payload.date_of_death)) return false;
  if (payload.date_of_incident_gregorian !== null && !/^\d{4}-\d{2}-\d{2}$/.test(payload.date_of_incident_gregorian)) {
    return false;
  }
  if (payload.date_of_incident_jalali !== null && !/^\d{4}\/\d{2}\/\d{2}$/.test(payload.date_of_incident_jalali)) {
    return false;
  }
  if (payload.location.length > 120) return false;
  if (payload.description.length > 600) return false;
  return true;
}

function normalizeDigits(input) {
  return String(input)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

function div(a, b) {
  return Math.floor(a / b);
}

function mod(a, b) {
  return a - Math.floor(a / b) * b;
}

// Based on established Jalaali conversion algorithms.
function jalCal(jy) {
  const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
  let bl = breaks.length;
  let gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jm = 0;
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += Math.floor(jump / 33) * 8 + Math.floor((jump % 33) / 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += Math.floor(n / 33) * 8 + Math.floor(((n % 33) + 3) / 4);
  if (jump % 33 === 4 && jump - n === 4) leapJ += 1;
  let leapG = Math.floor(gy / 4) - Math.floor((Math.floor(gy / 100) + 1) * 3 / 4) - 150;
  let march = 20 + leapJ - leapG;
  if (jump - n < 6) {
    n = n - jump + Math.floor((jump + 4) / 33) * 33;
  }
  let leap = (((n + 1) % 33) - 1) % 4;
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4);
  d += div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d -= div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  let i = div(mod(j, 1461), 4) * 5 + 308;
  let gd = div(mod(i, 153), 5) + 1;
  let gm = mod(div(i, 153), 12) + 1;
  let gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - Math.floor((jm - 1) / 7) * (jm - 7) + jd - 1;
}

function isValidJalaliDate(jy, jm, jd) {
  if (jy < -61 || jy > 3177) return false;
  if (jm < 1 || jm > 12) return false;
  if (jd < 1) return false;
  if (jm <= 6) return jd <= 31;
  if (jm <= 11) return jd <= 30;
  return jd <= (jalCal(jy).leap === 0 ? 30 : 29);
}

function parseJalaliDateInput(value) {
  const normalized = normalizeDigits(value).trim();
  if (!normalized) return null;
  const m = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return undefined;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (!isValidJalaliDate(jy, jm, jd)) return undefined;
  return {
    jy,
    jm,
    jd,
    jalali: `${String(jy).padStart(4, "0")}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`
  };
}

function jalaliToIsoDate(jy, jm, jd) {
  const g = d2g(j2d(jy, jm, jd));
  const y = String(g.gy).padStart(4, "0");
  const mo = String(g.gm).padStart(2, "0");
  const d = String(g.gd).padStart(2, "0");
  return `${y}-${mo}-${d}`;
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

async function loadSubmissionCount() {
  if (!submissionCountLineEl) return;
  try {
    const res = await fetch(STATS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("stats_fetch_failed");
    const data = await res.json();
    const count = Number(data.submissions_count);
    if (!Number.isFinite(count) || count < 0) throw new Error("stats_invalid");
    submissionCountLineEl.textContent = messages.submissions_count_label.replace("{count}", String(Math.floor(count)));
  } catch {
    submissionCountLineEl.textContent = messages.submissions_count_unavailable;
  }
}

void loadSubmissionCount();

if (locale === "fa") {
  const jq = window.jQuery;
  if (jq && typeof jq.fn?.pDatepicker === "function") {
    jq("#date_of_death").pDatepicker({
      format: "YYYY/MM/DD",
      initialValue: false,
      autoClose: true,
      observer: true,
      calendar: {
        persian: {
          locale: "fa"
        }
      }
    });
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");

  const button = form.querySelector("button");
  button.disabled = true;

  try {
    let dateOfIncidentGregorian = form.date_of_death.value || null;
    let dateOfIncidentJalali = null;
    if (locale === "fa") {
      const parsedJalali = parseJalaliDateInput(form.date_of_death.value);
      if (parsedJalali === undefined) {
        setStatus(messages.invalid_incident_date);
        return;
      }
      if (parsedJalali !== null) {
        dateOfIncidentJalali = parsedJalali.jalali;
        dateOfIncidentGregorian = jalaliToIsoDate(parsedJalali.jy, parsedJalali.jm, parsedJalali.jd);
      } else {
        dateOfIncidentGregorian = null;
      }
    }

    const payload = {
      victim_name: normalizeText(form.victim_name.value, 120),
      incident_type: String(form.incident_type.value || ""),
      date_of_death: dateOfIncidentGregorian,
      date_of_incident_gregorian: dateOfIncidentGregorian,
      date_of_incident_jalali: dateOfIncidentJalali,
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
