import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as nodeScrypt,
  timingSafeEqual
} from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sql } from "./db";
import { sendMemberVerificationEmail } from "./email";
import { getMemberProfile, upsertMember } from "./loyalty";

export const memberSessionCookieName = "foundr1_member_session";
export const memberSessionMaxAgeSeconds = 365 * 24 * 60 * 60;
const verificationLifetimeMinutes = 10;
const verificationRequestWindowMinutes = 15;
const maxVerificationRequestsPerWindow = 5;
const maxVerificationAttempts = 5;
const loginAttemptWindowMinutes = 15;
const maxFailedLoginAttemptsPerWindow = 10;
const passwordKeyLength = 64;
const passwordScryptN = 16_384;
const passwordScryptR = 8;
const passwordScryptP = 1;

export type MemberSessionIdentity = {
  sessionId: string;
  memberId: string;
  email: string;
  displayName: string;
  expiresAt: string;
};

export class MemberAuthError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "member_auth_error") {
    super(message);
    this.name = "MemberAuthError";
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateMemberEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new MemberAuthError("メールアドレスを正しく入力してください。", 400, "invalid_email");
  }
  return email;
}

export function validateMemberPassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < 8) {
    throw new MemberAuthError("パスワードは8文字以上で入力してください。", 400, "weak_password");
  }
  if (password.length > 128) {
    throw new MemberAuthError("パスワードは128文字以内で入力してください。", 400, "weak_password");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new MemberAuthError("パスワードには英字と数字を含めてください。", 400, "weak_password");
  }
  return password;
}

function memberAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.DATABASE_URL?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "foundr1-local-member-auth-secret";
  throw new Error("AUTH_SECRET or DATABASE_URL is required for member authentication.");
}

function requestIp(request: Request) {
  return String(
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    ""
  ).trim().slice(0, 128);
}

function requestUserAgent(request: Request) {
  return String(request.headers.get("user-agent") || "").trim().slice(0, 500);
}

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function verificationCodeHash(challengeId: string, email: string, code: string) {
  return createHmac("sha256", memberAuthSecret())
    .update(`${challengeId}:${email}:${code}`)
    .digest("hex");
}

