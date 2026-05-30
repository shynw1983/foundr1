import { NextRequest, NextResponse } from "next/server";

const authCookieName = "foundr1_os_session";
const masterPageRoles = new Set(["owner", "manager", "buyer"]);
const masterPagePaths = ["/os/stores", "/os/suppliers", "/os/products"];

type ProxySession = {
  role?: string;
  expiresAt?: number;
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/ops" || pathname.startsWith("/ops/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/ops/, "/os");
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/api")) {
    const isMutatingRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.headers.get("origin");
    if (isMutatingRequest && origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ error: "不正なリクエスト元です。" }, { status: 403 });
    }

    return NextResponse.next();
  }

  if (!pathname.startsWith("/os") || pathname === "/os/login") {
    return NextResponse.next();
  }

  const session = await readValidSession(request.cookies.get(authCookieName)?.value);
  if (session) {
    const isStaffPage = pathname === "/os/staff" || pathname.startsWith("/os/staff/");
    if (isStaffPage && session.role !== "owner") {
      const url = request.nextUrl.clone();
      url.pathname = "/os";
      url.search = "";
      return NextResponse.redirect(url);
    }

    const isMasterPage = masterPagePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (isMasterPage && !masterPageRoles.has(session.role ?? "")) {
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

export const config = {
  matcher: ["/os/:path*", "/ops/:path*", "/api/:path*"]
};
