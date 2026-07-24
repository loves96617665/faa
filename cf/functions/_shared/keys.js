/** API Key store (Workers KV) */

import { decryptText, encryptText, randomToken, sha256Hex } from "./crypto.js";

const KEY_PREFIX = "faa_sk_";
const MAX_KEYS_PER_USER = 10;

function requireKv(env) {
  if (!env?.KEYS) {
    const e = new Error("KEYS KV binding is not configured");
    e.status = 500;
    e.code = "UPSTREAM_ERROR";
    throw e;
  }
  return env.KEYS;
}

function requireEncKey(env) {
  const k = env?.TOKEN_ENC_KEY;
  if (!k) {
    const e = new Error("TOKEN_ENC_KEY secret is not configured");
    e.status = 500;
    e.code = "UPSTREAM_ERROR";
    throw e;
  }
  return k;
}

function publicKeyView(rec) {
  return {
    id: rec.id,
    name: rec.name,
    prefix: rec.prefix,
    scopes: rec.scopes || ["*"],
    createdAt: rec.createdAt,
    lastUsedAt: rec.lastUsedAt || null,
    revokedAt: rec.revokedAt || null,
    username: rec.username || null,
  };
}

export function hasScope(scopes, needed) {
  const list = Array.isArray(scopes) ? scopes : ["*"];
  if (list.includes("*")) return true;
  return list.includes(needed);
}

