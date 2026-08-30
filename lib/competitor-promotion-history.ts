function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

type StorePromotionItem = {
  name: string;
  currentPrice: string;
  originalPrice: string;
  discountLabels: string[];
};

type StorePromotionCampaign = {
  title: string;
  itemCount: number;
  discountLabels: string[];
  items: StorePromotionItem[];
};

function storePromotionCampaigns(value: unknown): StorePromotionCampaign[] {
  const record = objectValue(value);
  const campaigns = Array.isArray(record.campaigns) ? record.campaigns : [];
  return campaigns.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const campaign = entry as Record<string, unknown>;
    const items = Array.isArray(campaign.items) ? campaign.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const itemRecord = item as Record<string, unknown>;
      return [{
        name: text(itemRecord.name) || text(itemRecord.title) || "商品名不明",
        currentPrice: text(itemRecord.currentPrice),
        originalPrice: text(itemRecord.originalPrice),
        discountLabels: Array.isArray(itemRecord.discountLabels) ? itemRecord.discountLabels.map(String) : []
      }];
    }) : [];
    return [{
      title: text(campaign.title) || "割引対象商品",
      itemCount: Number(campaign.itemCount) || items.length,
      discountLabels: Array.isArray(campaign.discountLabels) ? campaign.discountLabels.map(String) : [],
      items
    }];
  });
}

function storePromotionStateLabel(value: unknown) {
  const record = objectValue(value);
  const campaigns = storePromotionCampaigns(record);
  if (!campaigns.length) return record.active === true ? "キャンペーンあり（プラットフォームから対象商品の明細なし）" : "キャンペーンなし";
  return campaigns.map((campaign) => {
    const labels = campaign.discountLabels.length ? `／${campaign.discountLabels.join("・")}` : "";
    const count = campaign.itemCount || campaign.items.length;
    const itemDetails = campaign.items.map((item) => {
      const price = item.originalPrice && item.currentPrice
        ? `通常 ${item.originalPrice} → 割引 ${item.currentPrice}`
        : item.currentPrice ? `割引 ${item.currentPrice}` : "価格明細なし";
      const itemLabels = item.discountLabels.length ? `、${item.discountLabels.join("・")}` : "";
      return `${item.name}（${price}${itemLabels}）`;
    });
    return `「${campaign.title}」${count}商品${labels}${itemDetails.length ? `。対象商品：${itemDetails.join("、")}` : "（対象商品名は保存されていません）"}`;
  }).join("／");
}

export function describeStorePromotionChange(previous: unknown, current: unknown) {
  const previousRecord = objectValue(previous);
  const currentRecord = objectValue(current);
  const wasActive = previousRecord.active === true || storePromotionCampaigns(previousRecord).length > 0;
  const isActive = currentRecord.active === true || storePromotionCampaigns(currentRecord).length > 0;
  if (!wasActive && isActive) return `店舗キャンペーンが開始されました。変更後：${storePromotionStateLabel(currentRecord)}。`;
  if (wasActive && !isActive) return `店舗キャンペーンが終了しました。変更前：${storePromotionStateLabel(previousRecord)}。`;
  return `店舗キャンペーン内容が変更されました。変更前：${storePromotionStateLabel(previousRecord)}。変更後：${storePromotionStateLabel(currentRecord)}。`;
}

export function storePromotionSnapshotChanged(previous: unknown, current: unknown) {
  const previousRecord = objectValue(previous);
  const currentRecord = objectValue(current);
  const previousCampaigns = Array.isArray(previousRecord.campaigns) ? previousRecord.campaigns : [];
  const previousHasItemDetails = previousCampaigns.some((campaign) => Array.isArray(objectValue(campaign).items));
  if (previousHasItemDetails) return stableJson(previousRecord) !== stableJson(currentRecord);

  // Older snapshots only stored campaign name, count and discount label. Ignore
  // the newly added item detail once so deployment does not create a false change.
  const legacyShape = (value: Record<string, unknown>) => ({
    active: value.active === true,
    campaigns: (Array.isArray(value.campaigns) ? value.campaigns : []).map((campaign) => {
      const record = objectValue(campaign);
      return {
        title: text(record.title),
        itemCount: Number(record.itemCount) || 0,
        discountLabels: Array.isArray(record.discountLabels) ? record.discountLabels.map(String) : []
      };
    })
  });
  return stableJson(legacyShape(previousRecord)) !== stableJson(legacyShape(currentRecord));
}
