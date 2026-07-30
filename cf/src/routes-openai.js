/**
 * OpenAI-compatible Images API surface.
 *
 * Paths:
 *   POST /v1/images/generations
 *   POST /openai/v1/images/generations
 *   GET  /openai/v1/models
 *   GET  /v1/models?format=openai  (also handled via openaiModels)
 *
 * Auth: Authorization: Bearer faa_sk_...  (same as /v1/*)
 *
 * Default behaviour is synchronous: submit + poll history until media is ready,
 * then return OpenAI Images shape { created, data: [{ url | b64_json }] }.
 */

import { json, readJson, extractApiKey, uuid } from "../functions/_shared/http.js";
import {
  DaFreeAiError,
  history,
  absoluteMediaUrl,
  findResultInHistory,
  listAvailableModels,
} from "../functions/_shared/client.js";
import { resolveApiKey, hasScope, checkRateLimit } from "../functions/_shared/keys.js";
import { classifyError } from "../functions/_shared/errors.js";
import { smartGenerate } from "../functions/_shared/generate-smart.js";
import { resolveJobAuth, finalizeJobIfNeeded } from "../functions/_shared/pool.js";
import { normalizeModelId, isGptImage } from "../functions/_shared/models.js";

const SIZE_MAP = {
  "256x256": { aspect: "1:1", resolution: "1K" },
  "512x512": { aspect: "1:1", resolution: "1K" },
  "1024x1024": { aspect: "1:1", resolution: "1K" },
  "1792x1024": { aspect: "16:9", resolution: "1K" },
  "1024x1792": { aspect: "9:16", resolution: "1K" },
  "1536x1024": { aspect: "4:3", resolution: "1K" },
  "1024x1536": { aspect: "3:4", resolution: "1K" },
  "1344x768": { aspect: "16:9", resolution: "1K" },
  "768x1344": { aspect: "9:16", resolution: "1K" },
};

/** OpenAI / common aliases → FAA catalog id */
const OPENAI_MODEL_ALIASES = {
  "dall-e-3": "gpt-image-2",
  "dall-e-2": "nano-banana-2-lite",
  "dall-e": "nano-banana-2-lite",
  "gpt-image-1": "gpt-image-2",
  "gpt-image-1.5": "gpt-image-1.5",
  "gpt-image": "gpt-image-2",
  "chatgpt-image": "gpt-image-2",
};

