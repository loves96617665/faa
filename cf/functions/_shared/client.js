/** Upstream client for https://www.dafreeai.site */

import { baseUrl } from "./http.js";
import {
  listModels,
  modelToDict,
  enrichModelDict,
  extractModelStatuses,
  summarizeGlobalSettings,
  parseUpstreamModelsMap,
} from "./models.js";

export class DaFreeAiError extends Error {
  constructor(message, { status = null, payload = null } = {}) {
    super(message);
    this.name = "DaFreeAiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function dfRequest(env, method, path, { params, body, timeoutMs = 55000 } = {}) {
  const root = baseUrl(env);
  const url = new URL(path.startsWith("http") ? path : `${root}${path.startsWith("/") ? "" : "/"}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let payload;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (res.status >= 400) {
      const msg =
        (payload && (payload.error || payload.message)) ||
        `HTTP ${res.status}`;
      throw new DaFreeAiError(String(msg), { status: res.status, payload });
    }
    return payload;
  } catch (e) {
    if (e instanceof DaFreeAiError) throw e;
    if (String(e).includes("abort") || e?.name === "AbortError") {
      throw new DaFreeAiError("Upstream timeout", { status: 504 });
    }
    throw new DaFreeAiError(`Network error: ${e.message || e}`, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

export function absoluteMediaUrl(env, media) {
  if (!media) return "";
  const m = String(media);
  if (m.startsWith("http://") || m.startsWith("https://")) return m;
  return `${baseUrl(env)}${m.startsWith("/") ? "" : "/"}${m}`;
}

export function extractMedia(message) {
  const candidates = [
    message?.image,
    message?.imageUrl,
    message?.image_url,
    message?.url,
    message?.video,
    message?.videoUrl,
    message?.video_url,
    message?.media,
    message?.mediaUrl,
    message?.src,
  ];
  const outs = message?.outputImages || message?.output_images || message?.images;
  if (Array.isArray(outs)) candidates.push(...outs);
  else if (typeof outs === "string") candidates.push(outs);

  for (let item of candidates) {
    if (!item) continue;
    if (typeof item === "object") {
      item = item.url || item.src || item.image || item.imageUrl || item.video || item.videoUrl;
    }
    if (!item) continue;
    const text = String(item);
    if (text.toLowerCase().includes("placeholder")) continue;
    return text;
  }
  return null;
}

function isBotMessage(message) {
  if (!message || typeof message !== "object") return false;
  const role = String(message.role || message.type || "").toLowerCase();
  if (["bot", "assistant", "model", "ai", "system-bot"].includes(role)) return true;
  if (["user", "human"].includes(role)) return false;
  if (
    message.image ||
    message.imageUrl ||
    message.outputImages ||
    message.video ||
    message.videoUrl ||
    message.isLoading !== undefined ||
    message.modelName
  ) {
    return true;
  }
  return false;
}

function normModel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Locate generation result in history.
 *
 * Upstream often never materializes the client-supplied chatId as its own chat;
 * completed image jobs land in the synthetic `user_library` chat instead.
 *
 * Strategy:
 * 1. Exact chatId match (if present)
 * 2. Fallback scan (prefer user_library) by prompt / model / sinceTs
 * 3. activeGeneration for requested chatId → processing
 */
export function findResultInHistory(
  historyPayload,
  { chatId = null, promptSubstr = null, model = null, sinceTs = null } = {},
) {
  const chats = Array.isArray(historyPayload?.history) ? historyPayload.history : [];

  const promptOk = (chat, msg) => {
    if (!promptSubstr) return true;
    const promptText = String(msg.prompt || msg.text || msg.content || msg.message || "");
    const titleText = String(chat.title || "");
    return promptText.includes(promptSubstr) || titleText.includes(promptSubstr);
  };

  const modelOk = (msg) => {
    if (!model) return true;
    const want = normModel(model);
    const have = normModel(msg.modelName || msg.model || "");
    if (!want || !have) return true;
    return want.includes(have) || have.includes(want);
  };

  const tsOk = (msg) => {
    if (sinceTs == null || sinceTs === "") return true;
    const ts = Number(msg.timestamp || msg.createdAt || msg.created_at || 0);
    if (!Number.isFinite(ts)) return true;
    return ts >= Number(sinceTs) - 5000;
  };

  const scanMessages = (scanChats, { exactChat }) => {
    for (const chat of scanChats) {
      const botMsgs = (chat.messages || []).filter((m) => isBotMessage(m));
      for (let i = botMsgs.length - 1; i >= 0; i--) {
        const msg = botMsgs[i];
        if (!exactChat) {
          if (promptSubstr && !promptOk(chat, msg)) continue;
          if (!modelOk(msg)) continue;
          if (!tsOk(msg)) continue;
        }

        const errText = msg.error || msg.errorMessage || msg.error_message;
        if (msg.isError || errText) {
          return {
            status: "error",
            chatId: chat.id || chat.chatId,
            msgId: msg.id,
            message: errText || msg.text || "generation error",
            raw: msg,
            matchedVia: exactChat ? "exact_chat" : "library_fallback",
          };
        }

        const media = extractMedia(msg);
        if (media) {
          return {
            status: "completed",
            chatId: chat.id || chat.chatId,
            msgId: msg.id,
            media,
            prompt: msg.prompt || msg.text,
            modelName: msg.modelName || msg.model,
            resolution: msg.resolution,
            quality: msg.quality,
            ratio: msg.ratio || msg.aspectRatio || msg.aspect_ratio,
            timestamp: msg.timestamp,
            raw: msg,
            matchedVia: exactChat ? "exact_chat" : "library_fallback",
          };
        }

        const statusLower = String(msg.status || "").toLowerCase();
        if (
          msg.isLoading === true ||
          ["loading", "pending", "processing", "running", "queued"].includes(statusLower)
        ) {
          return {
            status: "processing",
            chatId: chat.id || chat.chatId,
            msgId: msg.id,
            raw: msg,
            matchedVia: exactChat ? "exact_chat" : "library_fallback",
          };
        }

        if (msg.isLoading === false) {
          return {
            status: "error",
            chatId: chat.id || chat.chatId,
            msgId: msg.id,
            message: msg.text || msg.content || "Generation finished without media",
            raw: msg,
            matchedVia: exactChat ? "exact_chat" : "library_fallback",
          };
        }
      }
    }
    return null;
  };

  // Exact chatId only when a concrete id was requested. When chatId is null
  // (loose scan), skip so prompt/model/since filters apply.
  if (chatId) {
    const matchedChats = chats.filter(
      (c) => String(c.id || c.chatId || "") === String(chatId),
    );
    if (matchedChats.length) {
      const hit = scanMessages(matchedChats, { exactChat: true });
      if (hit) return hit;
    }
  }

  // Fallback: client chatId often never appears; results land in user_library.
  if (promptSubstr || model || sinceTs != null || !chatId) {
    const lib = chats.filter((c) => String(c.id || "") === "user_library");
    const others = chats.filter((c) => String(c.id || "") !== "user_library");
    const hit = scanMessages([...lib, ...others], { exactChat: false });
    if (hit) return hit;
  }

  const active = historyPayload?.activeGeneration;
  if (active && typeof active === "object") {
    const activeCid = String(active.chatId || active.id || "");
    if (chatId && activeCid === String(chatId)) {
      return {
        status: "processing",
        chatId,
        msgId: null,
        raw: active,
        matchedVia: "activeGeneration",
      };
    }
    if (!chatId) {
      return {
        status: "processing",
        chatId: activeCid || null,
        msgId: null,
        raw: active,
        matchedVia: "activeGeneration",
      };
    }
  }

  return null;
}

export async function getLoginUrl(env) {
  const data = await dfRequest(env, "GET", "/api/auth/discord/url");
  return data.url;
}

export async function exchangeCode(env, code) {
  return dfRequest(env, "POST", "/api/auth/discord/callback", { body: { code } });
}

export async function creditsPool(env) {
  return dfRequest(env, "GET", "/api/artlist/credits-progress");
}

/** Fetch upstream /api/global-settings (model hide flags, pool max, etc.). */
export async function globalSettings(env) {
  return dfRequest(env, "GET", "/api/global-settings");
}

/** Fetch live GET /api/models (appEnabled/apiEnabled runtime catalog). */
export async function upstreamModels(env) {
  return dfRequest(env, "GET", "/api/models");
}

/**
 * List models filtered by global-settings + live /api/models enable flags.
 * @param {any} env
 * @param {{ type?: string|null, includeHidden?: boolean, onlyLiveEnabled?: boolean }} [opts]
 */
export async function listAvailableModels(
  env,
  { type = null, includeHidden = false, onlyLiveEnabled = false } = {}
) {
  let settings = {};
  let settingsError = null;
  try {
    settings = (await globalSettings(env)) || {};
  } catch (e) {
    settingsError = e?.message || String(e);
    settings = {};
  }

  let upstreamRaw = null;
  let modelsError = null;
  try {
    upstreamRaw = (await upstreamModels(env)) || {};
  } catch (e) {
    modelsError = e?.message || String(e);
    upstreamRaw = null;
  }

  const upstreamMap =
    upstreamRaw != null ? parseUpstreamModelsMap(upstreamRaw) : null;

  const statuses = extractModelStatuses(settings);
  const items = listModels(type, {
    includeHidden,
    modelStatuses: Object.keys(settings).length ? statuses : null,
    upstreamModels: upstreamMap,
    onlyLiveEnabled,
  });
  const models = items
    .map((m) =>
      enrichModelDict(modelToDict(m), statuses, { upstreamModels: upstreamMap })
    )
    .sort((a, b) => {
      const le = a.live_enabled ? 0 : 1;
      const re = b.live_enabled ? 0 : 1;
      if (le !== re) return le - re;
      const ar = a.recommended ? 0 : 1;
      const br = b.recommended ? 0 : 1;
      if (ar !== br) return ar - br;
      const au = a.unlimited ? 0 : 1;
      const bu = b.unlimited ? 0 : 1;
      if (au !== bu) return au - bu;
      const ap = a.id === "nano-banana-2-lite" ? 0 : 1;
      const bp = b.id === "nano-banana-2-lite" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.id).localeCompare(String(b.id));
    });
  const summary = Object.keys(settings).length
    ? summarizeGlobalSettings(settings)
    : {
        artlistPoolBar: null,
        artlistPoolMax: null,
        videoCooldown: null,
        announcementActive: null,
        announcementText: null,
        masterArtlistAutomation: null,
        hideCreditSystem: null,
        hideSponsorBtn: null,
        modelStatuses: {},
        hidden_models: [],
        raw: null,
      };

  return {
    models,
    global_settings: summary,
    include_hidden: includeHidden,
    only_live_enabled: onlyLiveEnabled,
    live_enabled_models: models.filter((m) => m.live_enabled).map((m) => m.id),
    settings_error: settingsError,
    models_error: modelsError,
    upstream_models_count: upstreamMap != null ? Object.keys(upstreamMap).length : null,
  };
}

export async function checkTag(env, userId) {
  return dfRequest(env, "GET", `/api/user/check-tag/${userId}`);
}

export async function balance(env, auth) {
  return dfRequest(env, "GET", `/api/bananas/${auth.userId}`, {
    params: { token: auth.token },
  });
}

export async function acceptTerms(env, auth) {
  return dfRequest(env, "POST", "/api/terms/accept", {
    body: { userId: auth.userId, token: auth.token },
  });
}

export async function history(env, auth, { limit = 20, offset = 0 } = {}) {
  return dfRequest(env, "GET", `/api/history/${auth.userId}`, {
    params: { token: auth.token, limit, offset },
  });
}

export async function deleteHistory(env, auth, chatId) {
  return dfRequest(env, "DELETE", `/api/history/${auth.userId}/${chatId}`, {
    params: { token: auth.token },
  });
}

export async function generate(env, auth, {
  prompt,
  model,
  settings,
  chatId,
  imagePaths = null,
}) {
  const payload = {
    userId: auth.userId,
    token: auth.token,
    chatId,
    model,
    prompt,
    settings,
  };
  if (imagePaths?.length) {
    payload.imagePaths = imagePaths;
    payload.imagePath = imagePaths[0];
  }
  return dfRequest(env, "POST", "/api/generate", { body: payload });
}
