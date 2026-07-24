/**
 * Cloudflare Worker entry — static assets + /api/* handlers.
 * Live: https://faa.kinai.workers.dev
 */
import {
  apiMeta,
  apiStatus,
  apiLoginUrl,
  apiExchange,
  apiSave,
  apiMe,
  apiAcceptTerms,
  apiGenerate,
  apiJob,
  apiHistory,
  apiDeleteHistory,
  apiGallery,
} from "./routes.js";

function ctx(request, env, executionCtx, params = {}) {
  return {
    request,
    env,
    waitUntil: executionCtx?.waitUntil?.bind(executionCtx),
    params,
  };
}

function match(path, pattern) {
  const pp = pattern.split("/").filter(Boolean);
  const sp = path.split("/").filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

async function handleApi(request, env, executionCtx) {
  const url = new URL(request.url);
  // normalize trailing slash except root
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const method = request.method.toUpperCase();
  const base = ctx(request, env, executionCtx);

  if (method === "OPTIONS" && path.startsWith("/api")) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-User-Token",
      },
    });
  }

  if (method === "GET" && path === "/api/meta") return apiMeta(base);
  if (method === "GET" && path === "/api/status") return apiStatus(base);
  if (method === "POST" && path === "/api/generate") return apiGenerate(base);
  if (method === "GET" && path === "/api/history") return apiHistory(base);
  if (method === "GET" && path === "/api/gallery") return apiGallery(base);
  if (method === "GET" && path === "/api/auth/login-url") return apiLoginUrl(base);
  if (method === "POST" && path === "/api/auth/exchange") return apiExchange(base);
  if (method === "POST" && path === "/api/auth/save") return apiSave(base);
  if (method === "GET" && path === "/api/auth/me") return apiMe(base);
  if (method === "POST" && path === "/api/auth/accept-terms") return apiAcceptTerms(base);

  let params = match(path, "/api/job/:chatId");
  if (params && method === "GET") return apiJob({ ...base, params });

  params = match(path, "/api/history/:chatId");
  if (params && method === "DELETE") return apiDeleteHistory({ ...base, params });

  return new Response(JSON.stringify({ ok: false, error: `API not found: ${method} ${path}` }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health marker so we can confirm the Worker script is active
    if (path === "/api/__version") {
      return new Response(
        JSON.stringify({
          ok: true,
          build: "2026-07-24-v2-worker-routes",
          runtime: "cloudflare-worker",
        }),
        { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    // Always handle API in worker (never fall through to SPA assets)
    if (path === "/api" || path.startsWith("/api/")) {
      try {
        return await handleApi(request, env, executionCtx);
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: e.message || String(e), stack: String(e.stack || "") }),
          { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
        );
      }
    }

    // Compatibility: old Flask paths under /static/*
    if (path.startsWith("/static/")) {
      const rewritten = new URL(request.url);
      rewritten.pathname = path.replace(/^\/static/, "") || "/";
      if (env.ASSETS) return env.ASSETS.fetch(new Request(rewritten, request));
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("ASSETS binding missing", { status: 500 });
  },
};
