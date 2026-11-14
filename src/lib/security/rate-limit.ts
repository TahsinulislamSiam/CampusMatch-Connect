import { prisma } from "@/lib/db";
import { secretsConfigured } from "@/lib/security/crypto";
import { audit, auditSecurity } from "@/lib/security/audit";

/**
 * Small fixed-window rate limiter backed by the existing SQLite database.
 *
 * Why not in-memory: a Next.js deployment can run several instances, and an
 * in-memory counter makes brute-force limits trivially bypassable by hitting a
 * second instance. Why not Redis: this build has no external services.
 *
 * The `RateLimit` model is intentionally tiny (key, window, count). Keys are
 * hashed by the caller so phone numbers and IPs are never written verbatim.
 */

export type RateLimitRule = {
  /** Bucket name, e.g. `otp_send_phone`. */
  bucket: string;
  /** Hashed subject (phone digest, IP digest, …). */
  subject: string;
  /** Max allowed hits per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function windowStart(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs;
}

export async function consumeRateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
  if (!secretsConfigured()) {
    // Fail closed: without secrets we cannot hash subjects safely, so the
    // protection would be fake. Callers translate this into a generic error.
    return { ok: false, remaining: 0, retryAfterSeconds: 60 };
  }

  const now = Date.now();
  const windowMs = rule.windowMs;
  const start = windowStart(now, windowMs);
  const key = `${rule.bucket}:${rule.subject}:${windowMs}:${start}`;
  const expiresAt = new Date(start + windowMs);

  try {
    // Upsert-then-read keeps the counter monotonic even with concurrent requests.
    await prisma.rateLimit.upsert({
      where: { key },
      create: { key, bucket: rule.bucket, count: 1, expiresAt },
      update: { count: { increment: 1 } },
    });
    const row = await prisma.rateLimit.findUnique({ where: { key }, select: { count: true } });
    const count = row?.count ?? 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
    return {
      ok: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds,
    };
  } catch {
    return { ok: false, remaining: 0, retryAfterSeconds: 60 };
  }
}

/** Best-effort cleanup, called opportunistically from auth routes. */
export async function pruneExpiredRateLimits(now = new Date()): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  } catch {
    /* never let housekeeping break a request */
  }
}

export { audit, auditSecurity };
