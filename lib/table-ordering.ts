import { randomBytes } from "node:crypto";

const tableOrderTokenBytes = 24;

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function createTableQrToken() {
  return randomBytes(tableOrderTokenBytes).toString("base64url");
}

export function getTableOrderBaseUrl(request?: Request) {
  return normalizeBaseUrl(
    process.env.TABLE_ORDER_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    request?.url ||
    "http://localhost:3000"
  );
}

export function buildTableOrderUrl(token: string, request?: Request) {
  const baseUrl = getTableOrderBaseUrl(request);
  return new URL(`/t/${encodeURIComponent(token)}`, baseUrl).toString();
}

export function normalizeTableLabel(value: unknown) {
  return String(value ?? "").trim().slice(0, 80);
}

export function normalizeCheckoutExitPolicy(value: unknown) {
  const normalized = String(value ?? "").trim();
  return [
    "show_staff_screen_required",
    "notify_staff_then_leave",
    "direct_leave_allowed"
  ].includes(normalized) ? normalized : "show_staff_screen_required";
}
