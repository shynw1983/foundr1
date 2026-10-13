export type AuditTarget = {
  kind: "item" | "option"; targetId: string; brandId: string; label: string;
  groupKey?: string; aliases: string[]; knownExternalIds: string[];
};

export const inventoryReferencePlatforms = ['uber_eats', 'rocket_now', 'demae_can'] as const;
export type InventoryReferencePlatform = typeof inventoryReferencePlatforms[number];

export function inventoryReferencePlatform(value: unknown): InventoryReferencePlatform {
  if (!inventoryReferencePlatforms.includes(value as InventoryReferencePlatform)) {
    throw new Error('販売状態の基準プラットフォームが無効です。');
  }
  return value as InventoryReferencePlatform;
}

export function validatePlatformAvailability(targets: AuditTarget[], result: Record<string, unknown>, platform: string) {
  if (!targets.length || !Array.isArray(result.items) || result.targetCount !== targets.length) {
    throw new Error(`${platform} の読取件数が一致しません。変更は適用していません。`);
  }
  const expected = new Set(targets.map(t => `${t.kind}:${t.targetId}`));
  if (expected.size !== targets.length) throw new Error('読取対象が重複しています。変更は適用していません。');
  const states = new Map<string, boolean>();
  for (const value of result.items) {
    const row = value as Record<string, unknown>;
    const key = `${row?.kind}:${row?.targetId}`;
    if (!expected.has(key) || states.has(key) || row.found !== true
      || typeof row.isAvailable !== "boolean" || row.status !== (row.isAvailable ? "available" : "sold_out")) {
      throw new Error(`${platform} の読取結果が不明または重複しています。変更は適用していません。`);
    }
    states.set(key, row.isAvailable);
  }
  const missing = targets.filter(t => !states.has(`${t.kind}:${t.targetId}`));
  if (missing.length) throw new Error(`${platform} で読み取れない商品: ${missing.map(t => t.label).join("、")}`);
  return targets.map(t => ({ ...t, isAvailable: states.get(`${t.kind}:${t.targetId}`)! }));
}

export function validateUberAvailability(targets: AuditTarget[], result: Record<string, unknown>) {
  return validatePlatformAvailability(targets, result, 'Uber');
}
