import { NextRequest } from "next/server";
import { usernameOrEmailTaken } from "@/lib/auth/user";
import { usernameSchema } from "@/lib/auth/validation";
import { fail, fieldErrors, ok, readJson, sameOrigin } from "@/lib/auth/api";
import { clientRateKey } from "@/lib/security/audit";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/auth/username-check
 *
 * Live availability for the signup form. Deliberately narrow so it cannot be
 * used as a scraping oracle:
 *  - only reports on a single syntactically valid username,
 *  - never echoes back suggestions or e-mail results,
 *  - rate limited per client.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("csrf", "Request rejected.", 403);

  const rate = await consumeRateLimit({
    bucket: "username_check",
    subject: clientRateKey(request),
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rate.ok) return fail("rate_limited", "Too many attempts. Please try again later.", 429);

  const parsed = usernameSchema.safeParse((await readJson(request))?.username);
  if (!parsed.success) {
    return ok({ ok: true, available: false, reason: "username_invalid" });
  }

  const taken = await usernameOrEmailTaken(parsed.data);
  return ok({ ok: true, available: !taken.username });
}
