"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, ShieldCheck, UserRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { REGISTRATION_UNIVERSITIES, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@/lib/constants";
import { useI18n } from "@/components/locale-provider";
import { cn } from "@/lib/utils";

type Mode = "signin" | "create";
type Step = "details" | "otp";

type CreateDraft = {
  fullName: string;
  username: string;
  phone: string;
  email: string;
  address: string;
  universityId: string;
  gender: "woman" | "man";
  genderPreference: "women" | "men" | "everyone";
  lookingForLabel: string;
  dob: string;
};

/** Mirrors the server's normalisation so the client can preview the +880 form. */
function normalizePhonePreview(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("880")) return `+${digits}`;
  if (digits.startsWith("0")) return `+88${digits}`;
  return `+880${digits}`;
}

function validPhonePre(raw: string) {
  return /^\+8801[3-9]\d{8}$/.test(normalizePhonePreview(raw));
}

async function api<T>(path: string, body: unknown, csrfToken?: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: T & { message?: string };
  try {
    data = (await res.json()) as T & { message?: string };
  } catch {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!res.ok) {
    const err = new Error(data.message ?? `HTTP ${res.status}`) as Error & { code?: string; fields?: Record<string, string> };
    (err as { code?: string }).code = (data as { code?: string }).code;
    (err as { fields?: Record<string, string> }).fields = (data as { fields?: Record<string, string> }).fields;
    throw err;
  }
  return data;
}

