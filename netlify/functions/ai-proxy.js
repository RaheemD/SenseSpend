// Netlify Serverless Function: AI Proxy
// Securely proxies requests to the OpenRouter API so the API key never touches the browser.
//
// SECURITY
// - Only authenticated Firebase users can call this endpoint (ID token verified server-side).
// - The model is chosen here, never by the client, and output tokens are capped, so a signed-in
//   user cannot use this endpoint as a free gateway to expensive models.
// - Requests are validated (roles, sizes, at most one inline image) before being forwarded.
// - A per-user daily quota is enforced with an atomic Firestore increment (no read-then-write race).
//
// ENVIRONMENT VARIABLES
//   OPENROUTER_API_KEY          (required) OpenRouter key
//   FIREBASE_API_KEY            (required) Firebase Web API key, used to verify ID tokens
//   OPENROUTER_MODEL            (optional) primary model, default google/gemini-3-flash-preview
//   OPENROUTER_FALLBACK_MODELS  (optional) comma-separated fallbacks, default google/gemini-2.5-flash
//   AI_DAILY_LIMIT              (optional) calls per user per day, default 10
//   FIREBASE_PROJECT_ID         (optional) default my-expense-tracker-50a7a
//   FIREBASE_SERVICE_ACCOUNT    (optional, recommended) service-account JSON (raw or base64). When set,
//                               the usage counter is written with server credentials, so Firestore rules
//                               can deny clients any write access to users/{uid}/api_usage.

const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "my-expense-tracker-50a7a";
const DAILY_LIMIT = Math.max(1, parseInt(process.env.AI_DAILY_LIMIT || "10", 10) || 10);
const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-3-flash-preview";
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || "google/gemini-2.5-flash")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== PRIMARY_MODEL);

const MAX_BODY_CHARS = 5_500_000; // Netlify rejects request bodies above ~6MB
const MAX_MESSAGES = 40;
const MAX_TEXT_CHARS = 60_000;
const MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_OUTPUT_TOKENS = 1024;
const UPSTREAM_TIMEOUT_MS = 25_000;

const json = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  body: JSON.stringify(body),
});

const header = (event, name) => {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};

const quotaHeaders = (used) => ({
  "X-AI-Limit": String(DAILY_LIMIT),
  "X-AI-Remaining": String(Math.max(0, DAILY_LIMIT - used)),
});

// The client sends its local date so the quota resets at the user's midnight. Only accept dates
// within one day of the server's UTC date, so the header cannot be used to mint fresh quotas.
function resolveQuotaDate(localDateHeader) {
  const now = Date.now();
  const allowed = [-1, 0, 1].map((d) => new Date(now + d * 86_400_000).toISOString().slice(0, 10));
  if (localDateHeader && /^\d{4}-\d{2}-\d{2}$/.test(localDateHeader) && allowed.includes(localDateHeader)) {
    return localDateHeader;
  }
  return allowed[1];
}

