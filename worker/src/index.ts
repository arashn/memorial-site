export interface Env {
  TURNSTILE_SECRET: string;
  PUBLIC_KEYSET_JSON: string;
  MAX_BODY_BYTES: string;
  RATE_LIMIT_PER_MIN: string;
  RATE_LIMIT_BURST: string;
  REPLAY_TTL_SECONDS: string;
  ENVIRONMENT: string;
  SUBMISSIONS_BUCKET: R2Bucket;
  RATE_LIMIT_KV: KVNamespace;
  REPLAY_KV: KVNamespace;
}

type SubmissionEnvelope = {
  version: string;
  ciphertext_b64: string;
  nonce_b64: string;
  ephemeral_pubkey_b64: string;
  enc_alg: string;
  key_id: string;
  turnstile_token: string;
  client_ts: string;
  honeypot: string;
};

const FORM_VERSION = "2026-01-01";
const ACCEPTED_ALGS = new Set(["x25519-xsalsa20-poly1305"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/v1/healthz") {
        if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
        return json({ status: "ok", environment: env.ENVIRONMENT || "unknown" }, 200);
      }

      if (url.pathname === "/api/v1/submissions") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return await handleSubmission(request, env);
      }

      return json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "internal_error" }, 500);
    }
  }
};

async function handleSubmission(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  const maxBodyBytes = toPositiveInt(env.MAX_BODY_BYTES, 71680);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBodyBytes) {
    return json({ error: "payload_too_large" }, 413);
  }

  let body: SubmissionEnvelope;
  try {
    body = JSON.parse(raw) as SubmissionEnvelope;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const validationError = validateEnvelope(body, env.PUBLIC_KEYSET_JSON);
  if (validationError) {
    return json({ error: validationError }, 400);
  }

  if (body.honeypot !== "") {
    return json({ error: "invalid_request" }, 400);
  }

  const turnstileOk = await verifyTurnstile(body.turnstile_token, request, env.TURNSTILE_SECRET);
  if (!turnstileOk) {
    return json({ error: "turnstile_failed" }, 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateResult = await checkRateLimit(ip, env);
  if (!rateResult.allowed) {
    return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  }

  const replayKey = await sha256Hex(`${body.ciphertext_b64}.${body.nonce_b64}`);
  const replaySeen = await env.REPLAY_KV.get(replayKey);
  if (replaySeen) {
    return json({ error: "replay_detected" }, 409);
  }

  const submissionId = `sub_${crypto.randomUUID().replace(/-/g, "")}`;
  const receivedAt = new Date().toISOString();
  const objectKey = objectKeyFromDate(receivedAt, submissionId);

  const storedObject = {
    submission_id: submissionId,
    received_at: receivedAt,
    key_id: body.key_id,
    enc_alg: body.enc_alg,
    envelope: {
      version: body.version,
      ciphertext_b64: body.ciphertext_b64,
      nonce_b64: body.nonce_b64,
      ephemeral_pubkey_b64: body.ephemeral_pubkey_b64,
      client_ts: body.client_ts
    },
    abuse: {
      rate_limited_remaining: rateResult.remaining
    }
  };

  await env.SUBMISSIONS_BUCKET.put(objectKey, JSON.stringify(storedObject), {
    httpMetadata: { contentType: "application/json" }
  });

  const replayTtlSeconds = toPositiveInt(env.REPLAY_TTL_SECONDS, 86400);
  await env.REPLAY_KV.put(replayKey, "1", { expirationTtl: replayTtlSeconds });

  return json(
    {
      status: "accepted",
      submission_id: submissionId,
      received_at: receivedAt
    },
    202
  );
}

function validateEnvelope(body: SubmissionEnvelope, keysetJson: string): string | null {
  if (!body || typeof body !== "object") return "invalid_body";
  if (body.version !== FORM_VERSION) return "invalid_version";
  if (!isBase64(body.ciphertext_b64) || body.ciphertext_b64.length > 65536) return "invalid_ciphertext";
  if (!isBase64(body.nonce_b64)) return "invalid_nonce";
  if (!isBase64(body.ephemeral_pubkey_b64)) return "invalid_ephemeral_pubkey";
  if (!ACCEPTED_ALGS.has(body.enc_alg)) return "invalid_enc_alg";
  if (!body.turnstile_token || typeof body.turnstile_token !== "string") return "invalid_turnstile_token";
  if (typeof body.honeypot !== "string") return "invalid_honeypot";

  if (!isFreshTimestamp(body.client_ts, 10 * 60 * 1000)) return "invalid_client_ts";

  let keyset: { active: string; keys: Record<string, string> };
  try {
    keyset = JSON.parse(keysetJson) as { active: string; keys: Record<string, string> };
  } catch {
    return "invalid_keyset";
  }

  if (!keyset.keys || typeof keyset.keys !== "object") return "invalid_keyset";
  if (!body.key_id || !(body.key_id in keyset.keys)) return "invalid_key_id";
  return null;
}

async function verifyTurnstile(token: string, request: Request, secret: string): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form
  });

  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}

async function checkRateLimit(ip: string, env: Env): Promise<{ allowed: boolean; remaining: number }> {
  const limit = toPositiveInt(env.RATE_LIMIT_PER_MIN, 5);
  const burst = toPositiveInt(env.RATE_LIMIT_BURST, 10);
  const nowMinute = Math.floor(Date.now() / 60000);
  const key = `rl:${ip}:${nowMinute}`;

  const current = Number((await env.RATE_LIMIT_KV.get(key)) || "0");
  const next = current + 1;

  if (next > burst || next > limit) {
    return { allowed: false, remaining: 0 };
  }

  await env.RATE_LIMIT_KV.put(key, String(next), { expirationTtl: 120 });
  return { allowed: true, remaining: Math.max(0, limit - next) };
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((x) => x.toString(16).padStart(2, "0")).join("");
}

function objectKeyFromDate(isoTime: string, submissionId: string): string {
  const [date] = isoTime.split("T");
  const [yyyy, mm, dd] = date.split("-");
  return `${yyyy}/${mm}/${dd}/${submissionId}.json`;
}

function isBase64(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(value);
}

function isFreshTimestamp(value: unknown, skewMs: number): boolean {
  if (typeof value !== "string") return false;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return false;
  return Math.abs(Date.now() - ts) <= skewMs;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function json(payload: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  applySecurityHeaders(headers, true);
  return new Response(JSON.stringify(payload), { status, headers });
}

function applySecurityHeaders(headers: Headers, noStore: boolean): void {
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; object-src 'none'"
  );
  headers.set("Cache-Control", noStore ? "no-store" : "public, max-age=300");
}
