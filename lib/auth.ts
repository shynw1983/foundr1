import { createHmac, randomBytes, timingSafeEqual, pbkdf2Sync } from "node:crypto";

export type EmployeeSession = {
  id: string;
  name: string;
  loginId: string;
  role: string;
};

export const authCookieName = "foundr1_ops_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
const hashIterations = 210_000;
const hashKeyLength = 32;
const hashDigest = "sha256";

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.DATABASE_URL || "foundr1-local-dev-secret";
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(password, salt, hashIterations, hashKeyLength, hashDigest).toString("base64url");
  return `pbkdf2:${hashIterations}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsValue, salt, expectedHash] = storedHash.split(":");
  if (algorithm !== "pbkdf2" || !iterationsValue || !salt || !expectedHash) return false;

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = pbkdf2Sync(password, salt, iterations, hashKeyLength, hashDigest);
  const expected = Buffer.from(expectedHash, "base64url");
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

export function createSessionToken(employee: EmployeeSession) {
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
  const payload = base64Url(JSON.stringify({ ...employee, expiresAt }));
  return `${payload}.${signPayload(payload)}`;
}

export function readSessionToken(token?: string | null): (EmployeeSession & { expiresAt: number }) | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EmployeeSession & { expiresAt: number };
    if (!session.id || !session.loginId || !session.role || Date.now() > session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookieMaxAge() {
  return sessionMaxAgeSeconds;
}
