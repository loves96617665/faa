/** Service account pool management (session auth) */

import { json, err, readJson, extractAuth, requireAuth } from "../functions/_shared/http.js";
import {
  listPoolAccounts,
  addPoolAccount,
  updatePoolAccount,
  removePoolAccount,
  poolStats,
  releasePoolAccount,
} from "../functions/_shared/pool.js";

function sessionAuth(context, body = {}) {
  const auth = extractAuth(context.request, body);
  try {
    requireAuth(auth);
  } catch (e) {
    return { error: err(e.message || "Unauthorized", e.status || 401) };
  }
  return { auth };
}

export async function apiPoolList(context) {
  const a = sessionAuth(context);
  if (a.error) return a.error;
  try {
    const accounts = await listPoolAccounts(context.env);
    const stats = await poolStats(context.env);
    return json({ ok: true, stats, accounts });
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}

export async function apiPoolStats(context) {
  // allow API key or session — stats only
  try {
    const stats = await poolStats(context.env);
    return json({ ok: true, stats });
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}

export async function apiPoolAdd(context) {
  const body = await readJson(context.request);
  const a = sessionAuth(context, body);
  if (a.error) return a.error;
  try {
    // default: add current session account if no body credentials
    const userId = String(body.userId || body.id || a.auth.userId).trim();
    const token = String(body.token || a.auth.token).trim();
    const username = String(body.username || body.name || "").trim();
    const name = String(body.name || username || userId).trim();
    const acc = await addPoolAccount(context.env, { userId, token, username, name });
    const stats = await poolStats(context.env);
    return json({ ok: true, account: acc, stats }, 201);
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}

export async function apiPoolUpdate(context) {
  const body = await readJson(context.request);
  const a = sessionAuth(context, body);
  if (a.error) return a.error;
  const id = String(context.params?.id || "").trim();
  if (!id) return err("缺少 account id");
  try {
    const acc = await updatePoolAccount(context.env, id, body);
    return json({ ok: true, account: acc });
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}

export async function apiPoolRemove(context) {
  const a = sessionAuth(context);
  if (a.error) return a.error;
  const id = String(context.params?.id || "").trim();
  if (!id) return err("缺少 account id");
  try {
    await removePoolAccount(context.env, id);
    const stats = await poolStats(context.env);
    return json({ ok: true, id, stats });
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}

export async function apiPoolRelease(context) {
  const a = sessionAuth(context);
  if (a.error) return a.error;
  const id = String(context.params?.id || "").trim();
  if (!id) return err("缺少 account id");
  try {
    await releasePoolAccount(context.env, id, { success: true });
    const stats = await poolStats(context.env);
    return json({ ok: true, id, stats, released: true });
  } catch (e) {
    return err(e.message || String(e), e.status || 500);
  }
}
