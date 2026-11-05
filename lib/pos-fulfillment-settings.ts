export type PosFulfillmentWorkspaceSettings = {
  enabled: boolean;
  overdueMinutes: number;
};

export const posFulfillmentOverdueError = "待ち時間の通知は1〜120分の整数で指定してください。";

export function defaultPosFulfillmentWorkspaceSettings(): PosFulfillmentWorkspaceSettings {
  return { enabled: false, overdueMinutes: 15 };
}

export function normalizePosFulfillmentWorkspaceSettings(value: unknown): PosFulfillmentWorkspaceSettings {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const minutes = source.overdueMinutes;
  return {
    enabled: source.enabled === true,
    overdueMinutes: typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes : 15
  };
}

export function validatePosFulfillmentWorkspaceSettings(value: unknown): { settings?: PosFulfillmentWorkspaceSettings; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "受け渡しの設定を確認してください。" };
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== "boolean") return { error: "受け渡しの設定を確認してください。" };
  if (typeof source.overdueMinutes !== "number" || !Number.isInteger(source.overdueMinutes) || source.overdueMinutes < 1 || source.overdueMinutes > 120) {
    return { error: posFulfillmentOverdueError };
  }
  return { settings: normalizePosFulfillmentWorkspaceSettings(source) };
}
