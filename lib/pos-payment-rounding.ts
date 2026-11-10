export const posRoundingMethods = ["cash", "qr", "card"] as const;
export type PosRoundingMethod = (typeof posRoundingMethods)[number];
export type PosPaymentRounding = Record<PosRoundingMethod, boolean>;

export const posRoundingMethodLabels: Record<PosRoundingMethod, string> = {
  cash: "現金", qr: "QRコード決済", card: "カード"
};

export function normalizePosPaymentRounding(value: unknown): PosPaymentRounding {
  const source = value && typeof value === "object" ? value as Partial<PosPaymentRounding> : {};
  return { cash: source.cash === true, qr: source.qr === true, card: source.card === true };
}

export function getPosPaymentRoundingAmount(amount: number, method: string, settings: PosPaymentRounding) {
  return Number.isSafeInteger(amount) && amount > 0 && posRoundingMethods.some(key => key === method && settings[key])
    ? amount % 5 : 0;
}
