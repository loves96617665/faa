# Upstream `POST /api/generate` — re-analysis

Date: 2026-07-30  
Source: live submit against `https://www.dafreeai.site`, FAA client/CF reverse, official UI patterns.

## 1. Role in the pipeline

```text
Client                         Upstream
------                         --------
1. POST /api/generate  ------>  validate auth + model + queue
                               enqueue background job
2. <---- { ok, bananas, ... }  (NO media URL)
3. loop GET /api/history/:uid  until bot.image != placeholder
4. GET /api/images/...         download bytes
```

`/api/generate` is **fire-and-forget enqueue**. It never streams pixels and does not return a job id other than the client-supplied `chatId`.

## 2. Endpoint

| Item | Value |
|------|-------|
| Method | `POST` |
| URL | `https://www.dafreeai.site/api/generate` |
| Content-Type | `application/json` |
| Auth | **Body** `userId` + `token` (not `Authorization: Bearer`) |
| Timeout | Can be slow; clients should use ≥60–120s HTTP timeout |

## 3. Request schema

### Top-level

```json
{
  "userId": "string(Discord snowflake)",
  "token": "string(hex session)",
  "chatId": "string(uuid recommended)",
  "model": "string(model id)",
  "prompt": "string",
  "settings": { },
  "imagePath": "string|null",
  "imagePaths": ["string", "..."]
}
```

### Field notes

| Field | Required | Behavior |
|-------|----------|----------|
| `userId` | yes | Must match token owner |
| `token` | yes | From Discord OAuth; stored in localStorage as `dafreeai_user` **or** `freedaai_user` |
| `chatId` | de-facto yes | Client UUID. Becomes history chat `id`. Poll key. |
| `model` | yes | Exact upstream id (see catalog). Unknown ids → error |
| `prompt` | yes | Free text |
| `settings` | yes | See matrix; empty/wrong resolution may error or default poorly |
| `imagePaths` | no | Ref images (URL / data-URL). Cap ~3 |
| `imagePath` | no | Convenience first ref; FAA sets both when refs present |

### `settings` (official UI / FAA builder)

Always send aspect **three ways** (frontend reverse):

```json
{
  "aspect_ratio": "1:1",
  "aspectRatio": "1:1",
  "ratio": "1:1",
  "resolution": "1K"
}
```

Conditional:

| Model type | Extra keys |
|------------|------------|
| GPT image (`gpt-image-*`) | `"quality": "low"\|"medium"\|"high"` |
| Video | `"duration": 5`, `"audio": true` |

Aspects: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `21:9`.

Resolutions:

- Image: `1K` / `2K` / `4K` (model-dependent; lite only `1K`)
- Video: `480p` / `720p` / `1080p`

## 4. Success response (live 2026-07)

```json
{
  "ok": true,
  "message": "Generation started in background",
  "bananas": {
    "balance": 100,
    "resetAt": 1785456000000,
    "history": [
      {
        "amount": 10,
        "reason": "Daily Reward",
        "timestamp": 1785393348670
      }
    ],
    "redeemedCodes": [],
    "v2ResetDone": true,
    "dailyAllowance": 10
  },
  "bananaCost": 0
}
```

### Semantics

| Field | Meaning |
|-------|---------|
| `ok: true` | Job **accepted** by API gateway / queue |
| `message` | Fixed async copy |
| `bananaCost` | Charge for this request (`0` for unlimited lite in live test) |
| `bananas` | **Post-charge wallet object** (use as balance refresh) |

There is **no** `jobId`, `media`, or `status: completed` here.

## 5. Post-submit observation channel

### `GET /api/history/:userId?token=&limit=&offset=`

Relevant top-level fields:

| Field | Meaning |
|-------|---------|
| `activeGeneration` | Object `{ chatId, model, timestamp }` while upstream marks job active; often **null** even mid-run |
| `activeGenerationsCount` | Parallel active count (may be null/absent) |
| `history[]` | Chats; each `id` == submitted `chatId` |
| `history[].messages[]` | user + bot turns |

### Bot message lifecycle (documented + reverse)

| Stage | Signals |
|-------|---------|
| Queued / running | `role: "bot"`, `isLoading: true`, `image: "placeholder-0"` (or similar) |
| Done | `isLoading: false`, `image` / `outputImages` real path, no `placeholder` |
| Error | `isError: true` and/or `error` / `errorMessage` text |

Media path form:

```text
/api/images/{userId}/{file}.png
→ https://www.dafreeai.site/api/images/{userId}/{file}.png
```

### Live anomaly (this session)

Submit for `nano-banana-2-lite` returned `ok: true`, `bananaCost: 0`.

Poll log:

1. First tick: `activeGeneration = { chatId, model, timestamp }`
2. Later ticks: `activeGeneration = null`, `found status = null`
3. After 240s: client `status: "timeout"`

Interpretation (ordered likelihood):

1. **Poll matcher bug (fixed in Python client)**: `generate_and_wait` used `prompt_substr=prompt[:40]` even with known `chatId`; bot messages often omit full prompt → permanent miss (`status=None`).
2. **History lag / chat not listed yet**: chatId absent from `history` window (`limit` too small or eventual consistency).
3. **Upstream job dropped** after accept (queue worker fail) — still possible; need raw history dump for that `chatId`.
4. **Network flakiness** on history GETs (earlier balance read timed out at 60s).

