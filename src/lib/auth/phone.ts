/** Bangladeshi mobile normalisation (docs/01-prd.md AUTH-01 AC1). */

const BD_MOBILE = /^1[3-9]\d{8}$/;

/**
 * Accepts `01712345678`, `8801712345678`, `+8801712345678`, and variants with
 * spaces, dashes or parentheses. Returns E.164 (`+8801712345678`) or null.
 *
 * Normalising before storage means the same number always hashes to the same
 * rate-limit key and the same unique index value.
 */
export function normalizePhone(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // Only digits, a leading +, spaces and the usual separators are allowed;
  // anything else is a typo or an injection attempt.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length > 15) return null;

  if (digits.startsWith("880")) digits = digits.slice(3);
  else if (digits.startsWith("88")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  if (!BD_MOBILE.test(digits)) return null;
  return `+880${digits}`;
}

/** "+8801712345678" -> "017 1234 5678" — used in masked UI, never in storage. */
export function formatPhoneForDisplay(e164: string): string {
  const local = e164.replace("+880", "0");
  if (local.length !== 11) return local;
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
}

/** Last four digits for "we sent a code to the number ending 5678". */
export function phoneHint(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}
