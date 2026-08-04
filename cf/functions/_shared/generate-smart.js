/**
 * Smart generate wrapper for flaky upstream models (esp. gpt-image-2).
 * - Alias normalize (gpt-image-2-fast → gpt-image-2)
 * - When artlist pool credits=0, force quality=low for GPT image models
 * - On MODEL_NOT_ALLOWED / MODEL_LOCKED, auto-retry once with quality=low
 * - Optional fallback to nano-banana-2-lite
 * - Busy (single global generation slot) → wait & resubmit, bounded budget
 * - HTTP 200 + {error:...} body treated as submit error, not silent success
 * - Account pool: true parallel via generateWithPool (mode auto|pool|personal)
 * - Live /api/models overlay for resolution/quality soft-clamp
 */

import { creditsPool, DaFreeAiError, upstreamModels } from "./client.js";
import {
  validateGenerateParams,
  normalizeModelId,
  isGptImage,
  parseUpstreamModelsMap,
} from "./models.js";
import { generateWithPool, releasePoolAccount, poolStats } from "./pool.js";

function isRetryableModelError(msg) {
  const s = String(msg || "");
  return (
    /MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE/i.test(s) ||
    /All accounts are currently inactive/i.test(s) ||
    /is locked/i.test(s) ||
    /MODEL_NOT_ALLOWED/i.test(s)
  );
}

function isBusyError(msg) {
  // Upstream allows only ONE active generation per account globally. While
  // another job runs it replies with a busy message; keep tokens specific to
  // observed upstream wording to avoid false-positive long waits.
  const s = String(msg || "").toLowerCase();
  return s.includes("generation in progress") || s.includes("already generating");
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

  // Live catalog overlay (supportedResolutions / qualities / imageReferenceEnabled)
  let upstreamMap = null;
  try {
    const raw = await upstreamModels(env);
    upstreamMap = parseUpstreamModelsMap(raw || {});
  } catch {
    upstreamMap = null;
  }

  const refs = Array.isArray(imagePaths) ? imagePaths : null;
  const mode = String(poolMode || "auto").toLowerCase();
  if (mode !== "personal") {
    adjustments.push(`poolMode:${mode}`);
  }

  function build(modelIdIn, qualityIn, imagePathsIn = refs) {
    return validateGenerateParams(modelIdIn, {
      aspect,
      resolution,
      quality: qualityIn,
      duration,
      audio,
      imagePaths: imagePathsIn || [],
      upstreamModels: upstreamMap,
    });
  }

  let model;
  let settings;
  ({ model, settings } = build(modelId, q));

  async function tryOnce(mid, set) {
    const res = await generateWithPool(env, auth, {
      prompt,
      model: mid,
      settings: set,
      chatId,
      imagePaths: refs?.length ? refs : null,
      mode,
      jobId: chatId,
    });
    // Some upstream errors come back with HTTP 200 + {error: ...}; treat a
    // non-ok body as a submit error instead of silently returning it as a
    // successful submission. Applied on every path (primary / retry / fallback).
    if (!res?.submit || !res.submit.ok) {
      const body = res?.submit || {};
      throw new DaFreeAiError(
        String(body.error || body.message || "submit failed"),
        { status: 200, payload: body }
      );
    }
    return res;
  }

  let poolResult;
  let fallbackUsed = false;
  let fromPool = false;
  let poolAccount = null;
  let pStats = null;

  // Busy retry: upstream keeps a SINGLE global generation slot per account.
  // While another job runs it replies "Generation in progress"; the right
  // move is to wait for the slot and resubmit the exact same payload.
  // TOTAL_BUSY_BUDGET_MS bounds the whole busy phase so it does not silently
  // exceed the caller's overall timeout.
  const BUSY_INTERVAL_MS = 6_000;
  const TOTAL_BUSY_BUDGET_MS = 60_000;
  let busyAttempts = 0;
  const busyStarted = Date.now();
  try {
    for (;;) {
      try {
        poolResult = await tryOnce(modelId, settings);
        break;
      } catch (e0) {
        const msg0 =
          e0 instanceof DaFreeAiError ? e0.message : e0.message || String(e0);
        const busyElapsed = Date.now() - busyStarted;
        if (isBusyError(msg0) && busyElapsed < TOTAL_BUSY_BUDGET_MS) {
          busyAttempts += 1;
          adjustments.push(
            `busy-wait:${busyAttempts} (generation slot busy, waiting ${BUSY_INTERVAL_MS / 1000}s)`
          );
          await new Promise((resolve) => setTimeout(resolve, BUSY_INTERVAL_MS));
          continue;
        }
        throw e0;
      }
    }
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
    // Fallback drops image refs (lite path is most reliable without refs)
    ({ model, settings } = build(modelId, q, null));
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

export { normalizeModelId, isGptImage, poolStats, releasePoolAccount };
