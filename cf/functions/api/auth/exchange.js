import { json, err, readJson, extractUserFields } from "../../_shared/http.js";
import { exchangeCode, DaFreeAiError } from "../../_shared/client.js";

export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const code = String(body.code || "").trim();
  if (!code) return err("缺少 code");
  try {
    const user = await exchangeCode(context.env, code);
    const fields = extractUserFields(user);
    if (!fields.id || !fields.token) {
      return err("交換成功但缺少 id/token", 502, { payload: user });
    }
    // Phase 1: return credentials to browser; do NOT store server-side.
    return json({
      ok: true,
      user: {
        id: fields.id,
        token: fields.token,
        username: fields.username,
        tokens: fields.tokens,
        hasToken: true,
      },
      note: "請由前端寫入 localStorage（伺服器不保存 token）",
    });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 401 : 500;
    return err(
      `${e.message || e}（code 可能已使用，請改貼 localStorage JSON）`,
      status
    );
  }
}
