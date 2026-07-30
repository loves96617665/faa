# DaFreeAi Studio v1 API

Base URL: `https://faa.kinai.workers.dev`
Build: `2026-07-30-v7-openai-images`

## Overview / 簡介

**English:** Public API for DaFreeAi Studio on Cloudflare Workers. Create an API key in the web UI, then call `/v1/*` with Bearer auth. Supports smart generate (gpt-image-2 quality/fallback) and a **service account pool** for true multi-user parallel generation.

**中文：** Cloudflare Worker 上的公開 API。在 UI 建立 API Key 後以 Bearer 呼叫 `/v1/*`。支援 smart generate（gpt-image-2 品質/降級）與**服務帳號池**，可多人真正並行生成。

Live docs page: https://faa.kinai.workers.dev/docs.html

---

## Authentication

Use an API Key created in the web UI (**API** tab) after logging in with your dafreeai credentials.

```http
Authorization: Bearer faa_sk_...
```

Also accepted:

```http
X-Api-Key: faa_sk_...
```

Keys are bound to your dafreeai `userId` + `token` (token encrypted in Workers KV).  
Plaintext key is shown **only once** at creation.

### Manage keys (browser session, not API Key)

Requires headers:

```http
X-User-Id: <discord user id>
X-User-Token: <dafreeai session token>
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/keys` | List keys (no plaintext) |
| POST | `/api/keys` | Create key `{ "name": "my-script", "scopes": ["*"] }` |
| DELETE | `/api/keys/:id` | Revoke key |

---

## Endpoints

### GET /v1/models

List models + aspects + qualities.

Models are filtered by live upstream `GET /api/global-settings` → `modelStatuses`.
Hidden statuses (`hide`, `hidden`, `disabled`, …) are omitted by default.

Query params:

| Param | Description |
|-------|-------------|
| `type` | Optional `image` \| `video` |
| `include_hidden` | `1` / `true` to include hidden models |

Response extras:

```json
{
  "ok": true,
  "models": [
    {
      "id": "nano-banana-2-lite",
      "name": "Nano Banana 2 Lite",
      "type": "image",
      "upstream_status": "show",
      "ui_hidden": false
    }
  ],
  "aspects": ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
  "qualities": ["low", "medium", "high"],
  "include_hidden": false,
  "maxCredits": 3000000,
  "hidden_models": ["gpt-image-1.5", "gpt-image-1-mini"],
  "global_settings": {
    "artlistPoolMax": 3000000,
    "videoCooldown": true,
    "modelStatuses": {"gpt-image-1.5": "hide"},
    "hidden_models": ["gpt-image-1.5", "gpt-image-1-mini"]
  }
}
```

Related browser endpoints (session headers, not API key):

- `GET /api/meta` — same filtered models + `maxCredits` / `global_settings`
- `GET /api/status` — credits pool + `global_settings` + `maxCredits`

### GET /v1/me

Current bound user balance / tag / key meta.

### POST /v1/generate

Non-blocking submit. Default model: `nano-banana-2-lite`.

Request:

```json
{
  "prompt": "a cute cat",
  "model": "nano-banana-2-lite",
  "aspect": "1:1",
  "resolution": "1K",
  "quality": "low",
  "duration": 5,
  "audio": true,
  "imagePaths": [],
  "chatId": null,
  "fallback": "auto",
  "forceQuality": false,
  "poolMode": "auto"
}
```

| Field | Description |
|-------|-------------|
| `prompt` | Required text prompt |
| `model` | Model id (aliases like `gpt-image-2-fast` → `gpt-image-2`) |
| `fallback` | `auto` \| `always` \| `never` — smart fallback for GPT image models |
| `forceQuality` | If true, do not auto-downgrade quality |
| `poolMode` | `auto` (default) \| `pool` \| `personal` — account pool routing |

Response `202`:

