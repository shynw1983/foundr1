import { createHmac, randomBytes, timingSafeEqual, pbkdf2Sync } from "node:crypto";

export type EmployeeSession = {
  id: string;
  name: string;
  loginId: string;
  role: string;
  sessionVersion: number;
  sessionId?: string;
  permissions?: string[];
  permittedNavPaths?: string[];
};

export const authCookieName = "foundr1_os_session";
export const passwordChangeRequiredRoles = new Set(["store_manager", "staff"]);
const passwordActionTokenMaxAgeSeconds = 15 * 60;
const hashIterations = 210_000;
const hashKeyLength = 32;
const hashDigest = "sha256";
const minPasswordLength = 10;

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

export function validatePasswordStrength(password: string) {
  if (password.length < minPasswordLength) {
    return `パスワードは${minPasswordLength}文字以上にしてください。`;
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "パスワードには英字と数字を含めてください。";
  }

  return "";
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
  const payload = base64Url(JSON.stringify(employee));
  return `${payload}.${signPayload(payload)}`;
}

export function shouldRequirePasswordChangeForRole(role: string) {
  return passwordChangeRequiredRoles.has(role);
}

export function createPasswordActionToken(employee: Pick<EmployeeSession, "id" | "sessionVersion">, purpose: "initial_change") {
  const expiresAt = Date.now() + passwordActionTokenMaxAgeSeconds * 1000;
  const payload = base64Url(JSON.stringify({ id: employee.id, sessionVersion: employee.sessionVersion, purpose, expiresAt }));
  return `${payload}.${signPayload(payload)}`;
}

export function readPasswordActionToken(token?: string | null, purpose?: "initial_change") {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const action = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      id?: string;
      sessionVersion?: number;
      purpose?: string;
      expiresAt?: number;
    };
    if (
      !action.id ||
      !Number.isInteger(action.sessionVersion) ||
      !action.purpose ||
      typeof action.expiresAt !== "number" ||
      !Number.isInteger(action.expiresAt) ||
      Date.now() > action.expiresAt ||
      (purpose && action.purpose !== purpose)
    ) return null;
    return {
      id: action.id,
      sessionVersion: action.sessionVersion,
      purpose: action.purpose
    };
  } catch {
    return null;
  }
}

export function readSessionToken(token?: string | null): (EmployeeSession & { expiresAt?: number }) | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signPayload(payload);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EmployeeSession & { expiresAt?: number };
    if (
      !session.id ||
      !session.loginId ||
      !session.role ||
      !Number.isInteger(session.sessionVersion) ||
      (typeof session.expiresAt === "number" && Date.now() > session.expiresAt)
    ) return null;
    return session;
  } catch {
    return null;
  }
}
