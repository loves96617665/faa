#!/usr/bin/env python3
"""DaFreeAi Studio — Flask Web UI (no Gradio/pandas)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

from dafreeai.client import DaFreeAiClient, DaFreeAiError
from dafreeai.models import (
    ASPECT_RATIOS,
    QUALITIES,
    get_model,
    list_models,
)

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"
OUTPUT.mkdir(exist_ok=True)
USER_FILE = ROOT / "dafreeai_user.json"
CONFIG_FILE = ROOT / "config.json"

app = Flask(__name__, static_folder="static", static_url_path="/static")


def load_client() -> DaFreeAiClient:
    if CONFIG_FILE.exists():
        try:
            return DaFreeAiClient.from_config(CONFIG_FILE)
        except Exception:
            pass
    if USER_FILE.exists():
        try:
            return DaFreeAiClient.from_user_json(USER_FILE)
        except Exception:
            pass
    return DaFreeAiClient()


def client_from_request(data: dict | None = None) -> DaFreeAiClient:
    data = data or {}
    body = request.get_json(silent=True) or {}
    args = request.args
    uid = data.get("userId") or body.get("userId") or args.get("userId")
    token = data.get("token") or body.get("token") or args.get("token")
    if uid and token:
        return DaFreeAiClient(user_id=str(uid), token=str(token))
    return load_client()


def extract_user_fields(data: dict[str, Any]) -> dict[str, Any]:
    if "user" in data and isinstance(data["user"], dict):
        data = data["user"]
    return {
        "id": str(data.get("id") or data.get("userId") or data.get("user_id") or ""),
        "token": data.get("token") or "",
        "username": data.get("username") or data.get("global_name") or data.get("globalName") or "",
        "tokens": data.get("tokens"),
        "raw": data,
    }


def save_user(payload: dict[str, Any]) -> None:
    USER_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_name(text: str, max_len: int = 40) -> str:
    text = re.sub(r"[^\w\-]+", "_", str(text))
    return (text or "file")[:max_len]


def media_ext(media: str, model_id: str = "") -> str:
    lower = str(media).lower()
    if any(x in lower for x in (".mp4", ".webm", ".mov")) or "video" in lower:
        return ".mp4"
    if lower.endswith(".png"):
        return ".png"
    if lower.endswith(".webp"):
        return ".webp"
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        return ".jpg"
    try:
        m = get_model(model_id)
        return ".mp4" if m.type == "video" else ".jpg"
    except Exception:
        return ".jpg"


def err(message: str, status: int = 400, **extra):
    payload = {"ok": False, "error": message}
    payload.update(extra)
    return jsonify(payload), status


# ---------------------------------------------------------------------------
# pages / static
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/output/<path:filename>")
def serve_output(filename: str):
    if ".." in filename or filename.startswith(("/", "\\")):
        return err("非法檔名", 400)
    return send_from_directory(OUTPUT, filename)


# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

@app.get("/api/meta")
def api_meta():
    models = [m.to_dict() for m in list_models()]
    auth = {}
    client = load_client()
    if client.user_id:
        auth = {
            "userId": client.user_id,
            "hasToken": bool(client.token),
            "tokenPreview": (client.token[:8] + "…" + client.token[-6:]) if client.token and len(client.token) > 14 else None,
        }
        if USER_FILE.exists():
            try:
                fields = extract_user_fields(json.loads(USER_FILE.read_text(encoding="utf-8")))
                auth["username"] = fields.get("username")
            except Exception:
                pass
    return jsonify(
        {
            "ok": True,
            "base_url": client.base_url,
            "aspects": ASPECT_RATIOS,
            "qualities": QUALITIES,
            "models": models,
            "auth": auth,
            "output_dir": str(OUTPUT),
            "user_file": str(USER_FILE),
        }
    )


# ---------------------------------------------------------------------------
# auth
# ---------------------------------------------------------------------------

@app.get("/api/auth/login-url")
def api_login_url():
    try:
        url = load_client().get_discord_login_url()
        return jsonify({"ok": True, "url": url})
    except Exception as e:
        return err(str(e), 500)


@app.post("/api/auth/exchange")
def api_exchange():
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    if not code:
        return err("缺少 code")
    client = load_client()
    try:
        user = client.exchange_code(code)
        fields = extract_user_fields(user if isinstance(user, dict) else {})
        if not fields["id"] or not fields["token"]:
            return err("交換成功但缺少 id/token", payload=user)
        payload = dict(user) if isinstance(user, dict) else {}
        payload["id"] = fields["id"]
        payload["token"] = fields["token"]
        if fields["username"]:
            payload["username"] = fields["username"]
        save_user(payload)
        return jsonify(
            {
                "ok": True,
                "user": {
                    "id": fields["id"],
                    "username": fields["username"],
                    "tokens": fields.get("tokens"),
                    "hasToken": True,
                },
                "saved": str(USER_FILE),
            }
        )
    except DaFreeAiError as e:
        return err(f"{e}（code 可能已使用，請改貼 localStorage JSON）", getattr(e, "status", 401) or 401)
    except Exception as e:
        return err(str(e), 500)


@app.post("/api/auth/save")
def api_auth_save():
    body = request.get_json(silent=True) or {}
    # JSON paste mode
    if body.get("json"):
        raw = body["json"]
        if isinstance(raw, str):
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                return err(f"JSON 解析失敗：{e}")
        elif isinstance(raw, dict):
            data = raw
        else:
            return err("json 格式錯誤")
        fields = extract_user_fields(data)
        if not fields["id"] or not fields["token"]:
            return err("JSON 缺少 id/token")
        if "user" in data and isinstance(data["user"], dict):
            save_obj = data
        else:
            save_obj = dict(data)
            save_obj["id"] = fields["id"]
            save_obj["token"] = fields["token"]
            if fields["username"]:
                save_obj["username"] = fields["username"]
        save_user(save_obj)
        return jsonify(
            {
                "ok": True,
                "user": {
                    "id": fields["id"],
                    "username": fields["username"],
                    "hasToken": True,
                },
                "saved": str(USER_FILE),
            }
        )

    uid = str(body.get("userId") or body.get("id") or "").strip()
    token = str(body.get("token") or "").strip()
    username = str(body.get("username") or "").strip()
    if not uid or not token:
        return err("userId 與 token 必填")
    payload = {"id": uid, "token": token}
    if username:
        payload["username"] = username
    save_user(payload)
    return jsonify(
        {
            "ok": True,
            "user": {"id": uid, "username": username, "hasToken": True},
            "saved": str(USER_FILE),
        }
    )


@app.get("/api/auth/me")
def api_auth_me():
    client = client_from_request()
    if not client.user_id or not client.token:
        return jsonify({"ok": True, "logged_in": False})
    out: dict[str, Any] = {
        "ok": True,
        "logged_in": True,
        "userId": client.user_id,
        "username": None,
    }
    if USER_FILE.exists():
        try:
            fields = extract_user_fields(json.loads(USER_FILE.read_text(encoding="utf-8")))
            out["username"] = fields.get("username")
        except Exception:
            pass
    try:
        bal = client.balance()
        out["balance"] = bal
    except Exception as e:
        out["balance_error"] = str(e)
    try:
        out["tag"] = client.check_tag()
    except Exception as e:
        out["tag_error"] = str(e)
    return jsonify(out)


@app.post("/api/auth/accept-terms")
def api_accept_terms():
    client = client_from_request()
    try:
        client.require_auth()
        data = client.accept_terms()
        return jsonify({"ok": True, "data": data})
    except Exception as e:
        return err(str(e), 400)


# ---------------------------------------------------------------------------
# status / history / generate
# ---------------------------------------------------------------------------

@app.get("/api/status")
def api_status():
    client = client_from_request()
    result: dict[str, Any] = {"ok": True}
    try:
        result["credits_pool"] = client.credits_pool()
    except Exception as e:
        result["credits_pool_error"] = str(e)
    if client.user_id and client.token:
        try:
            result["balance"] = client.balance()
        except Exception as e:
            result["balance_error"] = str(e)
        try:
            result["tag"] = client.check_tag()
        except Exception as e:
            result["tag_error"] = str(e)
        try:
            hist = client.history(limit=3, offset=0)
            result["active"] = {
                "activeGeneration": hist.get("activeGeneration"),
                "activeGenerationsCount": hist.get("activeGenerationsCount"),
                "hasMore": hist.get("hasMore"),
            }
        except Exception as e:
            result["active_error"] = str(e)
    result["paths"] = {
        "output": str(OUTPUT),
        "user_file": str(USER_FILE),
        "base_url": client.base_url,
    }
    return jsonify(result)


@app.get("/api/history")
def api_history():
    client = client_from_request()
    try:
        client.require_auth()
    except DaFreeAiError as e:
        return err(str(e), 401)
    limit = int(request.args.get("limit", 20))
    offset = int(request.args.get("offset", 0))
    try:
        data = client.history(limit=limit, offset=offset)
    except Exception as e:
        return err(str(e), 500)

    rows = []
    for chat in data.get("history") or []:
        chat_id = chat.get("id")
        title = chat.get("title") or ""
        for msg in chat.get("messages") or []:
            if msg.get("role") != "bot":
                continue
            media = client.extract_media(msg) or ""
            err_text = msg.get("error") or ""
            if msg.get("isError") or err_text:
                status = "error"
            elif media:
                status = "done"
            elif msg.get("isLoading"):
                status = "loading"
            else:
                status = "unknown"
            abs_url = client.absolute_media_url(media) if media else ""
            rows.append(
                {
                    "chatId": str(chat_id),
                    "msgId": str(msg.get("id") or ""),
                    "status": status,
                    "error": err_text,
                    "model": msg.get("modelName") or "",
                    "resolution": msg.get("resolution") or "",
                    "ratio": msg.get("ratio") or msg.get("aspectRatio") or "",
                    "prompt": (msg.get("prompt") or msg.get("text") or "")[:200],
                    "media": media,
                    "mediaUrl": abs_url,
                    "title": title,
                }
            )
    return jsonify(
        {
            "ok": True,
            "rows": rows,
            "activeGeneration": data.get("activeGeneration"),
            "activeGenerationsCount": data.get("activeGenerationsCount"),
            "hasMore": data.get("hasMore"),
        }
    )


@app.delete("/api/history/<chat_id>")
def api_delete_history(chat_id: str):
    client = client_from_request()
    try:
        client.require_auth()
        data = client.delete_history(chat_id)
        return jsonify({"ok": True, "data": data})
    except Exception as e:
        return err(str(e), 400)


@app.get("/api/job/<chat_id>")
def api_job(chat_id: str):
    """Poll a single chat job status without blocking the browser."""
    client = client_from_request()
    try:
        client.require_auth()
    except DaFreeAiError as e:
        return err(str(e), 401)
    prompt_substr = request.args.get("prompt") or None
    try:
        hist = client.history(limit=20, offset=0)
        found = client.find_result_in_history(hist, chat_id=chat_id, prompt_substr=prompt_substr)
    except Exception as e:
        return err(str(e), 500)

    if not found:
        return jsonify(
            {
                "ok": True,
                "status": "pending",
                "chatId": chat_id,
                "activeGeneration": hist.get("activeGeneration"),
                "activeGenerationsCount": hist.get("activeGenerationsCount"),
            }
        )

    out: dict[str, Any] = {
        "ok": True,
        "status": found.get("status"),
        "chatId": found.get("chatId") or chat_id,
        "msgId": found.get("msgId"),
        "message": found.get("message"),
        "result": found,
        "activeGeneration": hist.get("activeGeneration"),
        "activeGenerationsCount": hist.get("activeGenerationsCount"),
    }
    if found.get("status") == "completed" and found.get("media"):
        media = found["media"]
        out["media"] = media
        out["mediaUrl"] = client.absolute_media_url(media)
        out["modelName"] = found.get("modelName")
        out["resolution"] = found.get("resolution")
        out["ratio"] = found.get("ratio")
    return jsonify(out)


@app.post("/api/generate")
def api_generate():
    body = request.get_json(silent=True) or {}
    client = client_from_request(body)
    try:
        client.require_auth()
    except DaFreeAiError as e:
        return err(str(e), 401)

    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return err("prompt 不可為空")

    model_id = (body.get("model") or "nano-banana-2-lite").strip()
    aspect = body.get("aspect") or "1:1"
    resolution = body.get("resolution")
    quality = body.get("quality") or "low"
    duration = int(body.get("duration") or 5)
    audio = bool(body.get("audio", True))
    chat_id = (body.get("chatId") or "").strip() or str(uuid.uuid4())
    # Default wait=False so browser UI can poll and show live status.
    wait = bool(body.get("wait", False))
    poll_interval = float(body.get("pollInterval") or 3)
    poll_timeout = float(body.get("pollTimeout") or 180)
    auto_download = bool(body.get("autoDownload", True))

    refs = body.get("imagePaths") or body.get("imageRefs") or []
    if isinstance(refs, str):
        refs = [x.strip() for x in re.split(r"[\n,]+", refs) if x.strip()]
    if not isinstance(refs, list):
        refs = []

    try:
        model = get_model(model_id)
    except Exception as e:
        return err(str(e))

    try:
        submit = client.generate(
            prompt,
            model=model_id,
            aspect=aspect,
            resolution=resolution,
            quality=quality,
            duration=duration,
            audio=audio,
            image_paths=refs or None,
            chat_id=chat_id,
        )
    except Exception as e:
        return err(f"提交失敗：{e}", 502)

    if not wait:
        return jsonify(
            {
                "ok": True,
                "status": "submitted",
                "chatId": chat_id,
                "submit": submit,
                "model": model_id,
                "type": model.type,
                "prompt": prompt,
            }
        )

    try:
        result = client.wait_for_result(
            chat_id=chat_id,
            prompt_substr=prompt[:40],
            poll_interval=poll_interval,
            timeout=poll_timeout,
        )
    except Exception as e:
        return err(f"輪詢失敗：{e}", 500, chatId=chat_id, submit=submit)

    out: dict[str, Any] = {
        "ok": True,
        "chatId": chat_id,
        "submit": submit,
        "result": result,
        "model": model_id,
        "type": model.type,
        "status": result.get("status"),
        "message": result.get("message"),
    }

    if result.get("status") == "error":
        out["ok"] = False
        out["error"] = result.get("message") or "generation error"
        return jsonify(out), 200

    if result.get("status") == "completed" and result.get("media"):
        media = result["media"]
        abs_url = client.absolute_media_url(media)
        out["media"] = media
        out["mediaUrl"] = abs_url
        if auto_download:
            try:
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                fname = f"{safe_name(chat_id)}_{safe_name(model_id)}_{ts}{media_ext(media, model_id)}"
                dest = OUTPUT / fname
                client.download_media(media, dest)
                out["saved"] = {
                    "filename": fname,
                    "local_url": f"/output/{fname}",
                    "path": str(dest),
                    "size": dest.stat().st_size,
                }
            except Exception as e:
                out["download_error"] = str(e)
    return jsonify(out)


@app.post("/api/download")
def api_download():
    body = request.get_json(silent=True) or {}
    client = client_from_request(body)
    media = (body.get("media") or body.get("url") or "").strip()
    if not media:
        return err("缺少 media/url")
    chat_id = safe_name(body.get("chatId") or "history")
    model_id = safe_name(body.get("model") or "media")
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"{chat_id}_{model_id}_{ts}{media_ext(media, model_id)}"
        dest = OUTPUT / fname
        # accept absolute or relative
        path = client.download_media(media, dest)
        return jsonify(
            {
                "ok": True,
                "filename": fname,
                "local_url": f"/output/{fname}",
                "path": str(path),
                "size": path.stat().st_size,
            }
        )
    except Exception as e:
        return err(str(e), 500)


@app.get("/api/gallery")
def api_gallery():
    files = []
    for p in sorted(OUTPUT.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"}:
            files.append(
                {
                    "name": p.name,
                    "url": f"/output/{p.name}",
                    "size": p.stat().st_size,
                    "mtime": p.stat().st_mtime,
                    "type": "video" if p.suffix.lower() in {".mp4", ".webm"} else "image",
                }
            )
    return jsonify({"ok": True, "files": files})


def main():
    print("=" * 50)
    print("  DaFreeAi Studio")
    print("  開啟瀏覽器: http://127.0.0.1:7860")
    print("=" * 50)
    app.run(host="127.0.0.1", port=7860, debug=False, threaded=True)


if __name__ == "__main__":
    main()