## 6. Error surface

| Pattern | Typical cause |
|---------|----------------|
| `403 Unauthorized: Invalid token` | Bad token / logged out |
| `MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE` | Model not on free/unlimited package |
| `All accounts are currently inactive` | Provider account pool empty |
| `is locked` / `MODEL_NOT_ALLOWED` | Model locked; common for GPT high quality when artlist pool low |
| HTTP timeout | Upstream overload; retry with longer timeout |

FAA CF `smartGenerate` retries GPT models with `quality=low` and may fallback to `nano-banana-2-lite`.

## 7. Model ids accepted by generate (catalog)

Image: `nano-banana-2-lite`, `nano-banana-2`, `seedream-5.0-pro`, `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`  
Video: `gemini-omni-flash`, `seedance-2`, `seedance-mini`, `seedance-2-fast`, `sora-2-pro`, `sora-2`

Visibility of some models is controlled by **`GET /api/global-settings` → `modelStatuses`** (e.g. hide `gpt-image-1.5`). Hide is UI-level; generate may still accept or reject independently.

## 8. Cost / quota coupling

Two separate meters:

1. **Bananas** (`/api/bananas/:userId`, also echoed on generate success) — per-user daily allowance (~10) + balance.
2. **Artlist pool** (`/api/artlist/credits-progress`, `global-settings.artlistPoolMax` ~ 3_000_000) — shared provider credits; affects lock behavior for paid/high quality models.

Unlimited models can still fail if provider accounts are inactive/locked.

## 9. Minimal correct client algorithm

```text
chatId = uuid4()
POST /api/generate { userId, token, chatId, model, prompt, settings }
assert response.ok
deadline = now + T
while now < deadline:
  hist = GET /api/history/{userId}?token&limit=30
  chat = find hist.history where id == chatId
  if chat:
    bot = last message with role bot|assistant or generation fields
    if bot.media real: SUCCESS
    if bot.isError: FAIL
  sleep 2..5s
TIMEOUT → dump raw history for chatId
```

Do **not** require prompt substring match when `chatId` is known.

## 10. FAA code map

| File | Responsibility |
|------|----------------|
| [`dafreeai/client.py`](../dafreeai/client.py) `generate` | Build body, POST |
| [`dafreeai/models.py`](../dafreeai/models.py) `build_settings` | settings matrix |
| [`dafreeai/client.py`](../dafreeai/client.py) `wait_for_result` | history poll (chatId-first after 2026-07 fix) |
| [`cf/functions/_shared/client.js`](../cf/functions/_shared/client.js) `generate` | CF POST mirror |
| [`cf/functions/_shared/generate-smart.js`](../cf/functions/_shared/generate-smart.js) | quality retry + fallback + pool + busy-wait |
| [`cf/functions/_shared/pool.js`](../cf/functions/_shared/pool.js) | account pool acquire/release |

## 11. Probe commands

```powershell
cd <repo root>

# Full probe: public + auth + negative errors + one live generate
python main.py generate "a cute orange cat" --model nano-banana-2-lite --aspect 1:1 --resolution 1K --verbose

# GPT Image 2 submit+poll
python main.py generate "cyberpunk city" --model gpt-image-2 --quality low --resolution 1K

# Submit only (no poll)
python main.py generate "test" --model nano-banana-2-lite --no-wait

# Inspect raw history (uses the token saved in dafreeai_user.json)
python main.py history --limit 5
```

## 12. Conclusions

1. `/api/generate` contract is stable: **async accept + banana snapshot**.
2. Result delivery is **only** via history/media URLs keyed by client `chatId`.
3. Live submit works with current credentials (`ok`, `bananaCost: 0` on lite).
4. Prior “generation timeout” was largely a **client poll matching** issue (prompt filter), compounded by slow/flaky history and possible upstream drop — Python poll path has been hardened; CF `findResultInHistory` is now aligned (chatId-first).
5. For GPT Image 2 tests, use `quality=low` and a long poll; keep `--no-wait` handy to capture the raw submit response.

## 13. Re-recon 2026-08-05 (applied to code)

Live probes on 2026-08-05 (using a valid token) confirmed the contract and uncovered three fixes:

| Item | Observed | Code change |
|------|----------|-------------|
| gpt-image-2 resolution | `/api/models` reports `customDimensions: true`, `supportedResolutions: ["1K","2K","4K"]`; **live submit at 1K succeeds, at 4K the result never lands** (silent drop) | Removed the old “FORCED 4K” hack; default resolution is now `1K` (both `dafreeai/models.py` and `cf/functions/_shared/models.js`) |
| Parallel cap | Whole account allows **one** active generation; a second submit returns “Generation in progress” | Both clients now **busy-wait** (6s interval, 60s budget) and resubmit instead of failing; HTTP-200-but-`{ok:false}` bodies are guarded inside the submit layer |
| `activeGenerationsCount` | **Not present** in live history payload | `DaFreeAiClient.history()` derives `1`/`0` from `activeGeneration`; UI consumers (`/api/status`, `/api/job`, Gradio) read the derived value |

Also fixed in this pass: Gradio 5/6 compatibility (`theme`/`css` routed per major version) and `pool.js` no longer counts busy-release as an account error.