export function LoginView({ initialMode }: { initialMode: Mode }) {
  const { tr, locale } = useI18n();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("details");

  // Registration fields.
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [universityId, setUniversityId] = useState("");
  const [gender, setGender] = useState<"woman" | "man">("woman");
  const [dob, setDob] = useState("");

  const [agree, setAgree] = useState(false);
  const [ageConfirm, setAgeConfirm] = useState(false);

  // OTP step.
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpPurpose, setOtpPurpose] = useState<"signup" | "login">("login");

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Username debounced availability (client-side courtesy only; server decides).
  const [usernameState, setUsernameState] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  useEffect(() => {
    if (!username || username.length < USERNAME_MIN) {
      setUsernameState("idle");
      return;
    }
    setUsernameState("checking");
    const t = window.setTimeout(async () => {
      try {
        const res = await api<{ available: boolean }>("/api/auth/username-check", { username });
        setUsernameState(res.available ? "available" : "taken");
      } catch {
        setUsernameState("idle");
      }
    }, 450);
    return () => window.clearTimeout(t);
  }, [username]);

  const createEnabled = useMemo(
    () =>
      fullName.trim().length >= 3 &&
      USERNAME_PATTERN.test(username) &&
      validPhonePre(phone) &&
      address.trim().length >= 4 &&
      universityId !== "" &&
      Boolean(dob) &&
      agree &&
      ageConfirm,
    [fullName, username, phone, address, universityId, dob, agree, ageConfirm]
  );

  function resetMode(next: Mode) {
    setMode(next);
    setStep("details");
    setError(null);
    setFieldErrors({});
    setCode("");
    setChallengeId(null);
    setDemoCode("");
    setPhoneVerified(false);
  }

  const clientErrors = useCallback((): Record<string, string> | null => {
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 3) errs.fullName = tr("auth.required");
    if (!USERNAME_PATTERN.test(username)) errs.username = tr("auth.invalidUsername");
    if (!validPhonePre(phone)) errs.phone = tr("auth.invalidPhone");
    if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) errs.email = tr("auth.invalidEmail");
    if (address.trim().length < 4) errs.address = tr("auth.required");
    if (!universityId) errs.universityId = tr("auth.required");
    if (!dob) errs.dob = tr("auth.required");
    else {
      const d = new Date(`${dob}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d > new Date()) errs.dob = tr("auth.invalidDob");
      else {
        const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
        if (age < 18) errs.dob = tr("auth.under18");
      }
    }
    return Object.keys(errs).length ? errs : null;
  }, [fullName, username, phone, email, address, universityId, dob, tr]);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const purpose: "signup" | "login" = mode === "create" ? "signup" : "login";
    if (mode === "create") {
      const errs = clientErrors();
      if (errs) {
        setFieldErrors(errs);
        return;
      }
      if (!agree || !ageConfirm) {
        setFieldErrors({ terms: tr("auth.termsRequired") });
        return;
      }
      if (phoneVerified) {
        // Already proven: straight to registration.
        await doRegister();
        return;
      }
    } else {
      if (!validPhonePre(phone)) {
        setFieldErrors({ phone: tr("auth.invalidPhone") });
        return;
      }
    }

    setOtpPurpose(purpose);
    setBusy(true);
    try {
      const res = await api<{ challengeId: string | null; demoCode?: string; expiresInSeconds?: number }>(
        "/api/auth/otp/send",
        { phone, purpose }
      );
      if (res.challengeId) {
        setChallengeId(res.challengeId);
        setDemoCode(res.demoCode ?? "");
        setCode("");
        setStep("otp");
        setResendIn(30);
      } else {
        // Completely safe: the same message is returned whether the number is
        // new or already registered.
        setError(tr("auth.genericSent"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function doRegister() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        phone: normalizePhonePreview(phone),
        email: email.trim(),
        address: address.trim(),
        universityId,
        gender,
        genderPreference: "everyone",
        dob,
        acceptedTerms: agree,
        ageConfirm,
      };
      const res = await api<{ session?: { csrfToken?: string }; redirectTo?: string }>("/api/auth/register", payload);
      router.push(res.redirectTo ?? "/onboarding");
    } catch (err) {
      const e = err as Error & { fields?: Record<string, string> };
      if (e.fields) setFieldErrors(e.fields);
      setError(e.message ?? tr("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!challengeId || code.length !== 6) {
      setFieldErrors({ code: tr("auth.otpInvalid") });
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        ok: boolean;
        purpose?: string;
        csrfToken?: string;
        redirectTo?: string;
      }>("/api/auth/otp/verify", { challengeId, code });

      if (res.purpose === "signup") {
        setPhoneVerified(true);
        setStep("details");
        setError(null);
        // The signup proof cookie is now set; the next submit registers.
        return;
      }
      router.push("/today");
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  const inputClass = (hasError: boolean) =>
    cn(
      "input",
      hasError && "border-rose focus:border-rose focus:ring-rose/20"
    );

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => router.push("/")}
              className="btn-ghost btn-sm"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === "bn" ? "হোম" : "Home"}
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 md:py-14 lg:grid-cols-[0.9fr_1fr] lg:items-start lg:gap-12 lg:px-8">
        <aside className="hidden overflow-hidden rounded-[2rem] bg-forest p-8 text-cream lg:sticky lg:top-8 lg:block">
          <p className="inline-flex items-center gap-2 rounded-full border border-cream/20 bg-cream/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
            <ShieldCheck className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
            {locale === "bn" ? "ট্রাস্ট-ফার্স্ট ম্যাচমেকিং" : "Trust-first matchmaking"}
          </p>
          <blockquote className="mt-6 font-display text-3xl leading-snug text-cream">
            {locale === "bn"
              ? "\"ভালো সম্পর্ক শুরু হয় নিরাপত্তা আর স্পষ্ট intention দিয়ে।\""
              : "\"Good relationships start with safety and clear intention.\""}
          </blockquote>
          <p className="mt-3 text-[13px] leading-relaxed text-cream/70">
            {locale === "bn"
              ? "প্রতিটি প্রোফাইল একজন প্রকৃত শিক্ষার্থীর। প্রতিটি চ্যাট দুজনের সম্মতিতে।"
              : "Every profile belongs to a real student. Every chat needs both people to agree."}
          </p>

          <ul className="mt-8 space-y-3 text-[13px]">
            {[
              locale === "bn" ? "স্টুডেন্ট আইডি ও সেলফি যাচাই" : "Student ID and selfie review",
              locale === "bn" ? "ম্যাচ না হলে ছবি ব্লার" : "Photos blurred until you match",
              locale === "bn" ? "ফোন নম্বর কখনো শেয়ার হয় না" : "Phone numbers are never shared",
              locale === "bn" ? "২৪ ঘণ্টায় রিপোর্ট যাচাই" : "Reports triaged within 24 hours",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2 text-cream/85">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-8 flex items-start gap-2 rounded-2xl bg-cream/10 p-3 text-[11px] leading-relaxed text-cream/60">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
            {locale === "bn"
              ? "আপনার ব্যক্তিগত তথ্য এনক্রিপ্ট করে সংরক্ষণ করা হয় এবং অন্য সদস্যদের কাছে কখনো প্রকাশ করা হয় না।"
              : "Your personal details are encrypted at rest and never shown to other members."}
          </p>
        </aside>

        <section aria-labelledby="auth-title" className="min-w-0">
          <div className="card p-5 sm:p-7">
            <div className="flex rounded-full border border-line bg-parchment/60 p-1 text-[13px] font-semibold">
              <button
                type="button"
                onClick={() => resetMode("signin")}
                aria-pressed={mode === "signin"}
                className={cn(
                  "flex-1 rounded-full px-4 py-2 transition",
                  mode === "signin" ? "bg-white text-forest shadow-soft" : "text-muted hover:text-forest"
                )}
              >
                {tr("landing.signIn")}
              </button>
              <button
                type="button"
                onClick={() => resetMode("create")}
                aria-pressed={mode === "create"}
                className={cn(
                  "flex-1 rounded-full px-4 py-2 transition",
                  mode === "create" ? "bg-white text-forest shadow-soft" : "text-muted hover:text-forest"
                )}
              >
                {tr("landing.join")}
              </button>
            </div>

            <div className="mt-6 flex items-start justify-between gap-3">
              <div>
                <h1 id="auth-title" className="text-2xl text-forest">
                  {step === "otp"
                    ? tr("auth.code")
                    : mode === "signin"
                      ? tr("auth.welcomeBack")
                      : tr("auth.createTitle")}
                </h1>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                  {step === "otp"
                    ? tr("auth.codeSent", { phone: "+88" + phone.replace(/\D/g, "").replace(/^0?/, "") })
                    : mode === "signin"
                      ? tr("auth.signInSubtitle")
                      : tr("auth.createSubtitle")}
                </p>
              </div>
              {phoneVerified && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mint px-2.5 py-1 text-[11px] font-semibold text-forest">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {tr("auth.verifiedNumber")}
                </span>
              )}
            </div>

            {step === "details" ? (
              <>
                {mode === "create" && (
                  <div className="mt-5 rounded-2xl border border-leaf/30 bg-mint/20 px-3 py-2.5 text-[12px] leading-relaxed text-forest/90">
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      <Lock className="h-3.5 w-3.5 text-leaf" aria-hidden="true" />
                      {tr("auth.secureNote")}
                    </span>
                  </div>
                )}

                <form
                  className="mt-5 space-y-4"
                  onSubmit={mode === "create" ? handleSendCode : handleSendCode}
                >
                  {mode === "create" ? (
                    <>
                      <RegistrationFields
                        {...{
                          fullName, setFullName,
                          username, setUsername,
                          phone, setPhone,
                          email, setEmail,
                          address, setAddress,
                          universityId, setUniversityId,
                          gender, setGender,
                          dob, setDob,
                          usernameState,
                          fieldErrors,
                          tr, locale,
                          inputClass,
                          validating: false,
                        }}
                      />
                      <div className="space-y-2 rounded-2xl border border-line bg-parchment/40 p-3">
                        <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink/80">
                          <input
                            type="checkbox"
                            checked={ageConfirm}
                            onChange={(e) => setAgeConfirm(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-line text-forest focus:ring-leaf"
                          />
                          {tr("auth.ageConfirm")}
                        </label>
                        <label className="flex items-start gap-2 text-[12px] leading-relaxed text-ink/80">
                          <input
                            type="checkbox"
                            checked={agree}
                            onChange={(e) => setAgree(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-line text-forest focus:ring-leaf"
                          />
                          {tr("auth.terms")}
                        </label>
                      </div>
                      {error && (
                        <p role="alert" className="rounded-xl bg-rose/10 px-3 py-2 text-[12px] font-medium text-rose">
                          {error}
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={busy || !createEnabled}
                        className="btn-primary w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {phoneVerified ? tr("auth.creating") : tr("auth.sendCode")}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="phone" className="label">
                          {tr("auth.phone")}
                        </label>
                        <div className="flex items-stretch gap-2">
                          <span className="inline-flex items-center rounded-2xl border border-line bg-parchment px-3 text-[13px] font-semibold text-forest">
                            +880
                          </span>
                          <input
                            id="phone"
                            name="phone"
                            type="tel"
                            inputMode="numeric"
                            autoComplete="tel-national"
                            placeholder="1712 345678"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className={inputClass(Boolean(fieldErrors.phone))}
                            aria-describedby="phone-hint"
                            required
                          />
                        </div>
                        <p id="phone-hint" className="hint">
                          {tr("auth.phoneHint")}
                        </p>
                        {fieldErrors.phone && (
                          <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.phone}</p>
                        )}
                      </div>

                      {error && (
                        <p role="alert" className="rounded-xl bg-rose/10 px-3 py-2 text-[12px] font-medium text-rose">
                          {error}
                        </p>
                      )}

                      <button type="submit" disabled={busy} className="btn-primary w-full py-3 disabled:opacity-60">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                        {tr("auth.sendCode")}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </form>
              </>
            ) : (
              <form
                className="mt-5 space-y-4"
                onSubmit={handleVerify}
              >
                {demoCode && (
                  <div className="rounded-2xl border border-gold/30 bg-gold/10 px-3 py-3 text-[12px] leading-relaxed text-forest/90">
                    <p className="font-semibold">{tr("auth.demoCode", { code: demoCode })}</p>
                    <p className="mt-1 text-muted">{tr("auth.demoHint")}</p>
                  </div>
                )}

                <div>
                  <label htmlFor="code" className="label">
                    {tr("auth.code")}
                  </label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className={cn("input text-center font-mono text-2xl tracking-[0.45em]", fieldErrors.code && "border-rose")}
                    placeholder="••••••"
                    aria-describedby="code-hint"
                    autoFocus
                  />
                  <p id="code-hint" className="hint">
                    {locale === "bn" ? "৬ সংখ্যার কোডটি লিখুন।" : "Enter the 6-digit code."}
                  </p>
                  {fieldErrors.code && (
                    <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.code}</p>
                  )}
                </div>

                {error && (
                  <p role="alert" className="rounded-xl bg-rose/10 px-3 py-2 text-[12px] font-medium text-rose">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="btn-primary w-full py-3 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {tr("auth.verify")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="flex items-center justify-between gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("details");
                      setError(null);
                    }}
                    className="inline-flex items-center gap-1 font-medium text-muted hover:text-forest"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    {locale === "bn" ? "নম্বর বদলান" : "Change number"}
                  </button>
                  <button
                    type="button"
                    disabled={resendIn > 0 || busy}
                    onClick={handleSendCode}
                    className="font-medium text-forest disabled:text-muted"
                  >
                    {resendIn > 0 ? tr("auth.resendIn", { n: resendIn }) : tr("auth.resend")}
                  </button>
                </div>
              </form>
            )}
          </div>

          {mode === "signin" && (
            <div className="mt-5 rounded-3xl border border-line bg-white/70 p-4">
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                <UserRound className="h-4 w-4 text-leaf" aria-hidden="true" />
                {locale === "bn" ? "পদক্ষেপ" : "To sign in"}
              </p>
              <ol className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted">
                <li>1. {locale === "bn" ? "আপনার ফোন নম্বর দিন" : "Enter your phone number"}</li>
                <li>2. {locale === "bn" ? "SMS-এ পাঠানো কোডটি লিখুন" : "Enter the code sent by SMS"}</li>
                <li>3. {locale === "bn" ? "যাচাই হয়ে সাইন ইন করুন" : "Verify and you're in"}</li>
              </ol>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function RegistrationFields(props: {
  fullName: string; setFullName: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  universityId: string; setUniversityId: (v: string) => void;
  gender: "woman" | "man"; setGender: (v: "woman" | "man") => void;
  dob: string; setDob: (v: string) => void;
  usernameState: "idle" | "checking" | "available" | "taken" | "invalid";
  fieldErrors: Record<string, string>;
  tr: (k: Parameters<typeof import("@/lib/i18n").t>[1], v?: Record<string, string | number>) => string;
  locale: "en" | "bn";
  inputClass: (hasError: boolean) => string;
  validating: boolean;
}) {
  const {
    fullName, setFullName,
    username, setUsername,
    phone, setPhone,
    email, setEmail,
    address, setAddress,
    universityId, setUniversityId,
    gender, setGender,
    dob, setDob,
    usernameState,
    fieldErrors,
    tr, locale, inputClass,
  } = props;

  return (
    <>
      <div>
        <label htmlFor="fullName" className="label">
          {tr("auth.fullName")} <span className="text-rose">*</span>
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputClass(Boolean(fieldErrors.fullName))}
          aria-describedby="fullName-hint"
          required
        />
        <p id="fullName-hint" className="hint">{tr("auth.fullNameHint")}</p>
        {fieldErrors.fullName && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.fullName}</p>}
      </div>

      <div>
        <label htmlFor="username" className="label">
          {tr("auth.username")} <span className="text-rose">*</span>
        </label>
        <div className="flex items-stretch gap-2">
          <span className="inline-flex items-center rounded-2xl border border-line bg-parchment px-3 text-[13px] font-semibold text-forest">@</span>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={USERNAME_MAX}
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
            className={inputClass(Boolean(fieldErrors.username))}
            aria-describedby="username-hint"
            required
          />
          {usernameState === "checking" && <Loader2 className="my-auto h-4 w-4 animate-spin text-muted" />}
          {usernameState === "available" && !fieldErrors.username && (
            <Check className="my-auto h-4 w-4 text-leaf" aria-hidden="true" />
          )}
        </div>
        <p id="username-hint" className="hint">{tr("auth.usernameHint")}</p>
        {fieldErrors.username ? (
          <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.username}</p>
        ) : usernameState === "available" ? (
          <p className="mt-1 text-[11px] font-medium text-leaf">{tr("auth.usernameAvailable", { name: username })}</p>
        ) : usernameState === "taken" ? (
          <p className="mt-1 text-[11px] font-medium text-rose">{tr("auth.usernameTaken")}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="phone" className="label">
          {tr("auth.phone")} <span className="text-rose">*</span>
        </label>
        <div className="flex items-stretch gap-2">
          <span className="inline-flex items-center rounded-2xl border border-line bg-parchment px-3 text-[13px] font-semibold text-forest">+880</span>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="1712 345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass(Boolean(fieldErrors.phone))}
            aria-describedby="phone-hint"
            required
          />
        </div>
        <p id="phone-hint" className="hint">{tr("auth.phoneHint")}</p>
        {fieldErrors.phone && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.phone}</p>}
      </div>

      <div>
        <label htmlFor="email" className="label">
          {tr("auth.email")} <span className="font-normal text-muted">({tr("auth.optional")})</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass(Boolean(fieldErrors.email))}
          aria-describedby="email-hint"
        />
        <p id="email-hint" className="hint">{tr("auth.emailHint")}</p>
        {fieldErrors.email && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.email}</p>}
      </div>

      <div>
        <label htmlFor="address" className="label">
          {tr("auth.address")} <span className="text-rose">*</span>
        </label>
        <input
          id="address"
          name="address"
          type="text"
          autoComplete="street-address"
          maxLength={200}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={inputClass(Boolean(fieldErrors.address))}
          aria-describedby="address-hint"
          required
        />
        <p id="address-hint" className="hint">{tr("auth.addressHint")}</p>
        {fieldErrors.address && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.address}</p>}
      </div>

      <div>
        <label htmlFor="universityId" className="label">
          {tr("auth.university")} <span className="text-rose">*</span>
        </label>
        <select
          id="universityId"
          name="universityId"
          value={universityId}
          onChange={(e) => setUniversityId(e.target.value)}
          className={cn("input", fieldErrors.universityId && "border-rose")}
          aria-describedby="university-hint"
          required
        >
          <option value="">{locale === "bn" ? "বিশ্ববিদ্যালয় বেছে নিন…" : "Select your university…"}</option>
          {REGISTRATION_UNIVERSITIES.map((u) => (
            <option key={u.id} value={u.id}>
              {locale === "bn" ? u.nameBn : u.nameEn}
            </option>
          ))}
        </select>
        <p id="university-hint" className="hint">{tr("auth.universityHint")}</p>
        {fieldErrors.universityId && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.universityId}</p>}
      </div>

      <div>
        <fieldset>
          <legend className="label">{tr("auth.gender")} <span className="text-rose">*</span></legend>
          <div className="grid grid-cols-2 gap-2">
            {(["woman", "man"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                aria-pressed={gender === g}
                className={cn(
                  "rounded-2xl border px-3 py-2.5 text-sm font-medium transition",
                  gender === g ? "border-forest bg-mint text-forest" : "border-line bg-white text-muted hover:border-forest/30"
                )}
              >
                {g === "woman" ? tr("auth.woman") : tr("auth.man")}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <label htmlFor="dob" className="label">
          {tr("auth.dob")} <span className="text-rose">*</span>
        </label>
        <input
          id="dob"
          name="dob"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          max={new Date().toISOString().slice(0, 10)}
          className={inputClass(Boolean(fieldErrors.dob))}
          aria-describedby="dob-hint"
          required
        />
        <p id="dob-hint" className="hint">{tr("auth.dobHint")}</p>
        {fieldErrors.dob && <p className="mt-1 text-[11px] font-medium text-rose">{fieldErrors.dob}</p>}
      </div>
    </>
  );
}