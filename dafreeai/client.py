"""HTTP client for DaFreeAi reverse-engineered REST API."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

from .models import ModelSpec, validate_generate_params


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
    ) -> dict[str, Any]:
        """Submit a generation job to POST /api/generate."""
        self.require_auth()
        model_spec, settings = validate_generate_params(
            model,
            aspect=aspect,
            resolution=resolution,
            quality=quality,
            duration=duration,
            audio=audio,
            image_paths=image_paths,
        )
        if raw_settings:
            settings.update(raw_settings)

        cid = chat_id or self.chat_id
        payload: dict[str, Any] = {
            "userId": self.user_id,
            "token": self.token,
            "chatId": cid,
            "model": model_spec.id,
            "prompt": prompt,
            "settings": settings,
        }
        if image_paths:
            payload["imagePaths"] = image_paths[: model_spec.max_image_refs]
            payload["imagePath"] = image_paths[0]

        data = self._request("POST", "/api/generate", json=payload)
        data["_request"] = {
            "chatId": cid,
            "model": model_spec.id,
            "prompt": prompt,
            "settings": settings,
        }
        return data

    # ------------------------------------------------------------------
    # polling helpers
    # ------------------------------------------------------------------
    @staticmethod
    def extract_media(message: dict[str, Any]) -> str | None:
        media = (
            message.get("image")
            or message.get("imageUrl")
            or message.get("url")
            or message.get("video")
            or message.get("videoUrl")
        )
        if not media and message.get("outputImages"):
            outs = message["outputImages"]
            if isinstance(outs, list) and outs:
                media = outs[0]
        if media and "placeholder" not in str(media):
            return str(media)
        return None

    def find_result_in_history(
        self,
        history_payload: dict[str, Any],
        *,
        chat_id: str | None = None,
        prompt_substr: str | None = None,
    ) -> dict[str, Any] | None:
        for chat in history_payload.get("history") or []:
            if chat_id and str(chat.get("id")) != str(chat_id):
                continue
            bot_msgs = [m for m in (chat.get("messages") or []) if m.get("role") == "bot"]
            # Latest bot message first (API appends newest at end).
            for msg in reversed(bot_msgs):
                prompt_text = str(msg.get("prompt") or msg.get("text") or "")
                title_text = str(chat.get("title") or "")
                if prompt_substr and prompt_substr not in prompt_text and prompt_substr not in title_text:
                    continue

                err_text = msg.get("error")
                if msg.get("isError") or err_text:
                    return {
                        "status": "error",
                        "chatId": chat.get("id"),
                        "msgId": msg.get("id"),
                        "message": err_text or msg.get("text") or "generation error",
                        "raw": msg,
                    }

                media = self.extract_media(msg)
                if media:
                    return {
                        "status": "completed",
                        "chatId": chat.get("id"),
                        "msgId": msg.get("id"),
                        "media": media,
                        "prompt": msg.get("prompt"),
                        "modelName": msg.get("modelName"),
                        "resolution": msg.get("resolution"),
                        "quality": msg.get("quality"),
                        "ratio": msg.get("ratio") or msg.get("aspectRatio"),
                        "raw": msg,
                    }

                if msg.get("isLoading") is True:
                    return {
                        "status": "processing",
                        "chatId": chat.get("id"),
                        "msgId": msg.get("id"),
                        "raw": msg,
                    }

                # Bot finished (isLoading false) but no media/error field.
                if msg.get("isLoading") is False:
                    return {
                        "status": "error",
                        "chatId": chat.get("id"),
                        "msgId": msg.get("id"),
                        "message": msg.get("text") or "Generation finished without media",
                        "raw": msg,
                    }
        return None

    def wait_for_result(
        self,
        *,
        chat_id: str | None = None,
        prompt_substr: str | None = None,
        poll_interval: float = 3.0,
        timeout: float = 180.0,
        on_tick: Any = None,
    ) -> dict[str, Any]:
        """Poll /api/history until media appears, errors, or timeout."""
        self.require_auth()
        cid = chat_id or self.chat_id
        deadline = time.time() + timeout
        last: dict[str, Any] | None = None

        while time.time() < deadline:
            hist = self.history(limit=20, offset=0)
            found = self.find_result_in_history(hist, chat_id=cid, prompt_substr=prompt_substr)
            active = hist.get("activeGeneration")
            active_count = hist.get("activeGenerationsCount")
            if on_tick:
                on_tick(
                    {
                        "found": found,
                        "activeGeneration": active,
                        "activeGenerationsCount": active_count,
                    }
                )
            if found and found.get("status") in {"completed", "error"}:
                return found
            last = found
            time.sleep(poll_interval)

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
        submit = self.generate(prompt, **kwargs)
        chat_id = submit.get("_request", {}).get("chatId") or self.chat_id
        result = self.wait_for_result(
            chat_id=chat_id,
            prompt_substr=prompt[:40] if prompt else None,
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
