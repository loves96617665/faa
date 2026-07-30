import {
  json,
  err,
  readJson,
  extractAuth,
  requireAuth,
  uuid,
} from "../_shared/http.js";
import { DaFreeAiError } from "../_shared/client.js";
import { smartGenerate } from "../_shared/generate-smart.js";

/**
 * POST /api/generate
 * Phase 1: always non-blocking (wait=false). Frontend polls /api/job/:chatId.
 * Uses smartGenerate: alias normalize, GPT quality auto-downgrade, retry, fallback.
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
  const fallback = body.fallback ?? "auto";
  const forceQuality = body.forceQuality === true || body.forceQuality === "true";
  const poolMode = String(body.poolMode || body.mode || "auto").toLowerCase();

  let refs = body.imagePaths || body.imageRefs || [];
  if (typeof refs === "string") {
    refs = refs
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(refs)) refs = [];

  try {
    const result = await smartGenerate(context.env, auth, {
      prompt,
      model: modelId,
      aspect,
      resolution,
      quality,
      duration,
      audio,
      chatId,
      imagePaths: refs.length ? refs : null,
      fallback,
      forceQuality,
      poolMode,
    });

    return json({
      ok: true,
      status: "submitted",
      chatId: result.chatId,
      submit: result.submit,
      model: result.modelId,
      type: result.model?.type,
      prompt,
      adjustments: result.adjustments,
      fallbackUsed: result.fallbackUsed,
      originalModel: result.originalModel,
      originalQuality: result.originalQuality,
      poolCredits: result.poolCredits,
      fromPool: !!result.fromPool,
      poolAccount: result.poolAccount
        ? {
            id: result.poolAccount.id,
            name: result.poolAccount.name,
            userId: result.poolAccount.userId,
          }
        : null,
      poolStats: result.poolStats || null,
      settings: result.settings,
    });
  } catch (e) {
    const status =
      e.status === 503 || e.code === "POOL_BUSY"
        ? 503
        : e instanceof DaFreeAiError
          ? e.status || 502
          : e.status || 502;
    return err(`提交失敗：${e.message || e}`, status, {
      payload: e.payload || null,
      code: e.code || null,
    });
  }
}
