import { NextResponse } from "next/server";
import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getCurrentBusinessDayClosing, getStoreReceptionState } from "../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type StoreOperationPatch = {
  storeId?: string;
  reservationsEnabled?: boolean;
  minimumPickupMinutes?: number;
  statusNote?: string;
};

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
      store_operations.minimum_pickup_minutes as "minimumPickupMinutes",
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
    reservationsEnabled?: boolean;
    statusNote?: string;
    temporaryStatusUntil?: string | Date | null;
  }) | undefined;

  return NextResponse.json({
    access,
    selectedStoreId: storeId,
    operation: operation
      ? {
          ...operation,
          receptionState: getStoreReceptionState({
            businessHours: operation.businessHours,
            reservationsEnabled: operation.reservationsEnabled !== false,
            statusNote: operation.statusNote,
            temporaryStatusUntil: operation.temporaryStatusUntil
          })
        }
      : null
  });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return NextResponse.json({ error: "権限がありません。" }, { status: 403 });

  const access = await getStoreOrderAccess(session);
  const body = await request.json().catch(() => null) as StoreOperationPatch | null;
  const storeId = getScopedStoreFilter(access, body?.storeId) ?? access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return NextResponse.json({ error: "店舗を選択できません。" }, { status: 403 });
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

  await sql`
    insert into store_operations (store_id, reservations_enabled, minimum_pickup_minutes, status_note, temporary_status_until, updated_by, updated_at)
    values (${storeId}, ${reservationsEnabled}, ${minimumPickupMinutes}, ${statusNote}, ${temporaryStatusUntil?.toISOString() ?? null}, ${session.id}, now())
    on conflict (store_id)
    do update set
      reservations_enabled = excluded.reservations_enabled,
      minimum_pickup_minutes = case
        when ${hasMinimumPickupMinutes} then excluded.minimum_pickup_minutes
        else store_operations.minimum_pickup_minutes
      end,
      status_note = excluded.status_note,
      temporary_status_until = excluded.temporary_status_until,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}
