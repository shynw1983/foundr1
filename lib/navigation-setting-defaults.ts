export type NavigationMenuSettings = {
  betaNavPaths: string[];
};

export const defaultNavigationMenuSettings: NavigationMenuSettings = {
  betaNavPaths: []
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeNavPath(value: unknown) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/")) return null;
  if (path.includes(" ")) return null;
  return path;
}

export function normalizeNavigationMenuSettings(value: unknown): NavigationMenuSettings {
  const source = asObject(value);
  const betaNavPaths = Array.isArray(source.betaNavPaths)
    ? Array.from(new Set(source.betaNavPaths.map(normalizeNavPath).filter((path): path is string => Boolean(path))))
    : defaultNavigationMenuSettings.betaNavPaths;

  return { betaNavPaths };
}
