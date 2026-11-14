import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { otpDigest, randomOtp, safeEqual } from "@/lib/security/crypto";

/**
 * One-time codes (docs/01-prd.md AUTH-01 AC2/AC3).
 *
 *  - 6 digits from a CSPRNG; the plaintext is returned exactly once, to be
 *    placed in the SMS payload, and is never persisted.
 *  - Only an HMAC digest (bound to the challenge id, peppered) is stored.
 *  - 5 minute expiry, max 5 wrong attempts, single use.
 *  - Whether a challenge belongs to an existing account is never revealed by
 *    this module; the API decides what to say.
 */

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type IssuedChallenge = {
  challengeId: string;
  /** Plaintext code — hand to the SMS provider, never log or store. */
  code: string;
  expiresAt: Date;
};

export async function issueOtp(phone: string, purpose: "signup" | "login"): Promise<IssuedChallenge> {
  const code = randomOtp();
  const challengeId = randomTokenId();

  // Any earlier live challenge for this phone/purpose is invalidated so only
  // the most recent code can succeed.
  await prisma.otpChallenge.updateMany({
    where: { phone, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });

  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.otpChallenge.create({
    data: {
      id: challengeId,
      phone,
      codeHash: otpDigest(challengeId, code),
      purpose,
      expiresAt,
    },
  });

  return { challengeId, code, expiresAt };
}

export type VerifyResult =
  | { ok: true; phone: string; purpose: string }
  | { ok: false; reason: "not_found" | "expired" | "consumed" | "too_many_attempts" | "mismatch" };

/** Verify a code. A correct code consumes the challenge atomically. */
export async function verifyOtp(challengeId: string, code: string): Promise<VerifyResult> {
  const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) return { ok: false, reason: "not_found" };
  if (challenge.consumedAt) return { ok: false, reason: "consumed" };
  if (challenge.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const expected = challenge.codeHash;
  const candidate = otpDigest(challengeId, code);

  if (!safeEqual(expected, candidate)) {
    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    const attemptsLeft = OTP_MAX_ATTEMPTS - (challenge.attempts + 1);
    return { ok: false, reason: attemptsLeft <= 0 ? "too_many_attempts" : "mismatch" };
  }

  // Consume first, atomically, so a double-submit cannot be replayed.
  const consumed = await prisma.otpChallenge.updateMany({
    where: { id: challengeId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) return { ok: false, reason: "consumed" };

  return { ok: true, phone: challenge.phone, purpose: challenge.purpose };
}

function randomTokenId(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * SMS delivery is not connected in this build. The API returns a generic
 * success message and, only when DEMO_MODE is on in development, echoes the
 * code so the flow can be tested. In production this function is the single
 * place to plug in an SMS provider.
 */
export async function deliverOtp(phone: string, code: string): Promise<{ delivered: boolean; echo?: string }> {
  const configured = Boolean(process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_KEY);
  if (configured) {
    try {
      const res = await fetch(process.env.SMS_PROVIDER_URL!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.SMS_PROVIDER_KEY}`,
        },
        body: JSON.stringify({ to: phone, message: `CampusMatch code: ${code}. Valid 5 minutes.` }),
        signal: AbortSignal.timeout(5000),
      });
      return { delivered: res.ok };
    } catch {
      return { delivered: false };
    }
  }

  // Demo/test escape hatch. The code is handed back ONLY when DEMO_MODE is on,
  // the runtime sets OTP_ECHO=1, and this is not a production build. Production
  // therefore never returns a code over the wire under any configuration.
  const env = process.env as Record<string, string | undefined>;
  const isDemo = env.DEMO_MODE === "1";
  const notProd = env.NODE_ENV !== "production";
  const wantsEcho = env.OTP_ECHO === "1";
  if (isDemo && notProd && wantsEcho) {
    return { delivered: false, echo: code };
  }
  // No provider and no echo: behave as if delivered. The user is told "if this
  // number is registered, a code is on its way" and the challenge simply expires.
  return { delivered: true };
}
