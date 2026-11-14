import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/auth/phone";
import { usernameOrEmailTaken, createUser, findUserByPhone } from "@/lib/auth/user";
import { startSession } from "@/lib/auth/session";
import { registerSchema } from "@/lib/auth/validation";
import { clientRateKey, audit, auditSecurity, clientHash } from "@/lib/security/audit";
import { consumeRateLimit, pruneExpiredRateLimits } from "@/lib/security/rate-limit";
import { ok, fail, fieldErrors, readJson, sameOrigin } from "@/lib/auth/api";
import { REGISTRATION_UNIVERSITIES, TERMS_VERSION } from "@/lib/constants";
import {
  getAccountChallenge,
  consumeAccountChallenge,
  SIGNUP_COOKIE,
  expiredSignupCookieOptions,
} from "@/lib/auth/challenge";

export const runtime = "nodejs";

/**
 * POST /api/auth/register
 *
 * Completes signup: the phone in the request must have an OTP challenge that
 * was just verified (`scope: register`), otherwise this endpoint refuses. The
 * challenge scope is set by /api/auth/otp/verify and consumed here, so a code
 * proven for login cannot be reused to register, and a verified code can only
 * be spent once.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("csrf", "Request rejected.", 403);

  // Housekeeping is cheap and this is the least used of the auth routes.
  await pruneExpiredRateLimits();

  const parsed = registerSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    await auditSecurity("auth.register.invalid", { request, after: { errors: Object.keys(parsed.error.flatten().fieldErrors) } });
    return fail("invalid_input", "Please check your details and try again.", 400, {
      fields: fieldErrors(parsed.error),
    });
  }
  const input = parsed.data;

  const phone = normalizePhone(input.phone);
  if (!phone) {
    return fail("invalid_input", "Please enter a valid Bangladeshi number.", 400, { fields: { phone: "invalid_phone" } });
  }

  // One account per number.
  const existing = await findUserByPhone(phone);
  if (existing) {
    await auditSecurity("auth.register.existing", { request });
    return fail("no_account", "An account already exists for this number. Please sign in.", 409, {
      fields: { phone: "phone_taken" },
    });
  }

  // Rate limit by hashed phone AND by client, so a number cannot be probed
  // rapidly and a single device cannot spray across many numbers.
  const [ratePhone, rateClient] = await Promise.all([
    consumeRateLimit({ bucket: "register_phone", subject: phone, limit: 5, windowMs: 60 * 60 * 1000 }),
    consumeRateLimit({ bucket: "register_client", subject: clientRateKey(request), limit: 10, windowMs: 60 * 60 * 1000 }),
  ]);
  if (!ratePhone.ok || !rateClient.ok) {
    const retry = Math.max(ratePhone.retryAfterSeconds, rateClient.retryAfterSeconds);
    await auditSecurity("auth.register.rate_limited", { request });
    return fail("rate_limited", "Too many attempts. Please try again later.", 429, { retryAfterSeconds: retry });
  }

  // Username and e-mail uniqueness against HMAC digests (plaintext never indexed).
  const taken = await usernameOrEmailTaken(input.username, input.email || null);
  if (taken.username) {
    return fail("invalid_input", "That username is already taken.", 409, { fields: { username: "username_taken" } });
  }
  if (taken.email) {
    return fail("invalid_input", "That e-mail is already in use.", 409, { fields: { email: "email_taken" } });
  }

  // A tamper-proof cookie records that *this browser* proved *this* number by
  // OTP a few minutes ago. It is HMAC-signed with SESSION_SECRET, so it cannot
  // be forged, and a walk-up attacker at the signup page is forced through the
  // SMS step. It is consumed here and deleted so it cannot be replayed.
  const proof = getAccountChallenge(request, phone);
  if (!proof) {
    await auditSecurity("auth.register.unverified", { request });
    return fail("otp_invalid", "Verify your mobile number first.", 400, { fields: { phone: "phone_unverified" } });
  }
  consumeAccountChallenge(request, phone);

  // The university is a foreign key and reference data is curated, but a fresh
  // database may not have been seeded yet. Ensure the row exists rather than
  // failing the signup with an opaque foreign-key error.
  const university = REGISTRATION_UNIVERSITIES.find((u) => u.id === input.universityId);
  if (!university) {
    return fail("invalid_input", "Choose a supported university.", 400, {
      fields: { universityId: "university_invalid" },
    });
  }
  if (university.id !== "other") {
    try {
      await prisma.university.upsert({
        where: { id: university.id },
        update: {},
        create: {
          id: university.id,
          slug: university.id,
          nameEn: university.nameEn,
          nameBn: university.nameBn,
          city: university.city,
        },
      });
    } catch (error) {
      console.error("university upsert failed", error);
    }
  }

  try {
    const user = await createUser({
      fullName: input.fullName,
      username: input.username,
      phone,
      email: input.email || null,
      address: input.address,
      universityId: input.universityId,
      gender: input.gender,
      genderPreference: input.genderPreference,
      dob: new Date(`${input.dob}T00:00:00Z`),
      termsVersion: TERMS_VERSION,
      passwordHash: null,
    });

    await audit({
    actorType: "user",
      request,
      actorId: user.id,
      action: "auth.register",
      targetType: "user",
      targetId: user.id,
      after: { username: input.username, universityId: input.universityId },
    });

    const csrf = await startSession(user.id, { ipHash: clientHash(request) });
    const response = ok({ ok: true, session: { csrfToken: csrf }, redirectTo: "/onboarding" }, 201);
    // One proof, one account: the cookie is expired on the same response.
    response.cookies.set(SIGNUP_COOKIE, "", expiredSignupCookieOptions());
    return response;
  } catch (error) {
    console.error("register failed", error);
    await auditSecurity("auth.register.error", { request });
    return fail("generic", "Something went wrong. Please try again.", 500);
  }
}
