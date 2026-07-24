# DaFreeAi Studio v1 API

Base URL: `https://faa.kinai.workers.dev`

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
  "chatId": null
}
```

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
  "poll": { "url": "/v1/jobs/uuid", "intervalSec": 3, "timeoutSec": 180 }
}
```

### GET /v1/jobs/:jobId

Poll job status: `pending` | `processing` | `completed` | `error`.

On success includes `mediaUrl` (remote dafreeai URL).

### GET /v1/history?limit=20&offset=0

Normalized history rows.

---

## Error shape

```json
{
  "ok": false,
  "error": {
    "code": "MODEL_NOT_ALLOWED",
    "message": "Generation failed: MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE",
    "hint": "請改用 nano-banana-2-lite，或降低 quality。"
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
| UPSTREAM_ERROR | 502 | Other upstream error |

---

## Recommended model

Use **`nano-banana-2-lite`** for reliable unlimited generation.

`gpt-image-2` may intermittently fail with package/lock errors when pool credits are low.

---

## curl example

```bash
export FAA_KEY=faa_sk_...
export BASE=https://faa.kinai.workers.dev

curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/models" | jq

JOB=$(curl -s -X POST "$BASE/v1/generate" \
  -H "Authorization: Bearer $FAA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cute cat","model":"nano-banana-2-lite","aspect":"1:1","resolution":"1K"}')
echo "$JOB" | jq
CHAT=$(echo "$JOB" | jq -r .chatId)

curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/jobs/$CHAT" | jq
```

See also: `docs/examples/curl.sh`, `docs/examples/generate.mjs`.
