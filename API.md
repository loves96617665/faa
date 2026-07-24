# DaFreeAi Reverse API Reference

Source: frontend reverse of `https://www.dafreeai.site` (Express + nginx)

## Auth model

Not Bearer header. Use:

- Query: `?token=SESSION_TOKEN`
- Body: `{ "userId": "...", "token": "..." }`

User object fields observed:

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

## Endpoints

### GET /api/auth/discord/url

Response:

```json
{"url":"https://discord.com/api/oauth2/authorize?..."}
```

OAuth:
- client_id: `1505313291604594959`
- redirect_uri: `https://www.dafreeai.site/auth/callback`
- scope: `identify email guilds.join`

### POST /api/auth/discord/callback

Request:

```json
{"code":"..."}
```

Errors:
- `401 {"error":"Invalid \"code\" in request."}`

Success: `{ "user": { ... } }`

### GET /api/artlist/credits-progress

```json
{"totalCredits":0,"maxCredits":600000}
```

### GET /api/user/check-tag/:userId

```json
{"hasTag":false,"tagText":null,"primaryGuildId":null,"userId":"..."}
```

### POST /api/generate

Request:

```json
{
  "userId": "...",
  "token": "...",
  "chatId": "uuid-or-custom-id",
  "model": "nano-banana-2-lite",
  "prompt": "...",
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

Observed success:

```json
{
  "ok": true,
  "message": "Generation started in background",
  "bananas": {
    "balance": 40,
    "resetAt": 1784937600000,
    "history": [],
    "dailyAllowance": 10
  },
  "bananaCost": 0
}
```

Errors:
- `403 {"error":"Unauthorized: Invalid token"}`

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
  "activeGeneration": {"chatId":"..."},
  "activeGenerationsCount": 1,
  "hasCreditAccounts": true,
  "cooldownUntil": 0
}
```

### GET /api/bananas/:userId?token=

```json
{"balance":40, "...": "..."}
```

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

Image:
- nano-banana-2-lite (group 414)
- nano-banana-2 (363)
- seedream-5.0-pro (513)
- gpt-image-2 (380)
- gpt-image-1.5 (322)
- gpt-image-1-mini (312)

Video:
- gemini-omni-flash (400)
- seedance-2 (358)
- seedance-mini (416)
- seedance-2-fast (377)
- sora-2-pro (111)
- sora-2 (110)

## Media URL

Relative paths are served under site origin:

```text
https://www.dafreeai.site/api/images/{userId}/{filename}.png
```
