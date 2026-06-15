/**
 * Symmetric encryption for Torn API keys at rest (PLAN §10).
 *
 * AES-256-GCM. The 32-byte key comes from KEY_ENCRYPTION_KEY (base64) and lives
 * only in env / a KMS — never in the DB. Ciphertext layout is a single buffer:
 *
 *   [ iv (12 bytes) | auth tag (16 bytes) | ciphertext (n bytes) ]
 *
 * stored as `bytea`. Only the collector (and the server-side key-save path)
 * ever hold the plaintext key, in memory.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/** Parse and validate the 32-byte AES key from a base64 env value. */
export function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const b64 = env.KEY_ENCRYPTION_KEY;
  if (!b64) throw new Error("KEY_ENCRYPTION_KEY is not set.");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`KEY_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}.`);
  }
  return key;
}

/** Encrypt a Torn API key. Returns iv || tag || ciphertext. */
export function encryptKey(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

/** Decrypt a buffer produced by {@link encryptKey}. Throws on tamper / wrong key. */
export function decryptKey(blob: Buffer, key: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("Ciphertext too short to be a valid encrypted key.");
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
