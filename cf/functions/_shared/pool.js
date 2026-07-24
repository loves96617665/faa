/**
 * Service account pool for true parallel generation.
 * Multiple dafreeai credentials; acquire free account per job.
 *
 * KV layout (same KEYS binding):
 *  pool:index              → string[] account ids
 *  pool:acc:{id}           → account record (token encrypted)
 *  pool:lock:{id}          → { jobId, chatId, acquiredAt, expiresAt }
 *  jobmap:{jobId}          → { poolAccountId, chatId, model, prompt, createdAt, status }
 */

import { decryptText, encryptText, randomToken } from "./crypto.js";
import { history, generate as dfGenerate, DaFreeAiError } from "./client.js";

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min auto-release
const MAX_POOL = 30;

function requireKv(env) {
  if (!env?.KEYS) {
    const e = new Error("KEYS KV binding is not configured");
    e.status = 500;
    throw e;
  }
  return env.KEYS;
}

function requireEncKey(env) {
  const k = env?.TOKEN_ENC_KEY;
  if (!k) {
    const e = new Error("TOKEN_ENC_KEY secret is not configured");
    e.status = 500;
    throw e;
  }
  return k;
}

function publicAccount(rec, lock = null) {
  const now = Date.now();
  const busy = !!(lock && lock.expiresAt > now);
  return {
    id: rec.id,
    name: rec.name,
    userId: rec.userId,
    username: rec.username || null,
    enabled: rec.enabled !== false,
    createdAt: rec.createdAt,
    lastUsedAt: rec.lastUsedAt || null,
    lastError: rec.lastError || null,
    successCount: rec.successCount || 0,
    errorCount: rec.errorCount || 0,
    busy,
    lock: busy
      ? {
          jobId: lock.jobId,
          chatId: lock.chatId,
          acquiredAt: lock.acquiredAt,
          expiresAt: lock.expiresAt,
        }
      : null,
  };
}

