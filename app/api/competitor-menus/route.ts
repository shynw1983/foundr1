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

export async function GET() {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const [sources, changes, recentRuns, summaryRows] = await Promise.all([
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
    `
  ]);
  return Response.json({ sources, changes, recentRuns, summary: summaryRows[0] ?? { activeSources: 0, newProducts30d: 0, lastCompletedAt: null } });
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
