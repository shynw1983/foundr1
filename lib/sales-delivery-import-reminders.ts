import { sql } from "./db";
import {
  getCurrentDueDeliveryImportPeriod,
  isDeliveryImportPeriodDue,
  type DeliveryImportPeriod
} from "./sales-delivery-import-rules";
import { createOsNotification } from "./web-push";

type DeliverySalesSource = {
  id: string;
  sourceLabel: string;
  brandName: string;
  sourceType: string;
  sourcePlatform: string;
  importSupported: boolean;
};

async function notifyPendingSources(input: {
  storeId: string;
  storeName: string;
  salesSources: DeliverySalesSource[];
  duePeriod: DeliveryImportPeriod;
}) {
  if (!input.storeId || input.salesSources.length === 0) return 0;

  const deliverySources = input.salesSources.filter((source) => source.sourceType === "delivery" && source.importSupported);
  if (deliverySources.length === 0) return 0;

  const deliverySourceIds = deliverySources.map((source) => source.id);
  const deliverySourcePlatforms = Array.from(new Set(deliverySources.map((source) => source.sourcePlatform)));
  const importedRows = await sql`
    select
      sales_source_id::text as "salesSourceId",
      source_platform as "sourcePlatform",
      metadata->>'brandName' as "brandName"
    from sales_import_batches
    where store_id::text = ${input.storeId}
      and (
        sales_source_id::text = any(${deliverySourceIds})
        or source_platform = any(${deliverySourcePlatforms})
      )
      and metadata->>'deliveryImportPeriodKey' = ${input.duePeriod.key}
  `;
  const importedSourceIds = new Set(importedRows.map((row) => String(row.salesSourceId)).filter(Boolean));
  const importedNaturalKeys = new Set(importedRows.map((row) => (
    `${String(row.sourcePlatform)}:${String(row.brandName ?? "")}`
  )));
  const pendingSources = deliverySources.filter((source) => (
    !importedSourceIds.has(source.id)
    && !importedNaturalKeys.has(`${source.sourcePlatform}:${source.brandName}`)
  ));
  if (pendingSources.length === 0) return 0;

  const owners = await sql`
    select id::text
    from employees
    where role = 'owner'
      and status = 'active'
  `;
  if (owners.length === 0) return 0;

  let notificationCount = 0;
  for (const source of pendingSources) {
    const href = `/os/analytics/sales?storeId=${input.storeId}&month=${input.duePeriod.importMonth}`;
    const title = "デリバリー売上データ取込リマインダー";
    const message = `${input.storeName || "店舗"} / ${source.sourceLabel}: ${input.duePeriod.label}分をアップロードしてください。取得範囲は ${input.duePeriod.downloadStartDate}〜${input.duePeriod.downloadEndDate} です。`;
    const existingRows = await sql`
      select 1
      from os_notifications
      where notification_type = 'sales_delivery_import_due'
        and href = ${href}
        and message = ${message}
      limit 1
    `;
    if (existingRows.length > 0) continue;

    await Promise.all(owners.map((owner) => createOsNotification({
      employeeId: String(owner.id),
      type: "sales_delivery_import_due",
      title,
      message,
      href
    })));
    notificationCount += owners.length;
  }

  return notificationCount;
}

export async function notifyOwnersForDueDeliveryImportsForStore(input: {
  storeId: string;
  storeName: string;
  salesSources: DeliverySalesSource[];
}) {
  const duePeriod = getCurrentDueDeliveryImportPeriod();
  if (!isDeliveryImportPeriodDue(duePeriod)) return { notified: 0, duePeriod };

  const notified = await notifyPendingSources({ ...input, duePeriod });
  return { notified, duePeriod };
}

export async function notifyOwnersForDueDeliveryImports() {
  const duePeriod = getCurrentDueDeliveryImportPeriod();
  if (!isDeliveryImportPeriodDue(duePeriod)) return { notified: 0, duePeriod };

  const rows = await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      store_sales_sources.id::text as "sourceId",
      store_sales_sources.source_label as "sourceLabel",
      store_sales_sources.brand_name as "brandName",
      store_sales_sources.source_type as "sourceType",
      store_sales_sources.source_platform as "sourcePlatform"
    from stores
    join store_sales_sources on store_sales_sources.store_id = stores.id
    where stores.status = 'active'
      and store_sales_sources.is_enabled = true
      and store_sales_sources.source_type = 'delivery'
    order by stores.name, store_sales_sources.sort_order, store_sales_sources.source_label, store_sales_sources.brand_name
  `;

  const sourcesByStore = new Map<string, {
    storeName: string;
    salesSources: DeliverySalesSource[];
  }>();
  for (const row of rows) {
    const storeId = String(row.storeId);
    const sourceLabel = row.brandName
      ? `${String(row.sourceLabel)} / ${String(row.brandName)}`
      : String(row.sourceLabel);
    const entry = sourcesByStore.get(storeId) ?? { storeName: String(row.storeName ?? ""), salesSources: [] };
    entry.salesSources.push({
      id: String(row.sourceId),
      sourceLabel,
      brandName: String(row.brandName ?? ""),
      sourceType: String(row.sourceType),
      sourcePlatform: String(row.sourcePlatform),
      importSupported: ["uber_eats", "rocket_now"].includes(String(row.sourcePlatform))
    });
    sourcesByStore.set(storeId, entry);
  }

  let notified = 0;
  for (const [storeId, entry] of sourcesByStore) {
    notified += await notifyPendingSources({ storeId, storeName: entry.storeName, salesSources: entry.salesSources, duePeriod });
  }

  return { notified, duePeriod };
}
