/**
 * Stateless signed session tokens for the access gate.
 *
 * token = base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * Uses Web Crypto so it runs in both the edge middleware and Node server
 * actions. No 'server-only' / next/headers here so middleware can import it.
 * We sign only verified identity (Torn id + faction) — never the API key.
 */

export interface SessionPayload {
  tornId: number;
  factionId: number;
  name: string;
  /** Expiry, unix seconds. */
  exp: number;
}

const enc = new TextEncoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(enc.encode(s));
}
function stringFromB64url(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlFromString(JSON.stringify(payload));
  const sig = await hmac(body, secret);
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(body, secret);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(stringFromB64url(body)) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