async function getIndex(kv) {
  try {
    const raw = await kv.get("pool:index");
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function kvPut(kv, key, value, opts) {
  try {
    if (opts) await kv.put(key, value, opts);
    else await kv.put(key, value);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/put\(\) limit|limit exceeded|429|quota/i.test(msg)) {
      const e = new Error(
        "KV put() limit exceeded for the day. Free plan write quota is exhausted; wait for UTC midnight reset, upgrade Workers Paid, or reduce polling. Auth/rate-limit no longer write KV every request."
      );
      e.status = 503;
      e.code = "KV_LIMIT";
      throw e;
    }
    throw err;
  }
}

async function setIndex(kv, ids) {
  await kvPut(kv, "pool:index", JSON.stringify(ids));
}

async function getAccount(kv, id) {
  const raw = await kv.get(`pool:acc:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putAccount(kv, rec) {
  await kvPut(kv, `pool:acc:${rec.id}`, JSON.stringify(rec));
}

async function getLock(kv, id) {
  const raw = await kv.get(`pool:lock:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putLock(kv, id, lock, ttlSec) {
  await kvPut(kv, `pool:lock:${id}`, JSON.stringify(lock), {
    expirationTtl: Math.max(60, ttlSec || Math.ceil(LOCK_TTL_MS / 1000)),
  });
}

async function delLock(kv, id) {
  await kv.delete(`pool:lock:${id}`);
}

export async function listPoolAccounts(env) {
  const kv = requireKv(env);
  const ids = await getIndex(kv);
  const out = [];
  for (const id of ids) {
    const rec = await getAccount(kv, id);
    if (!rec) continue;
    const lock = await getLock(kv, id);
    out.push(publicAccount(rec, lock));
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return out;
}

export async function poolStats(env) {
  const list = await listPoolAccounts(env);
  const enabled = list.filter((a) => a.enabled);
  const free = enabled.filter((a) => !a.busy);
  const busy = enabled.filter((a) => a.busy);
  return {
    total: list.length,
    enabled: enabled.length,
    free: free.length,
    busy: busy.length,
    disabled: list.length - enabled.length,
  };
}

export async function addPoolAccount(env, { userId, token, username = "", name = "" }) {
  const kv = requireKv(env);
  const encKey = requireEncKey(env);
  const uid = String(userId || "").trim();
  const tok = String(token || "").trim();
  if (!uid || !tok) {
    const e = new Error("userId 與 token 必填");
    e.status = 400;
    throw e;
  }

  const ids = await getIndex(kv);
  if (ids.length >= MAX_POOL) {
    const e = new Error(`帳號池最多 ${MAX_POOL} 組`);
    e.status = 400;
    throw e;
  }

  // prevent duplicate userId
  for (const id of ids) {
    const rec = await getAccount(kv, id);
    if (rec && String(rec.userId) === uid) {
      const e = new Error(`userId ${uid} 已在帳號池中 (${rec.id})`);
      e.status = 400;
      throw e;
    }
  }

  const id = `pool_${randomToken(10)}`;
  const now = Date.now();
  const rec = {
    id,
    name: String(name || username || uid).slice(0, 64),
    userId: uid,
    username: String(username || "").slice(0, 64),
    tokenEnc: await encryptText(tok, encKey),
    enabled: true,
    createdAt: now,
    lastUsedAt: null,
    lastError: null,
    successCount: 0,
    errorCount: 0,
  };
  await putAccount(kv, rec);
  ids.push(id);
  await setIndex(kv, ids);
  return publicAccount(rec, null);
}

export async function updatePoolAccount(env, id, patch = {}) {
  const kv = requireKv(env);
  const rec = await getAccount(kv, id);
  if (!rec) {
    const e = new Error("帳號不存在");
    e.status = 404;
    throw e;
  }
  if (patch.name != null) rec.name = String(patch.name).slice(0, 64);
  if (patch.username != null) rec.username = String(patch.username).slice(0, 64);
  if (patch.enabled != null) rec.enabled = !!patch.enabled;
  if (patch.token) {
    const encKey = requireEncKey(env);
    rec.tokenEnc = await encryptText(String(patch.token).trim(), encKey);
  }
  await putAccount(kv, rec);
  const lock = await getLock(kv, id);
  return publicAccount(rec, lock);
}

export async function removePoolAccount(env, id) {
  const kv = requireKv(env);
  const ids = await getIndex(kv);
  const next = ids.filter((x) => x !== id);
  await setIndex(kv, next);
  await kv.delete(`pool:acc:${id}`);
  await delLock(kv, id);
  return { ok: true, id };
}

async function decryptAuth(env, rec) {
  const encKey = requireEncKey(env);
  const token = await decryptText(rec.tokenEnc, encKey);
  return { userId: rec.userId, token };
}

/**
 * Acquire a free pool account. Returns null if none free.
 * Uses optimistic lock: write lock only if free / expired.
 */
export async function acquirePoolAccount(env, { jobId, chatId, preferUserId = null } = {}) {
  const kv = requireKv(env);
  const ids = await getIndex(kv);
  if (!ids.length) return null;

  const now = Date.now();
  const candidates = [];

  for (const id of ids) {
    const rec = await getAccount(kv, id);
    if (!rec || rec.enabled === false) continue;
    let lock = await getLock(kv, id);
    if (lock && lock.expiresAt <= now) {
      await delLock(kv, id);
      lock = null;
    }
    if (lock) continue;
    candidates.push(rec);
  }

  if (!candidates.length) return null;

  // prefer specific userId if requested and free
  let pick = null;
  if (preferUserId) {
    pick = candidates.find((c) => String(c.userId) === String(preferUserId)) || null;
  }
  // round-robin-ish: least recently used
  if (!pick) {
    candidates.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    pick = candidates[0];
  }

  const lock = {
    jobId: jobId || null,
    chatId: chatId || null,
    acquiredAt: now,
    expiresAt: now + LOCK_TTL_MS,
  };
  // re-check race
  const existing = await getLock(kv, pick.id);
  if (existing && existing.expiresAt > now) {
    // lost race — try next
    for (const rec of candidates.slice(1)) {
      const ex = await getLock(kv, rec.id);
      if (ex && ex.expiresAt > Date.now()) continue;
      pick = rec;
      break;
    }
    const ex2 = await getLock(kv, pick.id);
    if (ex2 && ex2.expiresAt > Date.now()) return null;
  }

  // Only write lock here (1 put). lastUsed/stats update on release to save free KV quota.
  await putLock(kv, pick.id, lock, Math.ceil(LOCK_TTL_MS / 1000));

  const auth = await decryptAuth(env, pick);
  return {
    account: publicAccount(pick, lock),
    auth,
    lock,
  };
}

export async function releasePoolAccount(env, accountId, { success = true, error = null } = {}) {
  const kv = requireKv(env);
  if (!accountId) return;
  try {
    await delLock(kv, accountId);
  } catch {
    /* ignore delete failures */
  }
  const rec = await getAccount(kv, accountId);
  if (!rec) return;
  rec.lastUsedAt = Date.now();
  if (success) rec.successCount = (rec.successCount || 0) + 1;
  else {
    rec.errorCount = (rec.errorCount || 0) + 1;
    rec.lastError = error ? String(error).slice(0, 200) : null;
  }
  try {
    await putAccount(kv, rec);
  } catch {
    /* best-effort stats; lock already cleared or TTL will expire */
  }
}

export async function saveJobMap(env, jobId, data) {
  const kv = requireKv(env);
  await kvPut(
    kv,
    `jobmap:${jobId}`,
    JSON.stringify({ ...data, jobId, updatedAt: Date.now() }),
    { expirationTtl: 60 * 60 * 24 } // 24h
  );
}

export async function getJobMap(env, jobId) {
  const kv = requireKv(env);
  const raw = await kv.get(`jobmap:${jobId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve auth for a job: pool account if mapped, else provided personal auth.
 */
export async function resolveJobAuth(env, jobId, fallbackAuth = null) {
  const map = await getJobMap(env, jobId);
  if (map?.poolAccountId) {
    const kv = requireKv(env);
    const rec = await getAccount(kv, map.poolAccountId);
    if (rec) {
      const auth = await decryptAuth(env, rec);
      return { auth, map, fromPool: true };
    }
  }
  if (fallbackAuth?.userId && fallbackAuth?.token) {
    return { auth: fallbackAuth, map, fromPool: false };
  }
  return null;
}

/**
 * Generate using pool if available.
 * mode: "auto" | "pool" | "personal"
 * - auto: use pool if free account exists, else personal
 * - pool: require pool account
 * - personal: always personal auth
 */
export async function generateWithPool(env, personalAuth, opts = {}) {
  const {
    prompt,
    model,
    settings,
    chatId,
    imagePaths = null,
    mode = "auto",
    jobId = chatId,
  } = opts;

  const stats = await poolStats(env);
  let acquired = null;
  let auth = personalAuth;
  let fromPool = false;

  const wantPool = mode === "pool" || (mode === "auto" && stats.enabled > 0);

  if (wantPool) {
    acquired = await acquirePoolAccount(env, { jobId, chatId });
    if (acquired) {
      auth = acquired.auth;
      fromPool = true;
    } else if (mode === "pool") {
      const e = new Error(
        `帳號池忙碌中（free=0 / enabled=${stats.enabled}）。請稍後再試或增加池內帳號。`
      );
      e.status = 503;
      e.code = "POOL_BUSY";
      throw e;
    }
    // auto + no free → fall through to personal
  }

  if (!auth?.userId || !auth?.token) {
    const e = new Error("無可用憑證：請登入或將帳號加入服務帳號池");
    e.status = 401;
    throw e;
  }

  try {
    const submit = await dfGenerate(env, auth, {
      prompt,
      model,
      settings,
      chatId,
      imagePaths,
    });

    await saveJobMap(env, jobId, {
      poolAccountId: acquired?.account?.id || null,
      poolUserId: auth.userId,
      chatId,
      model,
      prompt: String(prompt || "").slice(0, 120),
      createdAt: Date.now(),
      status: "submitted",
      fromPool,
    });

    return {
      submit,
      auth,
      fromPool,
      poolAccount: acquired?.account || null,
      poolStats: await poolStats(env),
      chatId,
      jobId,
    };
  } catch (e) {
    if (acquired?.account?.id) {
      await releasePoolAccount(env, acquired.account.id, {
        success: false,
        error: e.message || String(e),
      });
    }
    throw e;
  }
}

/**
 * After job reaches terminal state, release pool lock.
 */
export async function finalizeJobIfNeeded(env, jobId, status) {
  if (!jobId) return;
  const map = await getJobMap(env, jobId);
  if (!map?.poolAccountId) return;
  if (status === "completed" || status === "error" || status === "timeout") {
    await releasePoolAccount(env, map.poolAccountId, {
      success: status === "completed",
      error: status === "error" ? "job error" : null,
    });
    map.status = status;
    map.finishedAt = Date.now();
    await saveJobMap(env, jobId, map);
  }
}

/**
 * Probe whether an account is currently busy upstream (activeGeneration).
 */
export async function probeAccountBusy(env, auth) {
  try {
    const hist = await history(env, auth, { limit: 1, offset: 0 });
    return {
      busy: !!hist?.activeGeneration,
      activeGeneration: hist?.activeGeneration || null,
    };
  } catch (e) {
    return { busy: false, error: e.message || String(e) };
  }
}

export { DaFreeAiError, LOCK_TTL_MS, MAX_POOL };
