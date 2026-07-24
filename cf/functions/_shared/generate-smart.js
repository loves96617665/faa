/**
 * Smart generate wrapper for flaky upstream models (esp. gpt-image-2).
 * - Alias normalize (gpt-image-2-fast → gpt-image-2)
 * - When artlist pool credits=0, force quality=low for GPT image models
 * - On MODEL_NOT_ALLOWED / MODEL_LOCKED, auto-retry once with quality=low
 * - Optional fallback to nano-banana-2-lite
 * - Account pool: true parallel via generateWithPool (mode auto|pool|personal)
 */

import { creditsPool, DaFreeAiError } from "./client.js";
import { validateGenerateParams } from "./models.js";
import { generateWithPool, releasePoolAccount, poolStats } from "./pool.js";

const GPT_IMAGE_IDS = new Set(["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"]);

const MODEL_ALIASES = {
  "gpt-image-2-fast": "gpt-image-2",
  "gpt-image2": "gpt-image-2",
  gpt2: "gpt-image-2",
  "gpt-image": "gpt-image-2",
};

function isGptImage(modelId) {
  return GPT_IMAGE_IDS.has(String(modelId || "").toLowerCase());
}

function isRetryableModelError(msg) {
  const s = String(msg || "");
  return (
    /MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE/i.test(s) ||
    /All accounts are currently inactive/i.test(s) ||
    /is locked/i.test(s) ||
    /MODEL_NOT_ALLOWED/i.test(s)
  );
}

export function normalizeModelId(modelId) {
  const raw = String(modelId || "nano-banana-2-lite").trim();
  const key = raw.toLowerCase();
  return MODEL_ALIASES[key] || raw;
}

/**
 * @returns {Promise<{
 *  modelId: string,
 *  model: any,
 *  settings: Record<string, unknown>,
 *  submit: any,
 *  chatId: string,
 *  adjustments: string[],
 *  fallbackUsed: boolean,
 *  originalModel: string,
 *  originalQuality: string,
 *  poolCredits: number|null,
 *  fromPool: boolean,
 *  poolAccount: any,
 *  poolStats: any,
 * }>}
 */
export async function smartGenerate(
  env,
  auth,
  {
    prompt,
    model: rawModel,
    aspect = "1:1",
    resolution,
    quality = "low",
    duration = 5,
    audio = true,
    chatId,
    imagePaths = null,
    /** auto | never | always — default auto for gpt models */
    fallback = "auto",
    /** if true, never force quality down (still retries on hard errors) */
    forceQuality = false,
    /** auto | pool | personal — account pool mode */
    poolMode = "auto",
  } = {}
) {
  const originalModel = String(rawModel || "nano-banana-2-lite").trim();
  const originalQuality = String(quality || "low").toLowerCase();
  let modelId = normalizeModelId(originalModel);
  const adjustments = [];
  if (modelId !== originalModel) {
    adjustments.push(`alias:${originalModel}→${modelId}`);
  }

  let q = originalQuality;
  let poolCredits = null;
  try {
    const pool = await creditsPool(env);
    poolCredits = Number(pool?.totalCredits ?? pool?.credits ?? NaN);
  } catch {
    poolCredits = null;
  }

  // Empirically: with poolCredits=0, high often locks; low/medium can still work.
  if (
    isGptImage(modelId) &&
    !forceQuality &&
    q === "high" &&
    (poolCredits === null || Number.isNaN(poolCredits) || poolCredits <= 0)
  ) {
    adjustments.push(`quality:high→low (poolCredits=${poolCredits ?? "unknown"})`);
    q = "low";
  }

  const refs = Array.isArray(imagePaths) ? imagePaths : null;
  const mode = String(poolMode || "auto").toLowerCase();
  if (mode !== "personal") {
    adjustments.push(`poolMode:${mode}`);
  }

  function build(modelIdIn, qualityIn) {
    return validateGenerateParams(modelIdIn, {
      aspect,
      resolution,
      quality: qualityIn,
      duration,
      audio,
      imagePaths: refs || [],
    });
  }

  let model;
  let settings;
  ({ model, settings } = build(modelId, q));

  async function tryOnce(mid, set) {
    return generateWithPool(env, auth, {
      prompt,
      model: mid,
      settings: set,
      chatId,
      imagePaths: refs?.length ? refs : null,
      mode,
      jobId: chatId,
    });
  }

  let poolResult;
  let fallbackUsed = false;
  let fromPool = false;
  let poolAccount = null;
  let pStats = null;

  try {
    poolResult = await tryOnce(modelId, settings);
  } catch (e) {
    const msg = e instanceof DaFreeAiError ? e.message : e.message || String(e);

    // Retry same model with quality=low
    if (isGptImage(modelId) && q !== "low" && isRetryableModelError(msg)) {
      adjustments.push(`retry:quality=${q}→low after ${msg.slice(0, 80)}`);
      q = "low";
      ({ model, settings } = build(modelId, q));
      try {
        poolResult = await tryOnce(modelId, settings);
      } catch (e2) {
        const msg2 = e2 instanceof DaFreeAiError ? e2.message : e2.message || String(e2);
        if (shouldFallback(fallback, modelId) && isRetryableModelError(msg2)) {
          return doFallback(msg2);
        }
        throw e2;
      }
    } else if (shouldFallback(fallback, modelId) && isRetryableModelError(msg)) {
      return doFallback(msg);
    } else {
      throw e;
    }
  }

  fromPool = !!poolResult.fromPool;
  poolAccount = poolResult.poolAccount || null;
  pStats = poolResult.poolStats || null;
  if (fromPool && poolAccount?.id) {
    adjustments.push(`poolAccount:${poolAccount.id}`);
  }

  return {
    modelId,
    model,
    settings,
    submit: poolResult.submit,
    chatId: poolResult.chatId || chatId,
    adjustments,
    fallbackUsed,
    originalModel,
    originalQuality,
    poolCredits,
    fromPool,
    poolAccount,
    poolStats: pStats,
  };

  async function doFallback(prevMsg) {
    const fb = "nano-banana-2-lite";
    adjustments.push(`fallback:${modelId}→${fb} after ${String(prevMsg).slice(0, 80)}`);
    modelId = fb;
    q = "low";
    ({ model, settings } = build(modelId, q));
    poolResult = await tryOnce(modelId, settings);
    fallbackUsed = true;
    fromPool = !!poolResult.fromPool;
    poolAccount = poolResult.poolAccount || null;
    pStats = poolResult.poolStats || null;
    if (fromPool && poolAccount?.id) {
      adjustments.push(`poolAccount:${poolAccount.id}`);
    }
    return {
      modelId,
      model,
      settings,
      submit: poolResult.submit,
      chatId: poolResult.chatId || chatId,
      adjustments,
      fallbackUsed,
      originalModel,
      originalQuality,
      poolCredits,
      fromPool,
      poolAccount,
      poolStats: pStats,
    };
  }
}

function shouldFallback(fallback, modelId) {
  if (fallback === true || fallback === "always") return true;
  if (fallback === false || fallback === "never") return false;
  // auto: only for gpt image models
  return isGptImage(modelId);
}

export { poolStats, releasePoolAccount };
