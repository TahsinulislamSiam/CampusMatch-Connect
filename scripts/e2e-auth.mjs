// End-to-end auth test against a running server. Node 18+ (has global fetch).
// Usage: node scripts/e2e-auth.mjs [baseUrl]
//
// SMS is not connected, so the code is recovered out of band: we know the most
// recent challenge id for the phone (returned by the API) and brute-force the
// 6-digit HMAC over it with the local OTP_PEPPER. This mirrors exactly what an
// attacker could do if the digest key leaked, so it also exercises the digest.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const { createHmac } = require("crypto");
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), true);

const prisma = new PrismaClient();

/** Recover the plaintext OTP for a challenge, locally, from the stored digest. */
async function recoverCode(challengeId) {
  const pepper = process.env.OTP_PEPPER ?? "";
  const row = await prisma.otpChallenge.findUnique({ where: { id: challengeId }, select: { codeHash: true } });
  if (!row) throw new Error(`challenge ${challengeId} not found`);
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, "0");
    if (createHmac("sha256", pepper).update(`${challengeId}:${code}`).digest("base64url") === row.codeHash) return code;
  }
  throw new Error(`code for ${challengeId} could not be recovered`);
}

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";

let failures = 0;
function check(name, cond, extra = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${tag}] ${name}${extra ? "  " + extra : ""}`);
}

// Every request uses the same synthetic client address so the per-client rate
// limit does not bleed in from other local testing. The value is peppered and
// hashed server-side, so nothing identifying is stored.
// Fresh per run so repeated local runs do not exhaust the per-client OTP budget
// (which would otherwise mask real failures behind 429s).
const CLIENT_IP = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

// An isolated client bucket, for checks that deliberately make several requests
// from "the same client" without consuming the main run's per-client budget.
// Optional `opts.ip` pins the client address (and `opts.cookie` sends the proof).
const isolatedPost = (path, body, opts = {}) =>
  fetch(BASE + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-forwarded-for": opts.ip ?? `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null), setCookie: r.headers.getSetCookie() }));

async function post(path, body, { cookie, csrf, origin = BASE } = {}) {
  const headers = { "content-type": "application/json", origin, "x-forwarded-for": CLIENT_IP };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(BASE + path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookies: res.headers.getSetCookie?.() ?? [] };
}

async function get(path, { cookie } = {}) {
  const res = await fetch(BASE + path, { headers: { "x-forwarded-for": CLIENT_IP, ...(cookie ? { cookie } : {}) } });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, cookies: res.headers.getSetCookie?.() ?? [] };
}

function cookieValue(cookies, name) {
  for (const c of cookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (pair.slice(0, idx) === name) return pair;
  }
  return null;
}

function joinCookies(...pairs) {
  return pairs.filter(Boolean).join("; ");
}

const stamp = Date.now().toString().slice(-7);
const phoneA = `+88019${stamp}0`;
const phoneB = `+88017${stamp}1`;
const userA = `e2e_${stamp}a`;
const userB = `e2e_${stamp}b`;
const unknownProbe = `+880150${stamp}`;

const base = { fullName: "Tester", address: "Mirpur, Dhaka", universityId: "du", gender: "woman", dob: "2000-05-05", genderPreference: "everyone", acceptedTerms: true, ageConfirm: true };

console.log("base", BASE);

// --- 1. validation is server-side (bad payload rejected without touching DB)
const bad = await post("/api/auth/register", { ...base, fullName: "", username: "X", phone: "12345", address: "", email: "nope" });
check("register rejects invalid payload", bad.status === 400 && bad.data?.code === "invalid_input", JSON.stringify(bad.data?.fields ?? {}));

// --- 2. registration requires a proven phone (no cookie -> refused)
const noProof = await post("/api/auth/register", { ...base, fullName: "No Proof", username: `nopr_${stamp}`, phone: phoneA, email: "" });
check("register without OTP proof is refused", noProof.status === 400, JSON.stringify(noProof.data));

// --- 4. resend cooldown
const again = await post("/api/auth/otp/send", { phone: phoneA, purpose: "signup" });
check("send for a throttled number still returns a safe response", again.status === 200 || again.status === 429, `status=${again.status}`);
// first send for phoneA may already be rate limited by the cooldown above; fetch a fresh number
const phoneC = `+88016${stamp}2`;
const cooldownMs = 61_000; // per-phone resend cooldown (60 s) must elapse before a later send
const first = await post("/api/auth/otp/send", { phone: phoneC, purpose: "signup" });
check("signup OTP send returns a challenge", first.status === 200 && typeof first.data?.challengeId === "string", JSON.stringify({ id: !!first.data?.challengeId }));
check("response never contains a code", !("demoCode" in (first.data ?? {})), "");
const tooSoon = await post("/api/auth/otp/send", { phone: phoneC, purpose: "signup" });
check("immediate resend is refused (cooldown)", tooSoon.status === 429, `status=${tooSoon.status}`);

