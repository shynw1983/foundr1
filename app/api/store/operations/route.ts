import { NextResponse } from "next/server";
import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getCurrentBusinessDayClosing, getStoreReceptionState } from "../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";
import { cancelTemporaryClosure, createTemporaryClosure, getAffectedOrdersForTemporaryClosures, getUpcomingTemporaryClosures } from "../../../../lib/store-temporary-closures";

export const dynamic = "force-dynamic";

type StoreOperationPatch = {
  action?: string;
  storeId?: string;
  reservationsEnabled?: boolean;
  minimumPickupMinutes?: number;
  minimumPickupResetPolicy?: string;
  statusNote?: string;
  closureId?: string;
  closureDate?: string;
  closureStartTime?: string;
  closureEndTime?: string;
  closureReason?: string;
  closurePublicMessage?: string;
};

const brandDefaultPickupMinutes: Record<string, number> = {
  nanacha: 5,
  maamaa: 15
};

function getBrandDefaultPickupMinutes(brand: { brandName: string; brandType: string }) {
  const normalizedType = brand.brandType.toLowerCase();
  const normalizedName = brand.brandName.toLowerCase();
  if (normalizedType.includes("nanacha") || normalizedName.includes("nanacha")) return 5;
  if (normalizedType.includes("maamaa") || normalizedName.includes("maamaa") || normalizedName.includes("まぁ麻")) return 15;
  return brandDefaultPickupMinutes[normalizedType];
}

