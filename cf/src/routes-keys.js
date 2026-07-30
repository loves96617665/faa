/** API Key management (session auth only) */

import { json, err, readJson, extractAuth, requireAuth } from "../functions/_shared/http.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../functions/_shared/keys.js";
import { classifyError, errorBody } from "../functions/_shared/errors.js";

export async function apiKeysList(context) {
  const auth = extractAuth(context.request);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }
  try {
    const keys = await listApiKeys(context.env, auth.userId);
    return json({ ok: true, keys });
  } catch (e) {
    const c = classifyError(e.message || e, e.status);
    return json(errorBody(c), c.http);
  }
}

export async function apiKeysCreate(context) {
  const body = await readJson(context.request);
  const auth = extractAuth(context.request, body);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const name = String(body.name || "default").trim() || "default";
  let scopes = body.scopes;
  if (typeof scopes === "string") {
    scopes = scopes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(scopes) || !scopes.length) scopes = ["*"];

  try {
    const key = await createApiKey(context.env, {
      userId: auth.userId,
      token: auth.token,
      username: body.username || "",
      name,
      scopes,
    });
    return json({ ok: true, key }, 201);
  } catch (e) {
    const c = classifyError(e.message || e, e.status);
    return json(errorBody(c), c.http);
  }
}

export async function apiKeysRevoke(context) {
  const auth = extractAuth(context.request);
  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }
  const keyId = String(context.params?.id || "").trim();
  if (!keyId) return err("缺少 key id");

  try {
    const key = await revokeApiKey(context.env, auth.userId, keyId);
    return json({ ok: true, key });
  } catch (e) {
    const c = classifyError(e.message || e, e.status);
    return json(errorBody(c), c.http);
  }
}
