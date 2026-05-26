"use client";

export type CurrentEmployee = {
  name: string;
  loginId: string;
  role: string;
};

let cachedEmployee: CurrentEmployee | null = null;
let inflightRequest: Promise<CurrentEmployee | null> | null = null;

export function getCachedCurrentEmployee() {
  return cachedEmployee;
}

export async function loadCurrentEmployee() {
  if (cachedEmployee) return cachedEmployee;
  if (inflightRequest) return inflightRequest;

  inflightRequest = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return null;
      const body = await response.json().catch(() => ({})) as { employee?: CurrentEmployee };
      cachedEmployee = body.employee ?? null;
      return cachedEmployee;
    })
    .finally(() => {
      inflightRequest = null;
    });

  return inflightRequest;
}