const QUALITY_MAP = {
  standard: "low",
  hd: "high",
  low: "low",
  medium: "medium",
  high: "high",
  auto: "low",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function openaiError(message, { status = 400, type = "invalid_request_error", code = null, param = null, extra = {} } = {}) {
  return json(
    {
      error: {
        message: String(message || "error"),
        type,
        param,
        code,
      },
      ...extra,
    },
    status
  );
}

function mapOpenAIError(classified, extra = {}) {
  const code = classified?.code || "UPSTREAM_ERROR";
  const http = classified?.http || 502;
  let type = "api_error";
  if (http === 401) type = "invalid_request_error";
  else if (http === 403) type = "invalid_request_error";
  else if (http === 400) type = "invalid_request_error";
  else if (http === 429) type = "rate_limit_error";
  const msg = classified?.hint
    ? `${classified.message} (${classified.hint})`
    : classified?.message || "error";
  return openaiError(msg, {
    status: http,
    type,
    code,
    extra: {
      faa: {
        code,
        message: classified?.message,
        hint: classified?.hint,
      },
      ...extra,
    },
  });
}

async function authOpenAI(context, { scope = null } = {}) {
  const raw = extractApiKey(context.request);
  if (!raw) {
    return {
      error: openaiError("Missing API Key. Use Authorization: Bearer faa_sk_...", {
        status: 401,
        type: "invalid_request_error",
        code: "UNAUTHORIZED",
      }),
    };
  }
  let resolved;
  try {
    resolved = await resolveApiKey(context.env, raw);
  } catch (e) {
    const c = classifyError(e.message || e, e.status || 401);
    return { error: mapOpenAIError(c) };
  }
  if (scope && !hasScope(resolved.scopes, scope)) {
    const c = classifyError(`Missing scope: ${scope}`, 403);
    return { error: mapOpenAIError(c) };
  }
  const allowed = await checkRateLimit(context.env, resolved.key.id, {
    bucket: "all",
    limit: 30,
    windowSec: 60,
  });
  if (!allowed) {
    const c = classifyError("Rate limit exceeded", 429);
    return { error: mapOpenAIError(c) };
  }
  return {
    auth: { userId: resolved.userId, token: resolved.token },
    keyMeta: resolved.key,
    scopes: resolved.scopes,
    username: resolved.username,
  };
}

function mapSize(size) {
  const key = String(size || "1024x1024").trim().toLowerCase();
  if (SIZE_MAP[key]) return { ...SIZE_MAP[key], size: key };
  // WxH numeric parse → aspect guess
  const m = key.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (w > 0 && h > 0) {
      const r = w / h;
      let aspect = "1:1";
      if (r > 1.8) aspect = "21:9";
      else if (r > 1.4) aspect = "16:9";
      else if (r > 1.2) aspect = "4:3";
      else if (r < 1 / 1.8) aspect = "9:21";
      else if (r < 1 / 1.4) aspect = "9:16";
      else if (r < 1 / 1.2) aspect = "3:4";
      // 9:21 not in catalog — clamp
      if (aspect === "9:21") aspect = "9:16";
      let resolution = "1K";
      const maxSide = Math.max(w, h);
      if (maxSide >= 3000) resolution = "4K";
      else if (maxSide >= 1500) resolution = "2K";
      return { aspect, resolution, size: key };
    }
  }
  // Already FAA-ish: "1:1" or "1K"
  if (/^\d+:\d+$/.test(key)) {
    return { aspect: key, resolution: "1K", size: key };
  }
  return { aspect: "1:1", resolution: "1K", size: key || "1024x1024" };
}

function mapQuality(quality, modelId) {
  if (quality == null || quality === "") {
    return isGptImage(modelId) ? "low" : "low";
  }
  const q = String(quality).toLowerCase();
  return QUALITY_MAP[q] || (isGptImage(modelId) ? q : "low");
}

function mapModel(model) {
  const raw = String(model || "nano-banana-2-lite").trim();
  const lower = raw.toLowerCase();
  if (OPENAI_MODEL_ALIASES[lower]) {
    return normalizeModelId(OPENAI_MODEL_ALIASES[lower]);
  }
  return normalizeModelId(raw);
}

