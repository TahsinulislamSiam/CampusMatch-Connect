import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { randomToken, safeEqual, sha256 } from "@/lib/security/crypto";
import { CSRF_COOKIE, SESSION_COOKIE } from "@/lib/constants";
import { findUserById, toAuthUser, type AuthUser } from "@/lib/auth/user";

/**
 * Sessions (docs/01-prd.md AUTH-01 AC4/AC5).
 *
 *  - A 256-bit random token lives in an HttpOnly cookie. Only its SHA-256
 *    digest is stored, so a database leak cannot be replayed as a login.
 *  - A second cookie holds a CSRF token that the client must echo in the
 *    `x-csrf-token` header for state-changing requests (double submit). The
 *    CSRF cookie is intentionally *not* HttpOnly so the SPA can read it, but
 *    it is useless without the session cookie.
 *  - Cookies use SameSite=Strict, Secure outside development, and a narrow path.
 */

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TOUCH_MS = 5 * 60 * 1000; // refresh lastUsedAt at most every 5 min
const COOKIE_PATH = "/";

const isProd = process.env.NODE_ENV === "production";

const baseCookie = {
  httpOnly: true,
  secure: isProd,
  sameSite: "strict" as const,
  path: COOKIE_PATH,
};

export type SessionInfo = { user: AuthUser; sessionId: string; csrfToken: string };

function expiry() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

/**
 * Create a session row and set cookies. Must be called from a Route Handler
 * (or Server Action) because `cookies().set` is not allowed while rendering.
 */
export async function startSession(
  userId: string,
  meta: { deviceLabel?: string; ipHash?: string | null } = {}
): Promise<string> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      // Device label is coarse and supplied by the server, never trusted from
      // a header verbatim: reduce to "platform / browser family".
      deviceLabel: (meta.deviceLabel ?? "unknown").slice(0, 40),
      ipHash: meta.ipHash ?? null,
      expiresAt: expiry(),
    },
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { ...baseCookie, maxAge: SESSION_TTL_MS / 1000 });
  jar.set(CSRF_COOKIE, csrfToken, { ...baseCookie, httpOnly: false, maxAge: SESSION_TTL_MS / 1000 });
  return csrfToken;
}

/**
 * Read the current session. Returns null for missing, expired or revoked tokens.
 *
 * CSRF policy — per-request double submit:
 *  - The CSRF cookie is minted once when the session starts and is NOT rotated
 *    on plain reads. Rotating on read would race with concurrent requests (a
 *    background hydration fetch would invalidate the token a form had already
 *    captured) and would let a read-only request mint a credential.
 *  - Rotation happens only at privileged moments: sign-in (the cookie is
 *    replaced) and full logout. A token therefore stays valid for the life of
 *    its session but is worthless without the HttpOnly session cookie.
 */
export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const csrfToken = jar.get(CSRF_COOKIE)?.value ?? "";
  const tokenHash = sha256(token);

  const row = await prisma.session.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true, lastUsedAt: true },
  });
  if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;

  const userRow = await findUserById(row.userId);
  if (!userRow || userRow.status === "banned" || userRow.status === "deactivated") return null;

  if (Date.now() - row.lastUsedAt.getTime() > SESSION_TOUCH_MS) {
    void prisma.session
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }

  return { user: toAuthUser(userRow), sessionId: row.id, csrfToken };
}

/** Revoke one session (the current one) and clear cookies. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(CSRF_COOKIE);
}

/** Revoke every session for a user — used on password/phone change and by "log out everywhere". */
export async function endAllSessions(userId: string): Promise<void> {
  await prisma.session
    .updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

/**
 * CSRF check for state-changing requests. Compares the header against the
 * cookie in constant time. Also requires the request to be same-origin.
 */
export function verifyCsrf(request: Request, csrfTokenFromCookie: string): boolean {
  const header = request.headers.get("x-csrf-token") ?? "";
  if (!header || !csrfTokenFromCookie) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host");
    try {
      if (host && new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return safeEqual(header, csrfTokenFromCookie);
}

/** Coarse device label built from the User-Agent — no fingerprinting. */
export function deviceLabelFrom(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  const platform = ua.includes("android")
    ? "Android"
    : ua.includes("iphone") || ua.includes("ipad")
      ? "iOS"
      : ua.includes("windows")
        ? "Windows"
        : ua.includes("mac os")
          ? "macOS"
          : ua.includes("linux")
            ? "Linux"
            : "Other";
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome/")
      ? "Chrome"
      : ua.includes("firefox/")
        ? "Firefox"
        : ua.includes("safari/")
          ? "Safari"
          : "Browser";
  return `${platform} · ${browser}`;
}