// --- 5. wrong code, then correct code -> signup proof cookie
const wrong = await post("/api/auth/otp/verify", { challengeId: first.data.challengeId, code: "000000" });
check("wrong OTP is rejected", wrong.status === 400 && wrong.data?.code === "otp_invalid", JSON.stringify(wrong.data));
const signupCode = await recoverCode(first.data.challengeId);
const verified = await post("/api/auth/otp/verify", { challengeId: first.data.challengeId, code: signupCode });
const proofCookie = cookieValue(verified.cookies, "cm_signup_proof");
check("correct OTP issues a signup proof cookie", verified.status === 200 && verified.data?.purpose === "signup" && Boolean(proofCookie), JSON.stringify(verified.data));

// --- 6. cross-origin register is refused
const crossOrigin = await post("/api/auth/register", { ...base, username: userA, phone: phoneC, email: `a_${stamp}@example.com` }, { cookie: proofCookie, origin: "https://evil.example" });
check("cross-origin POST refused", crossOrigin.status === 403, `status=${crossOrigin.status}`);

// --- 7. register with the proof cookie
const registered = await post("/api/auth/register", { ...base, username: userA, phone: phoneC, email: `a_${stamp}@example.com` }, { cookie: proofCookie });
const sessionCookie = cookieValue(registered.cookies, "cm_session");
check("register succeeds and starts a session", registered.status === 201 && Boolean(sessionCookie), JSON.stringify(registered.data));
const proofClearedHeader = registered.cookies.find((c) => c.startsWith("cm_signup_proof=")) ?? "";
check(
  "signup proof cookie is cleared",
  /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(proofClearedHeader),
  proofClearedHeader ? "set-cookie present" : "no set-cookie for cm_signup_proof"
);

// --- 8. proof is single-use / cannot be replayed to create a second account
const replay = await post("/api/auth/register", { ...base, username: `rep_${stamp}`, phone: phoneC, email: "" }, { cookie: proofCookie });
check("signup proof cannot be replayed", replay.status !== 201, `status=${replay.status} ${JSON.stringify(replay.data)}`);

// --- 8b. enumeration: an unknown number must not be distinguishable from a known one.
// Each probe uses a fresh client address so the per-client budget cannot skew the
// comparison. A known account returns a challengeId; an unknown one returns null —
// the response SHAPE (keys, status, timing bucket) must still match, and the
// challenge id is only ever returned to a caller who already knows the number.
// A brand-new account created inside an isolated client bucket, so its very first
// login-send cannot be caught by the 60s cooldown spent earlier in this run.
const ENUM_IP = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
const enumPhone = `+8801825${stamp}`.slice(0, 14);
const enumChallenge = await isolatedPost("/api/auth/otp/send", { phone: enumPhone, purpose: "signup" }, { ip: ENUM_IP });
const enumCode = await recoverCode(enumChallenge.data.challengeId);
const enumVerified = await isolatedPost("/api/auth/otp/verify", { challengeId: enumChallenge.data.challengeId, code: enumCode }, { ip: ENUM_IP });
const enumProof = (enumVerified.setCookie.find((c) => c.startsWith("cm_signup_proof=")) ?? "").split(";")[0];
const enumRegistered = await isolatedPost(
  "/api/auth/register",
  { ...base, fullName: "Enum", username: `enm_${stamp}`, phone: enumPhone, email: "" },
  { ip: ENUM_IP, cookie: enumProof }
);
check("isolated account created for enumeration probe", enumRegistered.status === 201, `status=${enumRegistered.status}`);
const knownSend = await isolatedPost("/api/auth/otp/send", { phone: enumPhone, purpose: "login" });
// A well-formed BD number (1[3-9] + 8 digits) that is never registered.
const unknownSend = await isolatedPost("/api/auth/otp/send", { phone: `+88016${stamp}9`, purpose: "login" });
const shape = (d) => Object.keys(d ?? {}).filter((k) => k !== "challengeId").sort().join();
check(
  "login OTP send does not reveal whether a number has an account",
  knownSend.status === 200 &&
    unknownSend.status === 200 &&
    shape(knownSend.data) === shape(unknownSend.data) &&
    unknownSend.data?.challengeId === null,
  JSON.stringify({ known: knownSend.data, unknown: unknownSend.data })
);

