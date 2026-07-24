# DaFreeAi Studio — Cloudflare Phase 1 MVP

純 **Cloudflare Pages + Pages Functions** 部署，不依賴 Flask / 本機磁碟。

## 架構

```
Browser (localStorage token)
    │  X-User-Id / X-User-Token
    ▼
Pages (public/)  +  Functions (functions/api/*)
    │  fetch
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
  wrangler.toml
  public/                 # 靜態前端
    index.html
    css/style.css
    js/app.js
  functions/
    _shared/
      models.js           # 模型目錄 + settings
      http.js             # json/err/auth helpers
      client.js           # upstream dafreeai client
    api/
      meta.js
      status.js
      generate.js
      history.js
      history/[chatId].js
      job/[chatId].js
      gallery.js
      auth/
        login-url.js
        exchange.js
        save.js
        me.js
        accept-terms.js
```

## 本地開發

```bash
cd cf
npm install
npx wrangler pages dev public --compatibility-date=2024-11-01
```

或：

```bash
npm run dev
```

開啟終端顯示的本機 URL（通常 `http://127.0.0.1:8788`）。

> Wrangler 會自動把 `functions/` 掛到 `/api/*`。

## 部署到 Cloudflare Pages

### 方式 A：CLI

```bash
cd cf
npm install
npx wrangler login
npx wrangler pages project create dafreeai-studio   # 首次
npm run deploy
```

### 方式 B：Dashboard（Git 連線）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages**
2. 連 Git repo，或 **Direct Upload** 上傳 `public/`（Functions 需用 Git 或 Wrangler 帶 `functions/`）
3. Build 設定（若用 monorepo）：
   - **Root directory**: `cf`
   - **Build command**: （可留空，純靜態）
   - **Build output directory**: `public`
4. Environment variables：
   - `DAFREEAI_BASE_URL` = `https://www.dafreeai.site`（可選，已有預設）

### 自訂網域

1. 域名 NS 已指向 Cloudflare
2. Pages 專案 → **Custom domains** → 新增 `studio.yourdomain.com`
3. 等 SSL 生效即可

## 使用流程

1. 開啟網站 → **登入** 分頁
2. 官網已登入時，Console：`copy(localStorage.getItem('dafreeai_user'))`
3. 貼到 JSON 框 → **從 JSON 登入並儲存**（寫入瀏覽器 localStorage）
4. **生成** 分頁選模型、輸入 prompt → 開始生成
5. 前端自動輪詢 job；完成後預覽遠端圖片/影片

## API 一覽

| Method | Path | Auth headers | 說明 |
|--------|------|--------------|------|
| GET | `/api/meta` | 可選 | 模型列表 |
| GET | `/api/status` | 建議 | 餘額 / pool / active |
| GET | `/api/auth/login-url` | 否 | Discord OAuth URL |
| POST | `/api/auth/exchange` | 否 | code → user+token |
| POST | `/api/auth/save` | 否 | 驗證 JSON/手動欄位（不落盤） |
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
- 建議之後：Cloudflare Access 鎖站、或 Phase 2 改 HttpOnly cookie + 伺服器 session
- 勿把 `dafreeai_user.json` 提交到公開 repo

## Phase 2 預告

- R2 儲存生成結果 + 作品庫
- 可選 Durable Object / KV 做 job 狀態快取
- Cloudflare Access / 簡易密碼閘
- 伺服器端 session（token 不進 localStorage）
