import { json, err, extractAuth, requireAuth } from "../_shared/http.js";
import {
  history,
  extractMedia,
  absoluteMediaUrl,
  DaFreeAiError,
} from "../_shared/client.js";

/**
 * GET /api/history?limit=&offset=
 */
export async function onRequestGet(context) {
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
