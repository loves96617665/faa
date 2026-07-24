/**
 * Cloudflare Worker entry — serves static assets + /api/* handlers.
 * Deploy target: faa.<account>.workers.dev
 */

import * as meta from "../functions/api/meta.js";
import * as status from "../functions/api/status.js";
import * as generate from "../functions/api/generate.js";
import * as historyList from "../functions/api/history.js";
import * as historyItem from "../functions/api/history/[chatId].js";
import * as job from "../functions/api/job/[chatId].js";
import * as gallery from "../functions/api/gallery.js";
import * as loginUrl from "../functions/api/auth/login-url.js";
import * as exchange from "../functions/api/auth/exchange.js";
import * as save from "../functions/api/auth/save.js";
import * as me from "../functions/api/auth/me.js";
import * as acceptTerms from "../functions/api/auth/accept-terms.js";

function ctx(request, env, c) {
  return {
    request,
    env,
    waitUntil: c.waitUntil.bind(c),
    passThroughOnException: c.passThroughOnException?.bind(c),
    params: {},
  };
}

function match(path, pattern) {
  // pattern e.g. /api/job/:chatId
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

async function handleApi(request, env, c) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  const base = ctx(request, env, c);

  // static API map
  const routes = [
    ["GET", "/api/meta", meta.onRequestGet],
    ["GET", "/api/status", status.onRequestGet],
    ["POST", "/api/generate", generate.onRequestPost],
    ["GET", "/api/history", historyList.onRequestGet],
    ["GET", "/api/gallery", gallery.onRequestGet],
    ["GET", "/api/auth/login-url", loginUrl.onRequestGet],
    ["POST", "/api/auth/exchange", exchange.onRequestPost],
    ["POST", "/api/auth/save", save.onRequestPost],
    ["GET", "/api/auth/me", me.onRequestGet],
    ["POST", "/api/auth/accept-terms", acceptTerms.onRequestPost],
  ];

  for (const [m, p, fn] of routes) {
    if (method === m && path === p) {
      return fn(base);
    }
  }

  // dynamic
  let params = match(path, "/api/job/:chatId");
  if (params && method === "GET" && job.onRequestGet) {
    return job.onRequestGet({ ...base, params });
  }

  params = match(path, "/api/history/:chatId");
  if (params && method === "DELETE" && historyItem.onRequestDelete) {
    return historyItem.onRequestDelete({ ...base, params });
  }

  // CORS preflight for API
  if (method === "OPTIONS" && path.startsWith("/api/")) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-User-Token",
      },
    });
  }

  return null;
}

export default {
  async fetch(request, env, c) {
    const url = new URL(request.url);

    // API first
    if (url.pathname.startsWith("/api/")) {
      try {
        const res = await handleApi(request, env, c);
        if (res) return res;
        return new Response(JSON.stringify({ ok: false, error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ ok: false, error: e.message || String(e) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Static assets (Workers Assets binding)
    if (env.ASSETS) {
      // SPA-ish: bare / → index.html via assets
      return env.ASSETS.fetch(request);
    }

    return new Response("ASSETS binding missing", { status: 500 });
  },
};