function normalizeMinimumPickupMinutes(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes)) return null;
  return Math.max(0, Math.min(240, minutes));
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const access = await getStoreOrderAccess(session);
  const url = new URL(request.url);
  const requestedStoreId = url.searchParams.get("storeId");
  const storeId = getScopedStoreFilter(access, requestedStoreId) ?? access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return NextResponse.json({ error: "店舗を選択できません。" }, { status: 403 });
  }

  const rows = await sql`
    select
      stores.id::text,
      stores.name,
      stores.business_hours as "businessHours",
      coalesce(stores.reservation_note, '') as "reservationNote",
      case
        when store_operations.minimum_pickup_reset_at is not null and store_operations.minimum_pickup_reset_at <= now() then null
        else store_operations.minimum_pickup_minutes
      end as "minimumPickupMinutes",
      case
        when store_operations.minimum_pickup_reset_at is not null and store_operations.minimum_pickup_reset_at <= now() then null
        else store_operations.minimum_pickup_reset_at
      end as "minimumPickupResetAt",
      case
        when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then true
        else coalesce(store_operations.reservations_enabled, true)
      end as "reservationsEnabled",
      case
        when store_operations.temporary_status_until is not null and store_operations.temporary_status_until <= now() then ''
        else coalesce(store_operations.status_note, '')
      end as "statusNote",
      store_operations.temporary_status_until as "temporaryStatusUntil"
    from stores
    left join store_operations on store_operations.store_id = stores.id
    where stores.id = ${storeId}
    limit 1
  `;

  const operation = rows[0] as (Record<string, unknown> & {
    businessHours?: unknown;
    minimumPickupMinutes?: number | null;
    minimumPickupResetAt?: string | Date | null;
    reservationsEnabled?: boolean;
    statusNote?: string;
    temporaryStatusUntil?: string | Date | null;
  }) | undefined;

  const brandRows = await sql`
    select lower(brands.brand_type) as "brandType", brands.name
    from store_brands
    join brands on brands.id = store_brands.brand_id
    where store_brands.store_id = ${storeId}
      and brands.status = 'active'
    order by brands.name
  `;
  const brandDefaults = brandRows
    .map((brand) => {
      const entry = {
        brandName: String(brand.name ?? ""),
        brandType: String(brand.brandType ?? "")
      };
      return {
        ...entry,
        minimumPickupMinutes: getBrandDefaultPickupMinutes(entry)
      };
    })
    .filter((brand) => Number.isFinite(brand.minimumPickupMinutes));
  const defaultMinimumPickupMinutes = brandDefaults.length > 0 ? brandDefaults[0].minimumPickupMinutes : 15;

  const [temporaryClosures, affectedOrders] = await Promise.all([
    getUpcomingTemporaryClosures(storeId),
    getAffectedOrdersForTemporaryClosures(storeId)
  ]);

  return NextResponse.json({
    access,
    selectedStoreId: storeId,
    temporaryClosures,
    affectedOrders,
    operation: operation
      ? {
          ...operation,
          receptionState: getStoreReceptionState({
            businessHours: operation.businessHours,
            reservationsEnabled: operation.reservationsEnabled !== false,
            statusNote: operation.statusNote,
            temporaryStatusUntil: operation.temporaryStatusUntil
          }),
          defaultMinimumPickupMinutes,
          brandDefaultPickupMinutes: brandDefaults
        }
      : null
  });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  if (session.role === "store_terminal") return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const access = await getStoreOrderAccess(session);
  const body = await request.json().catch(() => null) as StoreOperationPatch | null;
  const storeId = getScopedStoreFilter(access, body?.storeId) ?? access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return NextResponse.json({ error: "店舗を選択できません。" }, { status: 403 });
  }

  if (body?.action === "create_temporary_closure") {
    try {
      await createTemporaryClosure({
        storeId,
        date: body.closureDate ?? "",
        startTime: body.closureStartTime ?? "",
        endTime: body.closureEndTime ?? "",
        reason: body.closureReason,
        publicMessage: body.closurePublicMessage,
        createdBy: session.id
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "臨時休業を保存できませんでした。" }, { status: 400 });
    }
  }

  if (body?.action === "cancel_temporary_closure") {
    await cancelTemporaryClosure({ storeId, closureId: String(body.closureId ?? "") });
    return NextResponse.json({ ok: true });
  }

  const reservationsEnabled = body?.reservationsEnabled !== false;
  const hasMinimumPickupMinutes = Object.prototype.hasOwnProperty.call(body ?? {}, "minimumPickupMinutes");
  const minimumPickupMinutes = normalizeMinimumPickupMinutes(body?.minimumPickupMinutes);
  const statusNote = String(body?.statusNote ?? "").trim();
  const storeRows = await sql`
    select business_hours as "businessHours"
    from stores
    where id = ${storeId}
    limit 1
  `;
  const businessHours = storeRows[0]?.businessHours;
  const temporaryStatusUntil = !reservationsEnabled && statusNote === "本日休業"
    ? getCurrentBusinessDayClosing(businessHours)
    : null;
  const minimumPickupResetAt = minimumPickupMinutes !== null && body?.minimumPickupResetPolicy === "business_day_end"
    ? getCurrentBusinessDayClosing(businessHours)
    : null;

  await sql`
    insert into store_operations (store_id, reservations_enabled, minimum_pickup_minutes, minimum_pickup_reset_at, status_note, temporary_status_until, updated_by, updated_at)
    values (${storeId}, ${reservationsEnabled}, ${minimumPickupMinutes}, ${minimumPickupResetAt?.toISOString() ?? null}, ${statusNote}, ${temporaryStatusUntil?.toISOString() ?? null}, ${session.id}, now())
    on conflict (store_id)
    do update set
      reservations_enabled = excluded.reservations_enabled,
      minimum_pickup_minutes = case
        when ${hasMinimumPickupMinutes} then excluded.minimum_pickup_minutes
        else store_operations.minimum_pickup_minutes
      end,
      minimum_pickup_reset_at = case
        when ${hasMinimumPickupMinutes} then excluded.minimum_pickup_reset_at
        else store_operations.minimum_pickup_reset_at
      end,
      status_note = excluded.status_note,
      temporary_status_until = excluded.temporary_status_until,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}
