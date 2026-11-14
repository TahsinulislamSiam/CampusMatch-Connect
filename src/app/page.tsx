import Link from "next/link";
import { cookies } from "next/headers";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileSearch,
  GraduationCap,
  HeartHandshake,
  Lock,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Portrait } from "@/components/portrait";
import { IntentChip, ScoreRing } from "@/components/badge";
import { DEFAULT_LOCALE, LOCALE_COOKIE, pick, t, type Locale } from "@/lib/i18n";
import { PEOPLE, UNIVERSITIES, personById, universityLabel } from "@/lib/mock-data";

export default async function LandingPage() {
  const jar = await cookies();
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const locale: Locale = cookieLocale === "en" || cookieLocale === "bn" ? cookieLocale : DEFAULT_LOCALE;
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);

  const hero = personById("w1")!;
  const side1 = personById("m5")!;
  const side2 = personById("w4")!;
  const verifiedCount = PEOPLE.filter((p) => p.verificationLevel >= 2).length;

  return (
    <div className="min-h-dvh overflow-x-hidden bg-cream">
      <header className="border-b border-line/70 bg-cream/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav className="ml-6 hidden items-center gap-6 text-[13px] font-medium text-muted lg:flex" aria-label="Landing">
            <a href="#how" className="transition hover:text-forest">
              {tr("landing.navHow")}
            </a>
            <a href="#safety" className="transition hover:text-forest">
              {tr("landing.navSafety")}
            </a>
            <a href="#campuses" className="transition hover:text-forest">
              {tr("landing.navCampuses")}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <Link href="/login" className="btn-ghost btn-sm hidden sm:inline-flex">
              {tr("landing.signIn")}
            </Link>
            <Link href="/login?mode=create" className="btn-primary btn-sm">
              {tr("landing.join")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="surface-gradient relative overflow-hidden">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8">
            <div className="animate-fade-up">
              <p className="inline-flex items-center gap-2 rounded-full border border-forest/15 bg-white/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-forest">
                <ShieldCheck className="h-3.5 w-3.5 text-leaf" aria-hidden="true" />
                {tr("landing.badge")}
              </p>

              <h1 className="mt-5 text-balance font-display text-[2.45rem] leading-[1.06] text-forest sm:text-5xl lg:text-[3.6rem]">
                {tr("landing.heroTitle")}
              </h1>

              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base">
                {tr("landing.heroSubtitle")}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href="/login?mode=create" className="btn-primary px-6 py-3 text-[15px]">
                  {tr("landing.ctaPrimary")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a href="#how" className="btn-secondary px-5 py-3 text-[15px]">
                  {tr("landing.ctaSecondary")}
                </a>
              </div>

              <ul className="mt-7 grid gap-2 text-[13px] text-forest/85 sm:grid-cols-3">
                {[tr("landing.trustVerification"), tr("landing.trustPrivacy"), tr("landing.trustConsent")].map(
                  (item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-leaf" aria-hidden="true" />
                      {item}
                    </li>
                  )
                )}
              </ul>

              <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-line/80 pt-5">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {tr("landing.statVerified")}
                  </dt>
                  <dd className="stat mt-1 text-2xl">
                    {verifiedCount}
                    <span className="text-base text-leaf">+</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {tr("landing.statCampuses")}
                  </dt>
                  <dd className="stat mt-1 text-2xl">{UNIVERSITIES.length}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {tr("landing.statResponse")}
                  </dt>
                  <dd className="stat mt-1 text-2xl">
                    &lt;24<span className="text-base text-leaf">h</span>
                  </dd>
                </div>
              </dl>

              <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-parchment/80 px-3 py-1.5 text-[11px] font-medium text-muted">
                <FileSearch className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                {tr("landing.demoNote")}
              </p>
            </div>

            {/* Collage */}
            <div className="relative mx-auto w-full max-w-md lg:max-w-none">
              <div className="relative z-10 ml-auto mr-auto w-[88%] rotate-[1.5deg] rounded-[2rem] border border-line bg-white p-3 shadow-lift sm:w-[80%]">
                <div className="relative">
                  <Portrait
                    name={hero.name}
                    seed={hero.photoSeed}
                    className="aspect-[4/4.6] w-full"
                    blurred
                    watermark="CampusMatch · w1"
                    showLock
                    lockLabel={locale === "bn" ? "ম্যাচ হলে ছবি খুলবে" : "Unlocks after a mutual match"}
                  />
                  <div className="absolute right-3 top-3 rounded-full bg-white/95 p-0.5 shadow-soft">
                    <ScoreRing score={94} />
                  </div>
                </div>
                <div className="flex items-end justify-between gap-3 px-1.5 pb-1 pt-3">
                  <div>
                    <p className="font-display text-lg font-semibold text-forest">
                      {hero.name}, {hero.age}
                    </p>
                    <p className="text-[12px] text-muted">
                      {universityLabel(hero.universityId, locale)} · {hero.year}
                      {locale === "bn" ? " বর্ষ" : "th year"}
                    </p>
                  </div>
                  <IntentChip intent={hero.intent} locale={locale} />
                </div>
              </div>

              <div className="absolute -left-1 top-10 z-20 hidden w-40 -rotate-[7deg] rounded-3xl border border-line bg-white p-2 shadow-soft sm:block lg:-left-6">
                <Portrait name={side1.name} seed={side1.photoSeed} className="aspect-[4/4.4] w-full" blurred rounded="rounded-2xl" />
                <p className="px-1 pt-2 font-display text-sm font-semibold text-forest">{side1.name}</p>
                <p className="px-1 pb-1 text-[10px] text-muted">BUET · CSE</p>
              </div>

              <div className="absolute -right-1 bottom-10 z-20 hidden w-36 rotate-[5deg] rounded-3xl border border-line bg-white p-2 shadow-soft sm:block lg:-right-5">
                <Portrait name={side2.name} seed={side2.photoSeed} className="aspect-[4/4.2] w-full" blurred rounded="rounded-2xl" />
                <p className="px-1 pt-2 font-display text-sm font-semibold text-forest">{side2.name}</p>
                <p className="px-1 pb-1 text-[10px] text-muted">BRAC · Architecture</p>
              </div>

              <div className="absolute -bottom-4 left-2 z-30 hidden w-56 rounded-2xl border border-line bg-cream/95 p-3 shadow-soft sm:block lg:left-0">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                  {locale === "bn" ? "কেন মিলছে" : "Why you match"}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-forest/85">
                  {locale === "bn"
                    ? "একই ক্যাম্পাস, তিনটি মিলিত আগ্রহ, এবং বিয়ের পর ঢাকাতেই থাকার পরিকল্পনা।"
                    : "Same campus, three shared interests, and you both plan to build a life in Dhaka."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20 border-t border-line/60 bg-cream">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                {locale === "bn" ? "তিন ধাপ" : "Three steps"}
              </p>
              <h2 className="mt-2 text-3xl text-forest sm:text-4xl">{tr("landing.howTitle")}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{tr("landing.howSubtitle")}</p>
            </div>

            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                { n: "01", title: tr("landing.how1Title"), body: tr("landing.how1Body"), icon: BadgeCheck },
                { n: "02", title: tr("landing.how2Title"), body: tr("landing.how2Body"), icon: HeartHandshake },
                { n: "03", title: tr("landing.how3Title"), body: tr("landing.how3Body"), icon: Lock },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.n} className="card relative p-6">
                    <span className="font-display text-4xl text-line">{step.n}</span>
                    <span className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-2xl bg-mint text-forest">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-xl text-forest">{step.title}</h3>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted">{step.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        {/* Safety */}
        <section id="safety" className="scroll-mt-20 bg-forest text-cream">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:px-8">
            <div>
              <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {locale === "bn" ? "নিরাপত্তা" : "Safety"}
              </p>
              <h2 className="mt-3 text-3xl text-cream sm:text-4xl">{tr("landing.safetyTitle")}</h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-cream/75">{tr("landing.safetyBody")}</p>

              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  tr("landing.safetyPoint1"),
                  tr("landing.safetyPoint2"),
                  tr("landing.safetyPoint3"),
                  tr("landing.safetyPoint4"),
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 rounded-2xl border border-cream/15 bg-cream/5 p-3 text-[13px] text-cream/90">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-cream/15 bg-cream/5 p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-3 border-b border-cream/15 pb-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cream/60">
                  {locale === "bn" ? "রিপোর্ট কিউ" : "Report queue"}
                </p>
                <span className="pill bg-gold/20 text-gold">SLA 2h</span>
              </div>
              <ul className="divide-y divide-cream/10">
                {[
                  { tag: "P0", label: locale === "bn" ? "সম্ভাব্য অপ্রাপ্তবয়স্ক" : "Possible underage", time: "12m" },
                  { tag: "P1", label: locale === "bn" ? "হয়রানি" : "Harassment", time: "41m" },
                  { tag: "P1", label: locale === "bn" ? "টাকা চাওয়া" : "Money request", time: "2h" },
                  { tag: "P2", label: locale === "bn" ? "ভুয়া প্রোফাইল" : "Fake profile", time: "5h" },
                ].map((row) => (
                  <li key={row.label} className="flex items-center gap-3 py-3 text-[13px]">
                    <span className="w-8 rounded-md bg-cream/10 py-0.5 text-center text-[10px] font-bold text-gold">
                      {row.tag}
                    </span>
                    <span className="flex-1 text-cream/85">{row.label}</span>
                    <span className="text-[11px] text-cream/50">{row.time}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-cream/10 px-3 py-2.5 text-[11px] text-cream/70">
                <FileSearch className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                {locale === "bn"
                  ? "সব সিদ্ধান্ত অডিট লগে সংরক্ষিত হয়। স্টাফদের জন্য ২FA বাধ্যতামূলক।"
                  : "Every decision is written to an audit log. Staff 2FA is mandatory."}
              </p>
            </div>
          </div>
        </section>

        {/* Campuses */}
        <section id="campuses" className="scroll-mt-20 border-b border-line/60">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
                {locale === "bn" ? "ক্যাম্পাস" : "Campuses"}
              </p>
              <h2 className="mt-2 text-3xl text-forest sm:text-4xl">{tr("landing.campusesTitle")}</h2>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">{tr("landing.campusesBody")}</p>

              <div className="mt-6 rounded-2xl border border-line bg-white p-4">
                <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
                  <GraduationCap className="h-4 w-4 text-leaf" aria-hidden="true" />
                  {locale === "bn" ? "শীঘ্রই আসছে" : "Coming next"}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-forest/85">
                  {locale === "bn"
                    ? "চট্টগ্রাম বিশ্ববিদ্যালয়, রাজশাহী বিশ্ববিদ্যালয়, এবং KUET — মডারেশন টিম তৈরি হলে।"
                    : "University of Chittagong, University of Rajshahi and KUET — as moderation capacity grows."}
                </p>
              </div>
            </div>

            <ul className="grid gap-2">
              {UNIVERSITIES.map((u, i) => {
                const count = PEOPLE.filter((p) => p.universityId === u.id).length;
                return (
                  <li
                    key={u.id}
                    className="flex items-center gap-4 rounded-2xl border border-line bg-white px-4 py-3.5 transition hover:border-forest/25 hover:bg-mint/30"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-parchment font-display text-sm font-semibold text-forest">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-semibold text-forest">{u.nameEn}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
                        <MapPin className="h-3 w-3" aria-hidden="true" />
                        {u.city} · {u.type === "public" ? (locale === "bn" ? "সরকারি" : "Public") : locale === "bn" ? "বেসরকারি" : "Private"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-forest">{count}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted">
                        {locale === "bn" ? "প্রোফাইল" : "profiles"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 md:py-20 lg:px-8">
          <div className="surface-gradient relative overflow-hidden rounded-[2rem] border border-line bg-white px-6 py-10 text-center sm:px-12">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              {locale === "bn" ? "দিনে ৬টি ম্যাচ" : "Six matches a day"}
            </p>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl text-forest sm:text-4xl">
              {pick(
                locale,
                "If you are serious, start with people who are too.",
                "আপনি যদি সিরিয়াস হন, শুরু করুন সেই মানুষদের সাথে যাঁরাও সিরিয়াস।"
              )}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
              {pick(
                locale,
                "Create a profile, verify your student status, and see today's six. No swiping, no endless noise.",
                "প্রোফাইল তৈরি করুন, শিক্ষার্থী পরিচয় যাচাই করুন, আর আজকের ছয়জনকে দেখুন। কোনো স্বাইপিং নেই, অন্তহীন ভিড় নেই।"
              )}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/login?mode=create" className="btn-primary px-6 py-3">
                {tr("landing.ctaPrimary")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/login" className="btn-secondary px-5 py-3">
                {tr("landing.signIn")}
              </Link>
            </div>
            <p className="mt-5 text-[11px] text-muted">{tr("landing.demoNote")}</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70 bg-parchment/40">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr] lg:px-8">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-[12px] leading-relaxed text-muted">{tr("landing.footerNote")}</p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-forest">
              <ShieldCheck className="h-3 w-3 text-leaf" aria-hidden="true" />
              18+ · {locale === "bn" ? "শুধু শিক্ষার্থী" : "Students only"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {locale === "bn" ? "পণ্য" : "Product"}
            </p>
            <ul className="mt-3 space-y-2 text-[13px] text-forest/85">
              <li>
                <a href="#how" className="hover:underline">
                  {tr("landing.navHow")}
                </a>
              </li>
              <li>
                <a href="#safety" className="hover:underline">
                  {tr("landing.navSafety")}
                </a>
              </li>
              <li>
                <a href="#campuses" className="hover:underline">
                  {tr("landing.navCampuses")}
                </a>
              </li>
              <li>
                <Link href="/admin" className="hover:underline">
                  {tr("nav.admin")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {locale === "bn" ? "নীতিমালা" : "Trust"}
            </p>
            <ul className="mt-3 space-y-2 text-[13px] text-forest/85">
              <li>{locale === "bn" ? "কমিউনিটি নীতিমালা" : "Community guidelines"}</li>
              <li>{locale === "bn" ? "প্রাইভেসি নোটিশ" : "Privacy notice"}</li>
              <li>{locale === "bn" ? "শর্তাবলি" : "Terms of use"}</li>
              <li>{locale === "bn" ? "রিপোর্ট ও ব্লক" : "Report & block"}</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-line/60 py-4">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 text-[11px] text-muted sm:flex-row sm:px-6 lg:px-8">
            <p>© {new Date().getFullYear()} CampusMatch. {tr("landing.rights")}</p>
            <p>{locale === "bn" ? "ঢাকা, বাংলাদেশ" : "Dhaka, Bangladesh"}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
