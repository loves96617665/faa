import { json, extractAuth, baseUrl } from "../_shared/http.js";
import {
  creditsPool,
  balance,
  checkTag,
  history,
} from "../_shared/client.js";

/**
 * GET /api/status
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  const result = {
    ok: true,
    runtime: "cloudflare-pages-functions",
    phase: 1,
    base_url: baseUrl(env),
  };

  try {
    result.credits_pool = await creditsPool(env);
  } catch (e) {
    result.credits_pool_error = e.message || String(e);
  }

  if (auth.userId && auth.token) {
    try {
      result.balance = await balance(env, auth);
    } catch (e) {
      result.balance_error = e.message || String(e);
    }
    try {
      result.tag = await checkTag(env, auth.userId);
    } catch (e) {
      result.tag_error = e.message || String(e);
    }
    try {
      const hist = await history(env, auth, { limit: 3, offset: 0 });
      result.active = {
        activeGeneration: hist?.activeGeneration,
        activeGenerationsCount: hist?.activeGenerationsCount,
        hasMore: hist?.hasMore,
      };
    } catch (e) {
      result.active_error = e.message || String(e);
    }
  } else {
    result.auth = "missing (send X-User-Id / X-User-Token)";
  }

  return json(result);
}
