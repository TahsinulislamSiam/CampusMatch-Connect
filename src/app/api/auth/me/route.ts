import { getSession } from "@/lib/auth/session";
import { fail, ok } from "@/lib/auth/api";
import { REGISTRATION_UNIVERSITIES } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Returns only the signed-in member's own record. Phone, e-mail and address
 * are theirs to see; nothing here is ever sent to another member's client.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return fail("unauthorized", "Not signed in.", 401);

  const { user } = session;
  const university = REGISTRATION_UNIVERSITIES.find((u) => u.id === user.universityId) ?? null;

  return ok({
    ok: true,
    user: {
      publicId: user.publicId,
      username: user.username,
      fullName: user.fullName,
      phone: user.phone,
      phoneLast4: user.phoneLast4,
      email: user.email,
      address: user.address,
      gender: user.gender,
      university: university ? { id: university.id, nameEn: university.nameEn, nameBn: university.nameBn } : null,
      status: user.status,
      verificationLevel: user.verificationLevel,
    },
    csrfToken: session.csrfToken,
  });
}
