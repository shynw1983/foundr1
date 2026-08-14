export function calculateShortageRefundAmount(input: {
  targetType: "item" | "option";
  targetPrice: number;
  grossAmount: number;
  paidAmount: number;
  refundedAmount: number;
}) {
  const paidAmount = Math.max(0, Math.round(Number(input.paidAmount) || 0));
  const remainingPaid = Math.max(0, paidAmount - Math.max(0, Math.round(Number(input.refundedAmount) || 0)));
  if (input.targetType === "item") return remainingPaid;
  const grossAmount = Math.max(1, Math.round(Number(input.grossAmount) || 0));
  const targetPrice = Math.max(0, Math.round(Number(input.targetPrice) || 0));
  return Math.min(remainingPaid, Math.max(0, Math.round(targetPrice * paidAmount / grossAmount)));
}

export function canHandleShortageAsSeparateOption(groupName: string, optionPrice: number) {
  const name = String(groupName || "").trim();
  const price = Math.max(0, Math.round(Number(optionPrice) || 0));
  return price > 0 && !["サイズ", "温度", "甘さ", "氷"].includes(name);
}
