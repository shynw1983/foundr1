export type PosItemPricingMode = 'fixed' | 'weight';
export type PosItemPricingInput = {
  itemKind?: string;
  posPricingMode?: string;
  posPricingOverride?: PosItemPricingMode;
  variableSchema?: Record<string, unknown>;
};
const pricingMode = (value: unknown): PosItemPricingMode | null => value === 'fixed' || value === 'weight' ? value : null;

/** The store's brand mode is a default for its base buildable product, never all food.
 * Menu data and store-owned overrides are trusted inputs; checkout request fields are not. */
export function resolvePosItemPricingMode(item: PosItemPricingInput): PosItemPricingMode {
  if (item.itemKind === 'drink') return 'fixed';
  const override = pricingMode(item.posPricingOverride);
  if (override) return override;
  const schema = item.variableSchema?.posWeightPricing;
  const explicit = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? pricingMode((schema as Record<string, unknown>).mode) : null;
  if (explicit) return explicit;
  return item.itemKind === 'buildable_product' ? pricingMode(item.posPricingMode) || 'fixed' : 'fixed';
}

/** Keep trusted prices, captured rates and production semantics unchanged. */
export function normalizePosItemPricing<T extends PosItemPricingInput>(item: T): T & { posPricingMode: PosItemPricingMode } {
  return { ...item, posPricingMode: resolvePosItemPricingMode(item) };
}
