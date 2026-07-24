# DaFreeAi Studio

**中文說明** · [English UI / product guide](./README.en.md)

專業逆向 API 生成工具，對應網站：`https://www.dafreeai.site`

| | |
|---|---|
| **線上 Studio** | https://faa.kinai.workers.dev |
| **API 文件** | https://faa.kinai.workers.dev/docs.html |
| **英文介面 README** | [README.en.md](./README.en.md) |
| **v1 API** | [docs/v1-api.md](./docs/v1-api.md) |
| **GitHub** | https://github.com/loves96617665/faa |

功能：
- **Gradio Web UI**（登入 / 生成 / 歷史 / 狀態）
- Discord OAuth 登入 / code 換 token
- 列出模型與支援參數
- 圖片 / 影片生成
- 歷史輪詢與自動下載結果
- 點數池 / 餘額 / Discord tag 查詢
- CLI 命令列工具

---

## 專案結構

```text
dafreeai-studio/
├── main.py                 # CLI 入口
├── ui_app.py               # Gradio Web UI 入口
├── start_ui.bat            # 一鍵啟動 UI
├── start.bat               # CLI 快捷
├── requirements.txt
├── config.example.json
├── config.json             # 你的設定（可自行建立）
├── dafreeai_user.json      # 登入後的 userId/token
├── output/                 # 生成結果輸出
├── examples/
│   └── generate_example.py
└── dafreeai/
    ├── __init__.py
    ├── models.py           # 模型與參數定義
    ├── client.py           # API client
    └── cli.py              # 命令列
```

---

## 安裝

```bat
cd /d "I:\新增資料夾 (2)\dafreeai-studio"
pip install -r requirements.txt
```

---

## Web UI（推薦）

### 一鍵啟動

```bat
cd /d "I:\新增資料夾 (2)\dafreeai-studio"
start_ui.bat
```

或：

```bat
python ui_app.py
```

瀏覽器開啟：`http://127.0.0.1:7860`

### UI 分頁

| 分頁 | 功能 |
|------|------|
| 登入 / 帳號 | Discord OAuth URL、code 換 token、貼 localStorage JSON、手動 userId/token、餘額/tag/接受條款 |
| 生成工作室 | 圖片/影片模型、aspect/resolution/quality/duration/audio、參考圖 URL、輪詢進度、預覽與下載 |
| 歷史紀錄 | 列表、點選預覽、下載、刪除 chat |
| 系統狀態 | credits pool、bananas、tag、active generation |

### 登入建議

1. 官網已登入時，Console 執行：
   ```js
   copy(localStorage.getItem('dafreeai_user'))
   ```
2. 貼到 UI「JSON 登入」並儲存  
3. OAuth `code` 只能用一次，常被官網前端先消耗，失敗請改用 JSON  
4. 若已有 `dafreeai_user.json`，UI 啟動會自動載入

### 生成參數（UI）

- **媒體類型**：image / video（切換後模型列表與參數會動態更新）
- **aspect**：`1:1` `16:9` `9:16` `4:3` `3:4` `21:9`
- **resolution**：依模型（圖片 1K/2K/4K，影片 480p/720p/1080p）
- **quality**：GPT Image 系列 `low` / `medium` / `high`
- **duration / audio**：影片模型
- **參考圖**：URL 或 data URL，每行一個，最多 3
- 完成後預設自動下載到 `output/`

---

## 快速開始（CLI）

### 1) 取得 Discord 登入連結

```bat
python main.py login-url
```

瀏覽器開啟後授權，若 callback 的 code 還沒被前端用掉：

```bat
python main.py exchange YOUR_CODE --out dafreeai_user.json
```

### 2) 或直接從網站複製 token

在已登入的 `https://www.dafreeai.site` Console：

```js
copy(localStorage.getItem('dafreeai_user'))
```

貼到 `dafreeai_user.json`：

```json
{
  "id": "DISCORD_USER_ID",
  "token": "SESSION_TOKEN",
  "username": "xxx"
}
```

也可複製 `config.example.json` 為 `config.json` 填入。

### 3) 查看模型

```bat
python main.py models
python main.py models --type image
python main.py models --json
```

### 4) 查看狀態

```bat
python main.py status
```

### 5) 生成圖片

```bat
python main.py generate "a cute orange cat, soft light" --model nano-banana-2-lite --aspect 1:1 --resolution 1K --verbose
```

GPT Image：

```bat
python main.py generate "cyberpunk city" --model gpt-image-2 --quality low --resolution 1K
```

