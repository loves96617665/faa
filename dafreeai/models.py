"""Model catalog and supported generation parameters (from frontend reverse)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any


ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]
IMAGE_RESOLUTIONS = ["1K", "2K", "4K"]
VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"]
QUALITIES = ["low", "medium", "high"]

# Upstream /api/global-settings modelStatuses values treated as hidden in UI lists.
HIDDEN_MODEL_STATUSES = {
    "hide",
    "hidden",
    "disabled",
    "off",
    "false",
    "0",
    "unavailable",
    "maintenance",
}

# Client-facing aliases → canonical catalog id (mirrors CF generate-smart.js).
# Live /api/models may list seedance-2.0 / gpt-image-2-fast as separate keys.
MODEL_ALIASES: dict[str, str] = {
    "gpt-image-2-fast": "gpt-image-2",
    "gpt-image2": "gpt-image-2",
    "gpt2": "gpt-image-2",
    "gpt-image": "gpt-image-2",
    "seedance-2.0": "seedance-2",
    "seedance-2.0-fast": "seedance-2-fast",
    "seedance2": "seedance-2",
    "nano-banana-lite": "nano-banana-2-lite",
    "nano-banana2": "nano-banana-2",
    "nano-banana-2.0": "nano-banana-2",
    "nano-banana-2.0-lite": "nano-banana-2-lite",
}

GPT_IMAGE_IDS = frozenset({"gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"})

# Models dual-enabled on live /api/models (appEnabled+apiEnabled) as of 2026-07-30.
# Used as offline fallback when /api/models cannot be fetched.
LIVE_DUAL_ENABLED_FALLBACK = frozenset(
    {
        "nano-banana-2-lite",
        "nano-banana-2",
        "gpt-image-2",
    }
)


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    company: str
    type: str  # image | video
    supported_resolutions: list[str]
    model_group_id: int
    unlimited: bool = False
    recommended: bool = False
    tag_required: bool = False
    tag: str | None = None
    supports_quality: bool = False
    supports_duration: bool = False
    supports_audio: bool = False
    supports_image_ref: bool = True
    max_image_refs: int = 3
    default_resolution: str = "1K"
    # Optional live-supported quality set (from /api/models); None = use QUALITIES.
    supported_qualities: list[str] | None = None
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "company": self.company,
            "type": self.type,
            "supported_resolutions": list(self.supported_resolutions),
            "model_group_id": self.model_group_id,
            "unlimited": self.unlimited,
            "recommended": self.recommended,
            "tag_required": self.tag_required,
            "tag": self.tag,
            "supports_quality": self.supports_quality,
            "supports_duration": self.supports_duration,
            "supports_audio": self.supports_audio,
            "supports_image_ref": self.supports_image_ref,
            "max_image_refs": self.max_image_refs,
            "default_resolution": self.default_resolution,
            "supported_qualities": list(self.supported_qualities)
            if self.supported_qualities is not None
            else None,
            "notes": self.notes,
        }


MODELS: dict[str, ModelSpec] = {
    # Image
    "nano-banana-2-lite": ModelSpec(
        id="nano-banana-2-lite",
        name="Nano Banana 2 Lite",
        company="Google",
        type="image",
        supported_resolutions=["1K"],
        model_group_id=414,
        unlimited=True,
        recommended=True,
        tag="LITE",
        default_resolution="1K",
        notes="Recommended default · free/unlimited · most reliable",
    ),
    "nano-banana-2": ModelSpec(
        id="nano-banana-2",
        name="Nano Banana 2",
        company="Google",
        type="image",
        supported_resolutions=["1K", "2K"],
        model_group_id=363,
        unlimited=True,
        tag="NEW",
        default_resolution="1K",
        notes="Unlimited · may lock when upstream pool is busy",
    ),
    "seedream-5.0-pro": ModelSpec(
        id="seedream-5.0-pro",
        name="Seedream 5.0 Pro",
        company="Seedream",
        type="image",
        supported_resolutions=["1K", "2K", "4K"],
        model_group_id=513,
        unlimited=False,
        tag_required=True,
        tag="PRO",
        default_resolution="1K",
        notes="Requires Discord clan tag · often locked when accounts inactive",
        supports_image_ref=False,
    ),
    "gpt-image-2": ModelSpec(
        id="gpt-image-2",
        name="GPT Image 2",
        company="OpenAI",
        type="image",
        supported_resolutions=["1K", "2K", "4K"],
        model_group_id=380,
        unlimited=True,
        tag="PRO",
        supports_quality=True,
        supports_image_ref=False,
        default_resolution="1K",
        supported_qualities=["low", "medium", "high"],
        notes="prefer quality=low · medium OK · high often locked when pool=0 · auto-retry/fallback enabled",
    ),
    "gpt-image-1.5": ModelSpec(
        id="gpt-image-1.5",
        name="GPT Image 1.5",
        company="OpenAI",
        type="image",
        supported_resolutions=["1K"],
        model_group_id=322,
        unlimited=False,
        supports_quality=True,
        supports_image_ref=False,
        default_resolution="1K",
        supported_qualities=["low", "medium"],
        notes="Not unlimited · live often disabled · qualities low|medium only",
    ),
    "gpt-image-1-mini": ModelSpec(
        id="gpt-image-1-mini",
        name="GPT Image 1.0 Mini",
        company="OpenAI",
        type="image",
        supported_resolutions=["1K"],
        model_group_id=312,
        unlimited=False,
        supports_quality=True,
        supports_image_ref=False,
        default_resolution="1K",
        supported_qualities=["low", "medium"],
        notes="Not unlimited · live often disabled · qualities low|medium only",
    ),
    # Video
    "gemini-omni-flash": ModelSpec(
        id="gemini-omni-flash",
        name="Gemini Omni Flash",
        company="Google",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=400,
        unlimited=False,
        tag_required=True,
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
    "seedance-2": ModelSpec(
        id="seedance-2",
        name="Seedance 2.0",
        company="Seedance",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=358,
        unlimited=False,
        tag_required=True,
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
    "seedance-mini": ModelSpec(
        id="seedance-mini",
        name="Seedance 2.0 Mini",
        company="Seedance",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=416,
        unlimited=False,
        tag_required=True,
        tag="NEW",
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
    "seedance-2-fast": ModelSpec(
        id="seedance-2-fast",
        name="Seedance 2.0 Fast",
        company="Seedance",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=377,
        unlimited=False,
        tag_required=True,
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
    "sora-2-pro": ModelSpec(
        id="sora-2-pro",
        name="Sora 2 Pro",
        company="OpenAI",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=111,
        unlimited=False,
        tag_required=True,
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
    "sora-2": ModelSpec(
        id="sora-2",
        name="Sora 2",
        company="OpenAI",
        type="video",
        supported_resolutions=["480p", "720p", "1080p"],
        model_group_id=110,
        unlimited=False,
        tag_required=True,
        supports_duration=True,
        supports_audio=True,
        default_resolution="480p",
    ),
}


def normalize_model_id(model_id: str | None, *, default: str = "nano-banana-2-lite") -> str:
    """Resolve client aliases to a canonical catalog model id."""
    raw = str(model_id or default).strip()
    if not raw:
        raw = default
    key = raw.lower()
    return MODEL_ALIASES.get(key, raw)


def is_gpt_image(model_id: str | None) -> bool:
    mid = normalize_model_id(model_id).lower()
    return mid in GPT_IMAGE_IDS or mid.startswith("gpt-image")


def get_model(model_id: str) -> ModelSpec:
    key = normalize_model_id(model_id).strip().lower()
    if key not in MODELS:
        known = ", ".join(MODELS)
        raise KeyError(f"Unknown model '{model_id}'. Known: {known}")
    return MODELS[key]


def normalize_model_statuses(raw: Any) -> dict[str, str]:
    """Normalize upstream modelStatuses map to {model_id_lower: status_lower}."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():  # type: ignore[union-attr]
        if key is None:
            continue
        k = str(key).strip().lower()
        if not k:
            continue
        if value is True:
            out[k] = "show"
            continue
        if value is False or value is None:
            out[k] = "hide"
            continue
        out[k] = str(value).strip().lower() or "show"
    return out


