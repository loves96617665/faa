# DaFreeAi Studio — Cloudflare 版（Workers + Static Assets）

**Cloudflare Worker + Static Assets**，不依賴 Flask / 本機磁碟。已實作：session UI、API Key + `/v1/*` 公開 API、服務帳號池、smart generate。

English product / UI guide: [../README.en.md](../README.en.md)

## 架構

```
Browser (localStorage token)
    │  X-User-Id / X-User-Token   (session UI)
    │  Authorization: Bearer      (API Key /v1)
    ▼
Worker (src/index.js)  +  Assets (public/)
    │  /api/*   session routes（auth / generate / job / history / pool / keys）
    │  /v1/*    public API（models / generate / jobs / history / me）
    │  KV: KEYS, pool:*, jobmap:*
    ▼
https://www.dafreeai.site
```

| 項目 | 行為 |
|------|----------------|
| 憑證 | 瀏覽器 `localStorage.dafreeai_user`；API Key 綁定一份 dafreeai 憑證（KV 加密存放） |
| 生成 | `POST /api/generate` 立即回 `submitted`，前端輪詢 `/api/job/:chatId`；busy 時自動等待重試 |
| 並行 | 上游單帳號只能 1 個 active generation → 帳號池（pool）多帳號共享、負載分擔 |
| 媒體 | 回傳遠端 `mediaUrl`，無本機下載 / R2 |

## 目錄

```
cf/
  package.json
  wrangler.toml          # name=faa, assets=public, run_worker_first=/api/*
  src/
    index.js             # Worker 路由入口
    routes.js            # session 路由（generate / job / history / status）
    routes-v1.js         # 公開 v1 API
    routes-pool.js       # pool 管理
    routes-keys.js       # API Key 管理
  public/                # 靜態前端（路徑 /css /js，不是 /static）
    index.html
    docs.html            # 線上 API 文件
    css/style.css
    js/app.js
  functions/
    _shared/             # client.js / models.js / pool.js / generate-smart.js / keys.js / crypto.js / errors.js
    api/                 # auth / generate / history / job / meta / status / gallery
```

## 本地開發

```bash
cd cf
npm install
npm run dev
```

開啟終端顯示的本機 URL（通常 `http://127.0.0.1:8787`）。

## 部署（必須用 cf/ + wrangler）

```bash
cd cf
npm install
npx wrangler login
# 或: set CLOUDFLARE_API_TOKEN=你的token
npm run deploy
```

Worker 名稱：`faa` → `https://faa.<subdomain>.workers.dev`

> Git auto-deploy 讀的是 **repo 根目錄**的 `wrangler.toml`（指向 `cf/`），本地的 `cf/wrangler.toml` 是給 `cd cf && wrangler deploy` 用的。兩份需同步。

### 常見錯誤

| 症狀 | 原因 | 解法 |
|------|------|------|
| 無樣式 / 破版 | 部署了 Flask 版 `static/index.html`（引用 `/static/css/...`） | 必須部署 `cf/public`（引用 `/css` `/js`） |
| `/api/*` 404 | 只上傳靜態檔、沒有 Worker 路由 | 在 `cf/` 執行 `npm run deploy` |
| 登入後 API 失敗 | 舊前端不帶 `X-User-*` | 使用 `cf/public/js/app.js` |

**錯誤示範**：把 repo 根目錄的 `static/` 當 Workers 靜態資源上傳。  
**正確**：`cd cf && wrangler deploy`（會打包 `src/index.js` + `public/`）。

### 自訂網域

1. 域名 NS 已指向 Cloudflare  
2. Worker `faa` → **Settings → Domains & Routes** → 新增自訂網域  
3. 等 SSL 生效

## 使用流程

1. 開啟網站 → **登入** 分頁  
2. 官網 Console：`copy(localStorage.getItem('dafreeai_user'))`  
3. 貼 JSON → 儲存（寫入瀏覽器 localStorage）  
4. **生成** → 自動輪詢 → 預覽遠端媒體  
5. （選用）**Pool** 分頁加入多個帳號 → 並行生成  
6. （選用）**API** 分頁建立 API Key → 用 `Bearer` 呼叫 `/v1/*`

## API 一覽

| Method | Path | Auth headers | 說明 |
|--------|------|--------------|------|
| GET | `/api/meta` | 可選 | 模型列表 |
| GET | `/api/status` | 建議 | 餘額 / pool / active |
| GET | `/api/auth/login-url` | 否 | Discord OAuth URL |
| POST | `/api/auth/exchange` | 否 | code → user+token |
| POST | `/api/auth/save` | 否 | 驗證 JSON（不落盤） |
| GET | `/api/auth/me` | 是 | 登入狀態 + balance |
| POST | `/api/auth/accept-terms` | 是 | 接受條款 |
| POST | `/api/generate` | 是 | 提交生成（非阻塞，smart + pool） |
| GET | `/api/job/:chatId` | 是 | 輪詢結果 |
| GET | `/api/history` | 是 | 歷史列表 |
| DELETE | `/api/history/:chatId` | 是 | 刪除 chat |
| GET | `/api/gallery` | 否 | Phase 2 stub（R2） |
| GET | `/api/pool` | 是 | pool 帳號列表 |
| POST | `/api/pool` | 是 | 加入 / 更新帳號 |
| DELETE | `/api/pool/:id` | 是 | 移除 / 停用 |
| GET/POST/DELETE | `/api/keys` | 是 | API Key 管理 |
| GET | `/v1/models` | Bearer | 公開模型列表 |
| POST | `/v1/generate` | Bearer | 公開生成（smart + pool） |
| GET | `/v1/jobs/:id` | Bearer | 輪詢公開生成結果 |
| GET | `/v1/history` | Bearer | 公開歷史 |
| GET | `/v1/me` | Bearer | Key 持有者資訊 |
| POST | `/v1/images/generations` | Bearer | OpenAI Images 相容（`/openai/v1/*` 亦可） |

Session auth headers：

```
X-User-Id: <discord user id>
X-User-Token: <token>
```

API Key auth：

```
Authorization: Bearer faa_sk_...
```

完整 v1 文件：[`docs/v1-api.md`](../docs/v1-api.md) · 線上版：`/docs.html`

## 安全注意

- token 在瀏覽器（session UI）；API Key 明文只在建立當下顯示一次，之後只存 hash
- pool 帳號 token 以 AES-GCM 加密存入 KV（需 `TOKEN_ENC_KEY` secret）
- 勿把 `dafreeai_user.json` / `config.json` 提交到公開 repo（已 gitignore）
- 建議：Cloudflare Access 鎖站，避免 token / API Key 被他人濫用
