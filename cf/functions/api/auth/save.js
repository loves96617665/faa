import { json, err, readJson, extractUserFields } from "../../_shared/http.js";

/**
 * Phase 1: validate credentials only. Persistence is browser localStorage.
 */
export async function onRequestPost(context) {
  const body = await readJson(context.request);

  if (body.json) {
    let data = body.json;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return err(`JSON 解析失敗：${e.message || e}`);
      }
    }
    if (!data || typeof data !== "object") return err("json 格式錯誤");
    const fields = extractUserFields(data);
    if (!fields.id || !fields.token) return err("JSON 缺少 id/token");
    return json({
      ok: true,
      user: {
        id: fields.id,
        username: fields.username,
        hasToken: true,
        token: fields.token,
      },
      saved: "browser-localStorage",
    });
  }

  const uid = String(body.userId || body.id || "").trim();
  const token = String(body.token || "").trim();
  const username = String(body.username || "").trim();
  if (!uid || !token) return err("userId 與 token 必填");
  return json({
    ok: true,
    user: { id: uid, username, hasToken: true, token },
    saved: "browser-localStorage",
  });
}
