/** AES-GCM helpers for encrypting dafreeai tokens at rest in KV */

function b64encode(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAesKey(rawKeyMaterial) {
  const material = String(rawKeyMaterial || "").trim();
  if (!material) {
    throw new Error("TOKEN_ENC_KEY is not configured (wrangler secret put TOKEN_ENC_KEY)");
  }

  let keyBytes;
  // Prefer 64-char hex (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      keyBytes[i] = parseInt(material.slice(i * 2, i * 2 + 2), 16);
    }
  } else {
    // Fallback: SHA-256 of arbitrary secret string → 32 bytes
    const enc = new TextEncoder().encode(material);
    keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", enc));
  }

  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext → base64(iv || ciphertext)
 * @param {string} plaintext
 * @param {string} secret TOKEN_ENC_KEY
 */
export async function encryptText(plaintext, secret) {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(plaintext));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return b64encode(combined);
}

/**
 * Decrypt base64(iv || ciphertext) → plaintext
 */
export async function decryptText(payloadB64, secret) {
  const key = await importAesKey(secret);
  const combined = b64decode(payloadB64);
  if (combined.length < 13) throw new Error("Invalid ciphertext");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** url-safe random string */
export function randomToken(bytes = 24) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  // base64url without padding
  return b64encode(arr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
