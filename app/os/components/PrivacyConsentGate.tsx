"use client";

import { useEffect } from "react";

type AuthMeResponse = {
  employee?: {
    pendingPrivacyConsentCount?: number;
  } | null;
};

const allowedPaths = new Set([
  "/os/login",
  "/os/logout",
  "/os/privacy-consent"
]);

export function PrivacyConsentGate() {
  useEffect(() => {
    let isMounted = true;

    async function checkPendingConsents() {
      const pathname = window.location.pathname;
      if (allowedPaths.has(pathname) || pathname.startsWith("/member")) return;

      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json().catch(() => ({})) as AuthMeResponse;
      if (!isMounted) return;

      if ((body.employee?.pendingPrivacyConsentCount ?? 0) > 0) {
        const nextPath = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/os/privacy-consent?next=${encodeURIComponent(nextPath)}`;
      }
    }

    void checkPendingConsents();

    return () => {
      isMounted = false;
    };
  }, []);

  return null;
}