export async function createApiKey(env, { userId, token, username = "", name = "default", scopes = ["*"] }) {
  const kv = requireKv(env);
  const encKey = requireEncKey(env);
  const uid = String(userId || "").trim();
  const tok = String(token || "").trim();
  if (!uid || !tok) {
    const e = new Error("Missing userId/token to bind API key");
    e.status = 401;
    throw e;
  }

  const indexKey = `userkeys:${uid}`;
  let hashes = [];
  try {
    hashes = JSON.parse((await kv.get(indexKey)) || "[]");
    if (!Array.isArray(hashes)) hashes = [];
  } catch {
    hashes = [];
  }

  // prune revoked from index opportunistically
  const active = [];
  for (const h of hashes) {
    const raw = await kv.get(`key:${h}`);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      if (!rec.revokedAt) active.push(h);
    } catch {
      /* skip */
    }
  }
  if (active.length >= MAX_KEYS_PER_USER) {
    const e = new Error(`最多 ${MAX_KEYS_PER_USER} 組 API Key，請先撤銷舊的`);
    e.status = 400;
    throw e;
  }

  const apiKey = KEY_PREFIX + randomToken(22);
  const keyHash = await sha256Hex(apiKey);
  const id = `key_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = Date.now();
  const scopeList = Array.isArray(scopes) && scopes.length ? scopes.map(String) : ["*"];
  const tokenEnc = await encryptText(tok, encKey);

  const rec = {
    id,
    name: String(name || "default").slice(0, 64),
    userId: uid,
    username: String(username || "").slice(0, 64),
    tokenEnc,
    scopes: scopeList,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    prefix: apiKey.slice(0, 12),
    meta: {},
  };

  await kv.put(`key:${keyHash}`, JSON.stringify(rec));
  active.push(keyHash);
  await kv.put(indexKey, JSON.stringify(active));

  return {
    ...publicKeyView(rec),
    apiKey,
    warning: "請立即複製保存，之後無法再查看完整 key",
  };
}

export async function listApiKeys(env, userId) {
  const kv = requireKv(env);
  const uid = String(userId || "").trim();
  const indexKey = `userkeys:${uid}`;
  let hashes = [];
  try {
    hashes = JSON.parse((await kv.get(indexKey)) || "[]");
    if (!Array.isArray(hashes)) hashes = [];
  } catch {
    hashes = [];
  }

  const keys = [];
  const keep = [];
  for (const h of hashes) {
    const raw = await kv.get(`key:${h}`);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      keep.push(h);
      keys.push(publicKeyView(rec));
    } catch {
      /* skip */
    }
  }
  if (keep.length !== hashes.length) {
    await kv.put(indexKey, JSON.stringify(keep));
  }
  keys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return keys;
}

export async function revokeApiKey(env, userId, keyId) {
  const kv = requireKv(env);
  const uid = String(userId || "").trim();
  const id = String(keyId || "").trim();
  const indexKey = `userkeys:${uid}`;
  let hashes = [];
  try {
    hashes = JSON.parse((await kv.get(indexKey)) || "[]");
    if (!Array.isArray(hashes)) hashes = [];
  } catch {
    hashes = [];
  }

  let found = null;
  let foundHash = null;
  for (const h of hashes) {
    const raw = await kv.get(`key:${h}`);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      if (rec.id === id && rec.userId === uid) {
        found = rec;
        foundHash = h;
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (!found) {
    const e = new Error("API Key 不存在");
    e.status = 404;
    throw e;
  }

  found.revokedAt = Date.now();
  await kv.put(`key:${foundHash}`, JSON.stringify(found));
  const next = hashes.filter((h) => h !== foundHash);
  await kv.put(indexKey, JSON.stringify(next));
  return publicKeyView(found);
}

/**
 * Resolve Bearer API key → { userId, token, username, key }
 */
export async function resolveApiKey(env, rawKey) {
  const kv = requireKv(env);
  const encKey = requireEncKey(env);
  const key = String(rawKey || "").trim();
  if (!key || !key.startsWith(KEY_PREFIX)) {
    const e = new Error("Invalid API Key");
    e.status = 401;
    e.code = "UNAUTHORIZED";
    throw e;
  }

  const keyHash = await sha256Hex(key);
  const raw = await kv.get(`key:${keyHash}`);
  if (!raw) {
    const e = new Error("Invalid API Key");
    e.status = 401;
    e.code = "UNAUTHORIZED";
    throw e;
  }

  let rec;
  try {
    rec = JSON.parse(raw);
  } catch {
    const e = new Error("Corrupt API Key record");
    e.status = 500;
    throw e;
  }

  if (rec.revokedAt) {
    const e = new Error("API Key has been revoked");
    e.status = 403;
    e.code = "FORBIDDEN";
    throw e;
  }

  let token;
  try {
    token = await decryptText(rec.tokenEnc, encKey);
  } catch {
    const e = new Error("Failed to decrypt bound credentials (TOKEN_ENC_KEY mismatch?)");
    e.status = 500;
    throw e;
  }

  // Touch lastUsedAt at most once per 15 minutes to avoid burning free KV write quota.
  // Job polling every ~3s would otherwise write on every request.
  const now = Date.now();
  const TOUCH_MIN_MS = 15 * 60 * 1000;
  const prev = Number(rec.lastUsedAt) || 0;
  if (!prev || now - prev >= TOUCH_MIN_MS) {
    rec.lastUsedAt = now;
    try {
      await kv.put(`key:${keyHash}`, JSON.stringify(rec));
    } catch {
      /* ignore — e.g. daily put() limit exceeded */
    }
  }

  return {
    userId: rec.userId,
    token,
    username: rec.username || "",
    key: publicKeyView(rec),
    scopes: rec.scopes || ["*"],
  };
}

/**
 * Per-key rate limit via Cache API (does NOT consume KV write quota).
 * Fail-open if cache unavailable or errors — prefer availability over hard limit
 * when free-tier KV is exhausted.
 * Returns true if allowed.
 */
export async function checkRateLimit(env, keyId, { bucket = "all", limit = 30, windowSec = 60 } = {}) {
  try {
    const slot = Math.floor(Date.now() / (windowSec * 1000));
    const cacheKey = new Request(
      `https://faa-rl.internal/rl/${encodeURIComponent(String(keyId))}/${encodeURIComponent(String(bucket))}/${slot}`
    );
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    let cur = 0;
    if (hit) {
      cur = Number(await hit.text()) || 0;
    }
    if (cur >= limit) return false;
    const next = cur + 1;
    const res = new Response(String(next), {
      headers: {
        "Cache-Control": `max-age=${Math.max(60, windowSec * 2)}`,
        "Content-Type": "text/plain",
      },
    });
    // waitUntil not available here; put is fire-and-forget enough for soft RL
    await cache.put(cacheKey, res);
    return true;
  } catch {
    // Fail open: do not block API when rate-limit storage fails
    return true;
  }
}
