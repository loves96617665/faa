/** Model catalog + settings builder (ported from dafreeai/models.py) */

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];
export const QUALITIES = ["low", "medium", "high"];

/** Upstream /api/global-settings modelStatuses values treated as hidden in UI lists. */
export const HIDDEN_MODEL_STATUSES = new Set([
  "hide",
  "hidden",
  "disabled",
  "off",
  "false",
  "0",
  "unavailable",
  "maintenance",
]);

/** Client-facing aliases → canonical catalog id. */
export const MODEL_ALIASES = {
  "gpt-image-2-fast": "gpt-image-2",
  "gpt-image2": "gpt-image-2",
  gpt2: "gpt-image-2",
  "gpt-image": "gpt-image-2",
  "seedance-2.0": "seedance-2",
  "seedance-2.0-fast": "seedance-2-fast",
  seedance2: "seedance-2",
  "nano-banana-lite": "nano-banana-2-lite",
  "nano-banana2": "nano-banana-2",
  "nano-banana-2.0": "nano-banana-2",
  "nano-banana-2.0-lite": "nano-banana-2-lite",
};

export const GPT_IMAGE_IDS = new Set(["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"]);

/** Offline fallback when /api/models cannot be fetched (live dual-enabled 2026-07-30). */
export const LIVE_DUAL_ENABLED_FALLBACK = new Set([
  "nano-banana-2-lite",
  "nano-banana-2",
  "gpt-image-2",
]);

/**
 * Resolve client aliases to a canonical catalog model id.
 * @param {string|null|undefined} modelId
 * @param {string} [defaultId]
 */
export function normalizeModelId(modelId, defaultId = "nano-banana-2-lite") {
  const raw = String(modelId || defaultId).trim() || defaultId;
  const key = raw.toLowerCase();
  return MODEL_ALIASES[key] || raw;
}

/**
 * @param {string|null|undefined} modelId
 */
export function isGptImage(modelId) {
  const mid = normalizeModelId(modelId).toLowerCase();
  return GPT_IMAGE_IDS.has(mid) || mid.startsWith("gpt-image");
}

/** @typedef {{
 *  id: string,
 *  name: string,
 *  company: string,
 *  type: 'image'|'video',
 *  supported_resolutions: string[],
 *  model_group_id: number,
 *  unlimited?: boolean,
 *  recommended?: boolean,
 *  tag_required?: boolean,
 *  tag?: string|null,
 *  supports_quality?: boolean,
 *  supports_duration?: boolean,
 *  supports_audio?: boolean,
 *  supports_image_ref?: boolean,
 *  max_image_refs?: number,
 *  default_resolution?: string,
 *  supported_qualities?: string[]|null,
 *  notes?: string
 * }} ModelSpec */

