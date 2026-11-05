export const appVersionScopes = ["os", "store", "staff", "member", "studio"] as const;

export type AppVersionScope = typeof appVersionScopes[number];

export const appVersionEventName = "app.version.updated";

export function isAppVersionScope(value: unknown): value is AppVersionScope {
  return typeof value === "string" && (appVersionScopes as readonly string[]).includes(value);
}

export function isContentAppVersion(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function appVersionChannel(app: AppVersionScope) {
  return `app-version-${app}`;
}
