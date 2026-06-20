"use client";

export type CurrentEmployee = {
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

function redirectToOsLogin() {
  if (typeof window === "undefined" || window.location.pathname.startsWith("/os/login")) return;

  const nextPath = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/os/login?next=${encodeURIComponent(nextPath)}`;
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
        redirectToOsLogin();
        return null;
      }
      const body = await response.json().catch(() => ({})) as { employee?: CurrentEmployee };
      cachedEmployee = body.employee ?? null;
      if (!cachedEmployee) redirectToOsLogin();
      return cachedEmployee;
    })
    .catch(() => {
      cachedEmployee = null;
      redirectToOsLogin();
      return null;
    })
    .finally(() => {
      clearTimeout(timeoutId);
      inflightRequest = null;
    });

  return inflightRequest;
}
