import { NextRequest, NextResponse } from "next/server";
import { canUseFullStoreWorkbench,isRestrictedStorePersonalRole,isRestrictedStoreExecutionPath } from "./lib/store-inventory-policy";
import { getNavPathsForPermissions, getPermissionsForRole, isPermittedOsPagePath } from "./lib/role-permissions";
import { canApproveTerminalLoginRole } from "./lib/store-terminal-login-policy";

const authCookieName = "foundr1_os_session";
const storeTerminalAllowedPaths = [
  "/store",
  "/store/orders",
  "/store/kitchen",
  "/store/pickup-display",
  "/store/display/kitchen",
  "/store/display/pickup",
  "/store/menu",
  "/store/inventory",
  "/store/replenishment",
  "/store/receiving",
  "/store/timecard",
  "/store/pos",
  "/store/pos/customer-display",
  "/store/procedures",
  "/store/sns",
  "/store/feedback"
];

type ProxySession = {
  role?: string;
  sessionId?: string;
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
    if (typeof session.expiresAt === "number" && Date.now() > session.expiresAt) return null;
    if (!session.sessionId && typeof session.expiresAt !== "number") return null;
    return session;
  } catch {
    return null;
  }
}

async function getPermittedPagePaths(session: ProxySession) {
  // Signed navigation snapshots become stale when a group's permissions change.
  return new Set(getNavPathsForPermissions(await getPermissionsForRole(session.role ?? "", { fresh: true })));
}

function isPermittedPagePath(pathname: string, permittedPaths: Set<string>) {
  if (pathname === "/os/logout" || pathname === "/store/logout" || pathname === "/staff/logout" || pathname === "/os/privacy-consent" || pathname === "/staff/privacy-consent") return true;
  if (pathname === "/os") return true;
  // Existing sessions already carry the parent module permission before SNS rollout.
  if ((pathname === "/os/sns" || pathname.startsWith("/os/sns/")) && permittedPaths.has("/os/procedures")) return true;
  // Existing signed sessions have the same module's original paths until renewal.
  if (pathname === "/os/replenishment" && permittedPaths.has("/os/orders")) return true;
  return isPermittedOsPagePath(pathname, permittedPaths);
}

function getFallbackPagePath(permittedPaths: Set<string>) {
  if (permittedPaths.has("/staff")) return "/staff";
  if (permittedPaths.has("/store")) return "/store";
  if (permittedPaths.has("/os")) return "/os";
  return Array.from(permittedPaths).find((path) => path.startsWith("/os/")) ?? "/store";
}

async function runFoundr1Proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isOsPath = pathname.startsWith("/os");
  const isStorePath = pathname.startsWith("/store");
  const isStaffPath = pathname.startsWith("/staff");

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

  if ((!isOsPath && !isStorePath && !isStaffPath) || pathname === "/os/login" || pathname === "/store/login" || pathname === "/staff/login" || pathname === "/staff/download") {
    return NextResponse.next();
  }

  const session = await readValidSession(request.cookies.get(authCookieName)?.value);
  if (session) {
    if(isStorePath&&isRestrictedStorePersonalRole(session.role??"")) {
      // The appearance page/API check the live permission and scope. This exact
      // exception does not open the rest of the Store workbench to managers.
      const isStoreAppearance = pathname === "/store/settings/appearance" && ["store_owner", "store_manager"].includes(session.role ?? "");
      if(!isRestrictedStoreExecutionPath(pathname) && !isStoreAppearance) {
        const url=request.nextUrl.clone();url.pathname="/store/inventory";url.search="";
        return NextResponse.redirect(url);
      }
    } else if (!canUseFullStoreWorkbench(session.role ?? "") && isStorePath && pathname !== "/store/logout") {
      const url = request.nextUrl.clone();
      url.pathname = session.role === "staff"
        ? pathname === "/store/timecard" ? "/staff/timecard" : "/staff"
        : "/os";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (session.role === "store_terminal") {
      if ((isOsPath || isStaffPath) && pathname !== "/os/logout" && pathname !== "/staff/logout") {
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

    if (isOsPath || isStaffPath) {
      // This QR approval page is an account action, not a navigation module.
      // The API revalidates the active session, role and assigned store/account.
      if (pathname === "/os/store-terminal-login" && canApproveTerminalLoginRole(session.role ?? "")) {
        return NextResponse.next();
      }
      try {
        const permittedPaths = await getPermittedPagePaths(session);
        if (!isPermittedPagePath(pathname, permittedPaths)) {
          const url = request.nextUrl.clone();
          url.pathname = getFallbackPagePath(permittedPaths);
          url.search = "";
          return NextResponse.redirect(url);
        }
      } catch {
        return new NextResponse("権限を確認できません。時間をおいて再読み込みしてください。", { status: 503 });
      }
    }

    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = isStaffPath ? "/staff/login" : isStorePath ? "/store/login" : "/os/login";
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

export default runFoundr1Proxy;

export const config = {
  matcher: ["/os/:path*", "/store/:path*", "/staff/:path*", "/member/:path*", "/api/:path*"]
};