def parse_upstream_models_map(raw: Any) -> dict[str, dict[str, Any]]:
    """Parse GET /api/models payload into {model_id_lower: meta}.

    Accepts either the full response ``{"models": {...}}`` or the inner map.
    """
    if not isinstance(raw, dict):
        return {}
    models_obj: Any = raw.get("models") if "models" in raw else raw
    if not isinstance(models_obj, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, value in models_obj.items():  # type: ignore[union-attr]
        k = str(key or "").strip().lower()
        if not k:
            continue
        if isinstance(value, dict):
            out[k] = dict(value)  # type: ignore[arg-type]
        else:
            out[k] = {"raw": value}
    return out


def _truthy_flag(value: Any, default: bool | None = None) -> bool | None:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value).strip().lower()
    if s in {"1", "true", "yes", "on", "enabled"}:
        return True
    if s in {"0", "false", "no", "off", "disabled"}:
        return False
    return default


def lookup_upstream_model_meta(
    model_id: str,
    upstream_models: dict[str, dict[str, Any]] | None,
) -> dict[str, Any] | None:
    """Find live /api/models meta for a catalog id (tries aliases + reverse)."""
    if not upstream_models:
        return None
    mid = normalize_model_id(model_id).lower()
    if mid in upstream_models:
        return upstream_models[mid]
    # Reverse: live key may be an alias of catalog id (e.g. seedance-2.0).
    for alias, canonical in MODEL_ALIASES.items():
        if canonical == mid and alias in upstream_models:
            return upstream_models[alias]
    # Direct raw key without normalize
    raw = str(model_id or "").strip().lower()
    if raw and raw in upstream_models:
        return upstream_models[raw]
    return None