/** @type {Record<string, ModelSpec>} */
export const MODELS = {
  "nano-banana-2-lite": {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    company: "Google",
    type: "image",
    supported_resolutions: ["1K"],
    model_group_id: 414,
    unlimited: true,
    recommended: true,
    tag: "LITE",
    default_resolution: "1K",
    notes: "Recommended default · free/unlimited · most reliable",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    company: "Google",
    type: "image",
    supported_resolutions: ["1K", "2K"],
    model_group_id: 363,
    unlimited: true,
    tag: "NEW",
    default_resolution: "1K",
    notes: "Unlimited · may lock when upstream pool is busy",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "seedream-5.0-pro": {
    id: "seedream-5.0-pro",
    name: "Seedream 5.0 Pro",
    company: "Seedream",
    type: "image",
    supported_resolutions: ["1K", "2K", "4K"],
    model_group_id: 513,
    unlimited: false,
    tag_required: true,
    tag: "PRO",
    default_resolution: "1K",
    notes: "Requires Discord clan tag · often locked when accounts inactive",
    supports_image_ref: false,
    max_image_refs: 3,
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    name: "GPT Image 2",
    company: "OpenAI",
    type: "image",
    supported_resolutions: ["1K", "2K", "4K"],
    model_group_id: 380,
    unlimited: true,
    tag: "PRO",
    supports_quality: true,
    default_resolution: "1K",
    supported_qualities: ["low", "medium", "high"],
    notes: "prefer quality=low · medium OK · high often locked when pool=0 · auto-retry/fallback enabled",
    supports_image_ref: false,
    max_image_refs: 3,
  },
  "gpt-image-1.5": {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    company: "OpenAI",
    type: "image",
    supported_resolutions: ["1K"],
    model_group_id: 322,
    unlimited: false,
    supports_quality: true,
    default_resolution: "1K",
    supported_qualities: ["low", "medium"],
    notes: "Not unlimited · live often disabled · qualities low|medium only",
    supports_image_ref: false,
    max_image_refs: 3,
  },
  "gpt-image-1-mini": {
    id: "gpt-image-1-mini",
    name: "GPT Image 1.0 Mini",
    company: "OpenAI",
    type: "image",
    supported_resolutions: ["1K"],
    model_group_id: 312,
    unlimited: false,
    supports_quality: true,
    default_resolution: "1K",
    supported_qualities: ["low", "medium"],
    notes: "Not unlimited · live often disabled · qualities low|medium only",
    supports_image_ref: false,
    max_image_refs: 3,
  },
  "gemini-omni-flash": {
    id: "gemini-omni-flash",
    name: "Gemini Omni Flash",
    company: "Google",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 400,
    unlimited: false,
    tag_required: true,
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "seedance-2": {
    id: "seedance-2",
    name: "Seedance 2.0",
    company: "Seedance",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 358,
    unlimited: false,
    tag_required: true,
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "seedance-mini": {
    id: "seedance-mini",
    name: "Seedance 2.0 Mini",
    company: "Seedance",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 416,
    unlimited: false,
    tag_required: true,
    tag: "NEW",
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "seedance-2-fast": {
    id: "seedance-2-fast",
    name: "Seedance 2.0 Fast",
    company: "Seedance",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 377,
    unlimited: false,
    tag_required: true,
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "sora-2-pro": {
    id: "sora-2-pro",
    name: "Sora 2 Pro",
    company: "OpenAI",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 111,
    unlimited: false,
    tag_required: true,
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "sora-2": {
    id: "sora-2",
    name: "Sora 2",
    company: "OpenAI",
    type: "video",
    supported_resolutions: ["480p", "720p", "1080p"],
    model_group_id: 110,
    unlimited: false,
    tag_required: true,
    supports_duration: true,
    supports_audio: true,
    default_resolution: "480p",
    notes: "Video · tag required · may lock",
    supports_image_ref: true,
    max_image_refs: 3,
  },
};

/**
 * Normalize upstream modelStatuses map to lowercase id -> status string.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeModelStatuses(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || "").trim().toLowerCase();
    if (!key) continue;
    if (v === true) out[key] = "show";
    else if (v === false || v == null) out[key] = "hide";
    else out[key] = String(v).trim().toLowerCase() || "show";
  }
  return out;
}

/**
 * @param {Record<string, unknown>|null|undefined} globalSettings
 * @returns {Record<string, string>}
 */
export function extractModelStatuses(globalSettings) {
  if (!globalSettings || typeof globalSettings !== "object") return {};
  return normalizeModelStatuses(globalSettings.modelStatuses);
}

/**
 * @param {string} modelId
 * @param {Record<string, string>|null|undefined} modelStatuses
 */
export function modelUpstreamStatus(modelId, modelStatuses) {
  if (!modelStatuses) return "show";
  const key = String(modelId || "").trim().toLowerCase();
  return modelStatuses[key] || "show";
}

/**
 * @param {string} modelId
 * @param {Record<string, string>|null|undefined} modelStatuses
 */
export function isModelUiHidden(modelId, modelStatuses) {
  const status = modelUpstreamStatus(modelId, modelStatuses);
  return HIDDEN_MODEL_STATUSES.has(status);
}

/**
 * Attach upstream visibility + live enable fields to a model dict.
 * @param {Record<string, unknown>} data
 * @param {Record<string, string>|null|undefined} modelStatuses
 * @param {{ upstreamModels?: Record<string, Record<string, unknown>>|null }} [opts]
 */
export function enrichModelDict(data, modelStatuses, opts = {}) {
  const mid = String(data?.id || "");
  const status = modelUpstreamStatus(mid, modelStatuses);
  const hidden = HIDDEN_MODEL_STATUSES.has(status);
  /** @type {Record<string, unknown>} */
  const out = {
    ...data,
    upstream_status: status,
    ui_hidden: hidden,
  };

  const upstreamModels = opts.upstreamModels;
  const meta = lookupUpstreamModelMeta(mid, upstreamModels);
  if (meta) {
    const appEn = !!meta.appEnabled;
    const apiEn = !!meta.apiEnabled;
    out.app_enabled = appEn;
    out.api_enabled = apiEn;
    out.live_enabled = appEn && apiEn;
    out.provider = meta.provider ?? null;
    out.has_delay = !!meta.hasDelay;
    if (meta.imageReferenceEnabled != null) {
      out.supports_image_ref = !!meta.imageReferenceEnabled;
    }
    const res = meta.supportedResolutions || meta.supported_resolutions;
    if (Array.isArray(res) && res.length) {
      out.supported_resolutions = res.map(String).filter(Boolean);
      if (!/** @type {string[]} */ (out.supported_resolutions).includes(String(out.default_resolution || ""))) {
        out.default_resolution = /** @type {string[]} */ (out.supported_resolutions)[0];
      }
    }
    const quals = meta.supportedQualities || meta.supported_qualities;
    if (Array.isArray(quals) && quals.length) {
      out.supported_qualities = quals.map((x) => String(x).toLowerCase()).filter(Boolean);
      out.supports_quality = true;
    }
    if (meta.customDimensions != null) {
      out.custom_dimensions = !!meta.customDimensions;
    }
  } else {
    const fallbackOn = LIVE_DUAL_ENABLED_FALLBACK.has(mid.toLowerCase());
    const useFallback = upstreamModels == null;
    out.app_enabled = useFallback ? fallbackOn : false;
    out.api_enabled = useFallback ? fallbackOn : false;
    out.live_enabled = useFallback ? fallbackOn : false;
  }
  return out;
}

/**
 * Pick stable fields from /api/global-settings for API responses.
 * @param {Record<string, unknown>|null|undefined} globalSettings
 */
export function summarizeGlobalSettings(globalSettings) {
  const gs = globalSettings && typeof globalSettings === "object" ? globalSettings : {};
  const statuses = extractModelStatuses(gs);
  const hidden = Object.entries(statuses)
    .filter(([, v]) => HIDDEN_MODEL_STATUSES.has(v))
    .map(([k]) => k)
    .sort();
  return {
    artlistPoolBar: gs.artlistPoolBar ?? null,
    artlistPoolMax: gs.artlistPoolMax ?? null,
    videoCooldown: gs.videoCooldown ?? null,
    announcementActive: gs.announcementActive ?? null,
    announcementText: gs.announcementText ?? null,
    masterArtlistAutomation: gs.masterArtlistAutomation ?? null,
    hideCreditSystem: gs.hideCreditSystem ?? null,
    hideSponsorBtn: gs.hideSponsorBtn ?? null,
    modelStatuses: statuses,
    hidden_models: hidden,
    raw: Object.keys(gs).length ? gs : null,
  };
}

/**
 * List catalog models.
 * @param {string|undefined|null} type
 * @param {{
 *   includeHidden?: boolean,
 *   modelStatuses?: Record<string, string>|null,
 *   globalSettings?: Record<string, unknown>|null,
 *   upstreamModels?: Record<string, Record<string, unknown>>|null,
 *   onlyLiveEnabled?: boolean,
 * }} [opts]
 */
export function listModels(type, opts = {}) {
  const includeHidden = opts.includeHidden !== false;
  let items = Object.values(MODELS);
  if (type) items = items.filter((m) => m.type === String(type).toLowerCase());

  let statuses = opts.modelStatuses;
  if (statuses == null && opts.globalSettings != null) {
    statuses = extractModelStatuses(opts.globalSettings);
  }

  if (statuses != null && !includeHidden) {
    items = items.filter((m) => !isModelUiHidden(m.id, statuses));
  }

  const upstreamModels = opts.upstreamModels;
  if (opts.onlyLiveEnabled) {
    items = items
      .map((m) => {
        const meta = lookupUpstreamModelMeta(m.id, upstreamModels);
        if (meta) {
          if (meta.appEnabled && meta.apiEnabled) return applyLiveModelOverrides(m, meta);
          return null;
        }
        if (upstreamModels == null && LIVE_DUAL_ENABLED_FALLBACK.has(m.id)) return m;
        return null;
      })
      .filter(Boolean);
  } else if (upstreamModels != null) {
    items = items.map((m) => applyLiveModelOverrides(m, lookupUpstreamModelMeta(m.id, upstreamModels)));
  }

  items.sort((a, b) => {
    const ar = a.recommended ? 0 : 1;
    const br = b.recommended ? 0 : 1;
    if (ar !== br) return ar - br;
    const au = a.unlimited ? 0 : 1;
    const bu = b.unlimited ? 0 : 1;
    if (au !== bu) return au - bu;
    const ap = a.id === "nano-banana-2-lite" ? 0 : 1;
    const bp = b.id === "nano-banana-2-lite" ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return String(a.id).localeCompare(String(b.id));
  });
  return items;
}

/**
 * Parse GET /api/models payload into {model_id_lower: meta}.
 * @param {unknown} raw
 * @returns {Record<string, Record<string, unknown>>}
 */
export function parseUpstreamModelsMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const modelsObj =
    obj.models && typeof obj.models === "object" && !Array.isArray(obj.models)
      ? /** @type {Record<string, unknown>} */ (obj.models)
      : obj;
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const [k, v] of Object.entries(modelsObj)) {
    const key = String(k || "").trim().toLowerCase();
    if (!key) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[key] = /** @type {Record<string, unknown>} */ (v);
    } else {
      out[key] = { raw: v };
    }
  }
  return out;
}

/**
 * @param {string} modelId
 * @param {Record<string, Record<string, unknown>>|null|undefined} upstreamModels
 */
export function lookupUpstreamModelMeta(modelId, upstreamModels) {
  if (!upstreamModels) return null;
  const mid = normalizeModelId(modelId).toLowerCase();
  if (upstreamModels[mid]) return upstreamModels[mid];
  for (const [alias, canonical] of Object.entries(MODEL_ALIASES)) {
    if (canonical === mid && upstreamModels[alias]) return upstreamModels[alias];
  }
  const raw = String(modelId || "").trim().toLowerCase();
  if (raw && upstreamModels[raw]) return upstreamModels[raw];
  return null;
}

/**
 * Overlay live /api/models fields onto a catalog model (shallow copy).
 * @param {ModelSpec} model
 * @param {Record<string, unknown>|null|undefined} meta
 * @returns {ModelSpec}
 */
export function applyLiveModelOverrides(model, meta) {
  if (!meta) return model;
  /** @type {ModelSpec} */
  const out = { ...model, supported_resolutions: [...(model.supported_resolutions || [])] };
  const res = meta.supportedResolutions || meta.supported_resolutions;
  if (Array.isArray(res) && res.length) {
    out.supported_resolutions = res.map(String).filter(Boolean);
    if (!out.supported_resolutions.includes(out.default_resolution || "")) {
      out.default_resolution = out.supported_resolutions[0];
    }
  }
  const quals = meta.supportedQualities || meta.supported_qualities;
  if (Array.isArray(quals) && quals.length) {
    out.supported_qualities = quals.map((x) => String(x).toLowerCase()).filter(Boolean);
    out.supports_quality = true;
  }
  if (meta.imageReferenceEnabled != null) {
    out.supports_image_ref = !!meta.imageReferenceEnabled;
  }
  return out;
}

export function getModel(modelId) {
  const key = normalizeModelId(modelId).trim().toLowerCase();
  if (!MODELS[key]) {
    throw new Error(`Unknown model '${modelId}'. Known: ${Object.keys(MODELS).join(", ")}`);
  }
  return MODELS[key];
}

export function modelToDict(m) {
  return {
    id: m.id,
    name: m.name,
    company: m.company,
    type: m.type,
    supported_resolutions: [...(m.supported_resolutions || [])],
    model_group_id: m.model_group_id,
    unlimited: !!m.unlimited,
    recommended: !!m.recommended,
    tag_required: !!m.tag_required,
    tag: m.tag ?? null,
    supports_quality: !!m.supports_quality,
    supports_duration: !!m.supports_duration,
    supports_audio: !!m.supports_audio,
    supports_image_ref: m.supports_image_ref !== false,
    max_image_refs: m.max_image_refs ?? 3,
    default_resolution: m.default_resolution || (m.type === "video" ? "480p" : "1K"),
    supported_qualities: m.supported_qualities ? [...m.supported_qualities] : null,
    notes: m.notes || "",
  };
}

export function buildSettings(model, { aspect = "1:1", resolution, quality = "low", duration = 5, audio = true } = {}) {
  let res = resolution || model.default_resolution || model.supported_resolutions[0];
  if (!model.supported_resolutions.includes(res)) {
    res = model.supported_resolutions[0] || res;
  }
  if (!ASPECT_RATIOS.includes(aspect)) {
    throw new Error(`Unsupported aspect '${aspect}'. Supported: ${ASPECT_RATIOS.join(", ")}`);
  }
  /** @type {Record<string, unknown>} */
  const settings = {
    aspect_ratio: aspect,
    aspectRatio: aspect,
    ratio: aspect,
    resolution: res,
  };
  if (model.supports_quality || String(model.id).includes("gpt-image") || String(model.id).includes("gpt")) {
    let q = String(quality || "low").toLowerCase();
    const allowed =
      Array.isArray(model.supported_qualities) && model.supported_qualities.length
        ? model.supported_qualities
        : QUALITIES;
    if (!allowed.includes(q)) {
      q = allowed.includes("low") ? "low" : allowed[0];
    }
    settings.quality = q;
  }
  if (model.type === "video") {
    settings.duration = Number(duration) || 5;
    settings.audio = !!audio;
  }
  return settings;
}

export function validateGenerateParams(modelId, opts = {}) {
  let model = getModel(modelId);
  if (opts.upstreamModels) {
    model = applyLiveModelOverrides(model, lookupUpstreamModelMeta(model.id, opts.upstreamModels));
  }
  const settings = buildSettings(model, opts);
  const refs = opts.image_paths || opts.imagePaths || [];
  const max = model.max_image_refs ?? 3;
  if (Array.isArray(refs) && refs.length) {
    if (model.supports_image_ref === false) {
      throw new Error(`Model ${model.id} does not support reference images`);
    }
    if (refs.length > max) {
      throw new Error(`Max ${max} reference images for ${model.id}`);
    }
  }
  return { model, settings };
}
