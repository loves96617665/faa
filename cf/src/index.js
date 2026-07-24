/**
 * Cloudflare Worker entry — static assets + /api/* + /v1/* handlers.
 * Live: https://faa.kinai.workers.dev
 * build: 2026-07-24-v6-account-pool
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
import { apiKeysList, apiKeysCreate, apiKeysRevoke } from "./routes-keys.js";
import {
  apiPoolList,
  apiPoolStats,
  apiPoolAdd,
  apiPoolUpdate,
  apiPoolRemove,
  apiPoolRelease,
} from "./routes-pool.js";
import { v1Models, v1Me, v1Generate, v1Job, v1History } from "./routes-v1.js";

const BUILD = "2026-07-24-v6-account-pool";

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

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Api-Key, X-User-Id, X-User-Token",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleApi(request, env, executionCtx) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const method = request.method.toUpperCase();
  const base = ctx(request, env, executionCtx);

  if (method === "OPTIONS" && (path.startsWith("/api") || path.startsWith("/v1"))) {
    return corsPreflight();
  }

  // --- UI session API ---
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

  // --- API Key management (session) ---
  if (method === "GET" && path === "/api/keys") return apiKeysList(base);
  if (method === "POST" && path === "/api/keys") return apiKeysCreate(base);
  let params = match(path, "/api/keys/:id");
  if (params && method === "DELETE") return apiKeysRevoke({ ...base, params });

  // --- Service account pool (session) ---
  if (method === "GET" && path === "/api/pool") return apiPoolList(base);
  if (method === "GET" && path === "/api/pool/stats") return apiPoolStats(base);
  if (method === "POST" && path === "/api/pool") return apiPoolAdd(base);
  params = match(path, "/api/pool/:id");
  if (params && method === "PATCH") return apiPoolUpdate({ ...base, params });
  if (params && method === "DELETE") return apiPoolRemove({ ...base, params });
  params = match(path, "/api/pool/:id/release");
  if (params && method === "POST") return apiPoolRelease({ ...base, params });

  params = match(path, "/api/job/:chatId");
  if (params && method === "GET") return apiJob({ ...base, params });

  params = match(path, "/api/history/:chatId");
  if (params && method === "DELETE") return apiDeleteHistory({ ...base, params });

  // --- Public v1 API (API Key) ---
  if (method === "GET" && path === "/v1/models") return v1Models(base);
  if (method === "GET" && path === "/v1/me") return v1Me(base);
  if (method === "POST" && path === "/v1/generate") return v1Generate(base);
  if (method === "GET" && path === "/v1/history") return v1History(base);
  params = match(path, "/v1/jobs/:id");
  if (params && method === "GET") return v1Job({ ...base, params });
  params = match(path, "/v1/job/:id");
  if (params && method === "GET") return v1Job({ ...base, params });

  return new Response(JSON.stringify({ ok: false, error: `API not found: ${method} ${path}` }), {
    status: 404,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/__version") {
      return new Response(
        JSON.stringify({
          ok: true,
          build: BUILD,
          runtime: "cloudflare-worker",
          features: ["api-keys", "v1", "gpt2-smart", "account-pool"],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    if (path === "/api" || path.startsWith("/api/") || path === "/v1" || path.startsWith("/v1/")) {
      try {
        return await handleApi(request, env, executionCtx);
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: e.message || String(e), stack: String(e.stack || "") }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            },
          }
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

    return new Response("Not found", { status: 404 });
  },
};
