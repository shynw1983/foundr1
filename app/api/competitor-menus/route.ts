import { requireMasterOsSession } from "../../../lib/api-auth";
import { scanCompetitorMenuSource, type CompetitorSourceType } from "../../../lib/competitor-menu-monitor";
import { sql } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sourceTypes = new Set<CompetitorSourceType>(["website", "uber_eats", "delivery_platform", "json"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parsePublicUrl(value: unknown) {
  const raw = text(value, 2_000);
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function plainText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return plainText(record.text ?? record.title ?? record.label);
}

type PublicOptionGroup = {
  id: string;
  title: string;
  min: number;
  max: number;
  options: Array<{
    id: string;
    title: string;
    price: number;
    isSoldOut: boolean;
    childGroups: PublicOptionGroup[];
  }>;
};

function normalizeOptionGroups(value: unknown, depth = 0): PublicOptionGroup[] {
  if (!Array.isArray(value) || depth > 4) return [];
  return value.flatMap((entry, groupIndex) => {
    if (!entry || typeof entry !== "object") return [];
    const group = entry as Record<string, unknown>;
    const options = Array.isArray(group.options) ? group.options : [];
    return [{
      id: plainText(group.uuid ?? group.id) || `group-${depth}-${groupIndex}`,
      title: plainText(group.title ?? group.name) || "選択内容",
      min: Number(group.minPermittedUnique ?? group.minPermitted ?? 0) || 0,
      max: Number(group.maxPermittedUnique ?? group.maxPermitted ?? 0) || 0,
      options: options.flatMap((optionEntry, optionIndex) => {
        if (!optionEntry || typeof optionEntry !== "object") return [];
        const option = optionEntry as Record<string, unknown>;
        const rawPrice = Number(option.price ?? option.priceAmount ?? 0);
        return [{
          id: plainText(option.uuid ?? option.id) || `option-${depth}-${groupIndex}-${optionIndex}`,
          title: plainText(option.title ?? option.name) || "名称未設定",
          price: Number.isFinite(rawPrice) ? rawPrice / 100 : 0,
          isSoldOut: option.isSoldOut === true || option.isAvailable === false,
          childGroups: normalizeOptionGroups(option.childCustomizationList ?? option.customizationsList, depth + 1)
        }];
      })
    }];
  });
}

function optionTotals(groups: PublicOptionGroup[]) {
  let groupCount = 0;
  let optionCount = 0;
  function visit(entries: PublicOptionGroup[]) {
    for (const group of entries) {
      groupCount += 1;
      optionCount += group.options.length;
      for (const option of group.options) visit(option.childGroups);
    }
  }
  visit(groups);
  return { groupCount, optionCount };
}

function promotionFromRaw(raw: Record<string, unknown>) {
  const tagline = raw.priceTagline && typeof raw.priceTagline === "object"
    ? raw.priceTagline as Record<string, unknown>
    : {};
  const format = typeof tagline.textFormat === "string" ? tagline.textFormat : "";
  const originalPrice = format.match(/line-through[^>]*>([^<]+)</i)?.[1]?.trim() ?? "";
  const currentPrice = plainText(tagline.text);
  const active = Boolean(raw.promoInfo) || Boolean(originalPrice);
  return { active, currentPrice: active ? currentPrice : "", originalPrice };
}

export async function GET() {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const [sources, changes, recentRuns, summaryRows, itemRows] = await Promise.all([
    sql`
      select sources.id::text, sources.competitor_name as "competitorName", sources.source_name as "sourceName",
        sources.source_url as "sourceUrl", sources.source_type as "sourceType", sources.is_active as "isActive",
        sources.last_scanned_at as "lastScannedAt", sources.last_success_at as "lastSuccessAt",
        sources.last_rating::float as "lastRating", sources.last_review_count_label as "lastReviewCountLabel",
        sources.last_error as "lastError", sources.created_at as "createdAt",
        coalesce(items.item_count, 0)::int as "itemCount",
        coalesce(items.present_count, 0)::int as "presentItemCount",
        coalesce(changes.new_count, 0)::int as "newProductCount"
      from competitor_menu_sources sources
      left join lateral (
        select count(*)::int as item_count, count(*) filter (where is_present)::int as present_count
        from competitor_menu_items where source_id = sources.id
      ) items on true
      left join lateral (
        select count(*) filter (where change_type = 'new_product' and detected_at >= now() - interval '30 days')::int as new_count
        from competitor_menu_changes where source_id = sources.id
      ) changes on true
      order by sources.is_active desc, sources.competitor_name, sources.created_at
    `,
    sql`
      select changes.id::text, changes.source_id::text as "sourceId", sources.competitor_name as "competitorName",
        sources.source_name as "sourceName", changes.change_type as "changeType", changes.title,
        changes.summary, changes.current_value as "currentValue", changes.detected_at as "detectedAt"
      from competitor_menu_changes changes
      join competitor_menu_sources sources on sources.id = changes.source_id
      order by changes.detected_at desc
      limit 100
    `,
    sql`
      select runs.id::text, runs.source_id::text as "sourceId", sources.competitor_name as "competitorName",
        runs.trigger_type as "triggerType", runs.status, runs.item_count as "itemCount",
        runs.new_item_count as "newItemCount", runs.change_count as "changeCount",
        runs.error_detail as "errorDetail", runs.started_at as "startedAt", runs.completed_at as "completedAt"
      from competitor_menu_scan_runs runs
      join competitor_menu_sources sources on sources.id = runs.source_id
      order by runs.started_at desc
      limit 30
    `,
    sql`
      select
        count(*) filter (where is_active)::int as "activeSources",
        (select count(*)::int from competitor_menu_changes where change_type = 'new_product' and detected_at >= now() - interval '30 days') as "newProducts30d",
        (select max(completed_at) from competitor_menu_scan_runs where status = 'succeeded') as "lastCompletedAt"
      from competitor_menu_sources
    `,
    sql`
      select items.id::text, items.source_id::text as "sourceId", sources.competitor_name as "competitorName",
        items.name, items.category, items.description, items.price::float as price, items.currency,
        items.item_url as "itemUrl", items.image_url as "imageUrl", items.is_available as "isAvailable",
        items.raw_payload as "rawPayload", items.last_seen_at as "lastSeenAt"
      from competitor_menu_items items
      join competitor_menu_sources sources on sources.id = items.source_id
      where items.is_present = true
      order by sources.competitor_name, items.category, items.name
    `
  ]);
  const items = itemRows.map((row) => {
    const raw = row.rawPayload && typeof row.rawPayload === "object" ? row.rawPayload as Record<string, unknown> : {};
    const optionGroups = normalizeOptionGroups(raw.customizationsList);
    return {
      id: String(row.id),
      sourceId: String(row.sourceId),
      competitorName: String(row.competitorName),
      name: String(row.name),
      category: String(row.category),
      description: String(row.description),
      price: row.price === null ? null : Number(row.price),
      currency: String(row.currency),
      itemUrl: String(row.itemUrl),
      imageUrl: String(row.imageUrl),
      isAvailable: row.isAvailable === true,
      lastSeenAt: row.lastSeenAt,
      promotion: promotionFromRaw(raw),
      optionGroups,
      ...optionTotals(optionGroups)
    };
  });
  return Response.json({ sources, items, changes, recentRuns, summary: summaryRows[0] ?? { activeSources: 0, newProducts30d: 0, lastCompletedAt: null } });
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action, 30) || "create";

  if (action === "scan") {
    const id = text(body.id, 50);
    if (!uuidPattern.test(id)) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });
    const result = await scanCompetitorMenuSource(id, "manual");
    return Response.json(result, { status: result.ok ? 200 : 422 });
  }

  const competitorName = text(body.competitorName, 160);
  const sourceName = text(body.sourceName, 160);
  const sourceUrl = parsePublicUrl(body.sourceUrl);
  const sourceTypeValue = text(body.sourceType, 40) as CompetitorSourceType;
  const sourceType = sourceTypes.has(sourceTypeValue) ? sourceTypeValue : "website";
  if (!competitorName) return Response.json({ error: "競合店名を入力してください。" }, { status: 400 });
  if (!sourceUrl) return Response.json({ error: "公開メニューのURLを入力してください。" }, { status: 400 });

  try {
    const rows = await sql`
      insert into competitor_menu_sources (
        competitor_name, source_name, source_url, source_type, created_by
      ) values (${competitorName}, ${sourceName}, ${sourceUrl}, ${sourceType}, ${session.id})
      returning id::text
    `;
    return Response.json({ ok: true, id: String(rows[0].id) });
  } catch (error) {
    const message = error instanceof Error && /unique|duplicate/i.test(error.message)
      ? "このメニューURLはすでに登録されています。"
      : "監視先を保存できませんでした。";
    return Response.json({ error: message }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = text(body.id, 50);
  if (!uuidPattern.test(id)) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });

  const rows = await sql`
    update competitor_menu_sources
    set is_active = ${body.isActive === true}, updated_at = now()
    where id::text = ${id}
    returning id::text
  `;
  if (!rows[0]) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const id = text(new URL(request.url).searchParams.get("id"), 50);
  if (!uuidPattern.test(id)) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });
  const rows = await sql`delete from competitor_menu_sources where id::text = ${id} returning id::text`;
  if (!rows[0]) return Response.json({ error: "監視先が見つかりません。" }, { status: 404 });
  return Response.json({ ok: true });
}
