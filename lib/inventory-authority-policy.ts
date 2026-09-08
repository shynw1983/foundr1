export type AuditTarget = {
  kind: "item" | "option"; targetId: string; brandId: string; label: string;
  groupKey?: string; aliases: string[]; knownExternalIds: string[];
};

export function validateUberAvailability(targets: AuditTarget[], result: Record<string, unknown>) {
  if (!targets.length || !Array.isArray(result.items) || result.targetCount !== targets.length) {
    throw new Error("Uber の読取件数が一致しません。変更は適用していません。");
  }
  const expected = new Set(targets.map(t => `${t.kind}:${t.targetId}`));
  const states = new Map<string, boolean>();
  for (const value of result.items) {
    const row = value as Record<string, unknown>;
    const key = `${row?.kind}:${row?.targetId}`;
    if (!expected.has(key) || states.has(key) || row.found !== true
      || typeof row.isAvailable !== "boolean" || row.status !== (row.isAvailable ? "available" : "sold_out")) {
      throw new Error("Uber の読取結果が不明または重複しています。変更は適用していません。");
    }
    states.set(key, row.isAvailable);
  }
  const missing = targets.filter(t => !states.has(`${t.kind}:${t.targetId}`));
  if (missing.length) throw new Error(`Uber で読み取れない商品: ${missing.map(t => t.label).join("、")}`);
  return targets.map(t => ({ ...t, isAvailable: states.get(`${t.kind}:${t.targetId}`)! }));
}
