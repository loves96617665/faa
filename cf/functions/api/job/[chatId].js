import { json, err, extractAuth, requireAuth } from "../../_shared/http.js";
import {
  history,
  findResultInHistory,
  absoluteMediaUrl,
  DaFreeAiError,
} from "../../_shared/client.js";

/**
 * GET /api/job/:chatId?prompt=...&model=...&since=...
 * Poll a single chat job status (non-blocking).
 *
 * Upstream often never materializes client chatId; completed images land in
 * synthetic `user_library`. Pass prompt/model/since for library fallback match.
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
  const model = url.searchParams.get("model") || null;
  const sinceRaw = url.searchParams.get("since");
  let sinceTs = null;
  if (sinceRaw != null && sinceRaw !== "") {
    const n = Number(sinceRaw);
    if (Number.isFinite(n)) sinceTs = n;
  }

  let hist;
  try {
    hist = await history(env, auth, { limit: 30, offset: 0 });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
    return err(e.message || String(e), status);
  }

  const found = findResultInHistory(hist, {
    chatId,
    promptSubstr,
    model,
    sinceTs,
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
    matchedVia: found.matchedVia,
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
