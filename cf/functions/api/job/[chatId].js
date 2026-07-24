import { json, err, extractAuth, requireAuth } from "../../_shared/http.js";
import {
  history,
  findResultInHistory,
  absoluteMediaUrl,
  DaFreeAiError,
} from "../../_shared/client.js";

/**
 * GET /api/job/:chatId?prompt=...
 * Poll a single chat job status (non-blocking).
 */
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const auth = extractAuth(request);

  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const chatId = String(params.chatId || "").trim();
  if (!chatId) return err("缺少 chatId");

  const url = new URL(request.url);
  const promptSubstr = url.searchParams.get("prompt") || null;

  let hist;
  try {
    hist = await history(env, auth, { limit: 20, offset: 0 });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
    return err(e.message || String(e), status);
  }

  const found = findResultInHistory(hist, {
    chatId,
    promptSubstr,
  });

  if (!found) {
    return json({
      ok: true,
      status: "pending",
      chatId,
      activeGeneration: hist?.activeGeneration,
      activeGenerationsCount: hist?.activeGenerationsCount,
    });
  }

  const out = {
    ok: true,
    status: found.status,
    chatId: found.chatId || chatId,
    msgId: found.msgId,
    message: found.message,
    result: found,
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
