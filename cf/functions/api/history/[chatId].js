import { json, err, extractAuth, requireAuth } from "../../_shared/http.js";
import { deleteHistory, DaFreeAiError } from "../../_shared/client.js";

/**
 * DELETE /api/history/:chatId
 */
export async function onRequestDelete(context) {
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
