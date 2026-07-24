import { json } from "../_shared/http.js";
import { ASPECT_RATIOS, QUALITIES, listModels, modelToDict } from "../_shared/models.js";
import { baseUrl, extractAuth } from "../_shared/http.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = extractAuth(request);
  const models = listModels().map(modelToDict);
  const out = {
    ok: true,
    base_url: baseUrl(env),
    aspects: ASPECT_RATIOS,
    qualities: QUALITIES,
    models,
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
