"""Minimal example: generate one image and download it."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dafreeai import DaFreeAiClient


def main() -> None:
    user_file = ROOT / "dafreeai_user.json"
    if not user_file.exists():
        print("Missing dafreeai_user.json. Login first.")
        return

    client = DaFreeAiClient.from_user_json(user_file)
    print("pool:", client.credits_pool())
    print("balance:", client.balance())

    result = client.generate_and_wait(
        "a cute orange cat sitting on a windowsill, soft daylight, simple illustration",
        model="nano-banana-2-lite",
        aspect="1:1",
        resolution="1K",
        timeout=180,
        poll_interval=3,
    )
    print(result)

    if result.get("status") == "completed" and result.get("media"):
        out = ROOT / "output" / "example_cat.png"
        client.download_media(result["media"], out)
        print("saved:", out)


if __name__ == "__main__":
    main()
