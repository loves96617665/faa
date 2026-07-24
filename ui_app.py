#!/usr/bin/env python3
"""DaFreeAi Studio — Gradio Web UI (full)."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import gradio as gr

from dafreeai.client import DaFreeAiClient, DaFreeAiError
from dafreeai.models import (
    ASPECT_RATIOS,
    QUALITIES,
    get_model,
    list_models,
)

ROOT = Path(__file__).resolve().parent
USER_FILE = ROOT / "dafreeai_user.json"
CONFIG_FILE = ROOT / "config.json"
OUTPUT_DIR = ROOT / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

DEFAULT_MODEL = "nano-banana-2-lite"
DEFAULT_ASPECT = "1:1"
DEFAULT_QUALITY = "low"
DEFAULT_DURATION = 5
DEFAULT_POLL = 3.0
DEFAULT_TIMEOUT = 180.0


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _mask_token(token: str | None) -> str:
    if not token:
        return "(none)"
    t = str(token)
    if len(t) <= 12:
        return t[:2] + "…" + t[-2:]
    return t[:8] + "…" + t[-6:]


def _model_choices(media_type: str) -> list[str]:
    items = list_models(media_type if media_type in {"image", "video"} else None)
    out: list[str] = []
    for m in items:
        flags: list[str] = [m.type]
        if m.unlimited:
            flags.append("unlimited")
        if m.tag_required:
            flags.append("tag")
        if m.supports_quality:
            flags.append("quality")
        out.append(f"{m.id}  |  {m.name}  [{', '.join(flags)}]")
    return out


def _parse_model_id(label: str | None) -> str:
    if not label:
        return DEFAULT_MODEL
    return label.split("|", 1)[0].strip()


def _default_model_label(media_type: str = "image") -> str:
    choices = _model_choices(media_type)
    for c in choices:
        if c.startswith(DEFAULT_MODEL):
            return c
    return choices[0] if choices else DEFAULT_MODEL


def _load_client_from_disk() -> DaFreeAiClient:
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


def _client_from_state(auth: dict[str, Any] | None) -> DaFreeAiClient:
    auth = auth or {}
    uid = auth.get("user_id") or auth.get("id")
    token = auth.get("token")
    base = auth.get("base_url") or "https://www.dafreeai.site"
    if uid and token:
        return DaFreeAiClient(user_id=str(uid), token=token, base_url=base)
    return _load_client_from_disk()


def _auth_summary(client: DaFreeAiClient, extra: dict[str, Any] | None = None) -> str:
    lines = [
        f"**userId:** `{client.user_id or '—'}`",
        f"**token:** `{_mask_token(client.token)}`",
        f"**base:** `{client.base_url}`",
        f"**auth file:** `{USER_FILE}`",
    ]
    if extra:
        if extra.get("username"):
            lines.insert(1, f"**username:** `{extra['username']}`")
        if "balance" in extra:
            lines.append(f"**bananas:** `{extra['balance']}`")
        if extra.get("tag") is not None:
            lines.append(f"**tag:** `{extra['tag']}`")
        if extra.get("message"):
            lines.append(f"\n{extra['message']}")
    return "\n".join(lines)


def _save_user_payload(payload: dict[str, Any]) -> Path:
    USER_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return USER_FILE


def _extract_user_fields(data: dict[str, Any]) -> dict[str, Any]:
    if "user" in data and isinstance(data["user"], dict):
        data = data["user"]
    return {
        "id": str(data.get("id") or data.get("userId") or data.get("user_id") or ""),
        "token": data.get("token") or "",
        "username": data.get("username") or data.get("global_name") or data.get("globalName") or "",
        "tokens": data.get("tokens"),
        "raw": data,
    }


def _media_ext(media: str, model_id: str) -> str:
    lower = media.lower()
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


def _safe_filename(chat_id: str, model_id: str, media: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    cid = re.sub(r"[^\w\-]+", "_", str(chat_id))[:40]
    mid = re.sub(r"[^\w\-]+", "_", str(model_id))[:40]
    return f"{cid}_{mid}_{ts}{_media_ext(media, model_id)}"


def _history_rows(client: DaFreeAiClient, limit: int = 20, offset: int = 0) -> tuple[list[list[Any]], str, dict[str, Any]]:
    data = client.history(limit=int(limit), offset=int(offset))
    rows: list[list[Any]] = []
    for chat in data.get("history") or []:
        chat_id = chat.get("id")
        title = chat.get("title") or ""
        for msg in chat.get("messages") or []:
            if msg.get("role") != "bot":
                continue
            media = client.extract_media(msg) or ""
            status = "error" if msg.get("isError") else ("loading" if msg.get("isLoading") else ("done" if media else "unknown"))
            prompt = (msg.get("prompt") or msg.get("text") or "")[:80]
            rows.append(
                [
                    str(chat_id),
                    str(msg.get("id") or ""),
                    status,
                    msg.get("modelName") or "",
                    msg.get("resolution") or "",
                    msg.get("ratio") or msg.get("aspectRatio") or "",
                    prompt,
                    media,
                    title,
                ]
            )
    meta = {
        "activeGeneration": data.get("activeGeneration"),
        "activeGenerationsCount": data.get("activeGenerationsCount"),
        "hasMore": data.get("hasMore"),
    }
    summary = (
        f"active={meta['activeGeneration']} | "
        f"count={meta['activeGenerationsCount']} | "
        f"hasMore={meta['hasMore']} | rows={len(rows)}"
    )
    return rows, summary, data


def _visibility_for_model(model_id: str) -> tuple[Any, ...]:
    """Return Gradio updates for resolution/quality/duration/audio."""
    try:
        m = get_model(model_id)
    except Exception:
        m = get_model(DEFAULT_MODEL)

    res_choices = list(m.supported_resolutions)
    res_value = m.default_resolution if m.default_resolution in res_choices else (res_choices[0] if res_choices else "1K")
    show_quality = bool(m.supports_quality or m.id.startswith("gpt-image") or "gpt" in m.id)
    show_video = m.type == "video"

    return (
        gr.update(choices=res_choices, value=res_value),
        gr.update(visible=show_quality, interactive=show_quality),
        gr.update(visible=show_video),
        gr.update(visible=show_video),
        gr.update(value=f"**{m.name}** (`{m.id}`) · {m.company} · type=`{m.type}` · "
                        f"res={','.join(m.supported_resolutions)} · "
                        f"unlimited={m.unlimited} · tag_required={m.tag_required}"
                        + (f" · notes: {m.notes}" if m.notes else "")),
    )


# ---------------------------------------------------------------------------
# auth handlers
# ---------------------------------------------------------------------------

def ui_get_login_url(auth: dict | None):
    client = _client_from_state(auth)
    try:
        url = client.get_discord_login_url()
        return url, "已取得 Discord OAuth URL。瀏覽器授權後，把 callback 的 `code` 貼到下方（注意：code 只能用一次）。"
    except Exception as e:
        return "", f"取得登入連結失敗：{e}"


def ui_exchange_code(code: str, auth: dict | None):
    code = (code or "").strip()
    if not code:
        return auth, _auth_summary(_client_from_state(auth), {"message": "請貼上 OAuth code"}), "缺少 code"
    client = _client_from_state(auth)
    try:
        user = client.exchange_code(code)
        fields = _extract_user_fields(user if isinstance(user, dict) else {})
        if not fields["id"] or not fields["token"]:
            return auth, _auth_summary(client), f"交換成功但缺少 id/token：{user}"
        payload = {
            "id": fields["id"],
            "token": fields["token"],
            "username": fields["username"],
            "tokens": fields.get("tokens"),
        }
        # keep extra fields if present
        if isinstance(user, dict):
            for k, v in user.items():
                if k not in payload:
                    payload[k] = v
        _save_user_payload(payload)
        new_auth = {
            "user_id": fields["id"],
            "token": fields["token"],
            "username": fields["username"],
            "base_url": client.base_url,
        }
        extra = {"username": fields["username"], "message": f"已儲存至 `{USER_FILE}`"}
        try:
            bal = client.balance()
            extra["balance"] = bal.get("balance", bal)
        except Exception:
            pass
        return new_auth, _auth_summary(client, extra), "登入成功"
    except DaFreeAiError as e:
        return auth, _auth_summary(client), f"交換失敗：{e}（code 可能已被使用或過期，請改貼 localStorage JSON）"
    except Exception as e:
        return auth, _auth_summary(client), f"交換失敗：{e}"


def ui_save_manual(user_id: str, token: str, username: str, auth: dict | None):
    user_id = (user_id or "").strip()
    token = (token or "").strip()
    username = (username or "").strip()
    if not user_id or not token:
        client = _client_from_state(auth)
        return auth, _auth_summary(client), "userId 與 token 必填"
    payload = {"id": user_id, "token": token}
    if username:
        payload["username"] = username
    _save_user_payload(payload)
    new_auth = {"user_id": user_id, "token": token, "username": username, "base_url": "https://www.dafreeai.site"}
    client = DaFreeAiClient(user_id=user_id, token=token)
    extra = {"username": username, "message": f"已儲存至 `{USER_FILE}`"}
    try:
        bal = client.balance()
        extra["balance"] = bal.get("balance", bal)
    except Exception as e:
        extra["message"] += f"\n餘額查詢：{e}"
    return new_auth, _auth_summary(client, extra), "已儲存憑證"


def ui_paste_json(raw: str, auth: dict | None):
    raw = (raw or "").strip()
    if not raw:
        return auth, _auth_summary(_client_from_state(auth)), "請貼上 JSON"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return auth, _auth_summary(_client_from_state(auth)), f"JSON 解析失敗：{e}"
    fields = _extract_user_fields(data)
    if not fields["id"] or not fields["token"]:
        return auth, _auth_summary(_client_from_state(auth)), "JSON 缺少 id/token"
    # preserve full structure when possible
    if "user" in data and isinstance(data["user"], dict):
        save_obj = data
    else:
        save_obj = dict(data)
        save_obj["id"] = fields["id"]
        save_obj["token"] = fields["token"]
        if fields["username"]:
            save_obj["username"] = fields["username"]
    _save_user_payload(save_obj)
    new_auth = {
        "user_id": fields["id"],
        "token": fields["token"],
        "username": fields["username"],
        "base_url": "https://www.dafreeai.site",
    }
    client = DaFreeAiClient(user_id=fields["id"], token=fields["token"])
    extra = {"username": fields["username"], "message": f"已從 JSON 載入並儲存 `{USER_FILE}`"}
    try:
        bal = client.balance()
        extra["balance"] = bal.get("balance", bal)
    except Exception as e:
        extra["message"] += f"\n餘額查詢：{e}"
    return new_auth, _auth_summary(client, extra), "JSON 登入成功"


def ui_load_saved(auth: dict | None):
    client = _load_client_from_disk()
    if not client.user_id or not client.token:
        return (
            auth or {},
            _auth_summary(client, {"message": "尚未找到 dafreeai_user.json / config.json"}),
            "",
            "",
            "",
            "未找到本機憑證",
        )
    new_auth = {
        "user_id": client.user_id,
        "token": client.token,
        "username": (auth or {}).get("username", ""),
        "base_url": client.base_url,
    }
    # try read username from file
    try:
        raw = json.loads(USER_FILE.read_text(encoding="utf-8"))
        fields = _extract_user_fields(raw)
        new_auth["username"] = fields.get("username") or new_auth.get("username") or ""
    except Exception:
        fields = {"username": ""}
    extra = {"username": new_auth.get("username"), "message": "已載入本機憑證"}
    try:
        bal = client.balance()
        extra["balance"] = bal.get("balance", bal)
    except Exception as e:
        extra["message"] += f"\n餘額：{e}"
    try:
        tag = client.check_tag()
        extra["tag"] = tag
    except Exception:
        pass
    return (
        new_auth,
        _auth_summary(client, extra),
        client.user_id or "",
        client.token or "",
        new_auth.get("username") or "",
        "載入成功",
    )


def ui_refresh_account(auth: dict | None):
    client = _client_from_state(auth)
    if not client.user_id or not client.token:
        return _auth_summary(client, {"message": "尚未登入"}), "未登入"
    extra: dict[str, Any] = {"username": (auth or {}).get("username")}
    msgs = []
    try:
        bal = client.balance()
        extra["balance"] = bal.get("balance", bal)
        msgs.append("balance ok")
    except Exception as e:
        msgs.append(f"balance: {e}")
    try:
        tag = client.check_tag()
        extra["tag"] = tag
        msgs.append("tag ok")
    except Exception as e:
        msgs.append(f"tag: {e}")
    try:
        client.accept_terms()
        msgs.append("terms accepted")
    except Exception as e:
        msgs.append(f"terms: {e}")
    extra["message"] = " / ".join(msgs)
    return _auth_summary(client, extra), "已重新整理帳號狀態"


# ---------------------------------------------------------------------------
# generate handlers
# ---------------------------------------------------------------------------

def ui_on_media_type(media_type: str):
    choices = _model_choices(media_type)
    label = _default_model_label(media_type)
    model_id = _parse_model_id(label)
    res_u, q_u, d_u, a_u, info_u = _visibility_for_model(model_id)
    return gr.update(choices=choices, value=label), res_u, q_u, d_u, a_u, info_u


def ui_on_model_change(model_label: str):
    return _visibility_for_model(_parse_model_id(model_label))


def ui_generate(
    auth: dict | None,
    media_type: str,
    model_label: str,
    prompt: str,
    aspect: str,
    resolution: str,
    quality: str,
    duration: float,
    audio: bool,
    image_refs: str,
    chat_id: str,
    poll_interval: float,
    poll_timeout: float,
    auto_download: bool,
    progress=gr.Progress(track_tqdm=False),
):
    client = _client_from_state(auth)
    empty_img, empty_vid, empty_file = None, None, None
    if not client.user_id or not client.token:
        yield "錯誤：尚未登入", "", empty_img, empty_vid, empty_file, "請先到「登入」分頁設定 token"
        return
    prompt = (prompt or "").strip()
    if not prompt:
        yield "錯誤：prompt 不可為空", "", empty_img, empty_vid, empty_file, "缺少 prompt"
        return

    model_id = _parse_model_id(model_label)
    try:
        model = get_model(model_id)
    except Exception as e:
        yield f"錯誤：{e}", "", empty_img, empty_vid, empty_file, str(e)
        return

    refs: list[str] | None = None
    if image_refs and image_refs.strip():
        refs = [x.strip() for x in re.split(r"[\n,]+", image_refs) if x.strip()]
        if len(refs) > model.max_image_refs:
            yield (
                f"錯誤：最多 {model.max_image_refs} 張參考圖",
                "",
                empty_img,
                empty_vid,
                empty_file,
                "參考圖過多",
            )
            return

    cid = (chat_id or "").strip() or str(uuid.uuid4())
    progress(0.05, desc="提交生成…")
    status_lines = [
        f"model={model_id}",
        f"chatId={cid}",
        f"aspect={aspect} resolution={resolution} quality={quality}",
    ]
    if model.type == "video":
        status_lines.append(f"duration={int(duration)} audio={bool(audio)}")
    if refs:
        status_lines.append(f"refs={len(refs)}")

    try:
        submit = client.generate(
            prompt,
            model=model_id,
            aspect=aspect or DEFAULT_ASPECT,
            resolution=resolution or None,
            quality=quality or DEFAULT_QUALITY,
            duration=int(duration or DEFAULT_DURATION),
            audio=bool(audio),
            image_paths=refs,
            chat_id=cid,
        )
    except Exception as e:
        yield (
            "提交失敗\n" + "\n".join(status_lines) + f"\n\n{e}",
            "",
            empty_img,
            empty_vid,
            empty_file,
            f"submit error: {e}",
        )
        return

    banana_cost = submit.get("bananaCost")
    bananas = submit.get("bananas") or {}
    bal = bananas.get("balance", bananas) if isinstance(bananas, dict) else bananas
    yield (
        "已提交，輪詢中…\n"
        + "\n".join(status_lines)
        + f"\nbananaCost={banana_cost} balance={bal}\nmessage={submit.get('message')}",
        cid,
        empty_img,
        empty_vid,
        empty_file,
        "submitted",
    )

    # poll with progress updates
    deadline_ticks = max(1, int(float(poll_timeout) / max(0.5, float(poll_interval))))
    tick = 0
    last_status = "processing"

    def on_tick(info: dict[str, Any]):
        nonlocal tick, last_status
        tick += 1
        found = info.get("found") or {}
        last_status = found.get("status") or "processing"
        frac = min(0.95, 0.1 + tick / deadline_ticks * 0.8)
        progress(frac, desc=f"輪詢 {tick}: {last_status} active={info.get('activeGeneration')}")

    try:
        result = client.wait_for_result(
            chat_id=cid,
            prompt_substr=prompt[:40],
            poll_interval=float(poll_interval or DEFAULT_POLL),
            timeout=float(poll_timeout or DEFAULT_TIMEOUT),
            on_tick=on_tick,
        )
    except Exception as e:
        yield (
            f"輪詢失敗：{e}\nchatId={cid}",
            cid,
            empty_img,
            empty_vid,
            empty_file,
            f"poll error: {e}",
        )
        return

    result_status = result.get("status")
    if result_status == "error":
        yield (
            f"生成錯誤\nchatId={cid}\n{result.get('message')}",
            cid,
            empty_img,
            empty_vid,
            empty_file,
            str(result.get("message")),
        )
        return
    if result_status == "timeout":
        yield (
            f"逾時（{poll_timeout}s）\nchatId={cid}\n可到歷史分頁查看是否稍後完成",
            cid,
            empty_img,
            empty_vid,
            empty_file,
            "timeout",
        )
        return
    if result_status != "completed" or not result.get("media"):
        yield (
            f"未知狀態：{result_status}\n{json.dumps(result, ensure_ascii=False)[:800]}",
            cid,
            empty_img,
            empty_vid,
            empty_file,
            str(result_status),
        )
        return

    media = result["media"]
    abs_url = client.absolute_media_url(media)
    local_path: Path | None = None
    img_out, vid_out, file_out = None, None, None

    if auto_download:
        progress(0.97, desc="下載媒體…")
        try:
            dest = OUTPUT_DIR / _safe_filename(cid, model_id, media)
            local_path = client.download_media(media, dest)
            file_out = str(local_path)
        except Exception as e:
            # still show remote url
            yield (
                f"完成但下載失敗：{e}\nURL: {abs_url}\nchatId={cid}",
                cid,
                abs_url if model.type == "image" else None,
                abs_url if model.type == "video" else None,
                None,
                f"download error: {e}",
            )
            return

    progress(1.0, desc="完成")
    if model.type == "video":
        vid_out = str(local_path) if local_path else abs_url
    else:
        img_out = str(local_path) if local_path else abs_url

    info = (
        f"完成\n"
        f"chatId={cid}\n"
        f"model={result.get('modelName') or model_id}\n"
        f"resolution={result.get('resolution')} ratio={result.get('ratio')}\n"
        f"media={media}\n"
        f"url={abs_url}\n"
        f"local={local_path or '—'}\n"
        f"bananaCost={banana_cost} balance={bal}"
    )
    yield info, cid, img_out, vid_out, file_out, "completed"


# ---------------------------------------------------------------------------
# history / status
# ---------------------------------------------------------------------------

def ui_load_history(auth: dict | None, limit: float, offset: float):
    client = _client_from_state(auth)
    if not client.user_id or not client.token:
        return [], "未登入", None, None, None, "未登入"
    try:
        rows, summary, _ = _history_rows(client, limit=int(limit), offset=int(offset))
        return rows, summary, None, None, None, "ok"
    except Exception as e:
        return [], f"載入失敗：{e}", None, None, None, str(e)


def ui_history_select(evt: gr.SelectData, auth: dict | None, table: Any):
    """Gradio .select 會把 SelectData 放在第一個參數，其後才是 inputs。"""
    client = _client_from_state(auth)
    if table is None:
        return None, None, None, "未選擇"
    try:
        row_idx = evt.index[0] if isinstance(evt.index, (list, tuple)) else evt.index
        # Gradio Dataframe 可能是 list[list] 或 pandas.DataFrame
        if hasattr(table, "iloc"):
            row = list(table.iloc[row_idx])
        else:
            row = list(table[row_idx])
    except Exception:
        return None, None, None, "選擇列失敗"
    media = row[7] if len(row) > 7 else ""
    chat_id = row[0] if row else ""
    status = row[2] if len(row) > 2 else ""
    if not media or status == "loading":
        return None, None, None, f"chat={chat_id} 尚無媒體（status={status}）"
    abs_url = client.absolute_media_url(str(media))
    is_video = any(x in abs_url.lower() for x in (".mp4", ".webm", ".mov", "video"))
    img = None if is_video else abs_url
    vid = abs_url if is_video else None
    return img, vid, abs_url, f"chat={chat_id} media={media}"


def ui_download_selected(auth: dict | None, media_url: str, chat_id_hint: str):
    client = _client_from_state(auth)
    media_url = (media_url or "").strip()
    if not media_url:
        return None, "沒有可下載的媒體 URL"
    # media_url may already be absolute
    media = media_url
    if media.startswith(client.base_url):
        media = media[len(client.base_url) :]
    try:
        name = _safe_filename(chat_id_hint or "history", "media", media)
        path = client.download_media(media_url if media_url.startswith("http") else media, OUTPUT_DIR / name)
        return str(path), f"已下載：{path}"
    except Exception as e:
        return None, f"下載失敗：{e}"


def ui_delete_history(auth: dict | None, chat_id: str, limit: float, offset: float):
    client = _client_from_state(auth)
    chat_id = (chat_id or "").strip()
    if not chat_id:
        rows, summary, _, _, _, _ = ui_load_history(auth, limit, offset)
        return rows, summary, "請輸入要刪除的 chatId"
    try:
        client.delete_history(chat_id)
        rows, summary, _ = _history_rows(client, limit=int(limit), offset=int(offset))
        return rows, summary, f"已刪除 chatId={chat_id}"
    except Exception as e:
        rows, summary, _, _, _, _ = ui_load_history(auth, limit, offset)
        return rows, summary, f"刪除失敗：{e}"


def ui_status_refresh(auth: dict | None):
    client = _client_from_state(auth)
    blocks: list[str] = []
    try:
        pool = client.credits_pool()
        blocks.append("## Credits Pool\n```json\n" + json.dumps(pool, ensure_ascii=False, indent=2) + "\n```")
    except Exception as e:
        blocks.append(f"## Credits Pool\n錯誤：{e}")

    if client.user_id and client.token:
        try:
            bal = client.balance()
            blocks.append("## Bananas\n```json\n" + json.dumps(bal, ensure_ascii=False, indent=2) + "\n```")
        except Exception as e:
            blocks.append(f"## Bananas\n錯誤：{e}")
        try:
            tag = client.check_tag()
            blocks.append("## Discord Tag\n```json\n" + json.dumps(tag, ensure_ascii=False, indent=2) + "\n```")
        except Exception as e:
            blocks.append(f"## Discord Tag\n錯誤：{e}")
        try:
            hist = client.history(limit=3, offset=0)
            active = {
                "activeGeneration": hist.get("activeGeneration"),
                "activeGenerationsCount": hist.get("activeGenerationsCount"),
                "hasMore": hist.get("hasMore"),
            }
            blocks.append("## Active Generation\n```json\n" + json.dumps(active, ensure_ascii=False, indent=2) + "\n```")
        except Exception as e:
            blocks.append(f"## Active Generation\n錯誤：{e}")
    else:
        blocks.append("## Account\n未登入（僅顯示公開 credits pool）")

    blocks.append(
        f"## Paths\n- output: `{OUTPUT_DIR}`\n- user file: `{USER_FILE}`\n- base: `{client.base_url}`"
    )
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# build UI
# ---------------------------------------------------------------------------

def build_ui() -> gr.Blocks:
    initial_client = _load_client_from_disk()
    initial_auth = {
        "user_id": initial_client.user_id,
        "token": initial_client.token,
        "username": "",
        "base_url": initial_client.base_url,
    }
    if USER_FILE.exists():
        try:
            fields = _extract_user_fields(json.loads(USER_FILE.read_text(encoding="utf-8")))
            initial_auth["username"] = fields.get("username") or ""
        except Exception:
            pass

    image_choices = _model_choices("image")
    default_label = _default_model_label("image")
    default_model_id = _parse_model_id(default_label)
    try:
        default_res = get_model(default_model_id).supported_resolutions
        default_res_val = get_model(default_model_id).default_resolution
    except Exception:
        default_res = ["1K"]
        default_res_val = "1K"

    css = """
    .status-box textarea {font-family: ui-monospace, Consolas, monospace; font-size: 13px;}
    footer {display:none !important}
    """

    with gr.Blocks(title="DaFreeAi Studio", theme=gr.themes.Soft(), css=css) as demo:
        gr.Markdown(
            """
