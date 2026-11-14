import { NextResponse } from "next/server";

// Re-exported so routes import a single module for every response concern.
export { fieldErrors } from "@/lib/auth/validation";

/**
 * Every auth endpoint answers through these helpers so the security posture is
 * consistent:
 *  - JSON only, never HTML error pages that leak stack frames;
 *  - `Cache-Control: no-store` so codes and profile data are not cached;
 *  - errors carry a machine-readable `code` and a safe, generic message. A
 *    response never reveals whether a phone number or e-mail is registered.
 */

const SECURITY_HEADERS = {
  "cache-control": "no-store, no-cache, must-revalidate, private",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

export type ApiErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "otp_invalid"
  | "otp_expired"
  | "too_many_attempts"
  | "no_account"
  | "not_configured"
  | "csrf"
  | "unauthorized"
  | "generic";

export function ok<T extends Record<string, unknown>>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: SECURITY_HEADERS });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
) {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status, headers: SECURITY_HEADERS });
}

/** Uniform "try again later" used by every rate-limited path. */
export function rateLimited(retryAfterSeconds: number) {
  const res = fail("rate_limited", "Too many attempts. Please try again later.", 429, { retryAfterSeconds });
  res.headers.set("retry-after", String(retryAfterSeconds));
  return res;
}

/** Reads a JSON body defensively: bounded size, object only, never throws. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 16 * 1024) return null;
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Rejects cross-site form posts before any business logic runs. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    // Same-origin fetches always include Origin for POST; a missing header is
    // treated as untrusted when a referer is present and mismatched.
    const referer = request.headers.get("referer");
    if (!referer) return true;
    try {
      return new URL(referer).host === request.headers.get("host");
    } catch {
      return false;
    }
  }
  const host = request.headers.get("host");
  try {
    return !host || new URL(origin).host === host;
  } catch {
    return false;
  }
}
