import { prisma } from "@/lib/db";
import { encryptField, decryptField, lookupHash } from "@/lib/security/crypto";

/**
 * Accounts.
 *
 * Personal data handling (docs/03-data-model.md §7, class "Restricted"):
 *  - full name, username, e-mail and address are AES-256-GCM encrypted;
 *  - username and e-mail also get an HMAC digest column used for uniqueness
 *    and lookup, so no query ever filters on plaintext;
 *  - the phone number stays in its normalised E.164 form because it is the
 *    login identifier and the schema enforces uniqueness through `phone` +
 *    `phoneLast4`; it is never returned to another member.
 *
 * Nothing in this module returns encrypted columns to a caller; the view type
 * below is the only shape that leaves the server.
 */

export type AuthUser = {
  id: string;
  publicId: string;
  username: string;
  fullName: string;
  phone: string;
  phoneLast4: string;
  email: string | null;
  address: string | null;
  universityId: string | null;
  gender: string;
  status: string;
  verificationLevel: number;
  is18Verified: boolean;
};

type UserRow = Awaited<ReturnType<typeof prisma.user.findFirst>>;

export function toAuthUser(row: NonNullable<UserRow>): AuthUser {
  let fullName = "";
  let email: string | null = null;
  let address: string | null = null;

  // A decrypt failure means tampering or a rotated key. Fail closed: return
  // the record with empty personal fields instead of throwing inside a render.
  try {
    fullName = decryptField(row.fullNameEnc);
  } catch {
    fullName = "";
  }
  if (row.emailEnc) {
    try {
      email = decryptField(row.emailEnc);
    } catch {
      email = null;
    }
  }
  if (row.addressEnc) {
    try {
      address = decryptField(row.addressEnc);
    } catch {
      address = null;
    }
  }

  return {
    id: row.id,
    publicId: row.publicId,
    username: row.username,
    fullName,
    phone: row.phone,
    phoneLast4: row.phoneLast4,
    email,
    address,
    universityId: row.universityId,
    gender: row.gender,
    status: row.status,
    verificationLevel: row.verificationLevel,
    is18Verified: row.is18Verified,
  };
}

export async function findUserByPhone(phone: string) {
  return prisma.user.findFirst({ where: { phone, deletedAt: null } });
}

export async function findUserById(id: string) {
  return prisma.user.findFirst({ where: { id, deletedAt: null } });
}

/** Both digests are checked in one round trip to keep the race window small. */
export async function usernameOrEmailTaken(username: string, email?: string | null) {
  const checks: Promise<unknown>[] = [
    prisma.user.findUnique({ where: { usernameLookup: lookupHash(username) }, select: { id: true } }),
  ];
  if (email) {
    checks.push(prisma.user.findUnique({ where: { emailLookup: lookupHash(email) }, select: { id: true } }));
  }
  const [byUsername, byEmail] = await Promise.all(checks);
  return { username: Boolean(byUsername), email: Boolean(byEmail) };
}

/** 12-char base62-ish public identifier, unique, safe in URLs (docs/03-data-model.md §1). */
function publicId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export type CreateUserInput = {
  fullName: string;
  username: string;
  phone: string;
  email?: string | null;
  address: string;
  universityId: string;
  gender: "woman" | "man";
  genderPreference: "women" | "men" | "everyone";
  dob: Date;
  passwordHash?: string | null;
  termsVersion: string;
};

export async function createUser(input: CreateUserInput) {
  const now = new Date();
  return prisma.user.create({
    data: {
      publicId: publicId(),
      phone: input.phone,
      phoneLast4: input.phone.slice(-4),
      username: input.username,
      usernameLookup: lookupHash(input.username),
      usernameEnc: encryptField(input.username),
      fullNameEnc: encryptField(input.fullName),
      emailEnc: input.email ? encryptField(input.email) : null,
      emailLookup: input.email ? lookupHash(input.email) : null,
      addressEnc: encryptField(input.address),
      passwordHash: input.passwordHash ?? null,
      termsAcceptedAt: now,
      termsVersion: input.termsVersion,
      // Active immediately: the phone was proven by OTP moments before this
      // call. Student verification is a separate, later step.
      status: "active",
      dob: input.dob,
      gender: input.gender,
      genderPreference: input.genderPreference,
      is18Verified: true,
      universityId: input.universityId === "other" ? null : input.universityId,
      lastActiveAt: now,
      preference: { create: {} },
      visibility: { create: {} },
    },
  });
}

/** Minimal, PII-free projection for public surfaces such as comments and cards. */
export const publicUserSelect = {
  id: true,
  publicId: true,
  username: true,
  universityId: true,
  gender: true,
  verificationLevel: true,
} as const;
