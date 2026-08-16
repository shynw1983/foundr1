import {
  findMaamaaProductionRule,
  translateMaamaaReferenceText,
  type MaamaaProductionReferenceSettings,
  type MaamaaSetItem,
  type MaamaaSetRule
} from "./maamaa-production-rules.ts";

export type InventoryDependencyProduct = {
  id: string;
  name: string;
  familyName: string;
  japaneseNote: string;
};

function compactInventoryName(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/gu, "")
    .replace(/(?:約)?\d+(?:\.\d+)?\s*(?:g|kg|個|枚|本|袋|パック|杯|人前|ヶ|个|张|根|包|份)/giu, "")
    .replace(/^(?:トッピング|麺|面|具材|食材)\s*[:：]/u, "")
    .replace(/冷凍|乾燥|厳選|高級|特選|国産|追加|変更|スライス|slice|片/giu, "")
    .replace(/[\s\u3000・·|｜()[\]（）「」『』【】"'’“”.,。、:：;；!！?？\-_/\\]/g, "")
    .trim();
}

export function inventoryDependencyKeys(value: unknown) {
  const source = String(value ?? "").trim();
  if (!source) return [];
  const productionRule = findMaamaaProductionRule(source);
  const candidates = [
    source,
    translateMaamaaReferenceText(source, "zh"),
    productionRule?.id,
    productionRule?.customerName,
    productionRule?.kitchenName,
    ...(productionRule?.aliases ?? [])
  ];
  return Array.from(new Set(candidates.map(compactInventoryName).filter((key) => key.length >= 2)));
}

export function inventoryDependencyMatches(left: unknown, right: unknown) {
  const leftKeys = new Set(inventoryDependencyKeys(left));
  return inventoryDependencyKeys(right).some((key) => leftKeys.has(key));
}

function productNames(product: InventoryDependencyProduct | undefined, fallback = "") {
  return [fallback, product?.name, product?.familyName, product?.japaneseNote].filter(Boolean);
}

function setItems(rule: MaamaaSetRule): MaamaaSetItem[] {
  return rule.items?.length
    ? rule.items.filter((item) => item.affectsAvailability !== false)
    : rule.defaultItems.map((productName) => ({ productName } satisfies MaamaaSetItem));
}

export function dependentSetRuleNames(
  ingredientLabel: string,
  settings: MaamaaProductionReferenceSettings,
  productsById = new Map<string, InventoryDependencyProduct>()
) {
  const commonRule = settings.setRules.find((rule) => /(共通|通用|common)/i.test(rule.name));
  const individualRules = settings.setRules.filter((rule) => (
    rule !== commonRule && !/(複数杯|多杯|operation)/i.test(rule.name)
  ));
  const commonMatches = commonRule
    ? setItems(commonRule).some((item) => productNames(item.productId ? productsById.get(item.productId) : undefined, item.productName)
      .some((name) => inventoryDependencyMatches(ingredientLabel, name)))
    : false;

  return individualRules.filter((rule) => commonMatches || setItems(rule).some((item) => (
    productNames(item.productId ? productsById.get(item.productId) : undefined, item.productName)
      .some((name) => inventoryDependencyMatches(ingredientLabel, name))
  ))).map((rule) => rule.name);
}