```json
{
  "ok": true,
  "status": "submitted",
  "jobId": "uuid",
  "chatId": "uuid",
  "model": "nano-banana-2-lite",
  "type": "image",
  "bananaCost": 0,
  "balance": 40,
  "fromPool": true,
  "poolAccount": { "id": "pool_...", "name": "...", "userId": "..." },
  "poolStats": { "total": 2, "enabled": 2, "free": 1, "busy": 1 },
  "adjustments": ["poolMode:auto", "poolAccount:pool_..."],
  "poll": { "url": "/v1/jobs/uuid", "intervalSec": 3, "timeoutSec": 180 }
}
```

### GET /v1/jobs/:jobId

Poll job status: `pending` | `processing` | `completed` | `error`.

On success includes `mediaUrl` (remote dafreeai URL).  
Pool jobs resolve auth via internal jobmap; keep using the same API key to poll.

### GET /v1/history?limit=20&offset=0

Normalized history rows.

---

## Service account pool / 服務帳號池

**English:** Upstream dafreeai allows only one active generation per account. Bind multiple credentials in the Studio **Pool** tab for true parallel multi-user generation. Each job acquires a free account; the lock is released on completed/error (TTL 5 minutes).

**中文：** 上游每個帳號同時只能跑一個生成。在 Studio **帳號池** 分頁綁多組憑證即可真正並行。每個 job 占用一個空閒帳號，完成/失敗後釋放（鎖 TTL 5 分鐘）。

### poolMode

| Value | Behavior |
|-------|----------|
| `auto` | Use pool if any enabled account exists; else personal |
| `pool` | Require free pool account; `POOL_BUSY` 503 if none |
| `personal` | Always use caller credentials |

### Pool management (session auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pool` | List accounts + stats |
| GET | `/api/pool/stats` | Stats only |
| POST | `/api/pool` | Add account (omit body to add current session) |
| PATCH | `/api/pool/:id` | Update `enabled` / `name` / `token` |
| DELETE | `/api/pool/:id` | Remove |
| POST | `/api/pool/:id/release` | Force release lock |

True concurrency needs **≥2 free pool accounts**.

---

## Error shape

```json
{
  "ok": false,
  "error": {
    "code": "MODEL_NOT_ALLOWED",
    "message": "Generation failed: MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE",
    "hint": "Use nano-banana-2-lite or lower quality."
  }
}
```

| code | HTTP | Meaning |
|------|------|---------|
| UNAUTHORIZED | 401 | Bad/missing API Key |
| FORBIDDEN | 403 | Revoked / missing scope |
| VALIDATION_ERROR | 400 | Bad params |
| RATE_LIMITED | 429 | 30/min overall, 6/min generate |
| UPSTREAM_BUSY | 409 | Generation already in progress |
| MODEL_LOCKED | 503 | Upstream accounts inactive / locked |
| MODEL_NOT_ALLOWED | 403 | Unlimited package restriction |
| PROMPT_LIMIT | 400/502 | Duplicate/similar prompt rejected |
| POOL_BUSY | 503 | No free pool account |
| UPSTREAM_ERROR | 502 | Other upstream error |

---

## Recommended model

Use **`nano-banana-2-lite`** for reliable unlimited generation.

`gpt-image-2`: prefer `quality=low`. Smart generate may retry with low quality or fall back to lite when locked / not allowed. Alias `gpt-image-2-fast` is normalized to `gpt-image-2`.

---

## OpenAI-compatible Images API

