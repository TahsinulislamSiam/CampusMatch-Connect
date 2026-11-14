import { prisma } from "@/lib/db";
import { hashClientId } from "@/lib/security/crypto";

/**
 * Append-only audit trail (docs/01-prd.md AUTH-*, docs/03-data-model.md §8).
 *
 * Rules:
 *  - Never write plaintext PII into the log. Targets are opaque IDs; client
 *    addresses are peppered hashes.
 *  - Failures are swallowed: logging must never let a request succeed or fail
 *    differently than the business logic decides.
 */

export type AuditActor = "user" | "admin" | "system";

export type AuditInput = {
  actorType: AuditActor;
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  /** Optional JSON-serialisable summary containing no raw PII. */
  after?: Record<string, unknown>;
  request?: Request;
};

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        after: input.after ? safeJson(input.after) : null,
        ipHash: clientHash(input.request),
      },
    });
  } catch {
    /* best effort */
  }
}

/** Audit entry for an attempt that may not have a user row yet (signup, failed login). */
export async function auditSecurity(
  action: string,
  options: { request?: Request; targetId?: string | null; after?: Record<string, unknown>; actorId?: string | null } = {}
): Promise<void> {
  await audit({
    actorType: options.actorId ? "user" : "system",
    actorId: options.actorId ?? null,
    action,
    targetType: options.targetId ? "user" : undefined,
    targetId: options.targetId ?? null,
    after: options.after,
    request: options.request,
  });
}

/** Peppered hash of the caller's address; `null` when headers are unavailable. */
export function clientHash(request?: Request): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const raw = forwarded || realIp;
  if (!raw) return null;
  return hashClientId(raw);
}

/** Stable per-client key for rate limiting, falls back to a shared bucket. */
export function clientRateKey(request: Request): string {
  return clientHash(request) ?? "shared";
}

function safeJson(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value).slice(0, 4000);
  } catch {
    return "{}";
  }
}
