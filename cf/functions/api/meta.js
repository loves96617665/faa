import { json, baseUrl, extractAuth } from "../_shared/http.js";
import { ASPECT_RATIOS, QUALITIES } from "../_shared/models.js";
import { listAvailableModels } from "../_shared/client.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  const url = new URL(request.url);
  const includeHidden =
    url.searchParams.get("include_hidden") === "1" ||
    url.searchParams.get("include_hidden") === "true";
  const onlyLiveEnabled =
    url.searchParams.get("only_live_enabled") === "1" ||
    url.searchParams.get("only_live_enabled") === "true";
  const type = url.searchParams.get("type") || null;

  let available;
  try {
    available = await listAvailableModels(env, {
      type,
      includeHidden,
      onlyLiveEnabled,
    });
  } catch (e) {
    available = {
      models: [],
      global_settings: null,
      include_hidden: includeHidden,
      only_live_enabled: onlyLiveEnabled,
      live_enabled_models: [],
      settings_error: e.message || String(e),
    };
  }

  const gs = available.global_settings || {};
  const out = {
    ok: true,
    base_url: baseUrl(env),
    aspects: ASPECT_RATIOS,
    qualities: QUALITIES,
    models: available.models,
    include_hidden: available.include_hidden,
    only_live_enabled: available.only_live_enabled ?? onlyLiveEnabled,
    live_enabled_models: available.live_enabled_models || [],
    models_error: available.models_error || null,
    upstream_models_count: available.upstream_models_count ?? null,
    global_settings: gs,
    maxCredits: gs.artlistPoolMax ?? null,
    hidden_models: gs.hidden_models || [],
    settings_error: available.settings_error || null,
    auth: {
      userId: auth.userId || null,
      hasToken: !!auth.token,
      tokenPreview:
        auth.token && auth.token.length > 14
          ? `${auth.token.slice(0, 8)}…${auth.token.slice(-6)}`
          : null,
    },
    runtime: "cloudflare-pages-functions",
    phase: 1,
  };
  return json(out);
}
