import {
  json,
  err,
  readJson,
  extractAuth,
  requireAuth,
  uuid,
} from "../_shared/http.js";
import { validateGenerateParams } from "../_shared/models.js";
import { generate, DaFreeAiError } from "../_shared/client.js";

/**
 * POST /api/generate
 * Phase 1: always non-blocking (wait=false). Frontend polls /api/job/:chatId.
 */
export async function onRequestPost(context) {
  const body = await readJson(context.request);
  const auth = extractAuth(context.request, body);

  try {
    requireAuth(auth);
  } catch (e) {
    return err(e.message || "Unauthorized", e.status || 401);
  }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) return err("prompt 不可為空");

  const modelId = String(body.model || "nano-banana-2-lite").trim();
  const aspect = body.aspect || "1:1";
  const resolution = body.resolution;
  const quality = body.quality || "low";
  const duration = Number(body.duration || 5);
  const audio = body.audio !== false && body.audio !== "false";
  const chatId = String(body.chatId || "").trim() || uuid();

  let refs = body.imagePaths || body.imageRefs || [];
  if (typeof refs === "string") {
    refs = refs
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(refs)) refs = [];

  let model;
  let settings;
  try {
    ({ model, settings } = validateGenerateParams(modelId, {
      aspect,
      resolution,
      quality,
      duration,
      audio,
      imagePaths: refs,
    }));
  } catch (e) {
    return err(e.message || String(e));
  }

  try {
    const submit = await generate(context.env, auth, {
      prompt,
      model: modelId,
      settings,
      chatId,
      imagePaths: refs.length ? refs : null,
    });

    return json({
      ok: true,
      status: "submitted",
      chatId,
      submit,
      model: modelId,
      type: model.type,
      prompt,
    });
  } catch (e) {
    const status = e instanceof DaFreeAiError ? e.status || 502 : 502;
    return err(`提交失敗：${e.message || e}`, status, {
      payload: e.payload || null,
    });
  }
}
