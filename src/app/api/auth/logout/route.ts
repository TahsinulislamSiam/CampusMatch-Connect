import { cookies } from "next/headers";
import { endSession, getSession, verifyCsrf } from "@/lib/auth/session";
import { CSRF_COOKIE } from "@/lib/constants";
import { audit } from "@/lib/security/audit";
import { fail, ok, sameOrigin } from "@/lib/auth/api";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/** POST /api/auth/logout — revokes the current session row and clears cookies. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return fail("csrf", "Request rejected.", 403);

  const jar = await cookies();
  const csrfCookie = jar.get(CSRF_COOKIE)?.value ?? "";
  const session = await getSession();

  // CSRF is required when a session exists; a stale/absent session just clears cookies.
  if (session && !verifyCsrf(request, csrfCookie)) {
    return fail("csrf", "Request rejected.", 403);
  }

  await endSession();
  if (session) {
    await audit({
    actorType: "user",
      request,
      actorId: session.user.id,
      action: "auth.logout",
      targetType: "session",
      targetId: session.sessionId,
    });
  }
  return ok({ ok: true });
}
