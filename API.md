# DaFreeAi Reverse API Reference

Source: frontend reverse + live probe of `https://www.dafreeai.site` (Express + nginx)  
Deep dive on generate: [`docs/upstream-generate.md`](docs/upstream-generate.md)  
Latest re-recon (2026-08-05, applied to code): see [`docs/upstream-generate.md`](docs/upstream-generate.md) §13

## Auth model

Not Bearer header. Use:

- Query: `?token=SESSION_TOKEN`
- Body: `{ "userId": "...", "token": "..." }`

User object fields observed (localStorage key may be `dafreeai_user` **or** `freedaai_user`):

```json
{
  "id": "1266...",
  "username": "...",
  "email": "...",
  "avatar": "https://cdn.discordapp.com/...",
  "token": "hex_session_token",
  "tokens": 50,
  "isAdmin": false,
  "isAgentTester": false,
  "hasDdfaiTag": false
}
```

Other localStorage keys used by official UI:

| Key | Purpose |
|-----|---------|
| `artlist_session_id` | Current client `chatId` (UUID) |
| `dafreeai_user_credits` | Local credit UI cache (default 50) |
| `dafreeai_cooldown_until` | Cooldown deadline |
| `dafreeai_admin_config` | Admin panel local config |

Cookie (post-login): `freedaai_user=...; domain=.dafreeai.site; Secure; SameSite=Lax`.

## Endpoints

### GET /api/auth/discord/url

Optional query: `?redirect_uri=https://.../auth/callback`

Response:

```json
{"url":"https://discord.com/api/oauth2/authorize?..."}
```

OAuth (live 2026-07-30):
- client_id: `1505313291604594959`
- redirect_uri in issued URL: `https://dafreeai.site/auth/callback` (**non-www**; frontend may pass `origin + '/auth/callback'`)
- scope: `identify email guilds.join`
- prompt: `consent`

### POST /api/auth/discord/callback

Request:

```json
{"code":"...","redirect_uri":"https://www.dafreeai.site/auth/callback"}
```

`redirect_uri` is sent by the official UI; may be required to match the authorize step.

Errors:
- `401 {"error":"Invalid \"code\" in request."}`

Success: `{ "user": { ... } }` — UI stores both `dafreeai_user` and `freedaai_user`.

### GET /api/artlist/credits-progress

```json
{"totalCredits":0,"maxCredits":3000000,"showBar":false}
```

> Note: `maxCredits` tracks the live Artlist pool ceiling (typically `3000000`). Live 2026-07-30 often has `totalCredits: 0` and `showBar: false`. Prefer reading this live, or use `/api/global-settings.artlistPoolMax`.  
> Official UI treats `totalCredits > 0` as `hasCreditAccounts`; when false, non-unlimited models and GPT Image 2 **High** are locked in the UI.

### GET /api/global-settings

Public upstream config used by the official UI. FAA now consumes this for dynamic model visibility and pool max. Polled ~every 10s by the official frontend.

Live 2026-07-30:

```json
{
  "artlistPoolBar": false,
  "artlistPoolMax": 3000000,
  "videoCooldown": true,
  "announcementActive": false,
  "announcementText": "Hey",
  "masterArtlistAutomation": true,
  "hideCreditSystem": true,
  "hideSponsorBtn": false,
  "modelStatuses": {
    "gpt-image-1.5": "hide",
    "gpt-image-1-mini": "hide"
  }
}
```

| Field | Meaning |
|-------|---------|
| `modelStatuses` | Per-model UI visibility. Values like `hide` / `hidden` / `disabled` / `offline` are filtered out of FAA model lists by default |
| `artlistPoolMax` | Same ceiling as credits-progress `maxCredits` |
| `videoCooldown` | Upstream video generation cooldown flag |
| `hideCreditSystem` | When true, official UI hides local credit bar/cost (live: true) |

FAA wrappers:

- Python: `DaFreeAiClient.global_settings()`, `list_available_models(include_hidden=False)`
- CF Worker: `GET /api/meta`, `GET /api/status`, `GET /v1/models` attach `global_settings`, `maxCredits`, `hidden_models`
- Query `?include_hidden=1` to keep hidden models in the list (still marked `ui_hidden: true`)