FAA implements an **OpenAI Images-compatible** surface so clients can use the familiar request/response shape.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/v1/images/generations` | OpenAI Images body → sync poll → `{ created, data:[{url\|b64_json}] }` |
| POST | `/openai/v1/images/generations` | Same handler (explicit prefix) |
| GET | `/openai/v1/models` | OpenAI `{ object:"list", data:[{id,object,owned_by}] }` |
| GET | `/v1/models?format=openai` | Same OpenAI list schema |
| GET | `/openai/v1/models/:id` | Model retrieve stub |

Auth is still FAA API Key:

```http
Authorization: Bearer faa_sk_...
```

### Request (OpenAI + FAA extensions)

```json
{
  "prompt": "a cute orange cat, soft daylight",
  "model": "nano-banana-2-lite",
  "n": 1,
  "size": "1024x1024",
  "quality": "standard",
  "response_format": "url",
  "aspect": "1:1",
  "resolution": "1K",
  "poolMode": "auto",
  "fallback": "auto",
  "timeout": 90,
  "async": false
}
```

| Field | Description |
|-------|-------------|
| `prompt` | Required |
| `model` | FAA id, or aliases: `dall-e-3`→`gpt-image-2`, `dall-e-2`→`nano-banana-2-lite` |
| `n` | Only `1` supported |
| `size` | `1024x1024` / `1792x1024` / `1024x1792` … mapped to aspect+resolution |
| `quality` | `standard`→`low`, `hd`→`high`, or raw `low`/`medium`/`high` |
| `response_format` | `url` (default) or `b64_json` |
| `timeout` | Sync poll seconds (default 90, max 150) |
| `async` | If true, return `202` with empty `data` + `faa.poll` (non-blocking) |
| `aspect` / `resolution` / `poolMode` / `fallback` | FAA extensions (optional) |

### Success response (OpenAI shape)

```json
{
  "created": 1753900000,
  "data": [
    {
      "url": "https://www.dafreeai.site/api/images/.../xxx.jpg",
      "revised_prompt": null
    }
  ],
  "id": "<jobId>",
  "model": "nano-banana-2-lite",
  "faa": {
    "jobId": "...",
    "mediaUrl": "...",
    "matchedVia": "library_fallback",
    "adjustments": []
  }
}
```

`b64_json` mode:

```json
{
  "created": 1753900000,
  "data": [{ "b64_json": "<base64...>", "revised_prompt": null }]
}
```

### Error response (OpenAI shape)

```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error",
    "param": null,
    "code": "VALIDATION_ERROR"
  },
  "faa": { "code": "VALIDATION_ERROR", "hint": "..." }
}
```

### size → aspect / resolution

| OpenAI `size` | aspect | resolution |
|---------------|--------|------------|
| `1024x1024` | `1:1` | `1K` |
| `1792x1024` | `16:9` | `1K` |
| `1024x1792` | `9:16` | `1K` |
| `1536x1024` | `4:3` | `1K` |
| `1024x1536` | `3:4` | `1K` |

### Official OpenAI SDK tip

```js
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: "faa_sk_...",
  baseURL: "https://faa.kinai.workers.dev/v1",
});
// calls POST {baseURL}/images/generations → /v1/images/generations
const img = await client.images.generate({
  model: "nano-banana-2-lite",
  prompt: "a cute cat",
  size: "1024x1024",
  response_format: "url",
});
console.log(img.data[0].url);
```

> Sync path waits up to `timeout` seconds inside the Worker (CF limit ~30s on free / higher on paid). If you hit Worker wall-clock limits, use `"async": true` then poll `GET /v1/jobs/:id`, or keep using native `/v1/generate`.

---

## curl example

```bash
export FAA_KEY=faa_sk_...
export BASE=https://faa.kinai.workers.dev

curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/models" | jq

JOB=$(curl -s -X POST "$BASE/v1/generate" \
  -H "Authorization: Bearer $FAA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cute cat","model":"nano-banana-2-lite","aspect":"1:1","resolution":"1K","poolMode":"auto"}')
echo "$JOB" | jq
CHAT=$(echo "$JOB" | jq -r .chatId)

curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/jobs/$CHAT" | jq
```

### OpenAI Images curl

```bash
curl -s -X POST "$BASE/v1/images/generations" \
  -H "Authorization: Bearer $FAA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":"a cute orange cat, soft daylight",
    "model":"nano-banana-2-lite",
    "size":"1024x1024",
    "response_format":"url",
    "timeout": 90
  }' | jq
```

See also: `docs/examples/curl.sh`, `docs/examples/generate.mjs`, `docs/examples/openai-images.mjs`, live page `/docs.html`.
