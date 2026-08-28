import { requireMasterOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changeTypeLabels: Record<string, string> = {
  new_product: "新商品",
  removed: "掲載終了",
  price_changed: "価格変更",
  renamed: "名称変更",
  category_changed: "分類変更",
  description_changed: "商品説明変更",
  image_changed: "商品画像変更",
  availability_changed: "販売状態変更",
  details_changed: "商品詳細変更",
  options_changed: "商品選択内容変更",
  store_rating_changed: "店舗評価変更",
  store_review_count_changed: "評価件数変更",
  store_promotion_changed: "店舗キャンペーン変更",
  item_promotion_changed: "商品割引変更",
  returned: "掲載再開"
};

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function dateParam(value: string | null, fallback: Date) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function value(record: unknown, key: string) {
  if (!record || typeof record !== "object") return "";
  return (record as Record<string, unknown>)[key] ?? "";
}

function availabilityLabel(record: unknown) {
  const available = value(record, "isAvailable");
  if (available === "") return "";
  return available === true ? "販売中" : "売り切れ・販売停止";
}

function detailsLabel(record: unknown) {
  const details = value(record, "details");
  if (!details || typeof details !== "object" || !Object.keys(details as Record<string, unknown>).length) return "";
  return JSON.stringify(details);
}

function optionsLabel(record: unknown) {
  const options = value(record, "options");
  if (!options || typeof options !== "object" || !Object.keys(options as Record<string, unknown>).length) return "";
  return JSON.stringify(options);
}

function promotionsLabel(record: unknown) {
  const promotions = value(record, "promotionDetails") || value(record, "promotions");
  if (!promotions || typeof promotions !== "object" || !Object.keys(promotions as Record<string, unknown>).length) return "";
  return JSON.stringify(promotions);
}

export async function GET(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const sourceId = String(params.get("sourceId") ?? "").trim();
  if (sourceId && !uuidPattern.test(sourceId)) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = dateParam(params.get("from"), defaultFrom);
  const toStart = dateParam(params.get("to"), now);
  const to = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);

  const rows = await sql`
    select changes.change_type as "changeType", changes.title, changes.summary,
      changes.previous_value as "previousValue", changes.current_value as "currentValue",
      changes.detected_at as "detectedAt", sources.competitor_name as "competitorName",
      sources.source_name as "sourceName", sources.source_url as "sourceUrl"
    from competitor_menu_changes changes
    join competitor_menu_sources sources on sources.id = changes.source_id
    where changes.detected_at >= ${from.toISOString()}
      and changes.detected_at < ${to.toISOString()}
      and (${sourceId} = '' or changes.source_id::text = ${sourceId})
    order by changes.detected_at desc, sources.competitor_name, changes.title
  `;

  const headers = [
    "発見日時", "競合店", "メニュー情報元", "変更種類", "商品名", "変更内容",
    "変更前価格", "変更後価格", "通貨", "変更前分類", "変更後分類",
    "変更前販売状態", "変更後販売状態", "変更前商品説明", "変更後商品説明",
    "変更前画像", "変更後画像", "変更前その他情報", "変更後その他情報",
    "変更前商品選択内容", "変更後商品選択内容",
    "変更前店舗評価", "変更後店舗評価", "変更前評価件数", "変更後評価件数",
    "変更前割引・キャンペーン", "変更後割引・キャンペーン",
    "商品URL", "メニューURL"
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    const previous = row.previousValue;
    const current = row.currentValue;
    lines.push([
      new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(String(row.detectedAt))),
      row.competitorName,
      row.sourceName,
      changeTypeLabels[String(row.changeType)] || row.changeType,
      row.title,
      row.summary,
      value(previous, "price"),
      value(current, "price"),
      value(current, "currency") || value(previous, "currency"),
      value(previous, "category"),
      value(current, "category"),
      availabilityLabel(previous),
      availabilityLabel(current),
      value(previous, "description"),
      value(current, "description"),
      value(previous, "imageUrl"),
      value(current, "imageUrl"),
      detailsLabel(previous),
      detailsLabel(current),
      optionsLabel(previous),
      optionsLabel(current),
      value(previous, "rating"),
      value(current, "rating"),
      value(previous, "reviewCount"),
      value(current, "reviewCount"),
      promotionsLabel(previous),
      promotionsLabel(current),
      value(current, "itemUrl") || value(previous, "itemUrl"),
      row.sourceUrl
    ].map(csvCell).join(","));
  }
  const dateLabel = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="competitor-menu-changes-${dateLabel}.csv"`,
      "Cache-Control": "no-store"
    }
  });
}