def extract_model_statuses(global_settings: dict[str, Any] | None) -> dict[str, str]:
    if not global_settings or not isinstance(global_settings, dict):
        return {}
    return normalize_model_statuses(global_settings.get("modelStatuses"))


def model_upstream_status(
    model_id: str,
    model_statuses: dict[str, str] | None = None,
) -> str:
    if not model_statuses:
        return "show"
    key = normalize_model_id(model_id).strip().lower()
    if key in model_statuses:
        return model_statuses[key]
    raw = str(model_id or "").strip().lower()
    return model_statuses.get(raw) or "show"


def is_model_ui_hidden(
    model_id: str,
    model_statuses: dict[str, str] | None = None,
) -> bool:
    status = model_upstream_status(model_id, model_statuses)
    return status in HIDDEN_MODEL_STATUSES


def apply_live_model_overrides(
    model: ModelSpec,
    upstream_meta: dict[str, Any] | None,
) -> ModelSpec:
    """Overlay live /api/models fields onto a catalog ModelSpec (resolutions etc.)."""
    if not upstream_meta:
        return model
    kwargs: dict[str, Any] = {}
    res = upstream_meta.get("supportedResolutions") or upstream_meta.get("supported_resolutions")
    if isinstance(res, list) and res:
        cleaned = [str(x) for x in res if x]
        if cleaned:
            kwargs["supported_resolutions"] = cleaned
            if model.default_resolution not in cleaned:
                kwargs["default_resolution"] = cleaned[0]
    quals = upstream_meta.get("supportedQualities") or upstream_meta.get("supported_qualities")
    if isinstance(quals, list) and quals:
        cleaned_q = [str(x).lower() for x in quals if x]
        if cleaned_q:
            kwargs["supported_qualities"] = cleaned_q
            kwargs["supports_quality"] = True
    iref = upstream_meta.get("imageReferenceEnabled")
    if iref is not None:
        flag = _truthy_flag(iref)
        if flag is not None:
            kwargs["supports_image_ref"] = flag
    if not kwargs:
        return model
    return replace(model, **kwargs)


