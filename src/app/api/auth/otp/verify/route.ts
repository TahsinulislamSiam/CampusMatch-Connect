import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyOtp } from "@/lib/auth/otp";
import { verifyOtpSchema } from "@/lib/auth/validation";
import { findUserByPhone } from "@/lib/auth/user";
import { startSession, deviceLabelFrom } from "@/lib/auth/session";
import { clientRateKey, audit, auditSecurity } from "@/lib/security/audit";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { fail, fieldErrors, ok, rateLimited, readJson, sameOrigin } from "@/lib/auth/api";
import { SIGNUP_COOKIE, issueAccountChallenge, signupCookieOptions } from "@/lib/auth/challenge";

export const runtime = "nodejs";

/**
 * POST /api/auth/otp/verify
 *
 * Two outcomes, both proven by the same primitive:
 *  - purpose `login`    -> an existing account gets a session;
 *  - purpose `signup`   -> the phone is simply proven; the client may then
 *                          call /api/auth/register with the same number.
 *
 * The challenge itself is consumed on success, so the code cannot be replayed
 * for the other outcome.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("csrf", "Request rejected.", 403);

  const parsed = verifyOtpSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return fail("invalid_input", "Check the code and try again.", 400, { fields: fieldErrors(parsed.error) });
  }

  // A per-client throttle on top of the per-challenge attempt counter, so an
  // attacker cannot rotate challenge ids to get fresh attempt budgets.
  const rate = await consumeRateLimit({
    bucket: "otp_verify_client",
    subject: clientRateKey(request),
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!rate.ok) return rateLimited(rate.retryAfterSeconds);

  const result = await verifyOtp(parsed.data.challengeId, parsed.data.code);
  if (!result.ok) {
    await auditSecurity("auth.otp.verify.failed", { request, after: { reason: result.reason } });
    if (result.reason === "too_many_attempts") {
      return fail("too_many_attempts", "Too many attempts. Request a new code.", 429);
    }
    if (result.reason === "expired") {
      return fail("otp_expired", "That code has expired. Request a new one.", 400);
    }
    // Wrong code, unknown and already-used challenges all read the same.
    return fail("otp_invalid", "That code is not correct.", 400);
  }

  if (result.purpose === "signup") {
    await auditSecurity("auth.otp.verify.signup", { request });

    // Hand this browser a short-lived, HMAC-signed proof tied to the number so
    // /api/auth/register can trust that the SMS step happened.
    const response = ok({ ok: true, purpose: "signup", phoneVerified: true, next: "register" });
    response.cookies.set(SIGNUP_COOKIE, issueAccountChallenge(result.phone), signupCookieOptions());
    return response;
  }

  const user = await findUserByPhone(result.phone);
  if (!user) {
    // The phone was valid for a challenge but the account vanished mid-flight.
    await auditSecurity("auth.otp.verify.no_account", { request });
    return fail("no_account", "Sign in details are no longer valid.", 400);
  }
  if (user.status === "banned" || user.status === "deactivated" || user.status === "suspended") {
    await auditSecurity("auth.login.blocked", { request, targetId: user.id, after: { status: user.status } });
    return fail("generic", "This account is not available. Contact support.", 403);
  }

  const csrf = await startSession(user.id, {
    deviceLabel: deviceLabelFrom(request.headers.get("user-agent")),
    ipHash: clientRateKey(request),
  });

  // A previous proof must not outlive this login.
  const jar = await cookies();
  jar.delete(SIGNUP_COOKIE);

  await audit({
    actorType: "user",
    request,
    actorId: user.id,
    action: "auth.login",
    targetType: "user",
    targetId: user.id,
  });

  return ok({ ok: true, purpose: "login", csrfToken: csrf, redirectTo: "/today" });
}