// --- Optional service-account access token (JWT bearer grant, no extra dependencies) ---
let cachedServiceToken = null;
async function getServiceToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) return cachedServiceToken.token;

  const sa = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  const nowSec = Math.floor(Date.now() / 1000);
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned =
    b64u({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64u({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    });
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Service token request failed (${res.status})`);
  const data = await res.json();
  cachedServiceToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedServiceToken.token;
}

// Atomically adds `delta` to users/{uid}/api_usage/{date}.count and returns the new value.
async function incrementUsage(uid, date, delta, bearer) {
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/api_usage/${date}`;
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [
          {
            update: { name, fields: {} },
            updateMask: { fieldPaths: [] },
            updateTransforms: [{ fieldPath: "count", increment: { integerValue: String(delta) } }],
          },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`Usage counter write failed (${res.status})`);
  const data = await res.json();
  const value = parseInt(data.writeResults?.[0]?.transformResults?.[0]?.integerValue, 10);
  if (Number.isNaN(value)) throw new Error("Usage counter returned no value");
  return value;
}

async function readUsage(uid, date, bearer) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/api_usage/${date}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Usage read failed (${res.status})`);
  const data = await res.json();
  return parseInt(data.fields?.count?.integerValue || "0", 10) || 0;
}

// --- Request validation ---
function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw badRequest("messages must be a non-empty array");
  if (messages.length > MAX_MESSAGES) throw badRequest(`At most ${MAX_MESSAGES} messages are allowed`);

  let imageCount = 0;
  return messages.map((m) => {
    if (!m || !["system", "user", "assistant"].includes(m.role)) throw badRequest("Invalid message role");

    if (typeof m.content === "string") {
      if (m.content.length > MAX_TEXT_CHARS) throw badRequest("Message too long");
      return { role: m.role, content: m.content };
    }

    if (!Array.isArray(m.content) || m.role !== "user") throw badRequest("Invalid message content");
    const parts = m.content.map((part) => {
      if (part && part.type === "text" && typeof part.text === "string") {
        if (part.text.length > MAX_TEXT_CHARS) throw badRequest("Message too long");
        return { type: "text", text: part.text };
      }
      if (part && part.type === "image_url" && typeof part.image_url?.url === "string") {
        imageCount += 1;
        if (imageCount > 1) throw badRequest("Only one image per request is allowed");
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(part.image_url.url)) {
          throw badRequest("Images must be base64 data URLs (png, jpeg, webp or gif)");
        }
        return { type: "image_url", image_url: { url: part.image_url.url } };
      }
      throw badRequest("Unsupported content part");
    });
    return { role: m.role, content: parts };
  });
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // --- STEP 1: Verify Firebase Authentication ---
  const idToken = header(event, "x-firebase-token");
  if (!idToken) return json(401, { error: "Authentication required. Please sign in to use AI features." });

  const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
  if (!FIREBASE_API_KEY) return json(500, { error: "Server authentication not configured." });

  let uid;
  try {
    const verifyResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
    );
    if (!verifyResponse.ok) return json(401, { error: "Invalid or expired session. Please sign in again." });
    const verifyData = await verifyResponse.json();
    if (!verifyData.users || verifyData.users.length === 0) {
      return json(401, { error: "User account not found. Please sign up first." });
    }
    uid = verifyData.users[0].localId;
  } catch (verifyError) {
    return json(401, { error: "Authentication verification failed." });
  }

  // --- STEP 2: Parse and validate the request ---
  if (!event.body || event.body.length > MAX_BODY_CHARS) {
    return json(413, { error: "Request too large. Try a smaller image." });
  }
  let requestBody;
  try {
    requestBody = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const today = resolveQuotaDate(header(event, "x-local-date"));
  let usageBearer = idToken;
  try {
    usageBearer = (await getServiceToken()) || idToken;
  } catch (e) {
    console.log("Service account token unavailable, using the user's token:", e.message);
  }

  // Quota check without spending a call
  if (requestBody && requestBody.action === "usage") {
    try {
      const used = await readUsage(uid, today, usageBearer);
      return json(200, { limit: DAILY_LIMIT, used, remaining: Math.max(0, DAILY_LIMIT - used) }, quotaHeaders(used));
    } catch (e) {
      return json(200, { limit: DAILY_LIMIT, used: null, remaining: null });
    }
  }

  let messages;
  try {
    messages = sanitizeMessages(requestBody && requestBody.messages);
  } catch (e) {
    return json(e.statusCode || 400, { error: e.message });
  }

  // --- STEP 3: Enforce the daily quota (reserve one call atomically, refund on failure) ---
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) return json(500, { error: "API key not configured on server" });

  let used = null;
  let reserved = false;
  try {
    used = await incrementUsage(uid, today, 1, usageBearer);
    reserved = true;
    if (used > DAILY_LIMIT) {
      await incrementUsage(uid, today, -1, usageBearer).catch(() => {});
      return json(
        429,
        { error: `You have reached your limit of ${DAILY_LIMIT} free AI calls for today. Please come back tomorrow!` },
        quotaHeaders(DAILY_LIMIT)
      );
    }
  } catch (limitError) {
    // Fail open so a Firestore hiccup doesn't break the app; the model/token caps still bound cost.
    console.log("Rate limiting check bypassed due to error:", limitError.message);
  }

  const refund = async () => {
    if (!reserved) return;
    reserved = false;
    await incrementUsage(uid, today, -1, usageBearer).catch(() => {});
    if (used !== null) used -= 1;
  };

  // --- STEP 4: Proxy the request to OpenRouter ---
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://sensespendai.netlify.app",
        "X-Title": "SpendSense AI",
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
        messages,
        max_tokens: Math.round(clamp(requestBody.max_tokens, 64, MAX_OUTPUT_TOKENS, DEFAULT_OUTPUT_TOKENS)),
        temperature: clamp(requestBody.temperature, 0, 1.2, 0.6),
        user: uid,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const content = data.choices?.[0]?.message?.content;

    if (!response.ok || typeof content !== "string" || !content.trim()) {
      await refund();
      const message =
        (typeof data.error === "string" ? data.error : data.error?.message) || "The AI service returned an empty response.";
      console.log("Upstream error:", response.status, message);
      return json(response.ok ? 502 : response.status >= 500 ? 502 : response.status, { error: message });
    }

    return json(
      200,
      { choices: [{ message: { role: "assistant", content } }], model: data.model || PRIMARY_MODEL },
      used !== null ? quotaHeaders(used) : {}
    );
  } catch (error) {
    await refund();
    const timedOut = error.name === "AbortError";
    return json(timedOut ? 504 : 502, {
      error: timedOut ? "The AI took too long to respond. Please try again." : "Could not reach the AI service.",
    });
  } finally {
    clearTimeout(timer);
  }
};
