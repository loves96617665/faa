import { json, err, extractAuth, requireAuth, readJson } from "../../_shared/http.js";
import { acceptTerms, DaFreeAiError } from "../../_shared/client.js";

export async function onRequestPost(context) {
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
