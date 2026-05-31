import { NextResponse } from "next/server";
import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getStoreReceptionState } from "../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type StoreOperationPatch = {
  storeId?: string;
  reservationsEnabled?: boolean;
  statusNote?: string;
};

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
      coalesce(store_operations.reservations_enabled, true) as "reservationsEnabled",
      coalesce(store_operations.status_note, '') as "statusNote"
    from stores
    left join store_operations on store_operations.store_id = stores.id
    where stores.id = ${storeId}
    limit 1
  `;

  const operation = rows[0] as (Record<string, unknown> & {
    businessHours?: unknown;
    reservationsEnabled?: boolean;
    statusNote?: string;
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
            statusNote: operation.statusNote
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
  const statusNote = String(body?.statusNote ?? "").trim();

  await sql`
    insert into store_operations (store_id, reservations_enabled, status_note, updated_by, updated_at)
    values (${storeId}, ${reservationsEnabled}, ${statusNote}, ${session.id}, now())
    on conflict (store_id)
    do update set
      reservations_enabled = excluded.reservations_enabled,
      status_note = excluded.status_note,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return NextResponse.json({ ok: true });
}
