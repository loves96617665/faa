/** Upstream client for https://www.dafreeai.site */

import { baseUrl } from "./http.js";

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
  let media =
    message?.image ||
    message?.imageUrl ||
    message?.url ||
    message?.video ||
    message?.videoUrl ||
    null;
  if (!media && message?.outputImages) {
    const outs = message.outputImages;
    if (Array.isArray(outs) && outs.length) media = outs[0];
  }
  if (media && !String(media).includes("placeholder")) return String(media);
  return null;
}

/**
 * Find latest bot result for chat (ported + fixed error field handling).
 */
export function findResultInHistory(historyPayload, { chatId = null, promptSubstr = null } = {}) {
  for (const chat of historyPayload?.history || []) {
    if (chatId && String(chat.id) !== String(chatId)) continue;
    const botMsgs = (chat.messages || []).filter((m) => m.role === "bot");
    for (let i = botMsgs.length - 1; i >= 0; i--) {
      const msg = botMsgs[i];
      const promptText = String(msg.prompt || msg.text || "");
      const titleText = String(chat.title || "");
      if (promptSubstr && !promptText.includes(promptSubstr) && !titleText.includes(promptSubstr)) {
        continue;
      }

      const errText = msg.error;
      if (msg.isError || errText) {
        return {
          status: "error",
          chatId: chat.id,
          msgId: msg.id,
          message: errText || msg.text || "generation error",
          raw: msg,
        };
      }

      const media = extractMedia(msg);
      if (media) {
        return {
          status: "completed",
          chatId: chat.id,
          msgId: msg.id,
          media,
          prompt: msg.prompt,
          modelName: msg.modelName,
          resolution: msg.resolution,
          quality: msg.quality,
          ratio: msg.ratio || msg.aspectRatio,
          raw: msg,
        };
      }

      if (msg.isLoading === true) {
        return {
          status: "processing",
          chatId: chat.id,
          msgId: msg.id,
          raw: msg,
        };
      }

      if (msg.isLoading === false) {
        return {
          status: "error",
          chatId: chat.id,
          msgId: msg.id,
          message: msg.text || "Generation finished without media",
          raw: msg,
        };
      }
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
