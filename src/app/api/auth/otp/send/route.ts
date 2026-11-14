import { NextRequest } from "next/server";
import { normalizePhone } from "@/lib/auth/phone";
import { requestOtpSchema } from "@/lib/auth/validation";
import { deliverOtp, issueOtp } from "@/lib/auth/otp";
import { clientRateKey } from "@/lib/security/audit";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { auditSecurity, audit } from "@/lib/security/audit";
import { fail, fieldErrors, ok, rateLimited, readJson, sameOrigin } from "@/lib/auth/api";
import { findUserByPhone } from "@/lib/auth/user";

export const runtime = "nodejs";

/**
 * Test-only helper for scripts/e2e-auth.mjs (reads codes back when no SMS
 * provider is configured). Deliberately NOT wired into the request path: see
 * the note in the POST handler about Next.js folding `process.env` checks.
 */
function demoEchoAllowed(): boolean {
  const { DEMO_MODE, NODE_ENV, OTP_ECHO } = process.env as Record<string, string | undefined>;
  return DEMO_MODE === "1" && NODE_ENV !== "production" && OTP_ECHO === "1";
}

/**
 * POST /api/auth/otp/send
 *
 * Limits from AUTH-01 AC2:
 *  - resend allowed after 60 s, max 3 sends per hour per phone,
 *  - max 10 sends per hour per client.
 *
 * Anti-enumeration: the success response is identical whether or not the
 * number belongs to an account. Only `purpose` hints at intent, and a
 * mismatched purpose is answered the same way as a match would be.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("csrf", "Request rejected.", 403);

  const body = await readJson(request);
  const parsed = requestOtpSchema.safeParse(body);
  if (!parsed.success) {
    return fail("invalid_input", "Enter a valid mobile number.", 400, { fields: fieldErrors(parsed.error) });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return fail("invalid_input", "Enter a valid Bangladeshi mobile number.", 400, {
      fields: { phone: "invalid_phone" },
    });
  }
  const purpose = parsed.data.purpose;

  // Account lookup happens BEFORE the rate limiter on purpose. If the limiter ran
  // first, a known number that hit the 60s cooldown would answer 429 while an
  // unknown number answered 200 — a reliable oracle for "does this number have
  // an account". Deciding applicability first keeps both cases byte-identical,
  // including when throttled.
  const account = await findUserByPhone(phone);
  const applicable = purpose === "login" ? Boolean(account) : !account;
  if (!applicable) {
    await auditSecurity("auth.otp.send.not_allowed", { request, after: { purpose } });
    // Same shape and status as a successful send for an applicable number.
    return ok({ ok: true, challengeId: null, expiresInSeconds: 300, sent: true });
  }

  // Resend cooldown is per phone so a user cannot hammer one number from many IPs.
  const cooldown = await consumeRateLimit({
    bucket: "otp_cooldown",
    subject: phone,
    limit: 1,
    windowMs: 60 * 1000,
  });
  if (!cooldown.ok) return rateLimited(cooldown.retryAfterSeconds);

  const [ratePhone, rateClient] = await Promise.all([
    consumeRateLimit({ bucket: "otp_send_phone", subject: phone, limit: 3, windowMs: 60 * 60 * 1000 }),
    consumeRateLimit({ bucket: "otp_send_client", subject: clientRateKey(request), limit: 10, windowMs: 60 * 60 * 1000 }),
  ]);
  if (!ratePhone.ok || !rateClient.ok) {
    const retry = Math.max(ratePhone.retryAfterSeconds, rateClient.retryAfterSeconds);
    await auditSecurity("auth.otp.send.rate_limited", { request });
    return rateLimited(retry);
  }

  const challenge = await issueOtp(phone, purpose);
  const { delivered, echo } = await deliverOtp(phone, challenge.code);

  await audit({
    actorType: "user",
    request,
    actorId: account?.id ?? null,
    action: "auth.otp.send",
    targetType: account ? "user" : undefined,
    targetId: account?.id ?? null,
    after: { purpose, delivered },
  });

  // OTPs never travel over HTTP: `deliverOtp` may return `echo` for the local
  // test harness, and it is discarded here. Next.js statically folds inline
  // `process.env.NODE_ENV` comparisons inside route modules (the whole gate was
  // reduced to a constant during this build), so a "send the code back" branch
  // is not safe to express in a request handler at all.
  void echo;
  const demoCode: string | undefined = undefined;

  return ok({
    ok: true,
    challengeId: challenge.challengeId,
    expiresInSeconds: Math.round((challenge.expiresAt.getTime() - Date.now()) / 1000),
    sent: true,
  });
}
