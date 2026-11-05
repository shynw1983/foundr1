/** Refunds use immutable checkout prices, never the current menu. All amounts are JPY. */
export type RefundOption = { key: string; groupName: string; label: string; quantity: number; grossAmount: number; paidAmount: number };
export type RefundSnapshot = { version: 1; paidAmount: number; customizations: Record<string, unknown>[]; labels: Record<string, unknown>; options: RefundOption[] };
export type RefundItem = {
  id: string; quantity: number; amount: number; grossAmount: number; paidAmount: number;
  discountAmount: number; couponDiscountAmount: number; couponId: string; exchangeCoupon?: boolean;
  refundStatus: string; refundedAmount: number; customizations: unknown;
  refundSnapshot: RefundSnapshot | null; refundedOptionKeys: string[];
  sizeKey?: string; size?: string; temperature?: string; sweetness?: string; ice?: string;
  optionKey?: string; option?: string; toppingKeys?: string[]; toppings?: string[];
};
export type OptionSelection = { itemId: string; key: string };
export class PosRefundError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function allocateRefundYen(total: number, weights: number[]) {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) throw new PosRefundError('会計金額の内訳を確認してください。');
  const sum = weights.reduce((n, w) => n + BigInt(w), BigInt(0));
  if (!sum) { if (total) throw new PosRefundError('会計金額の内訳を確認してください。'); return weights.map(() => 0); }
  const parts = weights.map((w, i) => ({ i, amount: Number(BigInt(total) * BigInt(w) / sum), remainder: BigInt(total) * BigInt(w) % sum }));
  let left = total - parts.reduce((n, p) => n + p.amount, 0);
  for (const p of [...parts].sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1)) if (left-- > 0) p.amount++;
  return parts.map(p => p.amount);
}
const groups = (value: unknown) => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [];
const strings = (v: unknown) => Array.isArray(v) ? v.map(x => String(x ?? '')) : [];
export function refundSnapshots(items: RefundItem[], orderAmount: number): RefundSnapshot[] {
  // amount is the remaining order balance. Item refunded amounts retain every prior refund.
  const originalTotal = orderAmount + items.reduce((sum, item) => sum + item.refundedAmount, 0);
  const taxedPaidAmounts = allocateRefundYen(originalTotal, items.map(item => item.paidAmount));
  return items.map((item, index) => {
    if (item.refundSnapshot?.version === 1) return item.refundSnapshot;
    const customizations = groups(item.customizations);
    const options: RefundOption[] = [];
    customizations.forEach((group, gi) => {
      const labels = strings(group.optionLabels), prices = group.optionPrices;
      // Historical display labels alone are not enough to infer a refundable price.
      if (!Array.isArray(prices) || prices.length !== labels.length) return;
      labels.forEach((label, oi) => {
        const price = prices[oi];
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
        options.push({ key: `${gi}:${oi}`, groupName: String(group.groupName ?? ''), label, quantity: item.quantity, grossAmount: Math.round(price * item.quantity), paidAmount: 0 });
      });
    });
    const gross = item.grossAmount || item.amount;
    const weights = [Math.max(0, gross - options.reduce((n, o) => n + o.grossAmount, 0)), ...options.map(o => o.grossAmount)];
    const grossShares = allocateRefundYen(Math.max(0, gross), weights);
    const discounts = allocateRefundYen(Math.min(gross, Math.max(0, item.discountAmount)), grossShares);
    const afterDiscount = grossShares.map((n, i) => n - discounts[i]);
    const coupon = Math.min(afterDiscount.reduce((n, v) => n + v, 0), Math.max(0, item.couponDiscountAmount));
    let couponShares: number[];
    if (item.exchangeCoupon) {
      // Exchange tickets cover the base product; priced additions remain payable.
      const base = Math.min(coupon, afterDiscount[0]);
      couponShares = [base, ...allocateRefundYen(coupon - base, afterDiscount.slice(1))];
    } else couponShares = allocateRefundYen(coupon, afterDiscount);
    const paidShares = allocateRefundYen(taxedPaidAmounts[index], afterDiscount.map((n, i) => Math.max(0, n - couponShares[i])));
    options.forEach((option, i) => { option.paidAmount = paidShares[i + 1]; });
    return { version: 1, paidAmount: taxedPaidAmounts[index], customizations, options,
      labels: { sizeKey: item.sizeKey, size: item.size, temperature: item.temperature, sweetness: item.sweetness, ice: item.ice, optionKey: item.optionKey, option: item.option, toppingKeys: item.toppingKeys, toppings: item.toppings } };
  });
}
export function activeRefundCustomizations(snapshot: RefundSnapshot, refundedKeys: string[]) {
  const removed = new Set(refundedKeys);
  return snapshot.customizations.flatMap((group, gi) => {
    const labels = strings(group.optionLabels);
    const keep = labels.map((_, oi) => !removed.has(`${gi}:${oi}`));
    const result = { ...group };
    for (const field of ['optionIds', 'optionKeys', 'optionLabels', 'optionPrices', 'optionDisplayNames', 'storeMenuOptionIds', 'localOptions', 'linkedItems']) {
      const values = group[field];
      if (Array.isArray(values) && values.length === labels.length) result[field] = values.filter((_, i) => keep[i]);
    }
    return keep.some(Boolean) ? [result] : [];
  });
}
export function activeRefundLabels(customizations: Record<string, unknown>[]) {
  const values = (key: string, field = 'optionLabels') => customizations.filter(g => g.groupKey === key).flatMap(g => strings(g[field]));
  const toppings = customizations.filter(g => !['size', 'temperature', 'sweetness', 'ice', 'option'].includes(String(g.groupKey))).flatMap(g => strings(g.optionLabels));
  const toppingKeys = customizations.filter(g => !['size', 'temperature', 'sweetness', 'ice', 'option'].includes(String(g.groupKey))).flatMap(g => strings(g.optionKeys));
  return { sizeKey: values('size', 'optionKeys').join(','), size: values('size').join(', '), temperature: values('temperature').join(', '), sweetness: values('sweetness').join(', '), ice: values('ice').join(', '), optionKey: values('option', 'optionKeys').join(','), option: values('option').join(', '), toppingKeys, toppings };
}
export function planPosRefund(items: RefundItem[], orderAmount: number, itemIds: string[], selections: OptionSelection[]) {
  if (!itemIds.length && !selections.length) throw new PosRefundError('返品する商品・追加選択肢を選択してください。');
  if (new Set(itemIds).size !== itemIds.length || new Set(selections.map(s => `${s.itemId}/${s.key}`)).size !== selections.length) throw new PosRefundError('同じ返品対象が重複しています。');
  const byId = new Map(items.map((item, i) => [item.id, i]));
  for (const id of [...itemIds, ...selections.map(s => s.itemId)]) if (!byId.has(id)) throw new PosRefundError('返金する商品が見つかりません。', 404);
  if (selections.some(s => itemIds.includes(s.itemId))) throw new PosRefundError('商品全体とその追加選択肢は同時に選択できません。');
  const snapshots = refundSnapshots(items, orderAmount);
  const updates = items.flatMap((item, i) => {
    const full = itemIds.includes(item.id), selected = selections.filter(s => s.itemId === item.id);
    if (!full && !selected.length) return [];
    if (item.refundStatus === 'refunded') throw new PosRefundError('返金済みの商品が含まれています。', 409);
    const snapshot = snapshots[i], prior = item.refundedOptionKeys || [];
    const remaining = snapshot.paidAmount - item.refundedAmount;
    const selectedOptions = selected.map(s => {
      const option = snapshot.options.find(o => o.key === s.key);
      if (!option || option.paidAmount <= 0) throw new PosRefundError('金額を確認できない追加選択肢は返金できません。');
      if (prior.includes(s.key)) throw new PosRefundError('返金済みの追加選択肢が含まれています。', 409);
      return option;
    });
    const amount = full ? remaining : selectedOptions.reduce((sum, o) => sum + o.paidAmount, 0);
    if (amount < 0 || amount > remaining || (!full && amount <= 0) || (full && amount === 0 && !item.couponId && !item.couponDiscountAmount)) throw new PosRefundError('返金可能な残額を確認してください。', 409);
    const keys = [...prior, ...selectedOptions.map(o => o.key)];
    const customizations = activeRefundCustomizations(snapshot, keys);
    return [{ id: item.id, full, amount, snapshot, refundedOptionKeys: keys, options: selectedOptions,
      customizations, labels: activeRefundLabels(customizations), refundedAmount: item.refundedAmount + amount,
      couponId: full ? item.couponId : '', quantity: full ? item.quantity : 0,
      stampQuantity: full && String(snapshot.labels.sizeKey || snapshot.labels.size || '').toLowerCase() !== 's' ? item.quantity : 0 }];
  });
  const amount = updates.reduce((sum, item) => sum + item.amount, 0);
  if (amount > orderAmount) throw new PosRefundError('返金可能な残額を確認してください。', 409);
  return { amount, updates, allRefunded: items.every(item => item.refundStatus === 'refunded' || updates.some(u => u.id === item.id && u.full)) };
}
