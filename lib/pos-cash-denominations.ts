export type CashBreakdown = Record<string, number>;

export const yenDenominations = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1] as const;

export function normalizeCashBreakdown(value: unknown): CashBreakdown {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return yenDenominations.reduce((result, denomination) => {
    const count = Number(source[String(denomination)] ?? 0);
    result[String(denomination)] = Number.isFinite(count) ? Math.max(0, Math.min(9999, Math.floor(count))) : 0;
    return result;
  }, {} as CashBreakdown);
}

export function getCashBreakdownTotal(value: unknown) {
  const breakdown = normalizeCashBreakdown(value);
  return yenDenominations.reduce((sum, denomination) => sum + denomination * breakdown[String(denomination)], 0);
}
