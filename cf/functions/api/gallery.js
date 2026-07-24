import { json } from "../_shared/http.js";

/**
 * GET /api/gallery
 * Phase 1: no R2 / local storage. Stub empty list.
 * Phase 2 will use R2.
 */
export async function onRequestGet() {
  return json({
    ok: true,
    files: [],
    note: "Phase 1 無本機/R2 作品庫；請使用遠端 mediaUrl。Phase 2 將接 R2。",
  });
}
