/** HTTP helpers for Pages Functions */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function err(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function baseUrl(env) {
  return (env?.DAFREEAI_BASE_URL || "https://www.dafreeai.site").replace(/\/$/, "");
}

/**
 * Extract credentials from headers or JSON body.
 * Headers preferred: X-User-Id / X-User-Token
 */
export function extractAuth(request, body = {}) {
  const h = request.headers;
  const uid =
    h.get("X-User-Id") ||
    h.get("x-user-id") ||
    body.userId ||
    body.id ||
    body.user_id ||
    "";
  const token =
    h.get("X-User-Token") ||
    h.get("x-user-token") ||
    body.token ||
    "";
  return {
    userId: String(uid || "").trim(),
    token: String(token || "").trim(),
  };
}

export function requireAuth(auth) {
  if (!auth?.userId || !auth?.token) {
    const e = new Error("Missing userId/token. Login first (paste dafreeai_user JSON).");
    e.status = 401;
    throw e;
  }
}

export function extractUserFields(data) {
  let d = data || {};
  if (d.user && typeof d.user === "object") d = d.user;
  return {
    id: String(d.id || d.userId || d.user_id || ""),
    token: d.token || "",
    username: d.username || d.global_name || d.globalName || "",
    tokens: d.tokens,
    raw: d,
  };
}

export function uuid() {
  return crypto.randomUUID();
}
