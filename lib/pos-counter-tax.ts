export type PosCounterTaxBucket = { rate: number; grossAmount: number; taxAmount: number };
export type PosCounterTaxLine = {
  amount: number;
  paidAmount: number;
  quantity: number;
  discountAmount?: number;
  couponDiscountAmount?: number;
  exchangeCoupon?: boolean;
  counterStandardTax?: boolean;
  selectedOptions?: readonly { priceDelta?: number | null; counterStandardTax?: boolean }[];
};

const yen = (value: number) => {
  const rounded = Math.round(Number(value));
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : 0;
};

// One deterministic yen split, used for order coupons and within a mixed-rate line.
export function allocatePosAmountByWeight(totalAmount: number, weights: readonly number[]) {
  const total = yen(totalAmount);
  const normalized = weights.map(yen).map(BigInt);
  const sum = normalized.reduce((a, b) => a + b, BigInt(0));
  if (!sum || !total) return weights.map(() => 0);
  const entries = normalized.map((weight, index) => {
    const numerator = BigInt(total) * weight;
    return { index, amount: Number(numerator / sum), remainder: numerator % sum };
  });
  const shares = entries.map(entry => entry.amount);
  const remainder = total - shares.reduce((a, b) => a + b, 0);
  entries.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const entry of entries.slice(0, remainder)) shares[entry.index] += 1;
  return shares;
}

/** Checkout inputs are already tax-inclusive yen after the current item/discount rules.
 * An unlinked modifier inherits the parent rate; a linked product can override it.
 * Rounding up matches the existing gross-minus-floor convention, once per rate. */
export function calculatePosCounterTax(input: {
  orderType: string;
  dineInTaxRate: number;
  takeoutTaxRate: number;
  lines: readonly PosCounterTaxLine[];
}) {
  const standardRate = Math.round(Math.max(0, Number(input.dineInTaxRate) || 0) * 100) / 100;
  const reducedRate = Math.round(Math.max(0, Number(input.takeoutTaxRate) || 0) * 100) / 100;
  const buckets = new Map<number, number>();
  const add = (rate: number, gross: number) => { if (gross > 0) buckets.set(rate, (buckets.get(rate) ?? 0) + gross); };
  for (const line of input.lines) {
    const amount = yen(line.amount), paid = Math.min(amount, yen(line.paidAmount));
    if (input.orderType !== 'takeout') { add(standardRate, paid); continue; }
    const parentStandard = line.counterStandardTax === true;
    const options = (line.selectedOptions ?? []).flatMap(option => {
      const gross = yen((Number(option.priceDelta) || 0) * yen(line.quantity));
      return gross ? [{ gross, standard: option.counterStandardTax ?? parentStandard }] : [];
    });
    const base = Math.max(0, amount - options.reduce((sum, option) => sum + option.gross, 0));
    const grossShares = allocatePosAmountByWeight(amount, [base, ...options.map(option => option.gross)]);
    // Use the same component allocation as refund snapshots. A product exchange
    // coupon covers the base first; paid additions retain their own tax class.
    const discounts = allocatePosAmountByWeight(Math.min(amount, yen(line.discountAmount ?? 0)), grossShares);
    const afterDiscount = grossShares.map((gross, index) => gross - discounts[index]);
    const coupon = Math.min(afterDiscount.reduce((sum, gross) => sum + gross, 0), yen(line.couponDiscountAmount ?? 0));
    const exchangeBase = line.exchangeCoupon ? Math.min(coupon, afterDiscount[0]) : 0;
    const couponShares = line.exchangeCoupon
      ? [exchangeBase, ...allocatePosAmountByWeight(coupon - exchangeBase, afterDiscount.slice(1))]
      : allocatePosAmountByWeight(coupon, afterDiscount);
    const paidShares = allocatePosAmountByWeight(paid, afterDiscount.map((gross, index) => gross - couponShares[index]));
    add(parentStandard ? standardRate : reducedRate, paidShares[0]);
    options.forEach((option, index) => add(option.standard ? standardRate : reducedRate, paidShares[index + 1]));
  }
  const taxBreakdown: PosCounterTaxBucket[] = [...buckets].sort(([a], [b]) => a - b).map(([rate, grossAmount]) => {
    const hundredths = Math.round(rate * 100);
    const divisor = BigInt(10000 + hundredths);
    const taxAmount = Number((BigInt(grossAmount) * BigInt(hundredths) + divisor - BigInt(1)) / divisor);
    return { rate, grossAmount, taxAmount };
  });
  return {
    amount: taxBreakdown.reduce((total, bucket) => total + bucket.grossAmount, 0),
    taxAmount: taxBreakdown.reduce((total, bucket) => total + bucket.taxAmount, 0),
    taxRate: taxBreakdown.length === 1 ? taxBreakdown[0].rate : 0,
    taxBreakdown
  };
}
