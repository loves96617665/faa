/* DaFreeAi Studio frontend */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    models: [],
    aspects: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"],
    qualities: ["low", "medium", "high"],
    currentMedia: null,
    currentChatId: null,
    currentModel: null,
  };

  function setStatus(el, text, kind = "") {
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
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

  function modelById(id) {
    return state.models.find((m) => m.id === id);
  }

  function fillModels() {
    const type = $("gen-type").value;
    const sel = $("gen-model");
    const list = state.models.filter((m) => m.type === type);
    sel.innerHTML = "";
    list.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      const flags = [m.type];
      if (m.unlimited) flags.push("unlimited");
      if (m.tag_required) flags.push("tag");
      if (m.supports_quality) flags.push("quality");
      opt.textContent = `${m.id} — ${m.name} [${flags.join(", ")}]`;
      sel.appendChild(opt);
    });
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "無模型";
      sel.appendChild(opt);
    }
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

    $("model-info").textContent = m
      ? `${m.name} · ${m.company} · res=${(m.supported_resolutions || []).join(",")} · unlimited=${m.unlimited} · tag_required=${m.tag_required}${m.notes ? " · " + m.notes : ""}`
      : "";
  }

  function setAuthBadge(me) {
    const badge = $("auth-badge");
    if (me && me.logged_in) {
      const bal = me.balance && (me.balance.balance ?? me.balance.bananas ?? me.balance);
      badge.textContent = `已登入 ${me.username || me.userId || ""}${bal != null ? " · 🍌 " + bal : ""}`;
      badge.classList.add("ok");
      if (me.userId) $("auth-uid").value = me.userId;
      if (me.username) $("auth-name").value = me.username;
    } else {
      badge.textContent = "未登入";
      badge.classList.remove("ok");
    }
  }

  function showPreview({ mediaUrl, localUrl, type, metaText }) {
    const wrap = $("preview-wrap");
    wrap.classList.remove("empty");
    wrap.innerHTML = "";
    const isVideo = type === "video" || /\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl || localUrl || "");
    const src = localUrl || mediaUrl;
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
    } else remote.classList.add("hidden");
    if (localUrl) {
      local.href = localUrl;
      local.classList.remove("hidden");
    } else local.classList.add("hidden");
    if (mediaUrl || localUrl) dl.classList.remove("hidden");
    else dl.classList.add("hidden");

    state.currentMedia = mediaUrl || localUrl;
  }

  async function refreshMe() {
    const me = await api("/api/auth/me");
    setAuthBadge(me);
    return me;
  }

  async function loadMeta() {
    const meta = await api("/api/meta");
    if (!meta.ok) throw new Error(meta.error || "meta failed");
    state.models = meta.models || [];
    state.aspects = meta.aspects || state.aspects;
    state.qualities = meta.qualities || state.qualities;

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

    if (meta.auth && meta.auth.userId) {
      $("auth-uid").value = meta.auth.userId;
      if (meta.auth.username) $("auth-name").value = meta.auth.username;
    }
    fillModels();
    // prefer lite model
    const lite = [...$("gen-model").options].find((o) => o.value === "nano-banana-2-lite");
    if (lite) $("gen-model").value = "nano-banana-2-lite";
    updateModelParams();
    await refreshMe();
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        $("panel-" + btn.dataset.tab).classList.add("active");
      });
    });
  }

  function bindAuth() {
    $("btn-save-json").onclick = async () => {
      setStatus($("auth-status"), "儲存中…");
      const data = await api("/api/auth/save", {
        method: "POST",
        body: JSON.stringify({ json: $("auth-json").value }),
      });
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      setStatus($("auth-status"), `已儲存 ${data.saved}`, "ok");
      await refreshMe();
    };

    $("btn-save-manual").onclick = async () => {
      setStatus($("auth-status"), "儲存中…");
      const data = await api("/api/auth/save", {
        method: "POST",
        body: JSON.stringify({
          userId: $("auth-uid").value.trim(),
          token: $("auth-token").value.trim(),
          username: $("auth-name").value.trim(),
        }),
      });
      if (!data.ok) return setStatus($("auth-status"), data.error || "失敗", "err");
      setStatus($("auth-status"), `已儲存 ${data.saved}`, "ok");
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
      setStatus($("auth-status"), `登入成功：${data.user?.username || data.user?.id}`, "ok");
      await refreshMe();
    };

    $("btn-accept-terms").onclick = async () => {
      const data = await api("/api/auth/accept-terms", { method: "POST", body: "{}" });
      setStatus($("auth-status"), data.ok ? "已接受條款" : data.error || "失敗", data.ok ? "ok" : "err");
    };
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function pollJob({ chatId, prompt, model, type, pollInterval, pollTimeout, autoDownload, submit }) {
    const started = Date.now();
    const intervalMs = Math.max(1, Number(pollInterval) || 3) * 1000;
    const timeoutMs = Math.max(10, Number(pollTimeout) || 180) * 1000;
    let ticks = 0;

    while (Date.now() - started < timeoutMs) {
      ticks += 1;
      const q = prompt ? `?prompt=${encodeURIComponent(prompt.slice(0, 40))}` : "";
      const job = await api(`/api/job/${encodeURIComponent(chatId)}${q}`);
      const elapsed = Math.round((Date.now() - started) / 1000);
      const active = job.activeGeneration || job.activeGenerationsCount || "—";
      setStatus(
        $("gen-status"),
        `輪詢中 #${ticks} · ${elapsed}s · status=${job.status || "?"} · active=${active}`,
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
        let saved = null;
        let download_error = null;
        if (autoDownload) {
          const dl = await api("/api/download", {
            method: "POST",
            body: JSON.stringify({
              media: job.media || job.mediaUrl,
              chatId,
              model: model || job.modelName || "media",
            }),
          });
          if (dl.ok) saved = dl;
          else download_error = dl.error || "download failed";
        }
        return {
          ok: true,
          status: "completed",
          chatId,
          media: job.media,
          mediaUrl: job.mediaUrl,
          saved,
          download_error,
          result: job.result,
          submit,
          model,
          type,
        };
      }

      // pending / processing / submitted
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
        autoDownload: $("gen-download").checked,
        wait: false, // non-blocking: frontend polls /api/job
      };

      try {
        const data = await api("/api/generate", { method: "POST", body: JSON.stringify(body) });
        if (!data.ok) {
          setStatus($("gen-status"), data.error || "提交失敗", "err");
          $("result-meta").textContent = JSON.stringify(data, null, 2);
          return;
        }

        state.currentChatId = data.chatId;
        state.currentModel = data.model || model;
        const submit = data.submit || {};
        const bal = submit.bananas?.balance ?? submit.bananas;
        $("result-meta").textContent = [
          `status=submitted`,
          `chatId=${data.chatId}`,
          `model=${data.model || model}`,
          `bananaCost=${submit.bananaCost ?? "—"}`,
          `balance=${bal ?? "—"}`,
        ].join("\n");
        setStatus($("gen-status"), `已提交 chatId=${data.chatId}，開始輪詢…`, "warn");

        const final = await pollJob({
          chatId: data.chatId,
          prompt,
          model: data.model || model,
          type: data.type || modelById(model)?.type,
          pollInterval: body.pollInterval,
          pollTimeout: body.pollTimeout,
          autoDownload: body.autoDownload,
          submit,
        });

        state.currentChatId = final.chatId || data.chatId;
        state.currentModel = final.model || data.model || model;

        if (!final.ok) {
          const msg = final.error || final.message || "生成失敗";
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
          final.saved ? `local=${final.saved.local_url}` : final.download_error ? `download_error=${final.download_error}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        showPreview({
          mediaUrl: final.mediaUrl,
          localUrl: final.saved?.local_url,
          type: final.type,
          metaText: meta,
        });
        setStatus($("gen-status"), "生成完成", "ok");
        loadGallery();
        refreshMe();
      } catch (e) {
        setStatus($("gen-status"), String(e), "err");
      } finally {
        btn.disabled = false;
        label.textContent = "開始生成";
        spinner.classList.add("hidden");
      }
    };

    $("btn-download-media").onclick = async () => {
      if (!state.currentMedia) return;
      const data = await api("/api/download", {
        method: "POST",
        body: JSON.stringify({
          media: state.currentMedia,
          chatId: state.currentChatId || "manual",
          model: state.currentModel || "media",
        }),
      });
      if (!data.ok) return setStatus($("gen-status"), data.error || "下載失敗", "err");
      setStatus($("gen-status"), `已下載 ${data.local_url}`, "ok");
      showPreview({
        mediaUrl: state.currentMedia,
        localUrl: data.local_url,
        type: state.currentModel && modelById(state.currentModel)?.type,
        metaText: $("result-meta").textContent + `\nlocal=${data.local_url}`,
      });
      loadGallery();
    };
  }

  async function loadHistory() {
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
            localUrl: null,
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
        setStatus($("hist-status"), row.error ? `錯誤：${row.error}` : `已選擇 ${row.chatId}`, row.error ? "err" : "ok");
      };
      list.appendChild(btn);
    });
    setStatus($("hist-status"), "完成", "ok");
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&")
      .replaceAll("<", "<")
      .replaceAll(">", ">");
  }

  function bindHistory() {
    $("btn-history").onclick = loadHistory;
    $("btn-hist-del").onclick = async () => {
      const chatId = $("hist-del").value.trim();
      if (!chatId) return setStatus($("hist-status"), "請輸入 chatId", "err");
      const data = await api(`/api/history/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      setStatus($("hist-status"), data.ok ? `已刪除 ${chatId}` : data.error || "刪除失敗", data.ok ? "ok" : "err");
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
    (data.files || []).slice(0, 24).forEach((f) => {
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

  async function init() {
    bindTabs();
    bindAuth();
    bindGenerate();
    bindHistory();
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