只提交不等待：

```bat
python main.py generate "test" --model nano-banana-2-lite --no-wait
```

### 6) 查歷史

```bat
python main.py history --limit 5
```

---

## 逆向 API 摘要

Base: `https://www.dafreeai.site`

| Method | Endpoint | Auth | 說明 |
|--------|----------|------|------|
| GET | `/api/auth/discord/url` | 否 | Discord OAuth URL |
| POST | `/api/auth/discord/callback` | code | 換 user/token |
| GET | `/api/artlist/credits-progress` | 否 | 全域點數池 |
| GET | `/api/user/check-tag/:userId` | 否 | Discord tag |
| POST | `/api/generate` | token | 提交生成 |
| GET | `/api/history/:userId` | token | 歷史/輪詢 |
| GET | `/api/bananas/:userId` | token | 餘額 |
| POST | `/api/terms/accept` | token | 接受條款 |
| DELETE | `/api/history/:userId/:chatId` | token | 刪紀錄 |
| DELETE | `/api/user/:userId` | token | 刪帳號 |
| POST | `/api/discord/share-image` | token | 分享到 Discord |

### 生成 body

```json
{
  "userId": "...",
  "token": "...",
  "chatId": "uuid",
  "model": "nano-banana-2-lite",
  "prompt": "...",
  "imagePath": "optional",
  "imagePaths": ["optional"],
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

成功提交回應示例：

```json
{
  "ok": true,
  "message": "Generation started in background",
  "bananas": {"balance": 40},
  "bananaCost": 0
}
```

結果需輪詢 `/api/history/:userId`，bot message 的 `image` / `outputImages` 會從 `placeholder-0` 變成 `/api/images/...png`。

---

## 模型與參數

### 圖片模型

| model id | 解析度 | unlimited | tagRequired | quality |
|----------|--------|-----------|-------------|---------|
| nano-banana-2-lite | 1K | Y | N | N |
| nano-banana-2 | 1K,2K | Y | N | N |
| seedream-5.0-pro | 1K,2K,4K | N | Y | N |
| gpt-image-2 | 1K,2K,4K | Y | N | Y |
| gpt-image-1.5 | 1K,2K | N | N | Y |
| gpt-image-1-mini | 1K | N | N | Y |

### 影片模型

| model id | 解析度 | unlimited | tagRequired | duration/audio |
|----------|--------|-----------|-------------|----------------|
| gemini-omni-flash | 480p/720p/1080p | N | Y | Y |
| seedance-2 | 480p/720p/1080p | N | Y | Y |
| seedance-mini | 480p/720p/1080p | N | Y | Y |
| seedance-2-fast | 480p/720p/1080p | N | Y | Y |
| sora-2-pro | 480p/720p/1080p | N | Y | Y |
| sora-2 | 480p/720p/1080p | N | Y | Y |

### 通用參數

- **aspect**: `1:1` `16:9` `9:16` `4:3` `3:4` `21:9`
- **quality** (GPT Image): `low` `medium` `high`
- **duration** (video): 預設 `5`
- **audio** (video): 預設 `true`
- **image refs**: 最多 3 張（data URL / URL）

---

## Python API 用法

```python
from dafreeai import DaFreeAiClient

client = DaFreeAiClient.from_user_json("dafreeai_user.json")
print(client.credits_pool())
print(client.balance())

result = client.generate_and_wait(
    "a cute cat",
    model="nano-banana-2-lite",
    aspect="1:1",
    resolution="1K",
    timeout=180,
)
print(result)
if result.get("status") == "completed":
    client.download_media(result["media"], "output/cat.png")
```

---

## 注意

1. token 等同帳號憑證，勿外流
2. OAuth `code` 只能用一次，且很快過期
3. 前端限制同時 1 個 active generation
4. 點數池 `totalCredits=0` 時，部分非 unlimited 模型可能被鎖
5. UI 僅綁定 `127.0.0.1`，token 不應暴露到公網
6. 本工具僅供學習 / 個人自動化，請遵守網站條款

---

## 實測紀錄（2026-07-24）

成功提交：

```json
{
  "ok": true,
  "message": "Generation started in background",
  "bananaCost": 0,
  "bananas": {"balance": 40}
}
```

history 中對應 chat `test-cat-001` 初始狀態：

```json
{
  "role": "bot",
  "image": "placeholder-0",
  "isLoading": true,
  "modelName": "nano-banana-2-lite"
}
```

完成後 image 會變成類似：

```text
/api/images/{userId}/{model}_{timestamp}.png
```
