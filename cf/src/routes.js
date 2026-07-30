/**
 * All API route handlers in one module (no [param] filenames for bundler safety).
 */
import { json, err, readJson, extractAuth, requireAuth, uuid, baseUrl } from "../functions/_shared/http.js";
import { ASPECT_RATIOS, QUALITIES, summarizeGlobalSettings } from "../functions/_shared/models.js";
import {
  DaFreeAiError,
  getLoginUrl,
  exchangeCode,
  creditsPool,
  globalSettings,
  listAvailableModels,
  checkTag,
  balance,
  acceptTerms,
  history,
  deleteHistory,
  extractMedia,
  absoluteMediaUrl,
  findResultInHistory,
} from "../functions/_shared/client.js";
import { extractUserFields } from "../functions/_shared/http.js";
import { smartGenerate } from "../functions/_shared/generate-smart.js";
import { resolveJobAuth, finalizeJobIfNeeded } from "../functions/_shared/pool.js";

export async function apiMeta(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  const url = new URL(request.url);
  const includeHidden =
    url.searchParams.get("include_hidden") === "1" ||
    url.searchParams.get("include_hidden") === "true";
  const onlyLiveEnabled =
    url.searchParams.get("only_live_enabled") === "1" ||
    url.searchParams.get("only_live_enabled") === "true";
  const type = url.searchParams.get("type") || null;

  let available;
  try {
    available = await listAvailableModels(env, {
      type,
      includeHidden,
      onlyLiveEnabled,
    });
  } catch (e) {
    available = {
      models: [],
      global_settings: null,
      include_hidden: includeHidden,
      only_live_enabled: onlyLiveEnabled,
      live_enabled_models: [],
      settings_error: e.message || String(e),
    };
  }

  const gs = available.global_settings || {};
  return json({
    ok: true,
    base_url: baseUrl(env),
    aspects: ASPECT_RATIOS,
    qualities: QUALITIES,
    models: available.models,
    include_hidden: available.include_hidden,
    only_live_enabled: available.only_live_enabled ?? onlyLiveEnabled,
    live_enabled_models: available.live_enabled_models || [],
    models_error: available.models_error || null,
    upstream_models_count: available.upstream_models_count ?? null,
    global_settings: gs,
    maxCredits: gs.artlistPoolMax ?? null,
    hidden_models: gs.hidden_models || [],
    settings_error: available.settings_error || null,
    auth: {
      userId: auth.userId || null,
      hasToken: !!auth.token,
      tokenPreview:
        auth.token && auth.token.length > 14
          ? `${auth.token.slice(0, 8)}…${auth.token.slice(-6)}`
          : null,
    },
    runtime: "cloudflare-worker",
    phase: 1,
  });
}

export async function apiStatus(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  const result = {
    ok: true,
    runtime: "cloudflare-worker",
    phase: 1,
    base_url: baseUrl(env),
  };
  try {
    result.credits_pool = await creditsPool(env);
  } catch (e) {
    result.credits_pool_error = e.message || String(e);
  }
  try {
    const gs = await globalSettings(env);
    result.global_settings = summarizeGlobalSettings(gs);
    result.maxCredits =
      result.global_settings?.artlistPoolMax ??
      result.credits_pool?.maxCredits ??
      null;
  } catch (e) {
    result.global_settings_error = e.message || String(e);
    result.maxCredits = result.credits_pool?.maxCredits ?? null;
  }
  if (auth.userId && auth.token) {
    try {
      result.balance = await balance(env, auth);
    } catch (e) {
      result.balance_error = e.message || String(e);
    }
    try {
      result.tag = await checkTag(env, auth.userId);
    } catch (e) {
      result.tag_error = e.message || String(e);
    }
    try {
      const hist = await history(env, auth, { limit: 3, offset: 0 });
      result.active = {
        activeGeneration: hist?.activeGeneration,
        activeGenerationsCount: hist?.activeGenerationsCount,
        hasMore: hist?.hasMore,
      };
    } catch (e) {
      result.active_error = e.message || String(e);
    }
  } else {
    result.auth = "missing (send X-User-Id / X-User-Token)";
  }
  return json(result);
}

