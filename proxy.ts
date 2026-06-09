import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

const authCookieName = "foundr1_os_session";
const defaultRoleNavPaths: Record<string, string[]> = {
  owner: [
    "/os",
    "/store",
    "/os/orders",
    "/os/procurement",
    "/os/history",
    "/os/vouchers",
    "/os/field-notes",
    "/os/reports",
    "/os/feedback",
    "/os/analytics",
    "/os/analytics/sales",
    "/os/sales",
    "/os/analytics/labor",
    "/os/analytics/cost",
    "/os/analytics/expenses",
    "/os/analytics/profit",
    "/os/timecard",
    "/os/timecard/schedule",
    "/os/timecard/workload",
    "/os/timecard/payroll",
    "/os/staff",
    "/os/products",
    "/os/stores",
    "/os/suppliers",
    "/os/product-comparisons",
    "/os/menus",
    "/os/brand-sites",
    "/os/loyalty",
    "/os/procedures",
    "/os/pos",
    "/os/settings",
    "/os/system-usage"
  ],
  manager: [
    "/os",
    "/store",
    "/os/orders",
    "/os/procurement",
    "/os/history",
    "/os/vouchers",
    "/os/field-notes",
    "/os/reports",
    "/os/feedback",
    "/os/analytics",
    "/os/analytics/sales",
    "/os/sales",
    "/os/analytics/labor",
    "/os/analytics/cost",
    "/os/analytics/expenses",
    "/os/analytics/profit",
    "/os/timecard",
    "/os/timecard/schedule",
    "/os/timecard/workload",
    "/os/timecard/payroll",
    "/os/staff",
    "/os/products",
    "/os/stores",
    "/os/suppliers",
    "/os/product-comparisons",
    "/os/menus",
    "/os/brand-sites",
    "/os/loyalty",
    "/os/procedures",
    "/os/pos"
  ],
  store_owner: ["/os", "/store", "/os/orders", "/os/procurement", "/os/history", "/os/vouchers", "/os/field-notes", "/os/reports", "/os/feedback", "/os/timecard", "/os/timecard/schedule", "/os/timecard/workload", "/os/timecard/payroll", "/os/staff", "/os/products"],
  store_manager: ["/os", "/store", "/os/orders", "/os/procurement", "/os/history", "/os/vouchers", "/os/field-notes", "/os/reports", "/os/feedback", "/os/timecard", "/os/timecard/schedule", "/os/timecard/workload", "/os/timecard/payroll", "/os/staff", "/os/products"],
  staff: ["/os", "/store", "/os/orders", "/os/procurement", "/os/history", "/os/vouchers", "/os/field-notes", "/os/reports", "/os/feedback"],
  store_terminal: ["/os", "/store"]
};
const storeTerminalAllowedPaths = [
  "/store",
  "/store/orders",
  "/store/kitchen",
  "/store/pickup-display",
  "/store/menu",
  "/store/timecard",
  "/store/pos",
  "/store/procedures"
];

type ProxySession = {
  role?: string;
  expiresAt?: number;
  permittedNavPaths?: string[];
};

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(payload: string) {
  const secret = process.env.AUTH_SECRET || process.env.DATABASE_URL || "foundr1-local-dev-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(signature);
}

async function readValidSession(token?: string): Promise<ProxySession | null> {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = await signPayload(payload);
  if (signature !== expectedSignature) return null;

  try {
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as ProxySession;
    if (!session.expiresAt || Date.now() > session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

function getPermittedPagePaths(session: ProxySession) {
  if (Array.isArray(session.permittedNavPaths) && session.permittedNavPaths.length > 0) {
    return new Set(session.permittedNavPaths.map(String));
  }

  return new Set(defaultRoleNavPaths[session.role ?? ""] ?? ["/os"]);
}

function isPermittedPagePath(pathname: string, permittedPaths: Set<string>) {
  if (pathname === "/os" || pathname === "/os/logout") return true;
  return Array.from(permittedPaths).some((path) => path !== "/os" && (pathname === path || pathname.startsWith(`${path}/`)));
}

const clerkKeysConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

async function runFoundr1Proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isOsPath = pathname.startsWith("/os");
  const isStorePath = pathname.startsWith("/store");

  if (pathname.startsWith("/api")) {
    const isMutatingRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.headers.get("origin");
    if (isMutatingRequest && origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "不正なリクエスト元です。" }, { status: 403 });
    }

    return NextResponse.next();
  }

  if (pathname === "/os/procedures/view") {
    const url = request.nextUrl.clone();
    url.pathname = "/store/procedures";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if ((!isOsPath && !isStorePath) || pathname === "/os/login") {
    return NextResponse.next();
  }

  const session = await readValidSession(request.cookies.get(authCookieName)?.value);
  if (session) {
    if (session.role === "store_terminal") {
      if (isOsPath && pathname !== "/os/logout") {
        const url = request.nextUrl.clone();
        url.pathname = "/store";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (isStorePath && !storeTerminalAllowedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
        const url = request.nextUrl.clone();
        url.pathname = "/store";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    if (isOsPath && !isPermittedPagePath(pathname, getPermittedPagePaths(session))) {
      const url = request.nextUrl.clone();
      url.pathname = "/os";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/os/login";
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

const foundr1Proxy = clerkKeysConfigured
  ? clerkMiddleware(async (_auth, request) => runFoundr1Proxy(request))
  : async (request: NextRequest) => runFoundr1Proxy(request);

export default foundr1Proxy;

export const config = {
  matcher: ["/os/:path*", "/store/:path*", "/member/:path*", "/api/:path*", "/__clerk/:path*"]
};
