/* DaFreeAi Studio — Cloudflare frontend
 * Credentials live in browser localStorage only.
 * All API calls send X-User-Id / X-User-Token headers.
 * build: 2026-07-24-v6-account-pool
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const LS_KEY = "dafreeai_user";
  const BASE = location.origin;

  const state = {
    models: [],
    aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    qualities: ["low", "medium", "high"],
    currentMedia: null,
    currentChatId: null,
    currentModel: null,
    creds: null, // { id, token, username }
    lastApiKey: null,
  };

  function loadCreds() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        state.creds = null;
        return null;
      }
      const data = JSON.parse(raw);
      const id = String(data.id || data.userId || data.user_id || "").trim();
      const token = String(data.token || "").trim();
      const username = data.username || data.global_name || data.globalName || "";
      if (!id || !token) {
        state.creds = null;
        return null;
      }
      state.creds = { id, token, username };
      return state.creds;
    } catch {
      state.creds = null;
      return null;
    }
  }

  function saveCreds({ id, token, username }) {
    const payload = {
      id: String(id).trim(),
      token: String(token).trim(),
    };
    if (username) payload.username = String(username).trim();
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    state.creds = {
      id: payload.id,
      token: payload.token,
      username: payload.username || "",
    };
    return state.creds;
  }

  function clearCreds() {
    localStorage.removeItem(LS_KEY);
    state.creds = null;
  }

  function setStatus(el, text, kind = "") {
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    if (state.creds?.id && state.creds?.token) {
      h["X-User-Id"] = state.creds.id;
      h["X-User-Token"] = state.creds.token;
    }
    return h;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {}),
      },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: `非 JSON 回應 (${res.status})` };
    }
    if (!res.ok && data && !data.error) data.error = `HTTP ${res.status}`;
    return data;
  }

  function friendlyError(msg) {
    const s = String(msg || "");
    if (/MODEL_NOT_ALLOWED_ON_UNLIMITED_PACKAGE/i.test(s)) {
      return `${s} → 請改用 nano-banana-2-lite，或降低 quality / use lite or lower quality`;
    }
    if (/All accounts are currently inactive|is locked/i.test(s)) {
      return `${s} → 上游帳號池鎖定 / upstream locked — retry or use nano-banana-2-lite`;
    }
    if (/Generation in progress/i.test(s)) {
      return `${s} → 請等目前生成完成 / wait for current job, or add more pool accounts`;
    }
    if (/帳號池忙碌|POOL_BUSY|free=0/i.test(s)) {
      return `${s} → 池內無空閒帳號 / pool busy — add accounts or retry`;
    }
    if (/prompt limit retry|diffrent prompt|different prompt/i.test(s)) {
      return `${s} → 請換不同 prompt / change prompt slightly`;
    }
    if (typeof msg === "object" && msg?.message) {
      const hint = msg.hint ? `（${msg.hint}）` : "";
      return `${msg.code || "ERROR"}: ${msg.message}${hint}`;
    }
    return s;
  }

  function modelById(id) {
    return state.models.find((m) => m.id === id);
  }

  function fillModels() {
    const type = $("gen-type").value;
    const sel = $("gen-model");
    const list = state.models.filter((m) => m.type === type && !m.ui_hidden);
    sel.innerHTML = "";
    list.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      const flags = [m.type];
      if (m.recommended) flags.push("recommended");
      if (m.unlimited) flags.push("unlimited");
      if (m.tag_required) flags.push("tag");
      if (m.supports_quality) flags.push("quality");
      if (m.upstream_status && m.upstream_status !== "show") flags.push(m.upstream_status);
      opt.textContent = `${m.id} — ${m.name} [${flags.join(", ")}]`;
      sel.appendChild(opt);
    });
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "無模型";
      sel.appendChild(opt);
    }
    const lite = [...sel.options].find((o) => o.value === "nano-banana-2-lite");
    if (lite) sel.value = "nano-banana-2-lite";
    updateModelParams();
  }

  function updateModelParams() {
    const m = modelById($("gen-model").value);
    const resSel = $("gen-resolution");
    resSel.innerHTML = "";
    const resolutions = (m && m.supported_resolutions) || ["1K"];
    resolutions.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      resSel.appendChild(opt);
    });
    if (m && m.default_resolution && resolutions.includes(m.default_resolution)) {
      resSel.value = m.default_resolution;
    }

    const showQ = !!(m && (m.supports_quality || String(m.id).includes("gpt")));
    const showV = !!(m && m.type === "video");
    $("quality-field").style.display = showQ ? "" : "none";
    $("duration-field").style.display = showV ? "" : "none";
    $("audio-field").style.display = showV ? "" : "none";
    if (showQ) $("gen-quality").value = "low";

    $("model-info").textContent = m
      ? `${m.name} · ${m.company} · res=${(m.supported_resolutions || []).join(",")} · unlimited=${m.unlimited} · recommended=${!!m.recommended} · tag_required=${m.tag_required}${m.notes ? " · " + m.notes : ""}`
      : "";
  }

  function setAuthBadge(me) {
    const badge = $("auth-badge");
    if (me && me.logged_in) {
      const bal = me.balance && (me.balance.balance ?? me.balance.bananas ?? me.balance);
      const name = me.username || state.creds?.username || me.userId || "";
      badge.textContent = `已登入 ${name}${bal != null ? " · 🍌 " + bal : ""}`;
      badge.classList.add("ok");
      if (me.userId) $("auth-uid").value = me.userId;
      if (me.username || state.creds?.username) {
        $("auth-name").value = me.username || state.creds.username || "";
      }
    } else if (state.creds) {
      badge.textContent = `已載入憑證 ${state.creds.username || state.creds.id}`;
      badge.classList.add("ok");
      $("auth-uid").value = state.creds.id;
      $("auth-name").value = state.creds.username || "";
    } else {
      badge.textContent = "未登入";
      badge.classList.remove("ok");
    }
  }

  function showPreview({ mediaUrl, type, metaText }) {
    const wrap = $("preview-wrap");
    wrap.classList.remove("empty");
    wrap.innerHTML = "";
    const isVideo =
      type === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl || "");
    const src = mediaUrl;
    if (!src) {
      wrap.classList.add("empty");
      wrap.innerHTML = '<p class="muted">無媒體</p>';
      return;
    }
    if (isVideo) {
      const v = document.createElement("video");
      v.src = src;
      v.controls = true;
      v.autoplay = true;
      wrap.appendChild(v);
    } else {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "result";
      wrap.appendChild(img);
    }

    $("result-meta").textContent = metaText || "";
    const remote = $("btn-open-remote");
    const local = $("btn-open-local");
    const dl = $("btn-download-media");
    if (mediaUrl) {
      remote.href = mediaUrl;
      remote.classList.remove("hidden");
      dl.href = mediaUrl;
      dl.classList.remove("hidden");
    } else {
      remote.classList.add("hidden");
      dl.classList.add("hidden");
    }
    local.classList.add("hidden");
    state.currentMedia = mediaUrl || null;
  }

  async function refreshMe() {
    loadCreds();
    if (!state.creds) {
      setAuthBadge({ logged_in: false });
      return { ok: true, logged_in: false };
    }
    const me = await api("/api/auth/me");
    if (me.logged_in && !me.username && state.creds.username) {
      me.username = state.creds.username;
    }
    setAuthBadge(me);
    return me;
  }

  async function loadMeta() {
    const meta = await api("/api/meta");
    if (!meta.ok) throw new Error(meta.error || "meta failed");
    state.models = meta.models || [];
    state.aspects = meta.aspects || state.aspects;
    state.qualities = meta.qualities || state.qualities;
    state.globalSettings = meta.global_settings || null;
    state.maxCredits = meta.maxCredits ?? meta.global_settings?.artlistPoolMax ?? null;
    state.hiddenModels = meta.hidden_models || [];

    const aspect = $("gen-aspect");
    aspect.innerHTML = "";
    state.aspects.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      aspect.appendChild(opt);
    });
    const quality = $("gen-quality");
    quality.innerHTML = "";
    state.qualities.forEach((q) => {
      const opt = document.createElement("option");
      opt.value = q;
      opt.textContent = q;
      quality.appendChild(opt);
    });
    quality.value = "low";

    if (state.creds) {
      $("auth-uid").value = state.creds.id;
      if (state.creds.username) $("auth-name").value = state.creds.username;
    }
    fillModels();
    await refreshMe();
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $("panel-" + btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "api") loadKeys();
        if (btn.dataset.tab === "pool") loadPool();
      });
    });
  }

  function bindAuth() {
    $("btn-save-json").onclick = async () => {
      setStatus($("auth-status"), "驗證中…");
      const data = await api("/api/auth/save", {
        method: "POST",
        body: JSON.stringify({ json: $("auth-json").value }),
      });
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      saveCreds({
        id: data.user.id,
        token: data.user.token,
        username: data.user.username,
      });
      $("auth-token").value = data.user.token || "";
      setStatus($("auth-status"), `已儲存至瀏覽器 ${data.user.id}`, "ok");
      await refreshMe();
    };

    $("btn-save-manual").onclick = async () => {
      setStatus($("auth-status"), "驗證中…");
      const uid = $("auth-uid").value.trim();
      const token = $("auth-token").value.trim();
      const username = $("auth-name").value.trim();
      const data = await api("/api/auth/save", {
        method: "POST",
        body: JSON.stringify({ userId: uid, token, username }),
      });
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      saveCreds({ id: data.user.id, token: data.user.token, username: data.user.username });
      setStatus($("auth-status"), `已儲存至瀏覽器 ${data.user.id}`, "ok");
      await refreshMe();
    };

    $("btn-login-url").onclick = async () => {
      const data = await api("/api/auth/login-url");
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      $("oauth-url").value = data.url || "";
      setStatus($("auth-status"), "已取得 OAuth URL，請在瀏覽器授權後貼回 code", "ok");
    };

    $("btn-exchange").onclick = async () => {
      setStatus($("auth-status"), "交換中…");
      const data = await api("/api/auth/exchange", {
        method: "POST",
        body: JSON.stringify({ code: $("oauth-code").value.trim() }),
      });
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      if (data.user?.id && data.user?.token) {
        saveCreds({
          id: data.user.id,
          token: data.user.token,
          username: data.user.username,
        });
        $("auth-uid").value = data.user.id;
        $("auth-token").value = data.user.token;
        if (data.user.username) $("auth-name").value = data.user.username;
      }
      setStatus(
        $("auth-status"),
        `登入成功：${data.user?.username || data.user?.id}（已寫入 localStorage）`,
        "ok"
      );
      await refreshMe();
    };

    $("btn-accept-terms").onclick = async () => {
      if (!state.creds) return setStatus($("auth-status"), "請先登入", "err");
      const data = await api("/api/auth/accept-terms", { method: "POST", body: "{}" });
      setStatus($("auth-status"), data.ok ? "已接受條款" : data.error || "失敗", data.ok ? "ok" : "err");
    };

    $("btn-logout").onclick = () => {
      clearCreds();
      $("auth-token").value = "";
      $("auth-json").value = "";
      setAuthBadge({ logged_in: false });
      setStatus($("auth-status"), "已清除本機憑證", "ok");
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollJob({ chatId, prompt, model, type, pollInterval, pollTimeout, submit }) {
    const started = Date.now();
    const intervalMs = Math.max(1, Number(pollInterval) || 3) * 1000;
    const timeoutMs = Math.max(10, Number(pollTimeout) || 180) * 1000;
    // Help server match user_library results (client chatId often never appears).
    const sinceTs = started - 60_000;
    let ticks = 0;

    while (Date.now() - started < timeoutMs) {
      ticks += 1;
      const params = new URLSearchParams();
      if (prompt) params.set("prompt", String(prompt).slice(0, 80));
      if (model) params.set("model", String(model));
      params.set("since", String(sinceTs));
      const q = params.toString() ? `?${params.toString()}` : "";
      const job = await api(`/api/job/${encodeURIComponent(chatId)}${q}`);
      const elapsed = Math.round((Date.now() - started) / 1000);
      const active = job.activeGeneration || job.activeGenerationsCount || "—";
      const via = job.matchedVia ? ` · via=${job.matchedVia}` : "";
      setStatus(
        $("gen-status"),
        `輪詢中 #${ticks} · ${elapsed}s · status=${job.status || "?"} · active=${active}${via}`,
        "warn"
      );

      if (!job.ok) {
        return { ok: false, error: job.error || "輪詢失敗", chatId };
      }

      if (job.status === "error") {
        return {
          ok: false,
          error: job.message || job.result?.message || "生成失敗",
          chatId,
          status: "error",
          result: job.result,
          submit,
          model,
          type,
        };
      }

      if (job.status === "completed" && (job.mediaUrl || job.media)) {
        return {
          ok: true,
          status: "completed",
          chatId,
          media: job.media,
          mediaUrl: job.mediaUrl,
          result: job.result,
          submit,
          model,
          type,
        };
      }

      await sleep(intervalMs);
    }

    return {
      ok: false,
      error: `逾時（${pollTimeout}s）仍未完成`,
      chatId,
      status: "timeout",
      submit,
      model,
      type,
    };
  }

  function bindGenerate() {
    $("gen-type").onchange = fillModels;
    $("gen-model").onchange = updateModelParams;
    document.querySelectorAll(".chip").forEach((c) => {
      c.onclick = () => {
        $("gen-prompt").value = c.dataset.prompt || "";
      };
    });

    $("btn-generate").onclick = async () => {
      if (!state.creds) {
        setStatus($("gen-status"), "請先在「登入」分頁儲存憑證", "err");
        return;
      }

      const btn = $("btn-generate");
      const label = btn.querySelector(".btn-label");
      const spinner = btn.querySelector(".spinner");
      btn.disabled = true;
      label.textContent = "生成中…";
      spinner.classList.remove("hidden");
      setStatus($("gen-status"), "提交中…", "warn");

      const prompt = $("gen-prompt").value;
      const model = $("gen-model").value;
      const body = {
        prompt,
        model,
        aspect: $("gen-aspect").value,
        resolution: $("gen-resolution").value,
        quality: $("gen-quality").value,
        duration: Number($("gen-duration").value || 5),
        audio: $("gen-audio").checked,
        imagePaths: $("gen-refs").value,
        chatId: $("gen-chatid").value.trim(),
        pollInterval: Number($("gen-poll").value || 3),
        pollTimeout: Number($("gen-timeout").value || 180),
        wait: false,
      };

      try {
        const data = await api("/api/generate", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!data.ok) {
          setStatus($("gen-status"), friendlyError(data.error || "提交失敗"), "err");
          $("result-meta").textContent = JSON.stringify(data, null, 2);
          return;
        }

        state.currentChatId = data.chatId;
        state.currentModel = data.model || model;
        const submit = data.submit || {};
        const bal = submit.bananas?.balance ?? submit.bananas;
        const adj = Array.isArray(data.adjustments) && data.adjustments.length
          ? data.adjustments.join(" | ")
          : "";
        $("result-meta").textContent = [
          `status=submitted`,
          `chatId=${data.chatId}`,
          `model=${data.model || model}`,
          data.originalModel && data.originalModel !== data.model
            ? `originalModel=${data.originalModel}`
            : null,
          data.fallbackUsed ? `fallbackUsed=true` : null,
          data.fromPool ? `fromPool=true account=${data.poolAccount?.id || "?"}` : `fromPool=false`,
          data.poolStats
            ? `pool free=${data.poolStats.free}/${data.poolStats.enabled}`
            : null,
          adj ? `adjustments=${adj}` : null,
          `bananaCost=${submit.bananaCost ?? "—"}`,
          `balance=${bal ?? "—"}`,
          data.poolCredits != null ? `poolCredits=${data.poolCredits}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        const adjHint = adj ? ` · ${adj}` : "";
        const poolHint = data.fromPool ? " · pool" : "";
        setStatus(
          $("gen-status"),
          `已提交 chatId=${data.chatId}${data.fallbackUsed ? "（已 fallback）" : ""}${poolHint}，開始輪詢…${adjHint}`,
          "warn"
        );

        const final = await pollJob({
          chatId: data.chatId,
          prompt,
          model: data.model || model,
          type: data.type || modelById(model)?.type,
          pollInterval: body.pollInterval,
          pollTimeout: body.pollTimeout,
          submit,
        });

        state.currentChatId = final.chatId || data.chatId;
        state.currentModel = final.model || data.model || model;

        if (!final.ok) {
          const msg = friendlyError(final.error || final.message || "生成失敗");
          setStatus($("gen-status"), msg, "err");
          $("result-meta").textContent = [
            `status=${final.status || "error"}`,
            `chatId=${final.chatId || data.chatId}`,
            `model=${final.model || model}`,
            `error=${msg}`,
          ].join("\n");
          return;
        }

        const meta = [
          `status=${final.status}`,
          `chatId=${final.chatId}`,
          `model=${final.model}`,
          `bananaCost=${submit.bananaCost ?? "—"}`,
          `balance=${bal ?? "—"}`,
          final.mediaUrl ? `url=${final.mediaUrl}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        showPreview({
          mediaUrl: final.mediaUrl,
          type: final.type,
          metaText: meta,
        });
        setStatus($("gen-status"), "生成完成", "ok");
        refreshMe();
      } catch (e) {
        setStatus($("gen-status"), friendlyError(String(e)), "err");
      } finally {
        btn.disabled = false;
        label.textContent = "開始生成";
        spinner.classList.add("hidden");
      }
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&")
      .replaceAll("<", "<")
      .replaceAll(">", ">");
  }

  function updateCurlExample(apiKey) {
    const key = apiKey || state.lastApiKey || "faa_sk_...";
    $("key-curl").textContent = `# API Key 範例
export FAA_KEY=${key}
export BASE=${BASE}

# 模型列表
curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/models"

# 生成
curl -s -X POST "$BASE/v1/generate" \\
  -H "Authorization: Bearer $FAA_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"a cute cat","model":"nano-banana-2-lite","aspect":"1:1","resolution":"1K"}'

# 輪詢（把 chatId 換成回傳值）
curl -s -H "Authorization: Bearer $FAA_KEY" "$BASE/v1/jobs/<chatId>"`;
  }

  async function loadKeys() {
    if (!state.creds) {
      setStatus($("key-status"), "請先登入", "err");
      $("key-list").innerHTML = "";
      return;
    }
    setStatus($("key-status"), "載入中…");
    const data = await api("/api/keys");
    if (!data.ok) {
      const msg =
        typeof data.error === "object"
          ? friendlyError(data.error)
          : data.error || "失敗";
      setStatus($("key-status"), msg, "err");
      return;
    }
    const list = $("key-list");
    list.innerHTML = "";
    (data.keys || []).forEach((k) => {
      const row = document.createElement("div");
      row.className = "key-item";
      const revoked = k.revokedAt ? " · revoked" : "";
      row.innerHTML = `
        <div class="key-meta">
          <div class="t">${escapeHtml(k.name || "—")} · <code>${escapeHtml(k.prefix || "")}…</code>${revoked}</div>
          <div class="p">id=${escapeHtml(k.id)} · scopes=${escapeHtml((k.scopes || []).join(","))} · created=${k.createdAt ? new Date(k.createdAt).toLocaleString() : "—"}</div>
        </div>
        <button type="button" class="btn btn-danger btn-sm" data-id="${escapeHtml(k.id)}">撤銷</button>
      `;
      row.querySelector("button").onclick = async () => {
        if (!confirm(`確定撤銷 ${k.name || k.id}？`)) return;
        const res = await api(`/api/keys/${encodeURIComponent(k.id)}`, { method: "DELETE" });
        if (!res.ok) {
          setStatus($("key-status"), friendlyError(res.error || "撤銷失敗"), "err");
          return;
        }
        setStatus($("key-status"), `已撤銷 ${k.id}`, "ok");
        loadKeys();
      };
      list.appendChild(row);
    });
    if (!(data.keys || []).length) {
      list.innerHTML = '<p class="muted small">尚無 API Key</p>';
    }
    setStatus($("key-status"), `共 ${(data.keys || []).length} 組`, "ok");
  }

  function bindKeys() {
    $("btn-key-refresh").onclick = loadKeys;
    $("btn-key-create").onclick = async () => {
      if (!state.creds) return setStatus($("key-status"), "請先登入", "err");
      setStatus($("key-status"), "建立中…", "warn");
      const data = await api("/api/keys", {
        method: "POST",
        body: JSON.stringify({
          name: $("key-name").value.trim() || "default",
          username: state.creds.username || "",
          scopes: ["*"],
        }),
      });
      if (!data.ok) {
        setStatus($("key-status"), friendlyError(data.error || "建立失敗"), "err");
        return;
      }
      const plain = data.key?.apiKey || "";
      state.lastApiKey = plain;
      $("key-once").value = plain;
      $("key-once-wrap").classList.remove("hidden");
      updateCurlExample(plain);
      setStatus($("key-status"), "已建立（請立即複製）", "ok");
      loadKeys();
    };
    $("btn-key-copy").onclick = async () => {
      const v = $("key-once").value;
      try {
        await navigator.clipboard.writeText(v);
        setStatus($("key-status"), "已複製到剪貼簿", "ok");
      } catch {
        $("key-once").select();
        setStatus($("key-status"), "請手動複製", "warn");
      }
    };
    updateCurlExample();
  }

  async function loadHistory() {
    if (!state.creds) {
      setStatus($("hist-status"), "請先登入", "err");
      return;
    }
    setStatus($("hist-status"), "載入中…");
    const limit = Number($("hist-limit").value || 15);
    const offset = Number($("hist-offset").value || 0);
    const data = await api(`/api/history?limit=${limit}&offset=${offset}`);
    if (!data.ok) {
      setStatus($("hist-status"), data.error || "失敗", "err");
      return;
    }
    $("hist-summary").textContent = `active=${data.activeGeneration} count=${data.activeGenerationsCount} hasMore=${data.hasMore} rows=${(data.rows || []).length}`;
    const list = $("hist-list");
    list.innerHTML = "";
    (data.rows || []).forEach((row) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hist-item";
      const errHint = row.error ? ` · ${escapeHtml(String(row.error).slice(0, 80))}` : "";
      btn.innerHTML = `<div class="t">${row.status} · ${row.model || "—"} · ${row.chatId}</div><div class="p">${escapeHtml(row.prompt || "(no prompt)")}${errHint}</div>`;
      btn.onclick = () => {
        $("hist-del").value = row.chatId || "";
        state.currentChatId = row.chatId;
        state.currentModel = row.model;
        state.currentMedia = row.mediaUrl || row.media;
        if (row.mediaUrl || row.media) {
          showPreview({
            mediaUrl: row.mediaUrl || row.media,
            type: /\.(mp4|webm)/i.test(row.mediaUrl || row.media || "") ? "video" : "image",
            metaText: `chatId=${row.chatId}\nmodel=${row.model}\nstatus=${row.status}\nmedia=${row.media}`,
          });
        } else {
          $("result-meta").textContent = [
            `chatId=${row.chatId}`,
            `status=${row.status}`,
            row.error ? `error=${row.error}` : "（尚無媒體）",
          ].join("\n");
        }
        setStatus(
          $("hist-status"),
          row.error ? `錯誤：${friendlyError(row.error)}` : `已選擇 ${row.chatId}`,
          row.error ? "err" : "ok"
        );
      };
      list.appendChild(btn);
    });
    setStatus($("hist-status"), "完成", "ok");
  }

  function bindHistory() {
    $("btn-history").onclick = loadHistory;
    $("btn-hist-del").onclick = async () => {
      const chatId = $("hist-del").value.trim();
      if (!chatId) return setStatus($("hist-status"), "請輸入 chatId", "err");
      const data = await api(`/api/history/${encodeURIComponent(chatId)}`, {
        method: "DELETE",
      });
      setStatus(
        $("hist-status"),
        data.ok ? `已刪除 ${chatId}` : data.error || "刪除失敗",
        data.ok ? "ok" : "err"
      );
      if (data.ok) loadHistory();
    };
  }

  async function loadStatus() {
    const data = await api("/api/status");
    $("status-box").textContent = JSON.stringify(data, null, 2);
  }

  async function loadGallery() {
    const data = await api("/api/gallery");
    const box = $("gallery");
    box.innerHTML = "";
    if (!data.ok) return;
    if (!data.files || !data.files.length) {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = data.note || "Phase 1 無本機作品庫";
      box.appendChild(p);
      return;
    }
    data.files.slice(0, 24).forEach((f) => {
      const a = document.createElement("a");
      a.href = f.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.title = f.name;
      if (f.type === "video") {
        const v = document.createElement("video");
        v.src = f.url;
        v.muted = true;
        a.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = f.url;
        img.alt = f.name;
        a.appendChild(img);
      }
      box.appendChild(a);
    });
  }

  function bindStatus() {
    $("btn-status").onclick = loadStatus;
    $("btn-refresh-status").onclick = async () => {
      await refreshMe();
      await loadStatus();
      await loadGallery();
    };
    $("btn-gallery").onclick = loadGallery;
  }

  function renderPoolStats(stats) {
    const s = stats || {};
    $("pool-stats").textContent =
      `total=${s.total ?? 0} · enabled=${s.enabled ?? 0} · free=${s.free ?? 0} · busy=${s.busy ?? 0} · disabled=${s.disabled ?? 0}`;
  }

  async function loadPool() {
    if (!state.creds) {
      setStatus($("pool-status"), "請先登入 / Please login first", "err");
      $("pool-list").innerHTML = "";
      return;
    }
    setStatus($("pool-status"), "載入中… / Loading…");
    const data = await api("/api/pool");
    if (!data.ok) {
      setStatus($("pool-status"), friendlyError(data.error || "失敗 / failed"), "err");
      return;
    }
    renderPoolStats(data.stats);
    const list = $("pool-list");
    list.innerHTML = "";
    (data.accounts || []).forEach((a) => {
      const row = document.createElement("div");
      row.className = "key-item";
      const busy = a.busy ? "BUSY" : "FREE";
      const en = a.enabled === false ? "disabled" : "enabled";
      row.innerHTML = `
        <div class="key-meta">
          <div class="t">${escapeHtml(a.name || a.id)} · <code>${escapeHtml(String(a.userId || ""))}</code> · ${busy} · ${en}</div>
          <div class="p">id=${escapeHtml(a.id)} · ok=${a.successCount || 0} err=${a.errorCount || 0}${
            a.lastError ? ` · lastError=${escapeHtml(String(a.lastError).slice(0, 80))}` : ""
          }</div>
        </div>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${a.enabled === false ? "啟用" : "停用"}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-act="release">釋放</button>
          <button type="button" class="btn btn-danger btn-sm" data-act="remove">移除</button>
        </div>
      `;
      row.querySelector('[data-act="toggle"]').onclick = async () => {
        const res = await api(`/api/pool/${encodeURIComponent(a.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: a.enabled === false }),
        });
        if (!res.ok) return setStatus($("pool-status"), friendlyError(res.error || "失敗"), "err");
        setStatus($("pool-status"), `已更新 ${a.id}`, "ok");
        loadPool();
      };
      row.querySelector('[data-act="release"]').onclick = async () => {
        const res = await api(`/api/pool/${encodeURIComponent(a.id)}/release`, {
          method: "POST",
          body: "{}",
        });
        if (!res.ok) return setStatus($("pool-status"), friendlyError(res.error || "失敗"), "err");
        setStatus($("pool-status"), `已釋放 ${a.id}`, "ok");
        loadPool();
      };
      row.querySelector('[data-act="remove"]').onclick = async () => {
        if (!confirm(`移除 / Remove ${a.name || a.id}?`)) return;
        const res = await api(`/api/pool/${encodeURIComponent(a.id)}`, { method: "DELETE" });
        if (!res.ok) return setStatus($("pool-status"), friendlyError(res.error || "失敗"), "err");
        setStatus($("pool-status"), `已移除 ${a.id}`, "ok");
        loadPool();
      };
      list.appendChild(row);
    });
    if (!(data.accounts || []).length) {
      list.innerHTML = '<p class="muted small">池內尚無帳號 / No pool accounts yet</p>';
    }
    setStatus($("pool-status"), `共 ${(data.accounts || []).length} 組 / ${(data.accounts || []).length} account(s)`, "ok");
  }

  function bindPool() {
    if (!$("btn-pool-refresh")) return;
    $("btn-pool-refresh").onclick = loadPool;
    $("btn-pool-add-session").onclick = async () => {
      if (!state.creds) return setStatus($("pool-status"), "請先登入 / Please login", "err");
      setStatus($("pool-status"), "加入中… / Adding…", "warn");
      const data = await api("/api/pool", {
        method: "POST",
        body: JSON.stringify({
          name: state.creds.username || state.creds.id,
          username: state.creds.username || "",
        }),
      });
      if (!data.ok) {
        setStatus($("pool-status"), friendlyError(data.error || "失敗"), "err");
        return;
      }
      setStatus($("pool-status"), `已加入 ${data.account?.id || ""}`, "ok");
      loadPool();
    };
    $("btn-pool-add").onclick = async () => {
      if (!state.creds) return setStatus($("pool-status"), "請先登入（管理用）/ Login required", "err");
      const userId = $("pool-uid").value.trim();
      const token = $("pool-token").value.trim();
      if (!userId || !token) {
        return setStatus($("pool-status"), "userId 與 token 必填 / required", "err");
      }
      setStatus($("pool-status"), "加入中… / Adding…", "warn");
      const data = await api("/api/pool", {
        method: "POST",
        body: JSON.stringify({
          userId,
          token,
          username: $("pool-username").value.trim(),
          name: $("pool-name").value.trim() || userId,
        }),
      });
      if (!data.ok) {
        setStatus($("pool-status"), friendlyError(data.error || "失敗"), "err");
        return;
      }
      $("pool-token").value = "";
      setStatus($("pool-status"), `已加入 ${data.account?.id || ""}`, "ok");
      loadPool();
    };
  }

  async function init() {
    loadCreds();
    bindTabs();
    bindAuth();
    bindGenerate();
    bindHistory();
    bindKeys();
    bindPool();
    bindStatus();
    try {
      await loadMeta();
      await loadGallery();
    } catch (e) {
      setStatus($("auth-status"), String(e), "err");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
