/** Public v1 API (API Key auth) */

import {
  json,
  err,
  readJson,
  extractApiKey,
  uuid,
  baseUrl,
} from "../functions/_shared/http.js";
import {
  ASPECT_RATIOS,
  QUALITIES,
  listModels,
  modelToDict,
} from "../functions/_shared/models.js";
import {
  DaFreeAiError,
  balance,
  checkTag,
  history,
  absoluteMediaUrl,
  findResultInHistory,
} from "../functions/_shared/client.js";
import { resolveApiKey, hasScope, checkRateLimit } from "../functions/_shared/keys.js";
import { classifyError, errorBody } from "../functions/_shared/errors.js";
import { smartGenerate } from "../functions/_shared/generate-smart.js";
import { resolveJobAuth, finalizeJobIfNeeded } from "../functions/_shared/pool.js";

async function authFromApiKey(context, { scope = null } = {}) {
  const raw = extractApiKey(context.request);
  if (!raw) {
    const c = classifyError("Missing API Key (Authorization: Bearer faa_sk_...)", 401);
    return { error: json(errorBody(c), c.http) };
  }
  let resolved;
  try {
    resolved = await resolveApiKey(context.env, raw);
  } catch (e) {
    const c = classifyError(e.message || e, e.status || 401);
    return { error: json(errorBody(c), c.http) };
  }

  if (scope && !hasScope(resolved.scopes, scope)) {
    const c = classifyError(`Missing scope: ${scope}`, 403);
    return { error: json(errorBody(c), c.http) };
  }

  const allowed = await checkRateLimit(context.env, resolved.key.id, {
    bucket: "all",
    limit: 30,
    windowSec: 60,
  });
  if (!allowed) {
    const c = classifyError("Rate limit exceeded", 429);
    return { error: json(errorBody(c), c.http) };
  }

  return {
    auth: { userId: resolved.userId, token: resolved.token },
    keyMeta: resolved.key,
    scopes: resolved.scopes,
    username: resolved.username,
  };
}

export async function v1Models(context) {
  const a = await authFromApiKey(context, { scope: "models" });
  if (a.error) return a.error;
  return json({
    ok: true,
    models: listModels().map(modelToDict),
    aspects: ASPECT_RATIOS,
    qualities: QUALITIES,
  });
}

export async function v1Me(context) {
  const a = await authFromApiKey(context);
  if (a.error) return a.error;
  const out = {
    ok: true,
    userId: a.auth.userId,
    username: a.username || null,
    key: a.keyMeta,
  };
  try {
    out.balance = await balance(context.env, a.auth);
  } catch (e) {
    out.balance_error = e.message || String(e);
  }
  try {
    out.tag = await checkTag(context.env, a.auth.userId);
  } catch (e) {
    out.tag_error = e.message || String(e);
  }
  return json(out);
}

export async function v1Generate(context) {
  const a = await authFromApiKey(context, { scope: "generate" });
  if (a.error) return a.error;

  const genOk = await checkRateLimit(context.env, a.keyMeta.id, {
    bucket: "generate",
    limit: 6,
    windowSec: 60,
  });
  if (!genOk) {
    const c = classifyError("Generate rate limit exceeded (6/min)", 429);
    return json(errorBody(c), c.http);
  }

  const body = await readJson(context.request);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    const c = classifyError("prompt 不可為空", 400);
    return json(errorBody(c), c.http);
  }

  const modelId = String(body.model || "nano-banana-2-lite").trim();
  const aspect = body.aspect || "1:1";
  const resolution = body.resolution;
  const quality = body.quality || "low";
  const duration = Number(body.duration || 5);
  const audio = body.audio !== false && body.audio !== "false";
  const chatId = String(body.chatId || body.jobId || "").trim() || uuid();
  const fallback = body.fallback ?? "auto";
  const forceQuality = body.forceQuality === true || body.forceQuality === "true";
  const poolMode = String(body.poolMode || body.mode || "auto").toLowerCase();

  let refs = body.imagePaths || body.imageRefs || [];
  if (typeof refs === "string") {
    refs = refs
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(refs)) refs = [];

  try {
    const result = await smartGenerate(context.env, a.auth, {
      prompt,
      model: modelId,
      aspect,
      resolution,
      quality,
      duration,
      audio,
      chatId,
      imagePaths: refs.length ? refs : null,
      fallback,
      forceQuality,
      poolMode,
    });
    const submit = result.submit;
    const bal = submit?.bananas?.balance ?? submit?.bananas ?? null;
    return json(
      {
        ok: true,
        status: "submitted",
        jobId: result.chatId,
        chatId: result.chatId,
        model: result.modelId,
        type: result.model.type,
        prompt,
        bananaCost: submit?.bananaCost ?? null,
        balance: bal,
        adjustments: result.adjustments,
        fallbackUsed: result.fallbackUsed,
        originalModel: result.originalModel,
        originalQuality: result.originalQuality,
        poolCredits: result.poolCredits,
        fromPool: !!result.fromPool,
        poolAccount: result.poolAccount
          ? { id: result.poolAccount.id, name: result.poolAccount.name, userId: result.poolAccount.userId }
          : null,
        poolStats: result.poolStats || null,
        settings: result.settings,
        poll: {
          url: `/v1/jobs/${result.chatId}`,
          intervalSec: 3,
          timeoutSec: 180,
        },
        submit,
      },
      202
    );
  } catch (e) {
    const msg = e instanceof DaFreeAiError ? e.message : e.message || String(e);
    const status =
      e.status === 503 || e.code === "POOL_BUSY"
        ? 503
        : e instanceof DaFreeAiError
          ? e.status || 502
          : e.status || 502;
    // validation errors from smartGenerate/buildSettings
    if (/Unknown model|Unsupported|Max \d+ reference/i.test(msg)) {
      const c = classifyError(msg, 400);
      return json(errorBody(c), c.http);
    }
    if (e.code === "POOL_BUSY" || status === 503) {
      const c = classifyError(msg, 503);
      return json(errorBody(c, { code: "POOL_BUSY" }), 503);
    }
    const c = classifyError(msg, status);
    return json(errorBody(c, { payload: e.payload || null }), c.http);
  }
}