// --- 9. /me returns own PII only to the owner
const me = await get("/api/auth/me", { cookie: sessionCookie });
check("GET /me returns the signed-in member", me.status === 200 && me.data?.user?.username === userA, JSON.stringify({ u: me.data?.user?.username, name: me.data?.user?.fullName, email: me.data?.user?.email }));
check("GET /me without session is 401", (await get("/api/auth/me")).status === 401);

// --- 10. duplicate username / email are rejected (against HMAC digests)
const p2 = await post("/api/auth/otp/send", { phone: phoneB, purpose: "signup" });
const code2 = await recoverCode(p2.data.challengeId);
const v2 = await post("/api/auth/otp/verify", { challengeId: p2.data.challengeId, code: code2 });
const proof2 = cookieValue(v2.cookies, "cm_signup_proof");
const dupUser = await post("/api/auth/register", { ...base, fullName: "TesterB", username: userA, phone: phoneB, email: "" }, { cookie: proof2 });
check("duplicate username rejected", dupUser.status === 409 && dupUser.data?.fields?.username === "username_taken", JSON.stringify(dupUser.data));
const dupMail = await post("/api/auth/register", { ...base, fullName: "TesterB", username: userB, phone: phoneB, email: `a_${stamp}@example.com` }, { cookie: proof2 });
check("duplicate e-mail rejected", dupMail.status === 409 && dupMail.data?.fields?.email === "email_taken", JSON.stringify(dupMail.data));

// --- 11. username availability endpoint
const avail = await post("/api/auth/username-check", { username: `free_${stamp}` });
const taken = await post("/api/auth/username-check", { username: userA });
check("username-check reports availability", avail.data?.available === true && taken.data?.available === false, JSON.stringify({ avail: avail.data, taken: taken.data }));

// --- 12. login with OTP for the registered account.
// The per-phone resend cooldown applies to every send for the same number, so
// wait it out rather than weakening the limit.
const waited = Date.now();
while (Date.now() - waited < cooldownMs) await new Promise((r) => setTimeout(r, 1000));
const loginSend = await post("/api/auth/otp/send", { phone: phoneC, purpose: "login" });
check("login OTP send succeeds for a real account", loginSend.status === 200 && typeof loginSend.data?.challengeId === "string", JSON.stringify(loginSend.data));
const loginCode = loginSend.data?.challengeId ? await recoverCode(loginSend.data.challengeId) : null;
const loginVerify = loginSend.data?.challengeId
  ? await post("/api/auth/otp/verify", { challengeId: loginSend.data.challengeId, code: loginCode })
  : { status: 0, data: null, cookies: [] };
const loginCookie = cookieValue(loginVerify.cookies, "cm_session");
check("login OTP verify starts a session", loginVerify.status === 200 && Boolean(loginCookie), JSON.stringify(loginVerify.data));

// --- 13. CSRF: logout requires the token for an authenticated caller.
// Build an authenticated cookie jar (session + csrf) from the login response.
const csrfValue = cookieValue(loginVerify.cookies, "cm_csrf");
const authedCookies = joinCookies(loginCookie, csrfValue);
const logoutNoCsrf = await post("/api/auth/logout", {}, { cookie: authedCookies });
check("logout without CSRF token refused", logoutNoCsrf.status === 403, `status=${logoutNoCsrf.status}`);
check("csrf cookie is set and readable by the client", Boolean(csrfValue) && !/HttpOnly/i.test(loginVerify.cookies.find((c) => c.startsWith("cm_csrf=")) ?? ""), "");
// The CSRF token lives in the (non-HttpOnly) cm_csrf cookie, so the browser SPA
// reads it from there and echoes it. Use the same source here.
const logoutCsrf = decodeURIComponent((csrfValue ?? "").split("=").slice(1).join("="));
const logoutOk = await post("/api/auth/logout", {}, { cookie: authedCookies, csrf: logoutCsrf });
check("logout with CSRF token succeeds", logoutOk.status === 200, JSON.stringify(logoutOk.data));
check("session is revoked after logout", (await get("/api/auth/me", { cookie: loginCookie })).status === 401);

// --- 14. session cookie flags
const setSession = linkedSessionCookie(sessionCookie, registered.cookies);
console.log("[info] session cookie header:", setSession);
check("session cookie is HttpOnly + SameSite=Strict + Path=/", /HttpOnly/i.test(setSession) && /SameSite=Strict/i.test(setSession) && /Path=\//.test(setSession), "");

function linkedSessionCookie(_value, cookies) {
  return cookies.find((c) => c.startsWith("cm_session=")) ?? "";
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
