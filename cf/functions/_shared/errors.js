/** Normalize upstream / local errors into stable API codes */

export function classifyError(message, status = null) {
  const msg = String(message || "Unknown error");
  const lower = msg.toLowerCase();

  if (status === 401 || /unauthorized|invalid token|missing userid|missing.*token/i.test(msg)) {
    return {
      code: "UNAUTHORIZED",
      http: 401,
      message: msg,
      hint: "請檢查 API Key 或重新登入（X-User-Id / X-User-Token）",
    };
  }

  if (/model_not_allowed_on_unlimited_package/i.test(msg)) {
    return {
      code: "MODEL_NOT_ALLOWED",
      http: 403,
      message: msg,
      hint: "此模型在 unlimited package 不可用。請改用 nano-banana-2-lite，或降低 quality。",
    };
  }

  if (/all accounts are currently inactive|is locked/i.test(msg)) {
    return {
      code: "MODEL_LOCKED",
      http: 503,
      message: msg,
      hint: "上游帳號池鎖定或 credits 不足。請稍後再試，或改用 nano-banana-2-lite。",
    };
  }

  if (/generation in progress|please wait for your current generation/i.test(msg)) {
    return {
      code: "UPSTREAM_BUSY",
      http: 409,
      message: msg,
      hint: "目前已有生成進行中，請等完成後再提交。",
    };
  }

  if (/prompt limit retry|diffrent prompt|different prompt/i.test(msg)) {
    return {
      code: "PROMPT_LIMIT",
      http: 429,
      message: msg,
      hint: "相同/相似 prompt 觸發上游限流，請換一段不同的 prompt 再試。",
    };
  }

  if (/kv put\(\) limit|put\(\) limit exceeded|kv_limit/i.test(lower)) {
    return {
      code: "KV_LIMIT",
      http: 503,
      message: msg,
      hint: "Cloudflare 免費 KV 當日寫入額度已用完（約 1000 次/天，UTC 午夜重置）。讀取/輪詢仍可用；新建 Key、帳號池、pool 生成需等重置或升級 Workers Paid。",
    };
  }

  if (status === 429 || /rate limit|too many/i.test(lower)) {
    return {
      code: "RATE_LIMITED",
      http: 429,
      message: msg,
      hint: "請求過於頻繁，請稍後再試。",
    };
  }

  if (status === 403 || /forbidden|scope|revoked/i.test(lower)) {
    return {
      code: "FORBIDDEN",
      http: 403,
      message: msg,
      hint: "權限不足或 API Key 已撤銷。",
    };
  }

  if (status === 400 || /unsupported|unknown model|不可為空|validation/i.test(lower)) {
    return {
      code: "VALIDATION_ERROR",
      http: 400,
      message: msg,
      hint: "請檢查 model / resolution / quality / aspect 參數。",
    };
  }

  return {
    code: "UPSTREAM_ERROR",
    http: status && status >= 400 ? status : 502,
    message: msg,
    hint: "上游或伺服器錯誤，請稍後再試。",
  };
}

export function errorBody(classified, extra = {}) {
  return {
    ok: false,
    error: {
      code: classified.code,
      message: classified.message,
      hint: classified.hint,
    },
    ...extra,
  };
}
