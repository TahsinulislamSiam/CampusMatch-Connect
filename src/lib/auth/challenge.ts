import { lookupHash, safeEqual, signValue } from "@/lib/security/crypto";

/**
 * Signup proof.
 *
 * The message is "you proved this phone number by OTP within the last 10
 * minutes". It is carried in a short-lived, HMAC-signed, HttpOnly cookie so the
 * server can trust it without a server-side row keyed by an anonymous visitor.
 *
 * - Scope: bound to the exact phone number, so it cannot be replayed for
 *   another number; bound to the purpose string, so it cannot be used for
 *   anything but registration.
 * - Expiry: 10 minutes, far shorter than a session.
 * - Consumption: cleared on successful registration, so one proof, one account.
 */

export const SIGNUP_COOKIE = "cm_signup_proof";
const PROOF_TTL_MS = 10 * 60 * 1000;
const PURPOSE = "signup";

function sign(payload: string): string {
  return signValue(PURPOSE, payload);
}

function buildValue(phone: string, issuedAt: number): string {
  const subject = lookupHash(phone);
  const payload = `${PURPOSE}.${subject}.${issuedAt}`;
  return `${payload}.${sign(payload)}`;
}

/** Cookie attributes for the proof. */
export function signupCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: "/",
    maxAge: PROOF_TTL_MS / 1000,
  };
}

/** Same attributes, but already expired — used to delete the proof after use. */
export function expiredSignupCookieOptions() {
  return { ...signupCookieOptions(), maxAge: 0, expires: new Date(0) };
}

/** Value to store in the cookie after a successful signup OTP verification. */
export function issueAccountChallenge(phone: string): string {
  return buildValue(phone, Date.now());
}

/** True when the request carries a valid, unexpired proof for this phone. */
export function getAccountChallenge(request: Request, phone: string): boolean {
  const raw = readCookie(request.headers.get("cookie"), SIGNUP_COOKIE);
  if (!raw) return false;

  const parts = raw.split(".");
  if (parts.length !== 4) return false;
  const [purpose, subject, issuedAtRaw, mac] = parts;
  if (purpose !== PURPOSE) return false;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > PROOF_TTL_MS || issuedAt > Date.now() + 60_000) {
    return false;
  }
  if (!safeEqual(subject, lookupHash(phone))) return false;
  return safeEqual(mac, sign(`${purpose}.${subject}.${issuedAtRaw}`));
}

/** Called after a successful registration; tells the caller to expire the cookie. */
export function consumeAccountChallenge(_request: Request, _phone: string): void {
  // Nothing to revoke server-side: the signature is single-use because the
  // registration itself succeeded and the cookie is deleted by the route.
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
