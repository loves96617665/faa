# DaFreeAi Studio — Cloudflare Phase 1 MVP

**Cloudflare Worker + Static Assets**，不依賴 Flask / 本機磁碟。

English product / UI guide: [../README.en.md](../README.en.md)

## 架構

```
Browser (localStorage token)
    │  X-User-Id / X-User-Token
    ▼
Worker (src/index.js)  +  Assets (public/)
    │  /api/* → API handlers
    │  /*     → static HTML/CSS/JS
    ▼
https://www.dafreeai.site
```

| 項目 | Phase 1 行為 |
|------|----------------|
| 憑證 | 瀏覽器 `localStorage.dafreeai_user`，伺服器不存 token |
| 生成 | `POST /api/generate` 立即回 `submitted`，前端輪詢 `/api/job/:chatId` |
| 媒體 | 只回傳遠端 `mediaUrl`，無本機下載 / R2 |
| 作品庫 | stub 空列表（Phase 2 → R2） |

## 目錄

```
cf/
  package.json
  wrangler.toml          # name=faa, assets=public, run_worker_first=/api/*
  src/index.js           # Worker 路由入口
  public/                # 靜態前端（路徑 /css /js，不是 /static）
    index.html
    css/style.css
    js/app.js
  functions/             # 被 src/index.js import 的 API 模組
    _shared/
    api/
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

### 常見錯誤（你現在遇到的）

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
| POST | `/api/generate` | 是 | 提交生成（非阻塞） |
| GET | `/api/job/:chatId` | 是 | 輪詢結果 |
| GET | `/api/history` | 是 | 歷史列表 |
| DELETE | `/api/history/:chatId` | 是 | 刪除 chat |
| GET | `/api/gallery` | 否 | Phase 1 stub |

Auth headers：

```
X-User-Id: <discord user id>
X-User-Token: <token>
```

## 安全注意

- Phase 1 token 在瀏覽器，**任何人開你的瀏覽器都能用**
- 勿把 `dafreeai_user.json` 提交到公開 repo
- 建議之後：Cloudflare Access 鎖站

## Phase 2 預告

- R2 儲存生成結果 + 作品庫  
- Cloudflare Access / 簡易密碼閘  
- 伺服器端 session（token 不進 localStorage）  
