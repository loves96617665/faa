"""HTTP client for DaFreeAi reverse-engineered REST API."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

from .models import (
    ModelSpec,
    enrich_model_dict,
    extract_model_statuses,
    is_gpt_image,
    list_models,
    normalize_model_id,
    parse_upstream_models_map,
    summarize_global_settings,
    validate_generate_params,
)


class DaFreeAiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class DaFreeAiClient:
    """Thin client around https://www.dafreeai.site/api/* endpoints."""

    def __init__(
        self,
        user_id: str | None = None,
        token: str | None = None,
        *,
        base_url: str = "https://www.dafreeai.site",
        timeout: float = 60.0,
        session: requests.Session | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.user_id = str(user_id) if user_id else None
        self.token = token
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.setdefault("Content-Type", "application/json")
        self.session.headers.setdefault("Accept", "application/json")
        self.chat_id = str(uuid.uuid4())

    # ------------------------------------------------------------------
    # factory helpers
    # ------------------------------------------------------------------
    @classmethod
    def from_config(cls, path: str | Path) -> "DaFreeAiClient":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        user = data.get("user") or {}
        return cls(
            user_id=user.get("id") or data.get("user_id"),
            token=user.get("token") or data.get("token"),
            base_url=data.get("base_url", "https://www.dafreeai.site"),
        )

    @classmethod
    def from_user_json(cls, path: str | Path, *, base_url: str = "https://www.dafreeai.site") -> "DaFreeAiClient":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if "user" in data and isinstance(data["user"], dict):
            data = data["user"]
        return cls(user_id=data.get("id"), token=data.get("token"), base_url=base_url)

    def require_auth(self) -> None:
        if not self.user_id or not self.token:
            raise DaFreeAiError("Missing user_id/token. Login first or load config.")

    def new_session(self) -> str:
        self.chat_id = str(uuid.uuid4())
        return self.chat_id

    def _url(self, path: str) -> str:
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def _request(self, method: str, path: str, **kwargs) -> Any:
        url = self._url(path)
        kwargs.setdefault("timeout", self.timeout)
        try:
            resp = self.session.request(method, url, **kwargs)
        except requests.RequestException as exc:
            raise DaFreeAiError(f"Network error: {exc}") from exc

        try:
            payload = resp.json()
        except Exception:
            payload = {"raw": resp.text}

        if resp.status_code >= 400:
            msg = None
            if isinstance(payload, dict):
                msg = payload.get("error") or payload.get("message")
            raise DaFreeAiError(
                msg or f"HTTP {resp.status_code}",
                status=resp.status_code,
                payload=payload,
            )
        return payload

    # ------------------------------------------------------------------
    # public / auth endpoints
    # ------------------------------------------------------------------
    def get_discord_login_url(self) -> str:
        data = self._request("GET", "/api/auth/discord/url")
        return data["url"]

    def exchange_code(self, code: str) -> dict[str, Any]:
        data = self._request("POST", "/api/auth/discord/callback", json={"code": code})
        user = data.get("user") or data
        if user.get("id") and user.get("token"):
            self.user_id = str(user["id"])
            self.token = user["token"]
        return user

    def credits_pool(self) -> dict[str, Any]:
        return self._request("GET", "/api/artlist/credits-progress")

    def global_settings(self) -> dict[str, Any]:
        """Fetch upstream /api/global-settings (model hide flags, pool max, etc.)."""
        return self._request("GET", "/api/global-settings")

    def upstream_models(self) -> dict[str, Any]:
        """Fetch live GET /api/models (appEnabled/apiEnabled runtime catalog)."""
        return self._request("GET", "/api/models")

    def list_available_models(
        self,
        model_type: str | None = None,
        *,
        include_hidden: bool = False,
        only_live_enabled: bool = False,
    ) -> dict[str, Any]:
        """List models filtered by global-settings + live /api/models enable flags."""
        settings: dict[str, Any] = {}
        settings_error = None
        try:
            settings = self.global_settings() or {}
        except Exception as exc:
            settings_error = str(exc)
            settings = {}

        upstream_raw: dict[str, Any] | None = None
        upstream_error = None
        try:
            upstream_raw = self.upstream_models() or {}
        except Exception as exc:
            upstream_error = str(exc)
            upstream_raw = None

        upstream_map = (
            parse_upstream_models_map(upstream_raw) if upstream_raw is not None else None
        )

        statuses = extract_model_statuses(settings)
        items = list_models(
            model_type,
            include_hidden=include_hidden,
            model_statuses=statuses if settings else None,
            upstream_models=upstream_map,
            only_live_enabled=only_live_enabled,
        )
        models = [
            enrich_model_dict(m.to_dict(), statuses, upstream_models=upstream_map)
            for m in items
        ]
        models.sort(
            key=lambda m: (
                0 if m.get("live_enabled") else 1,
                0 if m.get("recommended") else 1,
                0 if m.get("unlimited") else 1,
                0 if m.get("id") == "nano-banana-2-lite" else 1,
                str(m.get("id") or ""),
            )
        )
        if settings:
            summary = summarize_global_settings(settings)
        else:
            summary = {
                "artlistPoolBar": None,
                "artlistPoolMax": None,
                "videoCooldown": None,
                "announcementActive": None,
                "announcementText": None,
                "masterArtlistAutomation": None,
                "hideCreditSystem": None,
                "hideSponsorBtn": None,
                "modelStatuses": {},
                "hidden_models": [],
                "raw": None,
            }
        live_enabled_ids = [m["id"] for m in models if m.get("live_enabled")]
        return {
            "models": models,
            "global_settings": summary,
            "include_hidden": include_hidden,
            "only_live_enabled": only_live_enabled,
            "live_enabled_models": live_enabled_ids,
            "settings_error": settings_error,
            "models_error": upstream_error,
            "upstream_models_count": len(upstream_map) if upstream_map is not None else None,
        }

    def check_tag(self, user_id: str | None = None) -> dict[str, Any]:
        uid = user_id or self.user_id
        if not uid:
            raise DaFreeAiError("user_id required for check_tag")
        return self._request("GET", f"/api/user/check-tag/{uid}")

    # ------------------------------------------------------------------
    # authenticated endpoints
    # ------------------------------------------------------------------
    def balance(self) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "GET",
            f"/api/bananas/{self.user_id}",
            params={"token": self.token},
        )

    def accept_terms(self) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "POST",
            "/api/terms/accept",
            json={"userId": self.user_id, "token": self.token},
        )

    def history(self, *, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "GET",
            f"/api/history/{self.user_id}",
            params={"token": self.token, "limit": limit, "offset": offset},
        )

    def delete_history(self, chat_id: str) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "DELETE",
            f"/api/history/{self.user_id}/{chat_id}",
            params={"token": self.token},
        )

    def delete_account(self) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "DELETE",
            f"/api/user/{self.user_id}",
            params={"token": self.token},
        )

    def share_image(self, image_url: str) -> dict[str, Any]:
        self.require_auth()
        return self._request(
            "POST",
            "/api/discord/share-image",
            json={
                "userId": self.user_id,
                "token": self.token,
                "imageUrl": image_url,
            },
        )

    def generate(
        self,
        prompt: str,
        *,
        model: str = "nano-banana-2-lite",
        aspect: str = "1:1",
        resolution: str | None = None,
        quality: str = "low",
        duration: int = 5,
        audio: bool = True,
        image_paths: list[str] | None = None,
        chat_id: str | None = None,
        raw_settings: dict[str, Any] | None = None,
        force_quality: bool = False,
        smart: bool = True,
        fallback: str | bool = "auto",
    ) -> dict[str, Any]:
        """Submit a generation job to POST /api/generate.

        When ``smart=True`` (default):
        - normalize model aliases (gpt-image-2-fast → gpt-image-2, …)
        - for GPT image models, force quality=low when artlist pool credits ≤ 0
        - on MODEL_NOT_ALLOWED / locked errors, retry once with quality=low
        - optional fallback to nano-banana-2-lite (auto for GPT models)
        """
        self.require_auth()
        original_model = str(model or "nano-banana-2-lite").strip()
        original_quality = str(quality or "low").lower()
        model_id = normalize_model_id(original_model)
        adjustments: list[str] = []
        if model_id != original_model:
            adjustments.append(f"alias:{original_model}→{model_id}")

        q = original_quality
        pool_credits: float | None = None
        if smart and is_gpt_image(model_id) and not force_quality and q == "high":
            try:
                pool = self.credits_pool() or {}
                raw_credits = pool.get("totalCredits", pool.get("credits"))
                pool_credits = float(raw_credits) if raw_credits is not None else None
            except Exception:
                pool_credits = None
            # Empirically high locks when pool≈0; force low when unknown/zero.
            if pool_credits is None or pool_credits != pool_credits or pool_credits <= 0:
                pc_label = "unknown" if pool_credits is None or pool_credits != pool_credits else pool_credits
                adjustments.append(f"quality:high→low (poolCredits={pc_label})")
                q = "low"

        upstream_map = None
        if smart:
            try:
                upstream_map = parse_upstream_models_map(self.upstream_models() or {})
            except Exception:
                upstream_map = None

        model_spec, settings = validate_generate_params(
            model_id,
            aspect=aspect,
            resolution=resolution,
            quality=q,
            duration=duration,
            audio=audio,
            image_paths=image_paths,
            upstream_models=upstream_map,
        )
        if raw_settings:
            settings.update(raw_settings)

        cid = chat_id or self.chat_id

        def _submit(mid: str, setts: dict[str, Any], spec: ModelSpec) -> dict[str, Any]:
            payload: dict[str, Any] = {
                "userId": self.user_id,
                "token": self.token,
                "chatId": cid,
                "model": mid,
                "prompt": prompt,
                "settings": setts,
            }
            if image_paths and spec.supports_image_ref:
                payload["imagePaths"] = image_paths[: spec.max_image_refs]
                payload["imagePath"] = image_paths[0]
            return self._request("POST", "/api/generate", json=payload)

        def _retryable(msg: str) -> bool:
            s = str(msg or "")
            return bool(
                "MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE" in s
                or "All accounts are currently inactive" in s
                or "is locked" in s.lower()
                or "MODEL_NOT_ALLOWED" in s
            )

        def _should_fallback() -> bool:
            if fallback is True or fallback == "always":
                return True
            if fallback is False or fallback == "never":
                return False
            return is_gpt_image(model_id)

        fallback_used = False
        try:
            data = _submit(model_spec.id, settings, model_spec)
        except DaFreeAiError as exc:
            msg = str(exc)
            if smart and is_gpt_image(model_spec.id) and q != "low" and _retryable(msg):
                adjustments.append(f"retry:quality={q}→low after {msg[:80]}")
                q = "low"
                model_spec, settings = validate_generate_params(
                    model_id,
                    aspect=aspect,
                    resolution=resolution,
                    quality=q,
                    duration=duration,
                    audio=audio,
                    image_paths=image_paths,
                    upstream_models=upstream_map,
                )
                if raw_settings:
                    settings.update(raw_settings)
                try:
                    data = _submit(model_spec.id, settings, model_spec)
                except DaFreeAiError as exc2:
                    if smart and _should_fallback() and _retryable(str(exc2)):
                        adjustments.append(
                            f"fallback:{model_spec.id}→nano-banana-2-lite after {str(exc2)[:80]}"
                        )
                        model_id = "nano-banana-2-lite"
                        q = "low"
                        model_spec, settings = validate_generate_params(
                            model_id,
                            aspect=aspect,
                            resolution=resolution,
                            quality=q,
                            duration=duration,
                            audio=audio,
                            image_paths=None,
                            upstream_models=upstream_map,
                        )
                        data = _submit(model_spec.id, settings, model_spec)
                        fallback_used = True
                    else:
                        raise
            elif smart and _should_fallback() and _retryable(msg):
                adjustments.append(
                    f"fallback:{model_spec.id}→nano-banana-2-lite after {msg[:80]}"
                )
                model_id = "nano-banana-2-lite"
                q = "low"
                model_spec, settings = validate_generate_params(
                    model_id,
                    aspect=aspect,
                    resolution=resolution,
                    quality=q,
                    duration=duration,
                    audio=audio,
                    image_paths=None,
                    upstream_models=upstream_map,
                )
                data = _submit(model_spec.id, settings, model_spec)
                fallback_used = True
            else:
                raise

        data["_request"] = {
            "chatId": cid,
            "model": model_spec.id,
            "prompt": prompt,
            "settings": settings,
            "originalModel": original_model,
            "originalQuality": original_quality,
            "adjustments": adjustments,
            "fallbackUsed": fallback_used,
            "poolCredits": pool_credits,
        }
        return data

    # ------------------------------------------------------------------
    # polling helpers
    # ------------------------------------------------------------------
    @staticmethod
    def extract_media(message: dict[str, Any]) -> str | None:
        """Pull first real media URL from common upstream message shapes."""
        candidates: list[Any] = [
            message.get("image"),
            message.get("imageUrl"),
            message.get("image_url"),
            message.get("url"),
            message.get("video"),
            message.get("videoUrl"),
            message.get("video_url"),
            message.get("media"),
            message.get("mediaUrl"),
            message.get("src"),
        ]
        outs = message.get("outputImages") or message.get("output_images") or message.get("images")
        if isinstance(outs, list):
            candidates.extend(outs)
        elif isinstance(outs, str):
            candidates.append(outs)

        for item in candidates:
            if not item:
                continue
            if isinstance(item, dict):
                item = (
                    item.get("url")
                    or item.get("src")
                    or item.get("image")
                    or item.get("imageUrl")
                    or item.get("video")
                    or item.get("videoUrl")
                )
            if not item:
                continue
            text = str(item)
            if "placeholder" in text.lower():
                continue
            return text
        return None

    @staticmethod
    def _is_bot_message(message: dict[str, Any]) -> bool:
        role = str(message.get("role") or message.get("type") or "").lower()
        if role in {"bot", "assistant", "model", "ai", "system-bot"}:
            return True
        # Some payloads omit role but carry generation fields.
        if any(
            k in message
            for k in (
                "image",
                "imageUrl",
                "outputImages",
                "video",
                "videoUrl",
                "isLoading",
                "modelName",
            )
        ):
            # Avoid treating pure user prompts as bot results.
            if role in {"user", "human"}:
                return False
            if message.get("image") or message.get("imageUrl") or message.get("outputImages") or message.get("video"):
                return True
            if "isLoading" in message or "modelName" in message:
                return True
        return False

    def find_result_in_history(
        self,
        history_payload: dict[str, Any],
        *,
        chat_id: str | None = None,
        prompt_substr: str | None = None,
        model: str | None = None,
        since_ts: int | float | None = None,
    ) -> dict[str, Any] | None:
        """Locate generation result in history.

        Upstream often never materializes the client-supplied chatId as its own
        chat entry; completed image jobs land in the synthetic ``user_library``
        chat instead. Matching strategy:

        1. Exact chat_id match (if present)
        2. Fallback scan of all chats (esp. user_library) by prompt / model /
           since_ts filters
        3. activeGeneration for the requested chat_id → processing
        """
        chats = list(history_payload.get("history") or [])

        def chat_matches(chat: dict[str, Any]) -> bool:
            if not chat_id:
                return True
            return str(chat.get("id") or chat.get("chatId") or "") == str(chat_id)

        def prompt_ok(chat: dict[str, Any], msg: dict[str, Any]) -> bool:
            if not prompt_substr:
                return True
            prompt_text = str(
                msg.get("prompt")
                or msg.get("text")
                or msg.get("content")
                or msg.get("message")
                or ""
            )
            title_text = str(chat.get("title") or "")
            return prompt_substr in prompt_text or prompt_substr in title_text

        def _norm_model(value: str) -> str:
            # "GPT Image 2" / "gpt-image-2" / "gpt_image_2" → "gptimage2"
            return "".join(ch for ch in value.lower() if ch.isalnum())

        def model_ok(msg: dict[str, Any]) -> bool:
            if not model:
                return True
            name = str(msg.get("modelName") or msg.get("model") or "")
            want = _norm_model(str(model))
            have = _norm_model(name)
            if not want or not have:
                return True
            return want in have or have in want

        def ts_ok(msg: dict[str, Any]) -> bool:
            if since_ts is None:
                return True
            try:
                ts = msg.get("timestamp") or msg.get("createdAt") or msg.get("created_at") or 0
                return float(ts) >= float(since_ts) - 5_000  # 5s slack
            except (TypeError, ValueError):
                return True

        def scan_messages(
            scan_chats: list[dict[str, Any]],
            *,
            require_prompt: bool,
            exact_chat: bool,
        ) -> dict[str, Any] | None:
            for chat in scan_chats:
                messages = list(chat.get("messages") or [])
                bot_msgs = [m for m in messages if isinstance(m, dict) and self._is_bot_message(m)]
                # Latest bot message first (API appends newest at end).
                for msg in reversed(bot_msgs):
                    # Exact chat owns latest bot msg; otherwise filter by prompt/model/ts.
                    if not exact_chat:
                        if require_prompt and prompt_substr and not prompt_ok(chat, msg):
                            continue
                        if not model_ok(msg):
                            continue
                        if not ts_ok(msg):
                            continue
                    elif prompt_substr and not prompt_ok(chat, msg) and not exact_chat:
                        continue

                    err_text = msg.get("error") or msg.get("errorMessage") or msg.get("error_message")
                    if msg.get("isError") or err_text:
                        return {
                            "status": "error",
                            "chatId": chat.get("id") or chat.get("chatId"),
                            "msgId": msg.get("id"),
                            "message": err_text or msg.get("text") or "generation error",
                            "raw": msg,
                            "matchedVia": "exact_chat" if exact_chat else "library_fallback",
                        }

                    media = self.extract_media(msg)
                    if media:
                        return {
                            "status": "completed",
                            "chatId": chat.get("id") or chat.get("chatId"),
                            "msgId": msg.get("id"),
                            "media": media,
                            "prompt": msg.get("prompt") or msg.get("text"),
                            "modelName": msg.get("modelName") or msg.get("model"),
                            "resolution": msg.get("resolution"),
                            "quality": msg.get("quality"),
                            "ratio": msg.get("ratio") or msg.get("aspectRatio") or msg.get("aspect_ratio"),
                            "timestamp": msg.get("timestamp"),
                            "raw": msg,
                            "matchedVia": "exact_chat" if exact_chat else "library_fallback",
                        }

                    if msg.get("isLoading") is True or str(msg.get("status") or "").lower() in {
                        "loading",
                        "pending",
                        "processing",
                        "running",
                        "queued",
                    }:
                        return {
                            "status": "processing",
                            "chatId": chat.get("id") or chat.get("chatId"),
                            "msgId": msg.get("id"),
                            "raw": msg,
                            "matchedVia": "exact_chat" if exact_chat else "library_fallback",
                        }

                    # Bot finished (isLoading false) but no media/error field.
                    if msg.get("isLoading") is False:
                        return {
                            "status": "error",
                            "chatId": chat.get("id") or chat.get("chatId"),
                            "msgId": msg.get("id"),
                            "message": msg.get("text") or msg.get("content") or "Generation finished without media",
                            "raw": msg,
                            "matchedVia": "exact_chat" if exact_chat else "library_fallback",
                        }
            return None

        # Exact chatId only when a concrete id was requested. When chat_id is None
        # (timeout loose scan), skip this path so prompt/model/since filters apply.
        if chat_id:
            matched_chats = [c for c in chats if chat_matches(c)]
            if matched_chats:
                hit = scan_messages(matched_chats, require_prompt=False, exact_chat=True)
                if hit:
                    return hit

        # Fallback: client chatId often never appears; results land in user_library.
        # Prefer prompt/model/since filters so we do not grab an unrelated older image.
        if prompt_substr or model or since_ts is not None or not chat_id:
            # Prefer user_library first, then remaining chats.
            lib = [c for c in chats if str(c.get("id") or "") == "user_library"]
            others = [c for c in chats if str(c.get("id") or "") != "user_library"]
            # If we have no filters at all and no chat_id, still scan (legacy).
            require_prompt = bool(prompt_substr) or bool(model) or since_ts is not None
            hit = scan_messages(lib + others, require_prompt=require_prompt, exact_chat=False)
            if hit:
                return hit

        # If upstream still reports this chat as active, surface processing even without msg.
        active = history_payload.get("activeGeneration")
        if isinstance(active, dict):
            active_cid = str(active.get("chatId") or active.get("id") or "")
            if chat_id and active_cid == str(chat_id):
                return {
                    "status": "processing",
                    "chatId": chat_id,
                    "msgId": None,
                    "raw": active,
                    "matchedVia": "activeGeneration",
                }
            # No chat_id filter: any active job counts as processing.
            if not chat_id:
                return {
                    "status": "processing",
                    "chatId": active_cid or None,
                    "msgId": None,
                    "raw": active,
                    "matchedVia": "activeGeneration",
                }
        return None

    def wait_for_result(
        self,
        *,
        chat_id: str | None = None,
        prompt_substr: str | None = None,
        model: str | None = None,
        since_ts: int | float | None = None,
        poll_interval: float = 3.0,
        timeout: float = 180.0,
        on_tick: Any = None,
    ) -> dict[str, Any]:
        """Poll /api/history until media appears, errors, or timeout.

        Results frequently appear only under ``user_library`` (not the client
        chatId). Pass ``prompt_substr`` and/or ``model`` + ``since_ts`` so the
        library fallback can identify the correct bot message.
        """
        self.require_auth()
        cid = chat_id or self.chat_id
        deadline = time.time() + timeout
        last: dict[str, Any] | None = None
        last_hist: dict[str, Any] | None = None
        consecutive_errors = 0

        while time.time() < deadline:
            try:
                hist = self.history(limit=30, offset=0)
                consecutive_errors = 0
                last_hist = hist
            except DaFreeAiError as exc:
                consecutive_errors += 1
                if on_tick:
                    on_tick(
                        {
                            "found": None,
                            "activeGeneration": None,
                            "activeGenerationsCount": None,
                            "history_error": str(exc),
                            "consecutive_errors": consecutive_errors,
                        }
                    )
                # Transient upstream slowness — keep waiting until deadline.
                time.sleep(max(poll_interval, 2.0))
                continue

            found = self.find_result_in_history(
                hist,
                chat_id=cid,
                prompt_substr=prompt_substr,
                model=model,
                since_ts=since_ts,
            )
            active = hist.get("activeGeneration")
            active_count = hist.get("activeGenerationsCount")
            if on_tick:
                on_tick(
                    {
                        "found": found,
                        "activeGeneration": active,
                        "activeGenerationsCount": active_count,
                        "history_chats": len(hist.get("history") or []),
                        "matchedVia": (found or {}).get("matchedVia"),
                    }
                )
            if found and found.get("status") in {"completed", "error"}:
                return found
            last = found
            time.sleep(poll_interval)

        # Final best-effort scan without chat filter if we still have history.
        if last_hist:
            loose = self.find_result_in_history(
                last_hist,
                chat_id=None,
                prompt_substr=prompt_substr,
                model=model,
                since_ts=since_ts,
            )
            if loose and loose.get("status") in {"completed", "error"}:
                loose["note"] = "matched without strict chat_id after timeout"
                return loose

        return {
            "status": "timeout",
            "chatId": cid,
            "last": last,
            "message": f"Timed out after {timeout}s",
        }

    def generate_and_wait(
        self,
        prompt: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        poll_interval = float(kwargs.pop("poll_interval", 3.0))
        timeout = float(kwargs.pop("timeout", 180.0))
        on_tick = kwargs.pop("on_tick", None)
        model = kwargs.get("model")
        submit = self.generate(prompt, **kwargs)
        chat_id = submit.get("_request", {}).get("chatId") or self.chat_id
        # Prefer a short distinctive prompt slice for user_library fallback.
        # Full prompt is fine; library bot messages usually keep the prompt field.
        prompt_key = prompt.strip()[:80] if prompt else None
        since_ts = int(time.time() * 1000) - 60_000
        result = self.wait_for_result(
            chat_id=chat_id,
            prompt_substr=prompt_key,
            model=str(model) if model else None,
            since_ts=since_ts,
            poll_interval=poll_interval,
            timeout=timeout,
            on_tick=on_tick,
        )
        result["submit"] = submit
        return result

    def absolute_media_url(self, media: str) -> str:
        if media.startswith("http://") or media.startswith("https://"):
            return media
        return self._url(media)

    def download_media(self, media: str, dest: str | Path) -> Path:
        url = self.absolute_media_url(media)
        dest_path = Path(dest)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with self.session.get(url, stream=True, timeout=self.timeout) as resp:
            resp.raise_for_status()
            with dest_path.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
        return dest_path

    def save_auth(self, path: str | Path) -> None:
        self.require_auth()
        Path(path).write_text(
            json.dumps({"id": self.user_id, "token": self.token}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
