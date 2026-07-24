"""Model catalog and supported generation parameters (from frontend reverse)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]
IMAGE_RESOLUTIONS = ["1K", "2K", "4K"]
VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"]
QUALITIES = ["low", "medium", "high"]


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    company: str
    type: str  # image | video
    supported_resolutions: list[str]
    model_group_id: int
    unlimited: bool = False
    tag_required: bool = False
    tag: str | None = None
    supports_quality: bool = False
    supports_duration: bool = False
    supports_audio: bool = False
    supports_image_ref: bool = True
    max_image_refs: int = 3
    default_resolution: str = "1K"
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
            "tag_required": self.tag_required,
            "tag": self.tag,
            "supports_quality": self.supports_quality,
            "supports_duration": self.supports_duration,
            "supports_audio": self.supports_audio,
            "supports_image_ref": self.supports_image_ref,
            "max_image_refs": self.max_image_refs,
            "default_resolution": self.default_resolution,
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
        tag="LITE",
        default_resolution="1K",
        notes="Free/unlimited lite image model",
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
        notes="Requires Discord clan tag",
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
        default_resolution="1K",
        notes="Supports quality=low|medium|high; High may lock when pool credits=0",
    ),
    "gpt-image-1.5": ModelSpec(
        id="gpt-image-1.5",
        name="GPT Image 1.5",
        company="OpenAI",
        type="image",
        supported_resolutions=["1K", "2K"],
        model_group_id=322,
        unlimited=False,
        supports_quality=True,
        default_resolution="1K",
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
        default_resolution="1K",
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


def get_model(model_id: str) -> ModelSpec:
    key = model_id.strip().lower()
    if key not in MODELS:
        known = ", ".join(MODELS)
        raise KeyError(f"Unknown model '{model_id}'. Known: {known}")
    return MODELS[key]


def list_models(model_type: str | None = None) -> list[ModelSpec]:
    items = list(MODELS.values())
    if model_type:
        t = model_type.lower()
        items = [m for m in items if m.type == t]
    return items


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
        q = quality.lower()
        if q not in QUALITIES:
            raise ValueError(f"Unsupported quality '{quality}'. Supported: {QUALITIES}")
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
) -> tuple[ModelSpec, dict[str, Any]]:
    model = get_model(model_id)
    settings = build_settings(
        model,
        aspect=aspect,
        resolution=resolution,
        quality=quality,
        duration=duration,
        audio=audio,
    )
    if image_paths and len(image_paths) > model.max_image_refs:
        raise ValueError(f"Max {model.max_image_refs} reference images for {model.id}")
    return model, settings
