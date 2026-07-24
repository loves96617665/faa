# DaFreeAi Studio

**English UI & project guide** · [中文 README](./README.md)

Professional reverse-engineered client and Cloudflare-hosted studio for [dafreeai.site](https://www.dafreeai.site).

| | |
|---|---|
| **v1 API reference** | [docs/v1-api.md](./docs/v1-api.md) |
| **GitHub** | https://github.com/loves96617665/faa |
| **Build** | `2026-07-24-v6-account-pool` |

---

## What is this?

DaFreeAi Studio is a bilingual (EN + ZH) web app and API gateway that:

1. Logs in with your dafreeai Discord session (`userId` + `token`)
2. Generates images / videos via the upstream API
3. Issues **API Keys** for public `/v1/*` access
4. Runs a **service account pool** so multiple users can generate in true parallel
5. Applies **smart generate** for `gpt-image-2` (quality downgrade + optional fallback)

The production stack is **Cloudflare Workers + static assets** (no Flask disk, no server-side personal token storage for browser sessions).

---

## Features

| Feature | Description |
|---------|-------------|
| **Bilingual UI** | All tabs labeled EN + ZH |
| **Login** | JSON paste, manual credentials, OAuth helper |
| **Generate** | Image / video models, aspect, resolution, quality, refs |
| **Smart generate** | Auto quality retry + fallback for GPT image models |
| **History** | List / preview / delete chats |
| **API Keys** | Create / list / revoke; Bearer auth for `/v1/*` |
| **Account pool** | Multi-credential pool for concurrent jobs |
| **Status** | Balance, upstream credits pool, active generation |
| **CLI / Python** | Local toolkit under `dafreeai/` (optional) |

---

## Quick start (web UI)

1. Open your deployed Studio (or local `cf` dev server)
2. Go to **Login**
3. On [dafreeai.site](https://www.dafreeai.site) (already logged in), open DevTools Console and run:

```js
copy(localStorage.getItem('dafreeai_user'))
```

4. Paste the JSON into Studio → **Login from JSON**
5. Open **Generate**, enter a prompt, click **Generate**
6. Wait for the right-hand **Preview** panel (remote media URL)

> OAuth `code` is single-use and often consumed by the official frontend first. Prefer JSON login.

---

## UI tabs

### 1. Login

| Action | Purpose |
|--------|---------|
| Login from JSON | Paste `dafreeai_user` from official site |
| Manual userId / token | Type credentials by hand |
| Accept terms | Call upstream terms accept |
| Logout | Clear browser `localStorage` |
| Discord login URL / Exchange code | OAuth helper (code is single-use) |

**Security (Phase 1):** personal token stays in **this browser’s** `localStorage` only. The Worker does not persist your personal session token for UI login.

### 2. Generate

| Control | Notes |
|---------|--------|
| Prompt | Required text |
| Type | `image` or `video` |
| Model | Dynamic list from `/api/meta` |
| Aspect | `1:1` `16:9` `9:16` `4:3` `3:4` `21:9` |
| Resolution | Image: 1K/2K/4K · Video: 480p/720p/1080p |
| Quality | GPT Image: `low` / `medium` / `high` |
| Duration / Audio | Video models |
| Reference URLs | Optional, one per line, max 3 |
| Advanced | chatId, poll interval, timeout |

**Recommended model:** `nano-banana-2-lite` (most stable unlimited).

**gpt-image-2 tips:**

- Prefer `quality=low` (medium often works; high often locks when upstream pool credits = 0)
- Smart generate may lower quality and fall back to `nano-banana-2-lite` on hard errors
- Alias `gpt-image-2-fast` is a cost key only; generate model id is still `gpt-image-2`
- Avoid duplicate / near-duplicate prompts (`PROMPT_LIMIT`)

With an account pool configured, default `poolMode=auto` assigns a free service account for multi-user parallel generation.

### 3. History

- Lists history for the **logged-in** personal account
- Pool jobs are still polled correctly via internal **jobmap** even if media lives on a pool account
- Delete by `chatId`

### 4. API

Create keys for scripts and third-party clients:

```http
Authorization: Bearer faa_sk_...
```

- Full key is shown **only once** at creation — copy it immediately
- Manage keys: list / revoke in this tab
- In-app docs: `/docs.html` on your deployment
- Markdown: [docs/v1-api.md](./docs/v1-api.md)

Example:

```bash
export FAA_KEY=faa_sk_...
export BASE=https://YOUR_WORKER.workers.dev

curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/models"

JOB=$(curl -s -X POST "$BASE/v1/generate" \
  -H "Authorization: Bearer $FAA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"a cute cat","model":"nano-banana-2-lite","aspect":"1:1","resolution":"1K","poolMode":"auto"}')
echo "$JOB"
CHAT=$(echo "$JOB" | jq -r .chatId)
curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/jobs/$CHAT"
```

### 5. Pool (service account pool)

Upstream dafreeai allows **one active generation per account**. Bind multiple credentials here for true concurrency.

| Action | Purpose |
|--------|---------|
| Add current session | Push logged-in credentials into the pool |
| Add manually | name / userId / token / username |
| Refresh | Reload list + stats |
| Enable / disable / remove | Per-account controls |
| Force release | Clear a stuck lock (TTL is 5 minutes) |

**poolMode** (generate body / smart generate):

| Value | Behavior |
|-------|----------|
| `auto` (default) | Use pool if any enabled account exists; else personal |
| `pool` | Require free pool account; `POOL_BUSY` (503) if none |
| `personal` | Always use caller credentials |

True parallel generation needs **≥ 2 free pool accounts**.

### 6. Status

Refresh system status: balance, Discord tag, upstream credits pool, active generation flags, build meta.

### Preview panel

After a job completes, the right panel shows:

- Result meta (`fromPool`, model, adjustments, …)
- Image / video from remote `mediaUrl`
- Open remote URL / save media

Gallery is Phase 2 (R2) — currently a stub.

---

## Architecture (Cloudflare)

```text
Browser (localStorage token)
    │  X-User-Id / X-User-Token   (session UI)
    │  Authorization: Bearer      (API Key /v1)
    ▼
Worker (cf/src/index.js)  +  Assets (cf/public/)
    │  /api/*  session routes
    │  /v1/*   public API
    │  KV: KEYS, pool:*, jobmap:*
    ▼
https://www.dafreeai.site
```

| Path | Role |
|------|------|
| `cf/src/index.js` | Worker router, CORS, build stamp |
| `cf/src/routes.js` | Session generate / job / history |
| `cf/src/routes-v1.js` | Public v1 API |
| `cf/src/routes-pool.js` | Pool management |
| `cf/functions/_shared/pool.js` | Acquire / release / jobmap |
| `cf/functions/_shared/generate-smart.js` | Smart generate + poolMode |
| `cf/public/` | Bilingual Studio UI |

---

## Deploy

```bash
cd cf
npm install
npx wrangler login   # or set CLOUDFLARE_API_TOKEN
npm run deploy
```

Worker name: `faa` → `https://faa.<subdomain>.workers.dev`

Local dev:

```bash
cd cf
npm install
npm run dev
# usually http://127.0.0.1:8787
```

**Do not** deploy the root Flask `static/` tree as Workers assets. Always deploy from `cf/` so `/api/*` is handled by the Worker and assets use `/css` + `/js`.

Optional secrets / bindings (see `cf/wrangler.toml`):

- KV for API keys + account pool
- `TOKEN_ENC_KEY` for encrypting stored tokens

---

## Models (summary)

### Image

| model id | resolution | unlimited | quality |
|----------|------------|-----------|---------|
| nano-banana-2-lite | 1K | Y | N |
| nano-banana-2 | 1K, 2K | Y | N |
| seedream-5.0-pro | 1K, 2K, 4K | N | N |
| gpt-image-2 | 1K, 2K, 4K | Y | Y |
| gpt-image-1.5 | 1K, 2K | N | Y |
| gpt-image-1-mini | 1K | N | Y |

### Video

| model id | resolution | unlimited | duration/audio |
|----------|------------|-----------|----------------|
| gemini-omni-flash | 480p–1080p | N | Y |
| seedance-2 / mini / fast | 480p–1080p | N | Y |
| sora-2 / sora-2-pro | 480p–1080p | N | Y |

Some models require Discord tag or non-zero upstream credits pool.

---

## Common errors

| code | HTTP | Meaning / fix |
|------|------|----------------|
| UNAUTHORIZED | 401 | Missing/bad session or API key |
| RATE_LIMITED | 429 | 30/min overall, 6/min generate |
| UPSTREAM_BUSY | 409 | Same account already generating |
| POOL_BUSY | 503 | No free pool account — add accounts or wait |
| MODEL_LOCKED | 503 | Upstream locked; try low quality or lite |
| MODEL_NOT_ALLOWED | 403 | Unlimited package restriction |
| PROMPT_LIMIT | 400/502 | Change the prompt (duplicate rejected) |

---

## Local Python / CLI (optional)

For offline tooling without Cloudflare:

```bat
pip install -r requirements.txt
start_ui.bat
:: or: python ui_app.py  →  http://127.0.0.1:7860
python main.py models
python main.py generate "a cute cat" --model nano-banana-2-lite --aspect 1:1 --resolution 1K
```

See [README.md](./README.md) (Chinese) for full CLI details, and [API.md](./API.md) for upstream reverse notes.

---

## Project layout

```text
dafreeai-studio/
├── README.md              # Chinese project README
├── README.en.md           # This file (English UI / product guide)
├── docs/
│   └── v1-api.md          # Public v1 API (EN primary)
├── cf/                    # Cloudflare Worker + Studio UI
│   ├── public/            # index.html, docs.html, css/, js/
│   ├── src/               # Worker routes
│   └── functions/_shared/ # client, pool, smart generate, keys
├── dafreeai/              # Python client + CLI
├── static/                # Legacy Flask UI (not for CF deploy)
├── app.py / ui_app.py     # Local servers
└── plans/                 # Design notes
```

---

## Security notes

1. Treat `token` and `faa_sk_...` as account credentials — never commit them
2. Phase 1 UI tokens live in browser storage; anyone with that browser can use them
3. API Key plaintext is shown only once; revoke compromised keys in the **API** tab
4. Pool credentials are stored encrypted in Workers KV — limit who can open the Pool tab (session auth)
5. Prefer Cloudflare Access or similar if you expose a private deployment
6. For learning / personal automation only — follow upstream site terms

---

## Changelog (high level)

| Version | Highlights |
|---------|------------|
| **v6** | Service account pool, `poolMode`, jobmap poll auth, Pool UI |
| **v5** | Smart generate for gpt-image-2 (quality + fallback) |
| **v4** | API Keys + public `/v1/*` + docs |
| **v1–3** | CF Phase 1 MVP, session generate, bilingual labels |

---

## Links

- Official site: https://www.dafreeai.site
- Chinese README: [README.md](./README.md)
- CF deploy notes: [cf/README.md](./cf/README.md)
- v1 API: [docs/v1-api.md](./docs/v1-api.md)
