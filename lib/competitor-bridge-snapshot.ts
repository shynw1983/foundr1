import { sql } from "./db";
import { canonicalCompetitorProductIdentity } from "./competitor-menu-identity";
import { describeStorePromotionChange, storePromotionSnapshotChanged } from "./competitor-promotion-history";
import { resolvePromotionObservation, type StoreStatusSnapshot } from "./competitor-promotion-observation";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("ja-JP");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function promotionFromRaw(value: unknown) {
  const raw = record(value);
  if (raw._promotionDetails && typeof raw._promotionDetails === "object") return raw._promotionDetails as Record<string, unknown>;
  const promoInfo = record(raw.promoInfo);
  const analytics = record(raw.catalogItemAnalyticsData);
  const priceTagline = record(raw.priceTagline);
  const format = String(priceTagline.textFormat ?? "");
  const originalPrice = format.match(/line-through[^>]*>([^<]+)</i)?.[1]?.trim() ?? "";
  const labels = JSON.stringify(promoInfo).match(/\d+(?:\.\d+)?%\s*off/giu) ?? [];
  const promoType = String(analytics.promoType ?? "").trim();
  if (!Object.keys(promoInfo).length && !promoType && !originalPrice) return {};
  return {
    ...(labels.length ? { labels: [...new Set(labels)] } : {}),
    ...(promoType ? { promoType } : {}),
    ...(priceTagline.text ? { currentPrice: String(priceTagline.text) } : {}),
    ...(originalPrice ? { originalPrice } : {})
  };
}

function bridgePromotionDetails(value: Record<string, unknown>) {
  const labels = Array.isArray(value.discountLabels) ? value.discountLabels.map(String).filter(Boolean) : [];
  const currentPrice = String(value.currentPrice ?? "").trim();
  const originalPrice = String(value.originalPrice ?? "").trim();
  return {
    ...(labels.length ? { labels } : {}),
    promoType: "DISCOUNTED_ITEM",
    ...(currentPrice ? { currentPrice } : {}),
    ...(originalPrice ? { originalPrice } : {})
  };
}

function promotionSummary(price: number | null, previous: Record<string, unknown>, current: Record<string, unknown>) {
  const normal = price === null ? "通常価格不明" : `通常価格は¥${Math.round(price).toLocaleString("ja-JP")}で前回から変更なし`;
  const previousActive = Object.keys(previous).length > 0;
  const currentActive = Object.keys(current).length > 0;
  if (previousActive && !currentActive) return `${normal}、割引が終了しました。`;
  const discount = String(current.currentPrice ?? "割引価格不明");
  const labels = Array.isArray(current.labels) ? current.labels.map(String).join("・") : "";
  if (!previousActive && currentActive) return `${normal}、${discount}${labels ? `（${labels}）` : ""}の割引が開始されました。`;
  return `${normal}、割引内容が${String(previous.currentPrice ?? "不明")}から${discount}${labels ? `（${labels}）` : ""}に変わりました。`;
}