# DaFreeAi Studio
本機專業生成介面 · 逆向 API：`https://www.dafreeai.site`  
重用 `dafreeai` client · 支援圖片 / 影片 · 歷史 · OAuth / token 登入
            """.strip()
        )

        auth_state = gr.State(initial_auth)

        with gr.Tabs():
            # ---------------- Auth ----------------
            with gr.Tab("登入 / 帳號"):
                gr.Markdown(
                    """
### 建議流程
1. 若瀏覽器已登入官網：DevTools Console 執行 `copy(localStorage.getItem('dafreeai_user'))`，貼到下方 JSON  
2. 或手動填 userId + token  
3. OAuth `code` 只能用一次，且常被官網前端先消耗 → 失敗時改用 JSON
                    """.strip()
                )
                with gr.Row():
                    with gr.Column(scale=1):
                        btn_login_url = gr.Button("取得 Discord 登入連結", variant="secondary")
                        login_url = gr.Textbox(label="Discord OAuth URL", lines=2)
                        oauth_code = gr.Textbox(label="OAuth callback code", placeholder="貼上 code= 後面的值")
                        btn_exchange = gr.Button("用 code 換 token", variant="primary")
                        gr.Markdown("---")
                        user_json = gr.Textbox(
                            label="貼上 localStorage dafreeai_user JSON",
                            lines=8,
                            placeholder='{"id":"...","token":"...","username":"..."}',
                        )
                        btn_json = gr.Button("從 JSON 登入並儲存", variant="primary")
                        gr.Markdown("---")
                        in_uid = gr.Textbox(label="userId", value=initial_auth.get("user_id") or "")
                        in_token = gr.Textbox(label="token", value=initial_auth.get("token") or "", type="password")
                        in_name = gr.Textbox(label="username（可選）", value=initial_auth.get("username") or "")
                        with gr.Row():
                            btn_manual = gr.Button("儲存 userId/token", variant="primary")
                            btn_load = gr.Button("載入本機 dafreeai_user.json")
                            btn_refresh_acct = gr.Button("重新整理餘額 / tag / 接受條款")
                    with gr.Column(scale=1):
                        auth_md = gr.Markdown(_auth_summary(initial_client, {"username": initial_auth.get("username")}))
                        auth_msg = gr.Textbox(label="訊息", lines=3, elem_classes=["status-box"])

                btn_login_url.click(ui_get_login_url, inputs=[auth_state], outputs=[login_url, auth_msg])
                btn_exchange.click(
                    ui_exchange_code,
                    inputs=[oauth_code, auth_state],
                    outputs=[auth_state, auth_md, auth_msg],
                )
                btn_json.click(
                    ui_paste_json,
                    inputs=[user_json, auth_state],
                    outputs=[auth_state, auth_md, auth_msg],
                )
                btn_manual.click(
                    ui_save_manual,
                    inputs=[in_uid, in_token, in_name, auth_state],
                    outputs=[auth_state, auth_md, auth_msg],
                )
                btn_load.click(
                    ui_load_saved,
                    inputs=[auth_state],
                    outputs=[auth_state, auth_md, in_uid, in_token, in_name, auth_msg],
                )
                btn_refresh_acct.click(
                    ui_refresh_account,
                    inputs=[auth_state],
                    outputs=[auth_md, auth_msg],
                )

            # ---------------- Generate ----------------
            with gr.Tab("生成工作室"):
                with gr.Row():
                    with gr.Column(scale=1):
                        media_type = gr.Radio(["image", "video"], value="image", label="媒體類型")
                        model_dd = gr.Dropdown(choices=image_choices, value=default_label, label="模型", allow_custom_value=False)
                        model_info = gr.Markdown()
                        prompt = gr.Textbox(
                            label="Prompt",
                            lines=5,
                            placeholder="a cute orange cat sitting on a windowsill, soft morning light",
                        )
                        aspect = gr.Dropdown(choices=ASPECT_RATIOS, value=DEFAULT_ASPECT, label="Aspect ratio")
                        resolution = gr.Dropdown(choices=default_res, value=default_res_val, label="Resolution")
                        quality = gr.Dropdown(
                            choices=QUALITIES,
                            value=DEFAULT_QUALITY,
                            label="Quality（GPT Image）",
                            visible=False,
                        )
                        duration = gr.Slider(1, 20, value=DEFAULT_DURATION, step=1, label="Duration 秒（Video）", visible=False)
                        audio = gr.Checkbox(value=True, label="Audio（Video）", visible=False)
                        image_refs = gr.Textbox(
                            label="參考圖 URL / data URL（可選，每行一個，最多 3）",
                            lines=3,
                            placeholder="https://...\ndata:image/png;base64,...",
                        )
                        with gr.Accordion("進階", open=False):
                            chat_id_in = gr.Textbox(label="chatId（空白=自動 UUID）")
                            poll_interval = gr.Number(value=DEFAULT_POLL, label="輪詢間隔秒")
                            poll_timeout = gr.Number(value=DEFAULT_TIMEOUT, label="逾時秒")
                            auto_download = gr.Checkbox(value=True, label="完成後自動下載到 output/")
                        btn_gen = gr.Button("開始生成", variant="primary")
                    with gr.Column(scale=1):
                        gen_status = gr.Textbox(label="狀態", lines=14, elem_classes=["status-box"])
                        out_chat = gr.Textbox(label="chatId")
                        out_image = gr.Image(label="圖片預覽", type="filepath")
                        out_video = gr.Video(label="影片預覽")
                        out_file = gr.File(label="下載檔案")
                        gen_msg = gr.Textbox(label="簡訊", lines=1)

                # init model info
                demo.load(lambda: _visibility_for_model(default_model_id), outputs=[resolution, quality, duration, audio, model_info])

                media_type.change(
                    ui_on_media_type,
                    inputs=[media_type],
                    outputs=[model_dd, resolution, quality, duration, audio, model_info],
                )
                model_dd.change(
                    ui_on_model_change,
                    inputs=[model_dd],
                    outputs=[resolution, quality, duration, audio, model_info],
                )
                btn_gen.click(
                    ui_generate,
                    inputs=[
                        auth_state,
                        media_type,
                        model_dd,
                        prompt,
                        aspect,
                        resolution,
                        quality,
                        duration,
                        audio,
                        image_refs,
                        chat_id_in,
                        poll_interval,
                        poll_timeout,
                        auto_download,
                    ],
                    outputs=[gen_status, out_chat, out_image, out_video, out_file, gen_msg],
                )

            # ---------------- History ----------------
            with gr.Tab("歷史紀錄"):
                with gr.Row():
                    hist_limit = gr.Number(value=15, label="limit", precision=0)
                    hist_offset = gr.Number(value=0, label="offset", precision=0)
                    btn_hist = gr.Button("重新整理歷史", variant="primary")
                hist_summary = gr.Textbox(label="摘要", lines=1)
                hist_table = gr.Dataframe(
                    headers=[
                        "chatId",
                        "msgId",
                        "status",
                        "model",
                        "resolution",
                        "ratio",
                        "prompt",
                        "media",
                        "title",
                    ],
                    datatype=["str"] * 9,
                    interactive=False,
                    wrap=True,
                    label="History（點選列可預覽）",
                )
                with gr.Row():
                    hist_image = gr.Image(label="預覽圖", type="filepath")
                    hist_video = gr.Video(label="預覽影片")
                hist_media_url = gr.Textbox(label="媒體 URL")
                with gr.Row():
                    btn_dl = gr.Button("下載目前媒體")
                    hist_file = gr.File(label="下載")
                with gr.Row():
                    del_chat = gr.Textbox(label="要刪除的 chatId")
                    btn_del = gr.Button("刪除該 chat", variant="stop")
                hist_msg = gr.Textbox(label="訊息", lines=2)

                btn_hist.click(
                    ui_load_history,
                    inputs=[auth_state, hist_limit, hist_offset],
                    outputs=[hist_table, hist_summary, hist_image, hist_video, hist_media_url, hist_msg],
                )
                hist_table.select(
                    ui_history_select,
                    inputs=[auth_state, hist_table],
                    outputs=[hist_image, hist_video, hist_media_url, hist_msg],
                )
                btn_dl.click(
                    ui_download_selected,
                    inputs=[auth_state, hist_media_url, del_chat],
                    outputs=[hist_file, hist_msg],
                )
                btn_del.click(
                    ui_delete_history,
                    inputs=[auth_state, del_chat, hist_limit, hist_offset],
                    outputs=[hist_table, hist_summary, hist_msg],
                )

            # ---------------- Status ----------------
            with gr.Tab("系統狀態"):
                btn_status = gr.Button("重新整理狀態", variant="primary")
                status_md = gr.Markdown("點擊重新整理以載入 credits pool / 餘額 / tag / active 任務")
                btn_status.click(ui_status_refresh, inputs=[auth_state], outputs=[status_md])
                gr.Markdown(
                    f"""
### 本機路徑
- 專案：`{ROOT}`
- 輸出：`{OUTPUT_DIR}`
- 憑證：`{USER_FILE}`

### CLI 仍可用
```bat
python main.py models
python main.py status
python main.py generate "a cute cat" --model nano-banana-2-lite --verbose
```
                    """.strip()
                )

        gr.Markdown("<sub>token 僅存本機 · 伺服器綁定 127.0.0.1 · 請遵守網站條款</sub>")

    return demo


def main():
    demo = build_ui()
    demo.queue(default_concurrency_limit=2)
    demo.launch(
        server_name="127.0.0.1",
        server_port=7860,
        inbrowser=True,
        show_error=True,
    )


if __name__ == "__main__":
    main()
