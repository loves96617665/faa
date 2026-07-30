"""DaFreeAi Studio - reverse-engineered API client & generation toolkit."""

from .client import DaFreeAiClient
from .models import (
    MODELS,
    MODEL_ALIASES,
    enrich_model_dict,
    get_model,
    is_gpt_image,
    list_models,
    normalize_model_id,
    summarize_global_settings,
)

__all__ = [
    "DaFreeAiClient",
    "MODELS",
    "MODEL_ALIASES",
    "enrich_model_dict",
    "get_model",
    "is_gpt_image",
    "list_models",
    "normalize_model_id",
    "summarize_global_settings",
]
__version__ = "1.2.0"