export async function v1Job(context) {
  const a = await authFromApiKey(context, { scope: "jobs" });
  if (a.error) return a.error;

  const chatId = String(context.params?.id || context.params?.chatId || "").trim();
  if (!chatId) {
    const c = classifyError("缺少 jobId", 400);
    return json(errorBody(c), c.http);
  }

  const url = new URL(context.request.url);
  const promptSubstr = url.searchParams.get("prompt") || null;

  let auth = a.auth;
  let fromPool = false;
  try {
    const resolved = await resolveJobAuth(context.env, chatId, a.auth);
    if (resolved?.auth) {
      auth = resolved.auth;
      fromPool = !!resolved.fromPool;
    }
  } catch {
    /* personal */
  }

  let hist;
  try {
    hist = await history(context.env, auth, { limit: 20, offset: 0 });
  } catch (e) {
    if (fromPool) {
      try {
        hist = await history(context.env, a.auth, { limit: 20, offset: 0 });
        fromPool = false;
      } catch (e2) {
        const c = classifyError(e2.message || e2, e2.status || 500);
        return json(errorBody(c), c.http);
      }
    } else {
      const c = classifyError(e.message || e, e.status || 500);
      return json(errorBody(c), c.http);
    }
  }

  const found = findResultInHistory(hist, { chatId, promptSubstr });
  if (!found) {
    return json({
      ok: true,
      status: "pending",
      jobId: chatId,
      chatId,
      fromPool,
      activeGeneration: hist?.activeGeneration || null,
      error: null,
    });
  }

  try {
    await finalizeJobIfNeeded(context.env, chatId, found.status);
  } catch {
    /* ignore */
  }

  if (found.status === "error") {
    const c = classifyError(found.message || "generation error", 502);
    return json({
      ok: true,
      status: "error",
      jobId: chatId,
      chatId: found.chatId || chatId,
      msgId: found.msgId,
      fromPool,
      error: {
        code: c.code,
        message: c.message,
        hint: c.hint,
      },
      mediaUrl: null,
      media: null,
    });
  }

  const media = found.media || null;
  return json({
    ok: true,
    status: found.status,
    jobId: found.chatId || chatId,
    chatId: found.chatId || chatId,
    msgId: found.msgId,
    fromPool,
    media,
    mediaUrl: media ? absoluteMediaUrl(context.env, media) : null,
    modelName: found.modelName || null,
    resolution: found.resolution || null,
    ratio: found.ratio || null,
    quality: found.quality || null,
    prompt: found.prompt || null,
    error: null,
    activeGeneration: hist?.activeGeneration || null,
  });
}

export async function v1History(context) {
  const a = await authFromApiKey(context, { scope: "history" });
  if (a.error) return a.error;

  const url = new URL(context.request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let data;
  try {
    data = await history(context.env, a.auth, { limit, offset });
  } catch (e) {
    const c = classifyError(e.message || e, e.status || 500);
    return json(errorBody(c), c.http);
  }

  const rows = [];
  for (const chat of data?.history || []) {
    const chatId = chat.id;
    const title = chat.title || "";
    for (const msg of chat.messages || []) {
      if (msg.role !== "bot") continue;
      const media =
        msg.image ||
        msg.imageUrl ||
        (Array.isArray(msg.outputImages) && msg.outputImages[0]) ||
        "";
      const errText = msg.error || "";
      let status;
      if (msg.isError || errText) status = "error";
      else if (media && !String(media).includes("placeholder")) status = "done";
      else if (msg.isLoading) status = "loading";
      else status = "unknown";
      rows.push({
        jobId: String(chatId),
        chatId: String(chatId),
        msgId: String(msg.id || ""),
        status,
        error: errText || null,
        model: msg.modelName || "",
        resolution: msg.resolution || "",
        ratio: msg.ratio || msg.aspectRatio || "",
        prompt: String(msg.prompt || msg.text || "").slice(0, 200),
        media: media && !String(media).includes("placeholder") ? media : "",
        mediaUrl:
          media && !String(media).includes("placeholder")
            ? absoluteMediaUrl(context.env, media)
            : "",
        title,
      });
    }
  }

  return json({
    ok: true,
    rows,
    activeGeneration: data?.activeGeneration || null,
    activeGenerationsCount: data?.activeGenerationsCount ?? null,
    hasMore: !!data?.hasMore,
    base_url: baseUrl(context.env),
  });
}
