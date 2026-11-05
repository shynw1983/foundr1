/** Store appearance is independent from business status and the OS theme. */
export const defaultStoreThemeColor = "#245d49";
export const storeThemePaletteVersion = 1 as const;
export const storeThemeTargets = ["operations", "pickup", "customer", "courier"] as const;
export type StoreThemeTarget = typeof storeThemeTargets[number];
export type StoreThemeMode = "custom" | "brand";

/** Missing targets are old Store clients; explicit unknown values never select a record. */
export function normalizeStoreThemeTarget(value: unknown): StoreThemeTarget | null {
  if (value === undefined) return "operations";
  return storeThemeTargets.find(target => target === value) ?? null;
}

export function storeThemeTargetForPath(pathname: string): StoreThemeTarget {
  const path = pathname.replace(/\/$/, "");
  if (path === "/store/display/pickup") return "pickup";
  if (path === "/store/pos/customer-display") return "customer";
  if (path === "/store/display/courier") return "courier";
  return "operations";
}

export type StoreThemeSettings = {
  primaryColor: string;
  mode: StoreThemeMode;
  paletteVersion: typeof storeThemePaletteVersion;
};

export function getDefaultStoreTheme(target: StoreThemeTarget): StoreThemeSettings {
  return { primaryColor: target === "operations" ? defaultStoreThemeColor : target === "pickup" ? "#c30d23" : "#262827",
    mode: target === "operations" ? "custom" : "brand", paletteVersion: storeThemePaletteVersion };
}

export type StoreThemeContext = {
  target: StoreThemeTarget;
  brand: { name: string; logoUrl: string | null; primaryColor: string } | null;
  storeId: string;
  storeName: string;
  stores: Array<{ id: string; name: string }>;
  canManageTheme: boolean;
  theme: StoreThemeSettings;
  revision: string | null;
  updatedAt: string | null;
};

export function normalizeStoreThemeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : null;
}

type Rgb = [number, number, number];
const rgb = (color: string): Rgb => [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16)) as Rgb;
function mix(color: string, other: string, amount: number): string {
  const first = rgb(color), second = rgb(other);
  return `#${first.map((channel, index) => Math.round(channel * (1 - amount) + second[index] * amount).toString(16).padStart(2, "0")).join("")}`;
}
function luminance(color: string): number {
  const values = rgb(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
export function storeThemeContrast(first: string, second: string): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function readableText(color: string, background: string): string {
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mix(color, "#101712", step / 20);
    if (storeThemeContrast(candidate, background) >= 4.8) return candidate;
  }
  return "#101712";
}

/** All emitted values are derived from a validated hex color; never accept CSS. */
export function createStoreThemePalette(value: unknown = defaultStoreThemeColor): Record<string, string> {
  const primary = normalizeStoreThemeColor(value) ?? defaultStoreThemeColor;
  const darkText = "#101712";
  const onPrimary = storeThemeContrast(primary, "#ffffff") >= 4.5 ? "#ffffff"
    : storeThemeContrast(primary, darkText) >= 4.5 ? darkText : "#000000";
  const hover = mix(primary, onPrimary === "#ffffff" ? "#000000" : "#ffffff", 0.13);
  const active = mix(primary, onPrimary === "#ffffff" ? "#000000" : "#ffffff", 0.22);
  const background = mix("#f5f7f6", primary, 0.018);
  const soft = mix("#f0f3f2", primary, 0.08);
  const primaryText = readableText(primary, soft);
  const ink = mix("#202631", primary, 0.06);
  return {
    "--store-primary": primary,
    "--store-primary-hover": hover,
    "--store-primary-active": active,
    "--store-on-primary": onPrimary,
    "--store-primary-soft": soft,
    "--store-primary-border": mix("#ffffff", primaryText, 0.34),
    "--store-primary-text": primaryText,
    "--store-focus-ring": primaryText,
    "--store-bg": background,
    "--store-panel": "#ffffff",
    "--store-surface-muted": mix("#eef1f0", primary, 0.025),
    "--store-surface-subtle": mix("#f9faf9", primary, 0.012),
    "--store-ink": ink,
    "--store-muted": readableText(mix("#626b75", primary, 0.05), background),
    "--store-line": mix("#dfe4e2", primary, 0.04),
    "--store-line-strong": mix("#b5beb9", primaryText, 0.10),
    "--store-shadow": `0 2px 8px ${ink}09`,
    "--store-success": "#21745b",
    "--store-success-soft": "#e5f4ee",
    "--store-success-border": "#b9d8cb",
    "--store-info": "#2869a8",
    "--store-info-soft": "#e8f1fb",
    "--store-info-border": "#bdd3ec",
    "--store-warning": "#945d10",
    "--store-warning-soft": "#fff2d9",
    "--store-warning-border": "#e7cd9f",
    "--store-danger": "#b33a32",
    "--store-danger-soft": "#fdebea",
    "--store-danger-border": "#e6bbb7",
    "--store-disabled-bg": "#eef0f1",
    "--store-disabled-ink": "#70777d",
    "--store-display-accent": primary,
    "--store-display-on-accent": onPrimary
  };
}
