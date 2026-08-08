type KitchenDisplayPricingInput = {
  storedAmount: unknown;
  quantity: unknown;
  basePrice: unknown;
  optionPriceDeltas: unknown[];
  bridgeItem: unknown;
  toppingCount: number;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function resolveKitchenDisplayAmounts(input: KitchenDisplayPricingInput) {
  const quantity = Math.max(1, Math.floor(Number(input.quantity ?? 1) || 1));
  const bridgeItem = asRecord(input.bridgeItem);
  const bridgeModifiers = Array.isArray(bridgeItem.modifiers) ? bridgeItem.modifiers.map(asRecord) : [];
  const bridgeUnitPrice = finiteAmount(bridgeItem.unitPrice);
  const bridgeToppingAmounts = bridgeModifiers.flatMap((modifier) => {
    const modifierQuantity = Math.max(1, Math.floor(Number(modifier.quantity ?? 1) || 1));
    const price = finiteAmount(modifier.price) ?? 0;
    // Uber exposes a per-option unit price, while Rocket exposes the displayed
    // modifier line total (for example, "x2 +240円"). Split Rocket's total
    // across the repeated labels so the grouped kitchen amount remains +240円.
    const repeatedAmount = bridgeUnitPrice !== null
      ? price * quantity
      : price / modifierQuantity;
    return Array.from({ length: modifierQuantity }, () => repeatedAmount);
  });
  const toppingAmounts = Array.from({ length: input.toppingCount }, (_, index) => (
    bridgeToppingAmounts.length === input.toppingCount
      ? bridgeToppingAmounts[index] ?? 0
      : (finiteAmount(input.optionPriceDeltas[index]) ?? 0) * quantity
  ));
  const optionAmountTotal = toppingAmounts.reduce((sum, amount) => sum + amount, 0);
  const bridgeLineTotal = finiteAmount(bridgeItem.lineTotal);
  const basePrice = finiteAmount(input.basePrice);
  const storedAmount = finiteAmount(input.storedAmount) ?? 0;
  const itemAmount = bridgeUnitPrice !== null
    ? bridgeUnitPrice
    : bridgeLineTotal !== null
      ? Math.max(0, bridgeLineTotal - optionAmountTotal)
      : basePrice !== null
        ? basePrice * quantity
        : Math.max(0, storedAmount - optionAmountTotal);

  return { itemAmount, toppingAmounts };
}