function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, passwordKeyLength, {
      N: passwordScryptN,
      r: passwordScryptR,
      p: passwordScryptP,
      maxmem: 64 * 1024 * 1024
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashMemberPassword(passwordValue: unknown) {
  const password = validateMemberPassword(passwordValue);
  const salt = randomBytes(16);
  const digest = await scrypt(password, salt);
  return [
    "scrypt",
    passwordScryptN,
    passwordScryptR,
    passwordScryptP,
    salt.toString("base64url"),
    digest.toString("base64url")
  ].join("$");
}

export async function verifyMemberPassword(passwordValue: unknown, encodedHash: string) {
  const password = String(passwordValue ?? "");
  const [algorithm, nText, rText, pText, saltText, digestText] = String(encodedHash || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !digestText) return false;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (n !== passwordScryptN || r !== passwordScryptR || p !== passwordScryptP) return false;

  try {
    const expected = Buffer.from(digestText, "base64url");
    const actual = await scrypt(password, Buffer.from(saltText, "base64url"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function recordAuthAttempt(input: {
  email: string;
  action: string;
  success: boolean;
  ipAddress: string;
}) {
  await sql`
    insert into member_auth_attempts (email, action, success, ip_address)
    values (${input.email}, ${input.action}, ${input.success}, ${input.ipAddress})
  `;
}

async function assertLoginRateLimit(email: string, ipAddress: string) {
  const rows = await sql`
    select count(*)::int as count
    from member_auth_attempts
    where action = 'password_login'
      and success = false
      and created_at > now() - (${loginAttemptWindowMinutes} * interval '1 minute')
      and (
        lower(email) = ${email}
        or (${ipAddress} <> '' and ip_address = ${ipAddress})
      )
  `;
  if (Number(rows[0]?.count ?? 0) >= maxFailedLoginAttemptsPerWindow) {
    throw new MemberAuthError("ログイン試行回数が多すぎます。15分後にもう一度お試しください。", 429, "rate_limited");
  }
}

export async function authenticateMemberPassword(input: {
  email: unknown;
  password: unknown;
  request: Request;
}) {
  const email = validateMemberEmail(input.email);
  const ipAddress = requestIp(input.request);
  await assertLoginRateLimit(email, ipAddress);

  const rows = await sql`
    select
      member_credentials.member_id::text as "memberId",
      member_credentials.password_hash as "passwordHash",
      members.status
    from member_credentials
    join members on members.id = member_credentials.member_id
    where lower(member_credentials.email) = ${email}
    limit 1
  `;
  const valid = rows[0]?.status === "active" &&
    await verifyMemberPassword(input.password, String(rows[0]?.passwordHash ?? ""));
  await recordAuthAttempt({ email, action: "password_login", success: valid, ipAddress });

  if (!valid) {
    throw new MemberAuthError(
      "メールアドレスまたはパスワードが正しくありません。初めて利用する場合は、メール確認からパスワードを設定してください。",
      401,
      "invalid_credentials"
    );
  }
  return getMemberProfile(String(rows[0].memberId));
}

export async function requestMemberVerification(input: {
  email: unknown;
  request: Request;
}) {
  const email = validateMemberEmail(input.email);
  const ipAddress = requestIp(input.request);
  const recentRows = await sql`
    select count(*)::int as count
    from member_verification_challenges
    where created_at > now() - (${verificationRequestWindowMinutes} * interval '1 minute')
      and (
        lower(email) = ${email}
        or (${ipAddress} <> '' and request_ip = ${ipAddress})
      )
  `;
  if (Number(recentRows[0]?.count ?? 0) >= maxVerificationRequestsPerWindow) {
    throw new MemberAuthError("確認コードの送信回数が多すぎます。15分後にもう一度お試しください。", 429, "rate_limited");
  }

  const challengeRows = await sql`
    insert into member_verification_challenges (
      email,
      code_hash,
      purpose,
      expires_at,
      request_ip
    )
    values (
      ${email},
      '',
      'set_password',
      now() + (${verificationLifetimeMinutes} * interval '1 minute'),
      ${ipAddress}
    )
    returning id::text
  `;
  const challengeId = String(challengeRows[0]?.id ?? "");
  if (!challengeId) throw new MemberAuthError("確認コードを作成できませんでした。", 500, "challenge_failed");

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await sql`
    update member_verification_challenges
    set code_hash = ${verificationCodeHash(challengeId, email, code)}
    where id::text = ${challengeId}
  `;

  const emailResult = await sendMemberVerificationEmail({
    to: email,
    code,
    expiresInMinutes: verificationLifetimeMinutes
  });
  if (emailResult.status !== "sent") {
    await sql`
      update member_verification_challenges
      set consumed_at = now()
      where id::text = ${challengeId}
    `;
    throw new MemberAuthError("確認メールを送信できませんでした。しばらくしてからお試しください。", 503, "email_failed");
  }
  await recordAuthAttempt({ email, action: "verification_request", success: true, ipAddress });
  return { challengeId, email, expiresInMinutes: verificationLifetimeMinutes };
}

export async function completeMemberVerification(input: {
  challengeId: unknown;
  email: unknown;
  code: unknown;
  password: unknown;
  request: Request;
}) {
  const challengeId = String(input.challengeId ?? "").trim();
  const email = validateMemberEmail(input.email);
  const code = String(input.code ?? "").replace(/\D/g, "").slice(0, 6);
  const password = validateMemberPassword(input.password);
  if (!challengeId || code.length !== 6) {
    throw new MemberAuthError("確認コードを正しく入力してください。", 400, "invalid_code");
  }

  const rows = await sql`
    select
      id::text,
      code_hash as "codeHash",
      attempt_count as "attemptCount"
    from member_verification_challenges
    where id::text = ${challengeId}
      and lower(email) = ${email}
      and purpose = 'set_password'
      and consumed_at is null
      and expires_at > now()
    limit 1
  `;
  if (!rows[0]?.id || Number(rows[0].attemptCount ?? 0) >= maxVerificationAttempts) {
    throw new MemberAuthError("確認コードの有効期限が切れました。もう一度送信してください。", 400, "challenge_expired");
  }

  const expected = Buffer.from(String(rows[0].codeHash ?? ""));
  const actual = Buffer.from(verificationCodeHash(challengeId, email, code));
  const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!valid) {
    await sql`
      update member_verification_challenges
      set attempt_count = attempt_count + 1
      where id::text = ${challengeId}
        and consumed_at is null
    `;
    await recordAuthAttempt({
      email,
      action: "verification_complete",
      success: false,
      ipAddress: requestIp(input.request)
    });
    throw new MemberAuthError("確認コードが正しくありません。", 400, "invalid_code");
  }

  const passwordHash = await hashMemberPassword(password);
  const consumedRows = await sql`
    update member_verification_challenges
    set consumed_at = now()
    where id::text = ${challengeId}
      and consumed_at is null
      and expires_at > now()
    returning id::text
  `;
  if (!consumedRows[0]?.id) {
    throw new MemberAuthError("確認コードはすでに使用されています。", 400, "challenge_consumed");
  }

  const member = await upsertMember({
    email,
    identityProvider: "foundr1_email",
    identitySubject: email,
    identityLabel: email,
    metadata: { source: "foundr1_member_auth", emailVerified: true }
  });
  if (!member) throw new MemberAuthError("会員情報を保存できませんでした。", 500, "member_save_failed");

  await sql`
    insert into member_credentials (
      member_id,
      email,
      password_hash,
      password_updated_at,
      updated_at
    )
    values (
      ${member.id},
      ${email},
      ${passwordHash},
      now(),
      now()
    )
    on conflict (member_id)
    do update set
      email = excluded.email,
      password_hash = excluded.password_hash,
      password_updated_at = now(),
      updated_at = now()
  `;
  await recordAuthAttempt({
    email,
    action: "verification_complete",
    success: true,
    ipAddress: requestIp(input.request)
  });
  return member;
}

export async function createMemberSession(memberId: string, request: Request) {
  const token = randomBytes(48).toString("base64url");
  const rows = await sql`
    insert into member_sessions (
      member_id,
      token_hash,
      user_agent,
      ip_address,
      expires_at
    )
    values (
      ${memberId},
      ${sessionTokenHash(token)},
      ${requestUserAgent(request)},
      ${requestIp(request)},
      now() + (${memberSessionMaxAgeSeconds} * interval '1 second')
    )
    returning id::text, expires_at::text as "expiresAt"
  `;
  if (!rows[0]?.id) throw new MemberAuthError("ログイン状態を保存できませんでした。", 500, "session_failed");
  return { token, sessionId: String(rows[0].id), expiresAt: String(rows[0].expiresAt ?? "") };
}

export function setMemberSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(memberSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: memberSessionMaxAgeSeconds
  });
}

export function clearMemberSessionCookie(response: NextResponse) {
  response.cookies.set(memberSessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getMemberSession(): Promise<MemberSessionIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(memberSessionCookieName)?.value;
  if (!token) return null;
  const tokenHash = sessionTokenHash(token);

  const rows = await sql`
    with active_session as (
      select
        member_sessions.id,
        member_sessions.member_id,
        member_sessions.expires_at,
        members.email,
        members.display_name
      from member_sessions
      join members on members.id = member_sessions.member_id
      where member_sessions.token_hash = ${tokenHash}
        and member_sessions.revoked_at is null
        and member_sessions.expires_at > now()
        and members.status = 'active'
      limit 1
    ), touched as (
      update member_sessions
      set last_seen_at = now()
      from active_session
      where member_sessions.id = active_session.id
        and member_sessions.last_seen_at < now() - interval '1 hour'
      returning member_sessions.id
    )
    select
      active_session.id::text as "sessionId",
      active_session.member_id::text as "memberId",
      active_session.email,
      active_session.display_name as "displayName",
      active_session.expires_at::text as "expiresAt"
    from active_session
  `;
  if (!rows[0]?.sessionId) return null;
  return {
    sessionId: String(rows[0].sessionId),
    memberId: String(rows[0].memberId),
    email: String(rows[0].email ?? ""),
    displayName: String(rows[0].displayName ?? ""),
    expiresAt: String(rows[0].expiresAt ?? "")
  };
}

export async function requireMemberSession() {
  const session = await getMemberSession();
  if (!session) throw new MemberAuthError("ログインしてください。", 401, "unauthenticated");
  return session;
}

export async function revokeCurrentMemberSession(reason = "logout") {
  const cookieStore = await cookies();
  const token = cookieStore.get(memberSessionCookieName)?.value;
  if (!token) return;
  await sql`
    update member_sessions
    set revoked_at = coalesce(revoked_at, now()), revoke_reason = ${reason}
    where token_hash = ${sessionTokenHash(token)}
  `;
}

export function memberAuthErrorResponse(error: unknown) {
  if (error instanceof MemberAuthError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "認証処理に失敗しました。しばらくしてからお試しください。" }, { status: 500 });
}