export async function applyCompetitorBridgeSnapshot(input: Record<string, unknown>) {
  const sourceId = String(input.sourceId ?? "").trim();
  if (!sourceId) throw new Error("competitor_bridge_source_missing");
  const sourceRows = await sql`
    select id::text, competitor_name as "competitorName", source_url as "sourceUrl",
      last_promotions as "lastPromotions"
    from competitor_menu_sources where id::text=${sourceId} limit 1
  `;
  const source = sourceRows[0] as { id: string; competitorName: string; sourceUrl: string; lastPromotions: Record<string, unknown> | null } | undefined;
  if (!source) throw new Error("competitor_bridge_source_not_found");
  const statusInput = record(input.storeStatus);
  const storeStatus: StoreStatusSnapshot = {
    isOpen: typeof statusInput.isOpen === "boolean" ? statusInput.isOpen : null,
    isOrderable: typeof statusInput.isOrderable === "boolean" ? statusInput.isOrderable : null,
    availabilityState: String(statusInput.availabilityState ?? ""),
    availabilityMessage: String(statusInput.availabilityMessage ?? ""),
    workingHoursLabel: String(statusInput.workingHoursLabel ?? ""),
    observedAt: String(statusInput.observedAt ?? input.observedAt ?? new Date().toISOString()),
    source: "bridge"
  };
  const complete = input.promotionComplete === true && storeStatus.isOpen === true;
  const observation = resolvePromotionObservation({
    previous: source.lastPromotions,
    current: input.promotions,
    isOpen: storeStatus.isOpen,
    complete
  });
  const itemRows = await sql`
    select id::text, external_key as "externalKey", name, price::float as price,
      currency, raw_payload as "rawPayload"
    from competitor_menu_items where source_id=${source.id} and is_present=true
  ` as Array<{ id: string; externalKey: string; name: string; price: number | null; currency: string; rawPayload: Record<string, unknown> }>;
  const observedPromotions = new Map<string, Record<string, unknown>>();
  for (const campaign of Array.isArray(record(input.promotions).campaigns) ? record(input.promotions).campaigns as unknown[] : []) {
    for (const value of Array.isArray(record(campaign).items) ? record(campaign).items as unknown[] : []) {
      const item = record(value);
      const details = bridgePromotionDetails(item);
      const key = canonicalCompetitorProductIdentity(String(item.key ?? ""));
      if (key) observedPromotions.set(`id:${key}`, details);
      const name = normalize(item.name);
      if (name) observedPromotions.set(`name:${name}`, details);
    }
  }
  const changes: Array<{
    itemId: string | null;
    type: "item_promotion_changed" | "store_promotion_changed";
    title: string;
    summary: string;
    previousValue: Record<string, unknown>;
    currentValue: Record<string, unknown>;
  }> = [];
  if (source.lastPromotions !== null && storePromotionSnapshotChanged(source.lastPromotions, observation.promotions)) {
    changes.push({
      itemId: null,
      type: "store_promotion_changed",
      title: source.competitorName,
      summary: describeStorePromotionChange(source.lastPromotions, observation.promotions),
      previousValue: { promotions: source.lastPromotions, itemUrl: source.sourceUrl },
      currentValue: { promotions: observation.promotions, itemUrl: source.sourceUrl }
    });
  }
  for (const item of itemRows) {
    const previousPromotion = promotionFromRaw(item.rawPayload);
    const identity = canonicalCompetitorProductIdentity(item.externalKey);
    const observed = observedPromotions.get(`id:${identity}`) ?? observedPromotions.get(`name:${normalize(item.name)}`);
    const currentPromotion = observed ?? (complete ? {} : previousPromotion);
    if (stableJson(previousPromotion) === stableJson(currentPromotion)) continue;
    changes.push({
      itemId: item.id,
      type: "item_promotion_changed",
      title: item.name,
      summary: promotionSummary(item.price, previousPromotion, currentPromotion),
      previousValue: { name: item.name, price: item.price, currency: item.currency, promotionDetails: previousPromotion, itemUrl: source.sourceUrl },
      currentValue: { name: item.name, price: item.price, currency: item.currency, promotionDetails: currentPromotion, itemUrl: source.sourceUrl }
    });
    await sql`
      update competitor_menu_items
      set raw_payload=jsonb_set(raw_payload, '{_promotionDetails}', ${JSON.stringify(currentPromotion)}::jsonb, true), updated_at=now()
      where id::text=${item.id}
    `;
  }
  const runRows = await sql`
    insert into competitor_menu_scan_runs (
      source_id, trigger_type, status, item_count, change_count, store_status,
      promotion_observation_status, completed_at
    ) values (
      ${source.id}, 'system', 'succeeded', ${itemRows.length}, ${changes.length},
      ${JSON.stringify(storeStatus)}::jsonb, ${observation.status}, now()
    ) returning id::text
  `;
  for (const change of changes) {
    await sql`
      insert into competitor_menu_changes (
        source_id, item_id, change_type, title, summary, previous_value, current_value
      ) values (
        ${source.id}, ${change.itemId}, ${change.type}, ${change.title}, ${change.summary},
        ${JSON.stringify(change.previousValue)}::jsonb, ${JSON.stringify(change.currentValue)}::jsonb
      )
    `;
  }
  await sql`
    update competitor_menu_sources set last_promotions=${JSON.stringify(observation.promotions)}::jsonb,
      last_store_status=${JSON.stringify(storeStatus)}::jsonb, last_scanned_at=now(), last_success_at=now(),
      last_error='', updated_at=now() where id=${source.id}
  `;
  return { sourceId: source.id, runId: String(runRows[0].id), changeCount: changes.length, promotionObservationStatus: observation.status };
}