function parseResolutionOverride(body, mapped) {
  // Allow FAA-native overrides alongside OpenAI fields
  const aspect = body.aspect || body.aspect_ratio || body.aspectRatio || mapped.aspect;
  const resolution = body.resolution || mapped.resolution;
  return { aspect, resolution };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchMediaAsBase64(env, mediaUrl) {
  const res = await fetch(mediaUrl, {
    headers: { Accept: "image/*,*/*" },
  });
  if (!res.ok) {
    throw new DaFreeAiError(`Failed to download media: HTTP ${res.status}`, {
      status: res.status,
    });
  }
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

async function pollUntilDone(env, auth, { chatId, prompt, model, sinceTs, timeoutSec, intervalSec }) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = null;
  let fromPool = false;
  let useAuth = auth;

  try {
    const resolved = await resolveJobAuth(env, chatId, auth);
    if (resolved?.auth) {
      useAuth = resolved.auth;
      fromPool = !!resolved.fromPool;
    }
  } catch {
    /* personal */
  }

  while (Date.now() < deadline) {
    let hist;
    try {
      hist = await history(env, useAuth, { limit: 30, offset: 0 });
    } catch (e) {
      if (fromPool) {
        try {
          hist = await history(env, auth, { limit: 30, offset: 0 });
          fromPool = false;
          useAuth = auth;
        } catch (e2) {
          throw e2;
        }
      } else {
        throw e;
      }
    }

    const promptSubstr = prompt && prompt.length > 80 ? prompt.slice(0, 80) : prompt;
    const found = findResultInHistory(hist, {
      chatId,
      promptSubstr,
      model,
      sinceTs,
    });
    last = found;

    if (found && (found.status === "completed" || found.status === "error")) {
      try {
        await finalizeJobIfNeeded(env, chatId, found.status);
      } catch {
        /* ignore */
      }
      return { found, fromPool, hist };
    }

    await sleep(Math.max(1, intervalSec) * 1000);
  }

  return { found: last, fromPool, hist: null, timedOut: true };
}

/**
 * POST /v1/images/generations  (OpenAI Images)
 *
 * Body (OpenAI + FAA extensions):
 * {
 *   "prompt": "...",
 *   "model": "nano-banana-2-lite" | "gpt-image-2" | "dall-e-3",
 *   "n": 1,
 *   "size": "1024x1024",
 *   "quality": "standard" | "low" | "hd",
 *   "response_format": "url" | "b64_json",
 *   "aspect": "1:1",          // FAA extension
 *   "resolution": "1K",       // FAA extension
 *   "poolMode": "auto",       // FAA extension
 *   "fallback": "auto",       // FAA extension
 *   "timeout": 90,            // sync poll seconds (default 90, max 150)
 *   "async": false            // if true → 202 FAA-style job, still OpenAI-ish wrapper
 * }
 */
export async function openaiImagesGenerations(context) {
  const a = await authOpenAI(context, { scope: "generate" });
  if (a.error) return a.error;

  const genOk = await checkRateLimit(context.env, a.keyMeta.id, {
    bucket: "generate",
    limit: 6,
    windowSec: 60,
  });
  if (!genOk) {
    return mapOpenAIError(classifyError("Generate rate limit exceeded (6/min)", 429));
  }

  const body = await readJson(context.request);
  const prompt = String(body.prompt || body.input || "").trim();
  if (!prompt) {
    return openaiError("prompt is required", {
      status: 400,
      type: "invalid_request_error",
      code: "VALIDATION_ERROR",
      param: "prompt",
    });
  }

  const n = Number(body.n ?? 1);
  if (Number.isFinite(n) && n > 1) {
    return openaiError("Only n=1 is supported", {
      status: 400,
      type: "invalid_request_error",
      code: "VALIDATION_ERROR",
      param: "n",
    });
  }

  const modelId = mapModel(body.model || "nano-banana-2-lite");
  const sizeMapped = mapSize(body.size || "1024x1024");
  const { aspect, resolution } = parseResolutionOverride(body, sizeMapped);
  const quality = mapQuality(body.quality, modelId);
  const responseFormat = String(body.response_format || body.responseFormat || "url").toLowerCase();
  if (responseFormat !== "url" && responseFormat !== "b64_json") {
    return openaiError("response_format must be 'url' or 'b64_json'", {
      status: 400,
      param: "response_format",
      code: "VALIDATION_ERROR",
    });
  }

  const fallback = body.fallback ?? "auto";
  const forceQuality = body.forceQuality === true || body.forceQuality === "true";
  const poolMode = String(body.poolMode || body.mode || "auto").toLowerCase();
  const asyncMode =
    body.async === true ||
    body.async === "true" ||
    body.background === true ||
    String(new URL(context.request.url).searchParams.get("async") || "") === "1";

  let timeoutSec = Number(body.timeout ?? body.timeout_sec ?? 90);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) timeoutSec = 90;
  timeoutSec = Math.min(150, Math.max(15, timeoutSec));
  const intervalSec = Math.min(10, Math.max(2, Number(body.poll_interval ?? 3)));

  let refs = body.imagePaths || body.imageRefs || body.image || [];
  if (typeof refs === "string") {
    refs = refs
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(refs)) refs = [];
  // OpenAI image edit style single image ignored for generations; only paths/urls

  const chatId = String(body.chatId || body.jobId || "").trim() || uuid();
  const sinceTs = Date.now();

  let result;
  try {
    result = await smartGenerate(context.env, a.auth, {
      prompt,
      model: modelId,
      aspect,
      resolution,
      quality,
      duration: Number(body.duration || 5),
      audio: body.audio !== false && body.audio !== "false",
      chatId,
      imagePaths: refs.length ? refs : null,
      fallback,
      forceQuality,
      poolMode,
    });
  } catch (e) {
    const msg = e instanceof DaFreeAiError ? e.message : e.message || String(e);
    const status =
      e.code === "POOL_BUSY" || e.status === 503
        ? 503
        : e instanceof DaFreeAiError
          ? e.status || 502
          : e.status || 502;
    if (/Unknown model|Unsupported|Max \d+ reference/i.test(msg)) {
      return mapOpenAIError(classifyError(msg, 400));
    }
    if (e.code === "POOL_BUSY" || status === 503) {
      return mapOpenAIError(classifyError(msg, 503), { code: "POOL_BUSY" });
    }
    return mapOpenAIError(classifyError(msg, status), {
      payload: e.payload || null,
    });
  }

  const jobId = result.chatId || chatId;

  // Async: return OpenAI-shaped stub + FAA poll hints (non-standard but useful)
  if (asyncMode) {
    return json(
      {
        created: Math.floor(Date.now() / 1000),
        data: [],
        status: "submitted",
        id: jobId,
        jobId,
        chatId: jobId,
        model: result.modelId,
        faa: {
          ok: true,
          status: "submitted",
          poll: {
            url: `/v1/jobs/${jobId}`,
            intervalSec: 3,
            timeoutSec: 180,
          },
          adjustments: result.adjustments,
          fallbackUsed: result.fallbackUsed,
          fromPool: !!result.fromPool,
        },
      },
      202
    );
  }

  // Sync: poll until completed
  let poll;
  try {
    poll = await pollUntilDone(context.env, a.auth, {
      chatId: jobId,
      prompt,
      model: result.modelId,
      sinceTs,
      timeoutSec,
      intervalSec,
    });
  } catch (e) {
    const c = classifyError(e.message || e, e.status || 502);
    return mapOpenAIError(c, { jobId, chatId: jobId });
  }

  if (poll.timedOut) {
    return openaiError(
      `Generation timed out after ${timeoutSec}s. Poll GET /v1/jobs/${jobId} or retry with higher timeout.`,
      {
        status: 504,
        type: "api_error",
        code: "TIMEOUT",
        extra: {
          jobId,
          chatId: jobId,
          faa: {
            status: poll.found?.status || "pending",
            poll: { url: `/v1/jobs/${jobId}`, intervalSec: 3 },
          },
        },
      }
    );
  }

  const found = poll.found;
  if (!found) {
    return openaiError("Generation result not found", {
      status: 502,
      type: "api_error",
      code: "UPSTREAM_ERROR",
      extra: { jobId },
    });
  }

  if (found.status === "error") {
    const c = classifyError(found.message || "generation error", 502);
    return mapOpenAIError(c, { jobId, chatId: found.chatId || jobId });
  }

  if (found.status !== "completed" || !found.media) {
    return openaiError(`Unexpected status: ${found.status}`, {
      status: 502,
      type: "api_error",
      code: "UPSTREAM_ERROR",
      extra: { jobId, status: found.status },
    });
  }

  const mediaUrl = absoluteMediaUrl(context.env, found.media);
  const created = Math.floor(Date.now() / 1000);
  const item = { revised_prompt: null };

  if (responseFormat === "b64_json") {
    try {
      item.b64_json = await fetchMediaAsBase64(context.env, mediaUrl);
    } catch (e) {
      return mapOpenAIError(classifyError(e.message || e, e.status || 502), {
        jobId,
        mediaUrl,
      });
    }
  } else {
    item.url = mediaUrl;
  }

  return json({
    created,
    data: [item],
    // Non-breaking FAA extensions (OpenAI clients ignore unknown fields)
    id: jobId,
    model: found.modelName || result.modelId,
    faa: {
      jobId,
      chatId: found.chatId || jobId,
      media: found.media,
      mediaUrl,
      matchedVia: found.matchedVia || null,
      adjustments: result.adjustments,
      fallbackUsed: result.fallbackUsed,
      fromPool: !!poll.fromPool || !!result.fromPool,
      size: sizeMapped.size,
      aspect,
      resolution,
      quality,
    },
  });
}