export async function apiLoginUrl(context) {
  try {
    const url = await getLoginUrl(context.env);
    return json({ ok: true, url });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
    return err(String(e.message || e), status);
  }
}

export async function apiExchange(context) {
  const body = await readJson(context.request);
  const code = String(body.code || "").trim();
  if (!code) return err("缺少 code");
  try {
    const user = await exchangeCode(context.env, code);
    const fields = extractUserFields(user);
    if (!fields.id || !fields.token) {
      return err("交換成功但缺少 id/token", 502, { payload: user });
    }
    return json({
      ok: true,
      user: {
        id: fields.id,
        token: fields.token,
        username: fields.username,
        tokens: fields.tokens,
        hasToken: true,
      },
      note: "請由前端寫入 localStorage（伺服器不保存 token）",
    });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 401 : 500;
    return err(
      `${e.message || e}（code 可能已使用，請改貼 localStorage JSON）`,
      status
    );
  }
}

export async function apiSave(context) {
  const body = await readJson(context.request);
  if (body.json) {
    let data = body.json;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return err(`JSON 解析失敗：${e.message || e}`);
      }
    }
    if (!data || typeof data !== "object") return err("json 格式錯誤");
    const fields = extractUserFields(data);
    if (!fields.id || !fields.token) return err("JSON 缺少 id/token");
    return json({
      ok: true,
      user: {
        id: fields.id,
        username: fields.username,
        hasToken: true,
        token: fields.token,
      },
      saved: "browser-localStorage",
    });
  }
  const uid = String(body.userId || body.id || "").trim();
  const token = String(body.token || "").trim();
  const username = String(body.username || "").trim();
  if (!uid || !token) return err("userId 與 token 必填");
  return json({
    ok: true,
    user: { id: uid, username, hasToken: true, token },
    saved: "browser-localStorage",
  });
}

export async function apiMe(context) {
  const auth = extractAuth(context.request);
  if (!auth.userId || !auth.token) {
    return json({ ok: true, logged_in: false });
  }
  const out = {
    ok: true,
    logged_in: true,
    userId: auth.userId,
    username: null,
  };
  try {
    try {
      out.balance = await balance(context.env, auth);
    } catch (e) {
      out.balance_error = e.message || String(e);
    }
    try {
      out.tag = await checkTag(context.env, auth.userId);
    } catch (e) {
      out.tag_error = e.message || String(e);
    }
  } catch (e) {
    if (e instanceof DaFreeAiError) {
      return json({ ok: true, logged_in: false, error: e.message });
    }
  }
  return json(out);
}

export async function apiAcceptTerms(context) {
  const body = await readJson(context.request);
  const auth = extractAuth(context.request, body);
  try {
    requireAuth(auth);
    const data = await acceptTerms(context.env, auth);
    return json({ ok: true, data });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 400 : e.status || 400;
    return err(e.message || String(e), status);
  }
}

export async function apiGenerate(context) {
  const body = await readJson(context.request);
  const auth = extractAuth(context.request, body);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) return err("prompt 不可為空");

  const modelId = String(body.model || "nano-banana-2-lite").trim();
  const aspect = body.aspect || "1:1";
  const resolution = body.resolution;
  const quality = body.quality || "low";
  const duration = Number(body.duration || 5);
  const audio = body.audio !== false && body.audio !== "false";
  const chatId = String(body.chatId || "").trim() || uuid();
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
    const result = await smartGenerate(context.env, auth, {
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
    return json({
      ok: true,
      status: "submitted",
      chatId: result.chatId,
      submit: result.submit,
      model: result.modelId,
      type: result.model.type,
      prompt,
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
    });
  } catch (e) {
    const status =
      e.status === 503 || e.code === "POOL_BUSY"
        ? 503
        : e instanceof DaFreeAiError
          ? e.status || 502
          : e.status || 502;
    return err(`提交失敗：${e.message || e}`, status, {
      payload: e.payload || null,
      code: e.code || null,
    });
  }
}

