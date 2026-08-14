import { sql } from "../../../../../lib/db";
import {
  applyInventoryAvailability,
  loadInventoryAvailabilityTargets,
  type InventoryAvailabilityResolution
} from "../../../../../lib/inventory-availability";
import { authorizeLocalBridge } from "../../../../../lib/local-bridge-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizedVoiceLabel(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\u3000]/g, "").trim();
}

async function authorize(request: Request, storeId: string) {
  if (!storeId) return null;
  const authorization = await authorizeLocalBridge(request, storeId, "desktop");
  return authorization.authorized ? authorization : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const storeId = text(params.get("storeId"), 80);
  const commandId = text(params.get("commandId"), 80);
  if (!await authorize(request, storeId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!commandId) return Response.json({ error: "commandId is required." }, { status: 400 });
  const rows = await sql`
    select status, result, last_error as "lastError", completed_at::text as "completedAt"
    from local_bridge_commands
    where id::text = ${commandId}
      and store_id::text = ${storeId}
      and command_type = 'set_inventory_availability'
    limit 1
  `;
  if (!rows[0]) return Response.json({ error: "Voice inventory command was not found." }, { status: 404 });
  return Response.json(rows[0], { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const storeId = text(body.storeId, 80);
  if (!await authorize(request, storeId)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = text(body.query);
  const action = text(body.action, 20);
  const preview = body.preview === true;
  if (!query || !["stockout", "restore"].includes(action)) {
    return Response.json({ error: "商品名と操作を確認してください。" }, { status: 400 });
  }
  if (!preview && body.confirmed !== true) {
    return Response.json({ error: "音声操作の確認が必要です。" }, { status: 409 });
  }

  const brandRows = await sql`
    select brands.id::text, brands.name
    from store_brands
    join brands on brands.id = store_brands.brand_id
    where store_brands.store_id::text = ${storeId}
    order by brands.name
  `;
  const matches: Array<{
    brandId: string;
    brandName: string;
    targetKind: "item" | "option";
    resolution: InventoryAvailabilityResolution;
  }> = [];
  for (const brand of brandRows) {
    const brandId = String(brand.id);
    for (const targetKind of ["item", "option"] as const) {
      const resolution = await loadInventoryAvailabilityTargets(storeId, brandId, query, targetKind);
      if (!resolution.targets.length) continue;
      matches.push({ brandId, brandName: String(brand.name), targetKind, resolution });
    }
  }

  if (!matches.length) {
    return Response.json({
      error: `「${query}」に対応する商品または選択肢が見つかりません。`
    }, { status: 404 });
  }
  if (matches.length > 1) {
    return Response.json({
      error: `「${query}」に複数の候補があります。より正確な商品名で話してください。`,
      candidates: matches.map((match) => ({
        brandName: match.brandName,
        targetKind: match.targetKind,
        label: match.resolution.targets[0]?.label ?? match.resolution.ingredientLabel
      }))
    }, { status: 409 });
  }

  const match = matches[0];
  const isAvailable = action === "restore";
  const target = match.resolution.targets[0];
  const matchedLabel = target?.aliases.find((alias) => (
    normalizedVoiceLabel(alias) === normalizedVoiceLabel(query)
  )) ?? target?.label ?? match.resolution.ingredientLabel;
  if (preview) {
    return Response.json({
      ok: true,
      preview: true,
      query,
      matchedLabel,
      brandName: match.brandName,
      targetKind: match.targetKind,
      targetCount: match.resolution.targets.length,
      isAvailable
    });
  }

  const applied = await applyInventoryAvailability({
    storeId,
    resolution: match.resolution,
    isAvailable,
    statusSource: "Siri",
    syncSource: "siri",
    feedbackLabel: matchedLabel,
    updatedBy: null
  });
  return Response.json({
    ok: true,
    query,
    matchedLabel,
    brandName: match.brandName,
    targetKind: match.targetKind,
    targetCount: match.resolution.targets.length,
    isAvailable,
    commands: applied.commands,
    syncRun: applied.syncRun
  });
}
