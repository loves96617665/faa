/** Model catalog + settings builder (ported from dafreeai/models.py) */

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];
export const QUALITIES = ["low", "medium", "high"];

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
    supports_image_ref: true,
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
    notes: "quality=low|medium|high · may return MODEL_NOT_ALLOWED or lock when pool credits=0 · prefer low",
    supports_image_ref: true,
    max_image_refs: 3,
  },
  "gpt-image-1.5": {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5",
    company: "OpenAI",
    type: "image",
    supported_resolutions: ["1K", "2K"],
    model_group_id: 322,
    unlimited: false,
    supports_quality: true,
    default_resolution: "1K",
    notes: "Not unlimited · may be locked",
    supports_image_ref: true,
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
    notes: "Not unlimited · may be locked",
    supports_image_ref: true,
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

export function listModels(type) {
  let items = Object.values(MODELS);
  if (type) items = items.filter((m) => m.type === String(type).toLowerCase());
  items.sort((a, b) => {
    const ar = a.recommended ? 0 : 1;
    const br = b.recommended ? 0 : 1;
    if (ar !== br) return ar - br;
    const au = a.unlimited ? 0 : 1;
    const bu = b.unlimited ? 0 : 1;
    if (au !== bu) return au - bu;
    return String(a.id).localeCompare(String(b.id));
  });
  return items;
}

export function getModel(modelId) {
  const key = String(modelId || "").trim().toLowerCase();
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
    supported_resolutions: [...m.supported_resolutions],
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
    notes: m.notes || "",
  };
}

export function buildSettings(model, { aspect = "1:1", resolution, quality = "low", duration = 5, audio = true } = {}) {
  const res = resolution || model.default_resolution || model.supported_resolutions[0];
  if (!model.supported_resolutions.includes(res)) {
    throw new Error(`Model ${model.id} does not support resolution '${res}'. Supported: ${model.supported_resolutions.join(", ")}`);
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
    const q = String(quality || "low").toLowerCase();
    if (!QUALITIES.includes(q)) throw new Error(`Unsupported quality '${quality}'`);
    settings.quality = q;
  }
  if (model.type === "video") {
    settings.duration = Number(duration) || 5;
    settings.audio = !!audio;
  }
  return settings;
}

export function validateGenerateParams(modelId, opts = {}) {
  const model = getModel(modelId);
  const settings = buildSettings(model, opts);
  const refs = opts.image_paths || opts.imagePaths || [];
  const max = model.max_image_refs ?? 3;
  if (Array.isArray(refs) && refs.length > max) {
    throw new Error(`Max ${max} reference images for ${model.id}`);
  }
  return { model, settings };
}