export async function apiJob(context) {
  const { request, env, params } = context;
  const personalAuth = extractAuth(request);
  try {
    requireAuth(personalAuth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const chatId = String(params.chatId || "").trim();
  if (!chatId) return err("缺少 chatId");

  const url = new URL(request.url);
  const promptSubstr = url.searchParams.get("prompt") || null;
  const model = url.searchParams.get("model") || null;
  const sinceRaw = url.searchParams.get("since");
  let sinceTs = null;
  if (sinceRaw != null && sinceRaw !== "") {
    const n = Number(sinceRaw);
    if (Number.isFinite(n)) sinceTs = n;
  }

  // Prefer pool account auth if this job was submitted via pool
  let auth = personalAuth;
  let fromPool = false;
  try {
    const resolved = await resolveJobAuth(env, chatId, personalAuth);
    if (resolved?.auth) {
      auth = resolved.auth;
      fromPool = !!resolved.fromPool;
    }
  } catch {
    // fall back to personal
  }

  let hist;
  try {
    hist = await history(env, auth, { limit: 30, offset: 0 });
  } catch (e) {
    // if pool auth fails, try personal once
    if (fromPool) {
      try {
        hist = await history(env, personalAuth, { limit: 30, offset: 0 });
        fromPool = false;
      } catch (e2) {
        const status = e2 instanceof DaFreeAiError ? e2.status || 500 : 500;
        return err(e2.message || String(e2), status);
      }
    } else {
      const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
      return err(e.message || String(e), status);
    }
  }

  // user_library fallback needs prompt/model/since — client chatId often never appears.
  const found = findResultInHistory(hist, { chatId, promptSubstr, model, sinceTs });
  if (!found) {
    return json({
      ok: true,
      status: "pending",
      chatId,
      fromPool,
      activeGeneration: hist?.activeGeneration,
      activeGenerationsCount: hist?.activeGenerationsCount,
    });
  }

  // Release pool lock when terminal
  try {
    await finalizeJobIfNeeded(env, chatId, found.status);
  } catch {
    /* ignore */
  }

  const out = {
    ok: true,
    status: found.status,
    chatId: found.chatId || chatId,
    msgId: found.msgId,
    message: found.message,
    matchedVia: found.matchedVia,
    result: found,
    fromPool,
    activeGeneration: hist?.activeGeneration,
    activeGenerationsCount: hist?.activeGenerationsCount,
  };

  if (found.status === "completed" && found.media) {
    out.media = found.media;
    out.mediaUrl = absoluteMediaUrl(env, found.media);
    out.modelName = found.modelName;
    out.resolution = found.resolution;
    out.ratio = found.ratio;
  }
  return json(out);
}

export async function apiHistory(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));

  let data;
  try {
    data = await history(env, auth, { limit, offset });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
    return err(e.message || String(e), status);
  }

  const rows = [];
  for (const chat of data?.history || []) {
    const chatId = chat.id;
    const title = chat.title || "";
    for (const msg of chat.messages || []) {
      if (msg.role !== "bot") continue;
      const media = extractMedia(msg) || "";
      const errText = msg.error || "";
      let status;
      if (msg.isError || errText) status = "error";
      else if (media) status = "done";
      else if (msg.isLoading) status = "loading";
      else status = "unknown";
      rows.push({
        chatId: String(chatId),
        msgId: String(msg.id || ""),
        status,
        error: errText,
        model: msg.modelName || "",
        resolution: msg.resolution || "",
        ratio: msg.ratio || msg.aspectRatio || "",
        prompt: String(msg.prompt || msg.text || "").slice(0, 200),
        media,
        mediaUrl: media ? absoluteMediaUrl(env, media) : "",
        title,
      });
    }
  }

  return json({
    ok: true,
    rows,
    activeGeneration: data?.activeGeneration,
    activeGenerationsCount: data?.activeGenerationsCount,
    hasMore: data?.hasMore,
  });
}

export async function apiDeleteHistory(context) {
  const { request, env, params } = context;
  const auth = extractAuth(request);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }
  const chatId = String(params.chatId || "").trim();
  if (!chatId) return err("缺少 chatId");
  try {
    const data = await deleteHistory(env, auth, chatId);
    return json({ ok: true, data });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 400 : 400;
    return err(e.message || String(e), status);
  }
}

export async function apiGallery() {
  return json({
    ok: true,
    files: [],
    note: "Phase 1 無本機/R2 作品庫；請使用遠端 mediaUrl。Phase 2 將接 R2。",
  });
}
