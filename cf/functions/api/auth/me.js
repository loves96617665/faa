import { json, extractAuth, requireAuth } from "../../_shared/http.js";
import { balance, checkTag, DaFreeAiError } from "../../_shared/client.js";

export async function onRequestGet(context) {
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
    requireAuth(auth);
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
