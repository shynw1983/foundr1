"use client";

import { useEffect } from "react";

type AuthMeResponse = {
  employee?: {
    pendingPrivacyConsentCount?: number;
  } | null;
};

const allowedPaths = new Set([
  "/store/privacy-consent",
  "/staff/privacy-consent"
]);

export function PrivacyConsentGate() {
  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsents() {
      const pathname = window.location.pathname;
      const isProtectedSurface = pathname.startsWith("/store") || pathname.startsWith("/staff");
      if (!isProtectedSurface || allowedPaths.has(pathname)) return;

      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json().catch(() => ({})) as AuthMeResponse;
      if (!isMounted) return;

      if ((body.employee?.pendingPrivacyConsentCount ?? 0) > 0) {
        const nextPath = `${window.location.pathname}${window.location.search}`;
        const consentPath = pathname.startsWith("/staff") ? "/staff/privacy-consent" : "/store/privacy-consent";
        window.location.href = `${consentPath}?next=${encodeURIComponent(nextPath)}`;
      }
    }

    void checkPendingConsents();

    return () => {
      isMounted = false;
    };
  }, []);

  return null;
}
