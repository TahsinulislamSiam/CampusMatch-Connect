import { z } from "zod";
import {
  GENDERS,
  LOOKING_FOR,
  RESERVED_USERNAMES,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  UNIVERSITY_IDS,
} from "@/lib/constants";

/**
 * Registration and sign-in validation.
 *
 * Everything here runs on the server. Client-side checks are a convenience
 * only; a request that skips the browser must still be rejected.
 *
 * Messaging rule: errors describe the *field*, never whether an account exists.
 */

const RESERVED = new Set<string>(RESERVED_USERNAMES);

/** Control characters, zero-width joiners and bidi overrides are stripped. */
function stripInvisible(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const fullNameSchema = z
  .string()
  .transform(stripInvisible)
  .refine((v) => v.length >= 3, "full_name_too_short")
  .refine((v) => v.length <= 80, "full_name_too_long")
  // Letters (Bangla included), spaces, dots, hyphens and apostrophes only.
  .refine((v) => /^[\p{L}][\p{L} .'\u2019-]*$/u.test(v), "full_name_invalid")
  // Reject contact details smuggled into a name field (digits, e-mail, URLs).
  // Stray digits are allowed so "A. R. Rahman 2nd" style names are not blocked,
  // but any direct contact pattern is refused.
  .refine((v) => !/[\d@]/.test(v) && !/https?:|www\./i.test(v), "full_name_invalid");

export const usernameSchema = z
  .string()
  .transform((v) => stripInvisible(v).toLowerCase())
  .refine((v) => v.length >= USERNAME_MIN, "username_too_short")
  .refine((v) => v.length <= USERNAME_MAX, "username_too_long")
  .refine((v) => USERNAME_PATTERN.test(v), "username_invalid")
  .refine((v) => !RESERVED.has(v), "username_reserved");

export const emailSchema = z
  .string()
  .transform((v) => stripInvisible(v).toLowerCase())
  .refine((v) => v.length <= 254, "email_invalid")
  .refine((v) => /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(v), "email_invalid");

export const addressSchema = z
  .string()
  .transform(stripInvisible)
  .refine((v) => v.length >= 4, "address_too_short")
  .refine((v) => v.length <= 200, "address_too_long");

/** Gender is stored as the existing internal vocabulary (`woman` | `man`). */
export const genderValueSchema = z.enum(GENDERS);

export const universityIdSchema = z
  .string()
  .refine((v) => (UNIVERSITY_IDS as readonly string[]).includes(v), "university_invalid");

export const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d <= new Date();
  }, "invalid_date");

export const registerSchema = z.object({
  fullName: fullNameSchema,
  username: usernameSchema,
  phone: z.string().min(6).max(20),
  email: z.union([emailSchema, z.literal("")]).optional(),
  address: addressSchema,
  universityId: universityIdSchema,
  gender: genderValueSchema,
  dob: dobSchema,
  genderPreference: z.enum(LOOKING_FOR).default("everyone"),
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: "terms_required" }) }),
  ageConfirm: z.literal(true, { errorMap: () => ({ message: "age_required" }) }),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Sign-in is phone-first: the number is the account identifier. */
export const requestOtpSchema = z.object({
  phone: z.string().min(6).max(20),
  purpose: z.enum(["signup", "login"]).default("login"),
});

export const verifyOtpSchema = z.object({
  challengeId: z.string().min(8).max(64),
  code: z.string().regex(/^\d{6}$/, "invalid_code"),
});

export const usernameCheckSchema = z.object({ username: usernameSchema });

/** Flatten a Zod error into `{ field: firstMessage }` for the client. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    const name = typeof key === "string" ? key : "form";
    if (!(name in out)) out[name] = issue.message;
  }
  return out;
}
