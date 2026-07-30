import { json, err } from "../../_shared/http.js";
import { getLoginUrl, DaFreeAiError } from "../../_shared/client.js";

export async function onRequestGet(context) {
  try {
    const url = await getLoginUrl(context.env);
    return json({ ok: true, url });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 500 : 500;
    return err(String(e.message || e), status);
  }
}
