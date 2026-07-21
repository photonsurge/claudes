/**
 * Symmetric encryption for secrets we must persist (e.g. a YouTube OAuth refresh
 * token) but never want readable at rest in Mongo. AES-256-GCM (authenticated),
 * Node `crypto` only — no dependency.
 *
 * The key is derived from `APP_SECRET` (or an explicit 32-byte base64
 * `SECRETBOX_KEY`) via scrypt, so a leaked DB dump alone can't decrypt the token
 * without the app secret. Only the WORKER ever calls these — `public` builds the
 * OAuth consent URL and hands the auth code to the worker, so the plaintext token
 * and this key never enter the web process.
 *
 * Blob format: `v1.<iv b64>.<tag b64>.<ciphertext b64>`. The `v1` version prefix
 * lets a future key rotation decrypt old blobs while writing new ones.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_INFO = "youtube-token-v1"; // scrypt salt / domain separation

let cachedKey: Buffer | null = null;

/** Resolve the 32-byte key once. Prefers an explicit base64 key, else derives from APP_SECRET. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.SECRETBOX_KEY;
  if (explicit) {
    const raw = Buffer.from(explicit, "base64");
    if (raw.length !== 32) throw new Error("SECRETBOX_KEY must be 32 bytes (base64-encoded)");
    cachedKey = raw;
    return raw;
  }
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) throw new Error("secretbox: set APP_SECRET (or SECRETBOX_KEY) to encrypt stored secrets");
  cachedKey = scryptSync(appSecret, KEY_INFO, 32);
  return cachedKey;
}

/** True when a key is configured — lets callers gate features that need secret storage. */
export function secretboxConfigured(): boolean {
  return !!(process.env.SECRETBOX_KEY || process.env.APP_SECRET);
}

/** Encrypt a UTF-8 plaintext into a versioned, self-describing blob string. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
}

/** Decrypt a blob produced by `encryptSecret`. Throws on tamper or wrong key. */
export function decryptSecret(blob: string): string {
  const parts = String(blob).split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("secretbox: unrecognised blob format");
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Reset the cached key (tests that swap env between cases). */
export function _resetSecretboxKey(): void {
  cachedKey = null;
}