def enrich_model_dict(
    data: dict[str, Any],
    model_statuses: dict[str, str] | None = None,
    *,
    upstream_models: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Attach upstream visibility + live enable fields to a model dict."""
    mid = str(data.get("id") or "")
    status = model_upstream_status(mid, model_statuses)
    hidden = status in HIDDEN_MODEL_STATUSES
    out = dict(data)
    out["upstream_status"] = status
    out["ui_hidden"] = hidden

    meta = lookup_upstream_model_meta(mid, upstream_models)
    if meta is not None:
        app_en = _truthy_flag(meta.get("appEnabled"), False)
        api_en = _truthy_flag(meta.get("apiEnabled"), False)
        out["app_enabled"] = bool(app_en)
        out["api_enabled"] = bool(api_en)
        out["live_enabled"] = bool(app_en and api_en)
        out["provider"] = meta.get("provider")
        out["has_delay"] = bool(meta.get("hasDelay"))
        if "imageReferenceEnabled" in meta:
            out["supports_image_ref"] = bool(_truthy_flag(meta.get("imageReferenceEnabled"), out.get("supports_image_ref", True)))
        res = meta.get("supportedResolutions") or meta.get("supported_resolutions")
        if isinstance(res, list) and res:
            out["supported_resolutions"] = [str(x) for x in res if x]
            if out.get("default_resolution") not in out["supported_resolutions"]:
                out["default_resolution"] = out["supported_resolutions"][0]
        quals = meta.get("supportedQualities") or meta.get("supported_qualities")
        if isinstance(quals, list) and quals:
            out["supported_qualities"] = [str(x).lower() for x in quals if x]
            out["supports_quality"] = True
        if "customDimensions" in meta:
            out["custom_dimensions"] = bool(meta.get("customDimensions"))
    else:
        # Offline fallback: known dual-enabled set when /api/models missing.
        fallback_on = mid.lower() in LIVE_DUAL_ENABLED_FALLBACK
        out.setdefault("app_enabled", fallback_on if upstream_models is None else False)
        out.setdefault("api_enabled", fallback_on if upstream_models is None else False)
        out.setdefault("live_enabled", fallback_on if upstream_models is None else False)

    # Prefer live-enabled models in UI sort consumers.
    out["recommended"] = bool(out.get("recommended")) or bool(out.get("live_enabled") and mid == "nano-banana-2-lite")
    return out


def summarize_global_settings(global_settings: dict[str, Any] | None) -> dict[str, Any]:
    """Pick stable fields from /api/global-settings for API responses."""
    gs = global_settings if isinstance(global_settings, dict) else {}
    statuses = extract_model_statuses(gs)
    hidden = sorted(k for k, v in statuses.items() if v in HIDDEN_MODEL_STATUSES)
    return {
        "artlistPoolBar": gs.get("artlistPoolBar"),
        "artlistPoolMax": gs.get("artlistPoolMax"),
        "videoCooldown": gs.get("videoCooldown"),
        "announcementActive": gs.get("announcementActive"),
        "announcementText": gs.get("announcementText"),
        "masterArtlistAutomation": gs.get("masterArtlistAutomation"),
        "hideCreditSystem": gs.get("hideCreditSystem"),
        "hideSponsorBtn": gs.get("hideSponsorBtn"),
        "modelStatuses": statuses,
        "hidden_models": hidden,
        "raw": gs or None,
    }


def list_models(
    model_type: str | None = None,
    *,
    include_hidden: bool = True,
    model_statuses: dict[str, str] | None = None,
    global_settings: dict[str, Any] | None = None,
    upstream_models: dict[str, dict[str, Any]] | None = None,
    only_live_enabled: bool = False,
) -> list[ModelSpec]:
    """List catalog models.

    When model_statuses/global_settings is provided and include_hidden=False,
    models marked hide/disabled in upstream global-settings are omitted.
    When only_live_enabled=True and upstream_models is provided, keep models
    with appEnabled+apiEnabled (or offline LIVE_DUAL_ENABLED_FALLBACK).
    """
    items = list(MODELS.values())
    if model_type:
        t = model_type.lower()
        items = [m for m in items if m.type == t]

    statuses = model_statuses
    if statuses is None and global_settings is not None:
        statuses = extract_model_statuses(global_settings)

    if statuses is not None and not include_hidden:
        items = [m for m in items if not is_model_ui_hidden(m.id, statuses)]

    if only_live_enabled:
        filtered: list[ModelSpec] = []
        for m in items:
            meta = lookup_upstream_model_meta(m.id, upstream_models)
            if meta is not None:
                if _truthy_flag(meta.get("appEnabled"), False) and _truthy_flag(meta.get("apiEnabled"), False):
                    filtered.append(apply_live_model_overrides(m, meta))
            elif upstream_models is None and m.id in LIVE_DUAL_ENABLED_FALLBACK:
                filtered.append(m)
            # if upstream_models present but id missing → treat as disabled
        items = filtered
    elif upstream_models is not None:
        items = [apply_live_model_overrides(m, lookup_upstream_model_meta(m.id, upstream_models)) for m in items]

    def sort_key(m: ModelSpec) -> tuple[int, int, int, str]:
        rec = 0 if m.recommended else 1
        unlimited = 0 if m.unlimited else 1
        preferred = 0 if m.id == "nano-banana-2-lite" else 1
        return (rec, unlimited, preferred, m.id)

    return sorted(items, key=sort_key)


def build_settings(
    model: ModelSpec,
    *,
    aspect: str = "1:1",
    resolution: str | None = None,
    quality: str = "low",
    duration: int = 5,
    audio: bool = True,
) -> dict[str, Any]:
    """Build /api/generate settings payload matching frontend behavior."""
    res = resolution or model.default_resolution
    if res not in model.supported_resolutions:
        # Soft-clamp to first supported resolution instead of hard-fail when
        # live catalog shrank the set (e.g. gpt-image-1.5 → 1K only).
        if model.supported_resolutions:
            res = model.supported_resolutions[0]
        else:
            raise ValueError(
                f"Model {model.id} does not support resolution '{res}'. "
                f"Supported: {model.supported_resolutions}"
            )
    if aspect not in ASPECT_RATIOS:
        raise ValueError(f"Unsupported aspect '{aspect}'. Supported: {ASPECT_RATIOS}")

    settings: dict[str, Any] = {
        "aspect_ratio": aspect,
        "aspectRatio": aspect,
        "ratio": aspect,
        "resolution": res,
    }

    if model.supports_quality or model.id.startswith("gpt-image") or "gpt" in model.id:
        q = str(quality or "low").lower()
        allowed = list(model.supported_qualities) if model.supported_qualities else list(QUALITIES)
        if q not in allowed:
            # Soft-clamp: prefer low, else first allowed.
            q = "low" if "low" in allowed else allowed[0]
        settings["quality"] = q

    if model.type == "video":
        settings["duration"] = int(duration)
        settings["audio"] = bool(audio)

    return settings


def validate_generate_params(
    model_id: str,
    *,
    aspect: str = "1:1",
    resolution: str | None = None,
    quality: str = "low",
    duration: int = 5,
    audio: bool = True,
    image_paths: list[str] | None = None,
    upstream_models: dict[str, dict[str, Any]] | None = None,
) -> tuple[ModelSpec, dict[str, Any]]:
    model = get_model(model_id)
    if upstream_models is not None:
        model = apply_live_model_overrides(model, lookup_upstream_model_meta(model.id, upstream_models))
    settings = build_settings(
        model,
        aspect=aspect,
        resolution=resolution,
        quality=quality,
        duration=duration,
        audio=audio,
    )
    if image_paths:
        if not model.supports_image_ref:
            raise ValueError(f"Model {model.id} does not support reference images")
        if len(image_paths) > model.max_image_refs:
            raise ValueError(f"Max {model.max_image_refs} reference images for {model.id}")
    return model, settings
