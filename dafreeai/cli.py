"""Command-line interface for DaFreeAi Studio."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from .client import DaFreeAiClient, DaFreeAiError
from .models import ASPECT_RATIOS, MODELS, QUALITIES, list_models


def _print_json(data) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _load_client(args: argparse.Namespace) -> DaFreeAiClient:
    if getattr(args, "config", None) and Path(args.config).exists():
        client = DaFreeAiClient.from_config(args.config)
    elif getattr(args, "user_file", None) and Path(args.user_file).exists():
        client = DaFreeAiClient.from_user_json(args.user_file)
    else:
        client = DaFreeAiClient()

    if getattr(args, "user_id", None):
        client.user_id = str(args.user_id)
    if getattr(args, "token", None):
        client.token = args.token
    if getattr(args, "base_url", None):
        client.base_url = args.base_url.rstrip("/")
    return client


def cmd_login_url(args: argparse.Namespace) -> int:
    client = _load_client(args)
    url = client.get_discord_login_url()
    print(url)
    return 0


def cmd_exchange(args: argparse.Namespace) -> int:
    client = _load_client(args)
    user = client.exchange_code(args.code)
    out = Path(args.out)
    out.write_text(json.dumps(user, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved auth to {out}")
    _print_json({"id": user.get("id"), "username": user.get("username"), "tokens": user.get("tokens")})
    return 0


def cmd_models(args: argparse.Namespace) -> int:
    items = list_models(args.type)
    if args.json:
        _print_json([m.to_dict() for m in items])
        return 0

    print(f"{'ID':24} {'TYPE':6} {'RES':18} {'UNL':4} {'TAG':4} NAME")
    print("-" * 90)
    for m in items:
        print(
            f"{m.id:24} {m.type:6} {','.join(m.supported_resolutions):18} "
            f"{'Y' if m.unlimited else 'N':4} {'Y' if m.tag_required else 'N':4} {m.name}"
        )
    print("\nSupported aspects:", ", ".join(ASPECT_RATIOS))
    print("Supported qualities (GPT Image):", ", ".join(QUALITIES))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    client = _load_client(args)
    pool = client.credits_pool()
    print("== credits pool ==")
    _print_json(pool)
    if client.user_id and client.token:
        print("== balance ==")
        try:
            _print_json(client.balance())
        except DaFreeAiError as e:
            print(f"balance error: {e}")
        print("== tag ==")
        try:
            _print_json(client.check_tag())
        except DaFreeAiError as e:
            print(f"tag error: {e}")
    return 0


def cmd_history(args: argparse.Namespace) -> int:
    client = _load_client(args)
    data = client.history(limit=args.limit, offset=args.offset)
    if args.raw:
        _print_json(data)
        return 0

    print("activeGeneration:", data.get("activeGeneration"))
    print("activeGenerationsCount:", data.get("activeGenerationsCount"))
    print("hasMore:", data.get("hasMore"))
    for chat in data.get("history") or []:
        print(f"\n# chat {chat.get('id')} | {chat.get('title')}")
        for msg in chat.get("messages") or []:
            media = client.extract_media(msg)
            print(
                f"  - {msg.get('role')} loading={msg.get('isLoading')} error={msg.get('isError')} "
                f"model={msg.get('modelName')} media={media}"
            )
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    client = _load_client(args)
    if args.new_session:
        client.new_session()

    def on_tick(info):
        found = info.get("found") or {}
        print(
            f"[poll] active={info.get('activeGeneration')} "
            f"count={info.get('activeGenerationsCount')} "
            f"status={found.get('status')}"
        )

    try:
        if args.no_wait:
            result = client.generate(
                args.prompt,
                model=args.model,
                aspect=args.aspect,
                resolution=args.resolution,
                quality=args.quality,
                duration=args.duration,
                audio=not args.no_audio,
                image_paths=args.image,
                chat_id=args.chat_id,
            )
            _print_json(result)
            return 0

        result = client.generate_and_wait(
            args.prompt,
            model=args.model,
            aspect=args.aspect,
            resolution=args.resolution,
            quality=args.quality,
            duration=args.duration,
            audio=not args.no_audio,
            image_paths=args.image,
            chat_id=args.chat_id,
            poll_interval=args.poll_interval,
            timeout=args.timeout,
            on_tick=on_tick if args.verbose else None,
        )
    except DaFreeAiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        if e.payload is not None:
            _print_json(e.payload)
        return 1

    _print_json({k: v for k, v in result.items() if k != "raw"})

    if result.get("status") == "completed" and result.get("media"):
        out_dir = Path(args.output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        media = str(result["media"])
        ext = ".png"
        lower = media.lower()
        if lower.endswith(".mp4") or "video" in lower:
            ext = ".mp4"
        elif lower.endswith(".webp"):
            ext = ".webp"
        elif lower.endswith(".jpg") or lower.endswith(".jpeg"):
            ext = ".jpg"
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = out_dir / f"{args.model}_{ts}{ext}"
        try:
            saved = client.download_media(media, dest)
            print(f"Downloaded: {saved}")
            meta = out_dir / f"{args.model}_{ts}.json"
            meta.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
            print(f"Meta: {meta}")
        except Exception as exc:
            print(f"Download failed: {exc}", file=sys.stderr)
            print("Media URL:", client.absolute_media_url(media))
        return 0

    return 2 if result.get("status") != "completed" else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dafreeai",
        description="DaFreeAi Studio - reverse-engineered generation toolkit",
    )
    p.add_argument("--config", default="config.json", help="Path to config.json")
    p.add_argument("--user-file", default="dafreeai_user.json", help="Path to user auth JSON")
    p.add_argument("--user-id", help="Override user id")
    p.add_argument("--token", help="Override session token")
    p.add_argument("--base-url", default="https://www.dafreeai.site")

    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("login-url", help="Print Discord OAuth login URL")
    s.set_defaults(func=cmd_login_url)

    s = sub.add_parser("exchange", help="Exchange OAuth code for user token")
    s.add_argument("code")
    s.add_argument("--out", default="dafreeai_user.json")
    s.set_defaults(func=cmd_exchange)

    s = sub.add_parser("models", help="List supported models/parameters")
    s.add_argument("--type", choices=["image", "video"])
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_models)

    s = sub.add_parser("status", help="Show credits pool / balance / tag")
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("history", help="Show recent generation history")
    s.add_argument("--limit", type=int, default=10)
    s.add_argument("--offset", type=int, default=0)
    s.add_argument("--raw", action="store_true")
    s.set_defaults(func=cmd_history)

    s = sub.add_parser("generate", help="Generate image/video")
    s.add_argument("prompt")
    s.add_argument("--model", default="nano-banana-2-lite", choices=sorted(MODELS.keys()))
    s.add_argument("--aspect", default="1:1", choices=ASPECT_RATIOS)
    s.add_argument("--resolution", default=None)
    s.add_argument("--quality", default="low", choices=QUALITIES)
    s.add_argument("--duration", type=int, default=5)
    s.add_argument("--no-audio", action="store_true")
    s.add_argument("--image", action="append", help="Reference image path/URL/data-URL (repeatable)")
    s.add_argument("--chat-id", help="Reuse a chat session id")
    s.add_argument("--new-session", action="store_true")
    s.add_argument("--no-wait", action="store_true", help="Only submit, do not poll")
    s.add_argument("--poll-interval", type=float, default=3.0)
    s.add_argument("--timeout", type=float, default=180.0)
    s.add_argument("--output-dir", default="output")
    s.add_argument("--verbose", action="store_true")
    s.set_defaults(func=cmd_generate)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except DaFreeAiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        if e.payload is not None:
            _print_json(e.payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
