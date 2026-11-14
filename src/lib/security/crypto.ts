import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Field-level encryption and hashing for personal data.
 *
 * Rules (see docs/03-data-model.md §7, "Restricted" class):
 *  - Anything that can identify a person (full name, username, e-mail, address)
 *    is encrypted with AES-256-GCM before it touches the database.
 *  - Anything we must look up or make unique (username, e-mail) also gets an
 *    HMAC-SHA256 digest with a server-side pepper, so plaintext is never an
 *    index key and a database leak cannot be brute-forced with rainbow tables.
 *  - Tokens (session, OTP) are only ever stored hashed.
 *
 * Keys are derived from environment secrets, never hard-coded. Missing or weak
 * secrets throw at call time, not at import time, so read-only pages still render.
 */

const ENCRYPTION_VERSION = "v1";

function readSecret(name: "SESSION_SECRET" | "OTP_PEPPER" | "IP_PEPPER"): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < 32 || value.startsWith("change-me")) {
    throw new Error(`security: ${name} must be set to a random value of at least 32 characters`);
  }
  return value;
}

/** True when the deployment has real secrets. Used to fail closed before writing PII. */
export function secretsConfigured(): boolean {
  try {
    readSecret("SESSION_SECRET");
    readSecret("OTP_PEPPER");
    return true;
  } catch {
    return false;
  }
}

/** 32-byte encryption key and 32-byte HMAC key, both derived from distinct labels. */
function deriveKeys() {
  const base = readSecret("SESSION_SECRET");
  const encKey = createHash("sha256").update(`cm:enc:v1:${base}`).digest();
  const macKey = createHash("sha256").update(`cm:mac:v1:${base}`).digest();
  return { encKey, macKey };
}

/** AES-256-GCM. Returns `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptField(plaintext: string): string {
  const { encKey } = deriveKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    "."
  );
}

/** Reverse of {@link encryptField}. Any tampering throws instead of returning data. */
export function decryptField(value: string): string {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) {
    throw new Error("security: unrecognised ciphertext format");
  }
  const { encKey } = deriveKeys();
  const decipher = createDecipheriv("aes-256-gcm", encKey, Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

/** HMAC-SHA256 digest used for unique lookups of encrypted values. */
export function lookupHash(value: string): string {
  const { macKey } = deriveKeys();
  return createHmac("sha256", macKey).update(value.normalize("NFKC").trim().toLowerCase()).digest("base64url");
}

/**
 * Digest for an OTP or any other short-lived secret. A separate pepper keeps
 * OTP digests useless even if the lookup key were ever exposed.
 */
export function otpDigest(challengeId: string, code: string): string {
  const pepper = readSecret("OTP_PEPPER");
  // Base64url HMAC output. Note: base64url() output can contain '-' and '_',
  // and `safeEqual` compares UTF-8 bytes, so digests are compared as strings of
  // equal length — never parsed back into buffers.
  return createHmac("sha256", pepper).update(`${challengeId}:${code}`).digest("base64url");
}

/** Constant-time comparison for hex/base64 digests and any short secret. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** SHA-256 of a bearer token. Only this digest is persisted. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A 256-bit URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Six-digit OTP from a CSPRNG, not Math.random. */
export function randomOtp(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** Coarse, non-reversible client fingerprint for logs. Never stores a raw IP. */
export function hashClientId(raw: string): string | null {
  try {
    const pepper = readSecret("IP_PEPPER");
    return createHmac("sha256", pepper).update(raw).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

/** HMAC for tamper-proof, self-describing values (e.g. the signup proof cookie). */
export function signValue(purpose: string, payload: string): string {
  const { macKey } = deriveKeys();
  return createHmac("sha256", macKey).update(`${purpose}:${payload}`).digest("base64url");
}