/**
 * GET /openai/v1/models  or  GET /v1/models?format=openai
 * OpenAI list shape: { object: "list", data: [{ id, object, created, owned_by }] }
 */
export async function openaiModels(context) {
  const a = await authOpenAI(context, { scope: "models" });
  if (a.error) return a.error;

  const url = new URL(context.request.url);
  const includeHidden =
    url.searchParams.get("include_hidden") === "1" ||
    url.searchParams.get("include_hidden") === "true";
  const onlyLiveEnabled =
    url.searchParams.get("only_live_enabled") === "1" ||
    url.searchParams.get("only_live_enabled") === "true" ||
    url.searchParams.get("only_live_enabled") == null; // default live-only for OpenAI surface
  // Allow explicit only_live_enabled=0 to show full catalog
  const liveFlag =
    url.searchParams.get("only_live_enabled") === "0" ||
    url.searchParams.get("only_live_enabled") === "false"
      ? false
      : onlyLiveEnabled;

  let available;
  try {
    available = await listAvailableModels(context.env, {
      type: url.searchParams.get("type") || "image",
      includeHidden,
      onlyLiveEnabled: liveFlag,
    });
  } catch (e) {
    available = { models: [], settings_error: e.message || String(e) };
  }

  const created = Math.floor(Date.now() / 1000);
  const data = (available.models || []).map((m) => ({
    id: m.id,
    object: "model",
    created,
    owned_by: m.company || "faa",
    // extras (ignored by strict clients)
    type: m.type,
    permission: [],
    root: m.id,
    parent: null,
    faa: {
      name: m.name,
      unlimited: m.unlimited,
      live_enabled: m.live_enabled,
      supports_image_ref: m.supports_image_ref,
      supported_resolutions: m.supported_resolutions,
      supported_qualities: m.supported_qualities,
    },
  }));

  // Also advertise common OpenAI aliases as virtual models pointing at FAA ids
  const aliasExtras = [
    { id: "dall-e-3", maps_to: "gpt-image-2" },
    { id: "dall-e-2", maps_to: "nano-banana-2-lite" },
  ];
  for (const arow of aliasExtras) {
    if (!data.find((d) => d.id === arow.id)) {
      data.push({
        id: arow.id,
        object: "model",
        created,
        owned_by: "faa-alias",
        faa: { alias_of: arow.maps_to },
      });
    }
  }

  return json({
    object: "list",
    data,
    faa: {
      include_hidden: includeHidden,
      only_live_enabled: liveFlag,
      live_enabled_models: available.live_enabled_models || [],
      settings_error: available.settings_error || null,
    },
  });
}

/**
 * Optional: GET /openai/v1/models/:id
 */
export async function openaiModelRetrieve(context) {
  const a = await authOpenAI(context, { scope: "models" });
  if (a.error) return a.error;
  const id = String(context.params?.id || "").trim();
  if (!id) {
    return openaiError("model id required", { status: 400, param: "id" });
  }
  const mapped = mapModel(id);
  const created = Math.floor(Date.now() / 1000);
  return json({
    id: mapped,
    object: "model",
    created,
    owned_by: "faa",
    faa: {
      requested: id,
      normalized: mapped,
    },
  });
}
