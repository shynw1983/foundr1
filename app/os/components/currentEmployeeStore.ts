"use client";

export type CurrentEmployee = {
  id: string;
  name: string;
  loginId: string;
  role: string;
  permissions?: string[];
  permittedNavPaths?: string[];
  pendingPrivacyConsentCount?: number;
};

let cachedEmployee: CurrentEmployee | null = null;
let inflightRequest: Promise<CurrentEmployee | null> | null = null;
const currentEmployeeRequestTimeoutMs = 8000;

export function getCachedCurrentEmployee() {
  return cachedEmployee;
}

function redirectToSurfaceLogin() {
  if (typeof window === "undefined") return;

  const pathname = window.location.pathname;
  const loginPath = pathname === "/store" || pathname.startsWith("/store/")
    ? "/store/login"
    : pathname === "/staff" || pathname.startsWith("/staff/")
      ? "/staff/login"
      : "/os/login";
  if (pathname === loginPath || pathname.startsWith(`${loginPath}/`)) return;

  const nextPath = `${pathname}${window.location.search}`;
  window.location.href = `${loginPath}?next=${encodeURIComponent(nextPath)}`;
}

export async function loadCurrentEmployee() {
  if (cachedEmployee) return cachedEmployee;
  if (inflightRequest) return inflightRequest;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), currentEmployeeRequestTimeoutMs);

  inflightRequest = fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
    .then(async (response) => {
      if (!response.ok) {
        cachedEmployee = null;
        if (response.status === 401) redirectToSurfaceLogin();
        return null;
      }
      const body = await response.json().catch(() => ({})) as { employee?: CurrentEmployee };
      cachedEmployee = body.employee ?? null;
      return cachedEmployee;
    })
    .catch(() => {
      cachedEmployee = null;
      return null;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      inflightRequest = null;
    });

  return inflightRequest;
}