### GET /api/models

**Public runtime model catalog** (discovered 2026-07-30). Official frontend does **not** call this yet — it still hardcodes 12 product models and filters via `global-settings`. This endpoint is the server-side enable matrix.

```json
{
  "maintenanceMode": false,
  "globalRateLimit": 50,
  "models": {
    "gpt-image-2": {
      "hasDelay": false,
      "appEnabled": true,
      "apiEnabled": true,
      "provider": "zoviz",
      "imageReferenceEnabled": false,
      "supportedQualities": ["low", "medium", "high"],
      "supportedResolutions": ["1K", "2K", "4K"],
      "customDimensions": true
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `maintenanceMode` | Site-wide maintenance flag |
| `globalRateLimit` | Observed `50` |
| `appEnabled` / `apiEnabled` | Whether app UI / API path is open for that id |
| `provider` | Upstream provider hint (`zoviz`, `morphed`, `giz`, `everypixel`, `openai`, …) |
| `supportedResolutions` / `supportedQualities` | Capability hints when present |
| `imageReferenceEnabled` | Ref-image support |
| `customDimensions` | Custom size support (gpt-image-2) |

**Live enabled (`appEnabled` or `apiEnabled` true), 2026-07-30 — only 3:**

| id | res | quality | imgRef | notes |
|----|-----|---------|--------|-------|
| `nano-banana-2-lite` | 1K | — | yes | unlimited lite |
| `nano-banana-2` | 1K, 2K | — | yes | unlimited |
| `gpt-image-2` | 1K, 2K, 4K | low/medium/high | no | provider zoviz; customDimensions |

Catalog lists **38** ids total (seedream, seedance, sora, veo, flux, imagen, …) but the rest are dual-disabled. Prefer this endpoint over static lists when deciding if generate will be accepted.

> Raw live dumps (`output/upstream_*.json`) are local-only and gitignored — re-probe with `python main.py models --json` when needed.

### GET /api/user/check-tag/:userId

```json
{"hasTag":false,"tagText":null,"primaryGuildId":null,"userId":"..."}
```

Public enough to call with any id (including `0`). Used to set `hasDdfaiTag` after Support “Check My Discord Tag”.

### GET /api/credit-prices

Referenced by official UI to override the inline credit cost table. **Live 2026-07-30: HTTP 404** — UI falls back to hardcoded `CREDIT_PRICES_MAP`.

### GET /api/user/credits?userId=&targetUserId=

Syncs local credit UI (`dafreeai_user_credits`). Expected shape when healthy: `{ "ok": true, "credits": N }`. **Unauthenticated / invalid id live probe returned HTTP 500.** With `hideCreditSystem: true` this path is secondary.

### POST /api/generate

**Async enqueue only** — does **not** return image/video bytes or a final media URL.  
Poll `GET /api/history/:userId` with the same client `chatId` until bot media replaces `placeholder-*`.

#### Auth (body, not Bearer)

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | yes | Discord snowflake string |
| `token` | yes | Session token from OAuth / localStorage |

#### Request

```json
{
  "userId": "1266288955662405634",
  "token": "<session_token>",
  "chatId": "82c2ea44-5440-4284-abc8-3c435a0352fc",
  "model": "nano-banana-2-lite",
  "prompt": "a cute orange cat ...",
  "imagePath": null,
  "imagePaths": [],
  "settings": {
    "aspect_ratio": "1:1",
    "aspectRatio": "1:1",
    "ratio": "1:1",
    "resolution": "1K",
    "quality": "low",
    "duration": 5,
    "audio": true
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `chatId` | practical yes | Client UUID; becomes history chat `id` and poll key. Official UI stores it as `artlist_session_id` |
| `model` | yes | Exact upstream id (see Model IDs). FAA alias `gpt-image-2-fast` → normalize to `gpt-image-2` before calling upstream |
| `prompt` | yes | Text |
| `settings` | yes | See matrix; frontend sends aspect **three times** |
| `imagePaths` | no | Ref images (URL / data-URL / path); max ~3 |
| `imagePath` | no | First ref convenience field |

#### `settings` matrix

| Key | Image | GPT Image | Video |
|-----|-------|-----------|-------|
| `aspect_ratio` + `aspectRatio` + `ratio` | required (same value ×3) | same | same |
| `resolution` | `1K`/`2K`/`4K` per model | same | `480p`/`720p`/`1080p` |
| `quality` | omit | `low`/`medium`/`high` | omit |
| `duration` | omit | omit | seconds (e.g. 5) |
| `audio` | omit | omit | boolean |

Aspects: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `21:9`.

#### Live success (2026-07, `nano-banana-2-lite`)

```json
{
  "ok": true,
  "message": "Generation started in background",
  "bananas": {
    "balance": 100,
    "resetAt": 1785456000000,
    "history": [
      {"amount": 10, "reason": "Daily Reward", "timestamp": 1785393348670}
    ],
    "redeemedCodes": [],
    "v2ResetDone": true,
    "dailyAllowance": 10
  },
  "bananaCost": 0
}
```

| Field | Meaning |
|-------|---------|
| `ok` | Job **accepted** (queued), not completed |
| `message` | Fixed: `Generation started in background` |
| `bananaCost` | Charge for this job (`0` for unlimited lite in live test) |
| `bananas` | Full wallet snapshot **after** charge |
| `bananas.balance` | Current bananas |
| `bananas.resetAt` | ms epoch daily reset |
| `bananas.dailyAllowance` | Typical daily grant (10) |

Right after submit, history may briefly show:

```json
"activeGeneration": {
  "chatId": "82c2ea44-...",
  "model": "nano-banana-2-lite",
  "timestamp": 1785423762913
}
```

`activeGeneration` often becomes `null` while the worker still runs. Completion is only visible on the bot message media fields. Official UI may also read `generationId` from the generate response for placeholder DOM ids when present.

#### Result lifecycle (via history, not generate response)

| Stage | Bot message signals |
|-------|---------------------|
| Processing | `isLoading: true`, `image: "placeholder-0"` |
| Completed | real `image` / `outputImages` path without `placeholder` |
| Error | `isError: true` and/or `error` / `errorMessage` |

Media absolute URL:

```text
https://www.dafreeai.site/api/images/{userId}/{filename}.png
```

#### Errors (observed / wrapped)

| Pattern | When |
|---------|------|
| `403 Unauthorized: Invalid token` | bad/expired token |
| `MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE` | model not on package |
| `All accounts are currently inactive` | provider accounts down |
| `is locked` / `MODEL_NOT_ALLOWED` | model locked (esp. GPT `high` when artlist pool≈0) |
| HTTP read timeout | upstream slow; use ≥60–120s client timeout |

#### gpt-image-2 notes

- Prefer `quality=low`.
- Pool credits≈0 → `high` often locks; FAA `smartGenerate` forces/retries `low`, optional fallback to `nano-banana-2-lite`.
- `gpt-image-2-fast` appears in `/api/models` as **disabled** (`provider: giz`); treat as FAA cost/alias and normalize to `gpt-image-2`.

#### Minimal curl

```bash
curl -s -X POST "https://www.dafreeai.site/api/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "userId":"YOUR_ID",
    "token":"YOUR_TOKEN",
    "chatId":"00000000-0000-4000-8000-000000000001",
    "model":"nano-banana-2-lite",
    "prompt":"a cute cat",
    "settings":{
      "aspect_ratio":"1:1",
      "aspectRatio":"1:1",
      "ratio":"1:1",
      "resolution":"1K"
    }
  }'
```

Poll:

```bash
curl -s "https://www.dafreeai.site/api/history/YOUR_ID?token=YOUR_TOKEN&limit=20&offset=0"
```

Live probe: `python main.py generate ... --no-wait` (see [README.md](./README.md)) · detail: [`docs/upstream-generate.md`](docs/upstream-generate.md)

### GET /api/history/:userId?token=&limit=&offset=

Useful fields:

```json
{
  "history": [
    {
      "id": "chat-id",
      "title": "...",
      "timestamp": 0,
      "messages": [
        {"role":"user","prompt":"...","text":"..."},
        {
          "role":"bot",
          "prompt":"...",
          "image":"placeholder-0|/api/images/...",
          "outputImages":["..."],
          "isLoading": true,
          "isError": false,
          "modelName": "nano-banana-2-lite",
          "resolution": "1K",
          "quality": "Low",
          "ratio": "1:1"
        }
      ]
    }
  ],
  "hasMore": true,
  "activeGeneration": {"chatId":"...","model":"...","timestamp":0},
  "hasCreditAccounts": true,
  "cooldownUntil": 0
}
```

Poll tip: when `chatId` is known, match chat by `id` first; do **not** require full prompt substring on bot messages (they often omit/truncate prompt).

> **Recon 2026-08-05:** `activeGenerationsCount` is **absent** from the live payload (top-level keys are `history` / `hasMore` / `activeGeneration` / `cooldownUntil` / `hasCreditAccounts`). The FAA client derives it (`1` if `activeGeneration` is set, else `0`).

Official UI: poll interval ≈ **1200ms**; parallel active cap UI = **1**; library scroll uses `limit=50`.

### GET /api/bananas/:userId?token=

```json
{"balance":40, "...": "..."}
```

Also echoed as full wallet object on successful generate.

### POST /api/terms/accept

```json
{"userId":"...","token":"..."}
```

### DELETE /api/history/:userId/:chatId?token=

### DELETE /api/user/:userId?token=

Error example: `{"error":"Unauthorized purge request"}`

### POST /api/discord/share-image

```json
{"userId":"...","token":"...","imageUrl":"https://..."}
```

Success: `{"ok":true}`

## Model IDs

### Product catalog (official frontend hardcode + FAA `models.py`)

Image:
- nano-banana-2-lite (group 414) — unlimited
- nano-banana-2 (363) — unlimited
- seedream-5.0-pro (513) — tagRequired
- gpt-image-2 (380) — unlimited; **default selection in official UI**
- gpt-image-1.5 (322) — often `modelStatuses: hide`
- gpt-image-1-mini (312) — often `modelStatuses: hide`

Video:
- gemini-omni-flash (400)
- seedance-2 (358)
- seedance-mini (416)
- seedance-2-fast (377)
- sora-2-pro (111)
- sora-2 (110)

### Runtime enable (`GET /api/models`, live 2026-07-30)

Only these three have `appEnabled`/`apiEnabled` true: **`nano-banana-2-lite`**, **`nano-banana-2`**, **`gpt-image-2`**.  
All other catalog ids (including video + seedream) are dual-disabled until upstream flips flags.

## Media URL

Relative paths are served under site origin:

```text
https://www.dafreeai.site/api/images/{userId}/{filename}.png
```

## Endpoint checklist (frontend + live)

| Method | Path | Auth | Live note |
|--------|------|------|-----------|
| GET | `/api/auth/discord/url` | no | OK |
| POST | `/api/auth/discord/callback` | code | OK |
| GET | `/api/global-settings` | no | OK |
| GET | `/api/artlist/credits-progress` | no | OK; pool often 0 |
| GET | `/api/models` | no | OK; 38 ids, 3 enabled |
| GET | `/api/user/check-tag/:userId` | no | OK |
| GET | `/api/credit-prices` | no | **404** |
| GET | `/api/user/credits` | query userId | **500** without valid session |
| POST | `/api/generate` | body userId+token | async only |
| GET | `/api/history/:userId` | query token | poll channel |
| DELETE | `/api/history/:userId/:chatId` | query token | |
| GET | `/api/bananas/:userId` | query token | |
| POST | `/api/terms/accept` | body userId+token | |
| DELETE | `/api/user/:userId` | query token | |
| POST | `/api/discord/share-image` | body userId+token | |
| GET | `/api/images/:userId/:file` | media | |
