import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * AES-256-GCM encryption for mailbox secrets (passwords, OAuth refresh tokens).
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
function key(): Buffer {
  return createHash("sha256").update(env.encryptionKey).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** URL-safe random token for tracking links. */
export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("base64url");
}
