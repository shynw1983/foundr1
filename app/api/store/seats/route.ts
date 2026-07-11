import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type SeatStatus = "available" | "selecting" | "cooking" | "dining" | "cleaning";

function normalizeTarget(value: unknown) {
  const target = String(value ?? "").trim().toUpperCase();
  return ["A", "B", "A+B", "A1", "A2", "B1", "B2", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"].includes(target) ? target : "";
}

async function resolveStore(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const access = await getStoreOrderAccess(session);
  const requested = new URL(request.url).searchParams.get("storeId");
  const filtered = getScopedStoreFilter(access, requested);
  if (filtered === "__forbidden__") return { access, storeId: "", forbidden: true };
  if (filtered) return { access, storeId: filtered, forbidden: false };
  const sakuranamiki = access.stores.find((store) => store.name === "桜並木店");
  return { access, storeId: sakuranamiki?.id ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function seatBoard(storeId: string) {
  const storeRows = await sql`
    select
      stores.id::text,
      stores.name,
      coalesce(store_floor_layouts.background_path, '/store/maamaa-floor-background.svg') as "backgroundPath",
      coalesce(store_floor_layouts.canvas_width, 800)::int as "canvasWidth",
      coalesce(store_floor_layouts.canvas_height, 1200)::int as "canvasHeight",
      coalesce(store_floor_layouts.layout_data, '{}'::jsonb) as layout
    from stores
    left join store_floor_layouts on store_floor_layouts.store_id = stores.id
    where stores.id::text = ${storeId}
    limit 1
  `;
  const targetRows = await sql`
    select
      store_tables.id::text as "tableId",
      case when slots.seat_key = 'TABLE' then store_tables.label else slots.seat_key end as label,
      store_tables.label as "tableLabel",
      store_tables.display_name as "displayName",
      store_tables.seat_count as "seatCount",
      coalesce(store_dining_sessions.id::text, '') as "sessionId",
      case
        when store_dining_sessions.id is null then 'available'
        when store_dining_sessions.status = 'cleaning' then 'cleaning'
        when store_dining_sessions.status = 'dining' then 'dining'
        when store_dining_sessions.order_status = 'cooking' then 'cooking'
        else 'selecting'
      end as status,
      coalesce(store_dining_sessions.order_status, 'idle') as "activityStatus",
      coalesce(store_dining_sessions.dine_in_entitled, false) as "dineInEntitled",
      coalesce(
        store_dining_sessions.status = 'seated'
        and store_dining_sessions.order_status = 'selecting'
        and store_dining_sessions.assigned_at < now() - interval '20 minutes'
        and not exists (
          select 1 from store_dining_session_orders where store_dining_session_orders.session_id = store_dining_sessions.id
        ),
        false
      ) as overdue,
      coalesce(store_dining_sessions.party_size, 0)::int as "partySize",
      coalesce(to_char(store_dining_sessions.assigned_at at time zone 'Asia/Tokyo', 'HH24:MI'), '') as "startedAt",
      coalesce(store_dining_sessions.table_group_label, '') as "groupLabel"
    from store_tables
    cross join lateral (
      select 'TABLE'::text as seat_key
      where store_tables.label not in ('A', 'B')
         or coalesce((store_tables.metadata ->> 'sharedModeEnabled')::boolean, false) = false
      union all
      select store_tables.label || '1'
      where store_tables.label in ('A', 'B')
        and coalesce((store_tables.metadata ->> 'sharedModeEnabled')::boolean, false) = true
      union all
      select store_tables.label || '2'
      where store_tables.label in ('A', 'B')
        and coalesce((store_tables.metadata ->> 'sharedModeEnabled')::boolean, false) = true
    ) slots
    left join store_dining_session_tables
      on store_dining_session_tables.table_id = store_tables.id
      and store_dining_session_tables.seat_key = slots.seat_key
      and store_dining_session_tables.released_at is null
    left join store_dining_sessions
      on store_dining_sessions.id = store_dining_session_tables.session_id
      and store_dining_sessions.status <> 'completed'
    where store_tables.store_id::text = ${storeId}
      and store_tables.status = 'active'
      and store_tables.label = any(${["A", "B", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]})
    order by store_tables.sort_order, store_tables.label
  `;
  return {
    store: storeRows[0] ?? null,
    targets: targetRows.map((row) => ({ ...row, status: row.status as SeatStatus })),
    sharedTables: Array.from(new Set(targetRows.filter((row) => String(row.label).match(/^[AB][12]$/)).map((row) => String(row.tableLabel))))
  };
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const { access, storeId, forbidden } = await resolveStore(request, session);
  if (forbidden) return Response.json({ error: "店舗へのアクセス権限がありません。" }, { status: 403 });
  if (!storeId) return Response.json({ error: "利用できる店舗がありません。" }, { status: 404 });
  return Response.json({ ...(await seatBoard(storeId)), stores: access.stores }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const storeId = String(body.storeId ?? "").trim();
  const target = normalizeTarget(body.target);
  const partySize = Math.max(1, Math.min(20, Math.round(Number(body.partySize) || (target === "A+B" ? 4 : target === "A" || target === "B" ? 2 : 1))));
  const access = await getStoreOrderAccess(session);
  if (!storeId || getScopedStoreFilter(access, storeId) !== storeId) {
    return Response.json({ error: "店舗へのアクセス権限がありません。" }, { status: 403 });
  }
  if (!target) return Response.json({ error: "座席を選択してください。" }, { status: 400 });
  const chairTarget = /^[AB][12]$/.test(target);
  const labels = target === "A+B" ? ["A", "B"] : [chairTarget ? target[0] : target];
  const seatKey = chairTarget ? target : "TABLE";
  try {
    const rows = await sql`
      with selected_tables as (
        select id
        from store_tables
        where store_id::text = ${storeId}
          and label = any(${labels})
          and status = 'active'
          and (
            (${chairTarget} and coalesce((metadata ->> 'sharedModeEnabled')::boolean, false) = true)
            or (not ${chairTarget} and coalesce((metadata ->> 'sharedModeEnabled')::boolean, false) = false)
          )
      ), new_session as (
        insert into store_dining_sessions (
          store_id, table_group_label, status, order_status, party_size, assigned_by
        )
        select ${storeId}, ${target}, 'seated', 'selecting', ${partySize}, ${session.id}
        where (select count(*) from selected_tables) = ${labels.length}
        returning id
      ), assignments as (
        insert into store_dining_session_tables (session_id, table_id, seat_key)
        select new_session.id, selected_tables.id, ${seatKey}
        from new_session cross join selected_tables
        returning session_id
      )
      select id::text
      from new_session
      where (select count(*) from assignments) = ${labels.length}
    `;
    if (!rows[0]?.id) return Response.json({ error: "座席設定が見つかりません。" }, { status: 404 });
  } catch (error) {
    if (String((error as { code?: string })?.code ?? "") === "23505") {
      return Response.json({ error: "この座席は他のスタッフが案内済みです。" }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ ok: true, ...(await seatBoard(storeId)) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const storeId = String(body.storeId ?? "").trim();
  const target = normalizeTarget(body.target);
  const destination = normalizeTarget(body.destination);
  const action = String(body.action ?? "").trim();
  const sharedEnabled = body.enabled === true;
  const access = await getStoreOrderAccess(session);
  if (!storeId || getScopedStoreFilter(access, storeId) !== storeId) {
    return Response.json({ error: "店舗へのアクセス権限がありません。" }, { status: 403 });
  }
  if (!target || !["vacate", "clean", "cancel", "move", "toggle_shared"].includes(action) || (action === "move" && !destination)) {
    return Response.json({ error: "更新内容が不正です。" }, { status: 400 });
  }
  if (action === "toggle_shared") {
    if (!["A", "B"].includes(target)) return Response.json({ error: "相席にできるのはA・Bテーブルのみです。" }, { status: 400 });
    const rows = await sql`
      update store_tables
      set metadata = jsonb_set(metadata, '{sharedModeEnabled}', to_jsonb(${sharedEnabled}::boolean), true), updated_at = now()
      where store_id::text = ${storeId}
        and label = ${target}
        and not exists (
          select 1 from store_dining_session_tables
          where store_dining_session_tables.table_id = store_tables.id
            and store_dining_session_tables.released_at is null
        )
      returning id::text
    `;
    if (!rows.length) return Response.json({ error: "利用中のテーブルは相席モードを変更できません。" }, { status: 409 });
    return Response.json({ ok: true, ...(await seatBoard(storeId)) });
  }
  const chairTarget = /^[AB][12]$/.test(target);
  const labels = target === "A+B" ? ["A", "B"] : [chairTarget ? target[0] : target];
  const sourceSeatKey = chairTarget ? target : "TABLE";
  if (action === "move") {
    const destinationChair = /^[AB][12]$/.test(destination);
    const destinationLabels = destination === "A+B" ? ["A", "B"] : [destinationChair ? destination[0] : destination];
    const destinationSeatKey = destinationChair ? destination : "TABLE";
    try {
      const rows = await sql`
        with source_session as (
          select distinct store_dining_session_tables.session_id
          from store_dining_session_tables
          join store_tables on store_tables.id = store_dining_session_tables.table_id
          join store_dining_sessions on store_dining_sessions.id = store_dining_session_tables.session_id
          where store_tables.store_id::text = ${storeId}
            and store_tables.label = any(${labels})
            and store_dining_session_tables.seat_key = ${sourceSeatKey}
            and store_dining_session_tables.released_at is null
            and store_dining_sessions.status in ('seated', 'dining')
          limit 1
        ), destination_tables as (
          select store_tables.id
          from store_tables
          where store_tables.store_id::text = ${storeId}
            and store_tables.label = any(${destinationLabels})
            and store_tables.status = 'active'
            and (
              (${destinationChair} and coalesce((store_tables.metadata ->> 'sharedModeEnabled')::boolean, false) = true)
              or (not ${destinationChair} and coalesce((store_tables.metadata ->> 'sharedModeEnabled')::boolean, false) = false)
            )
            and not exists (
              select 1 from store_dining_session_tables occupied
              where occupied.table_id = store_tables.id
                and occupied.seat_key = ${destinationSeatKey}
                and occupied.released_at is null
                and occupied.session_id not in (select session_id from source_session)
            )
        ), released as (
          update store_dining_session_tables
          set released_at = now()
          where session_id in (select session_id from source_session)
            and released_at is null
            and (select count(*) from destination_tables) = ${destinationLabels.length}
          returning session_id
        ), relabeled as (
          update store_dining_sessions
          set table_group_label = ${destination}, updated_at = now()
          where id in (select session_id from source_session)
            and (select count(*) from destination_tables) = ${destinationLabels.length}
          returning id
        )
        insert into store_dining_session_tables (session_id, table_id, seat_key)
        select relabeled.id, destination_tables.id, ${destinationSeatKey}
        from relabeled cross join destination_tables
        returning session_id::text
      `;
      if (rows.length !== destinationLabels.length) return Response.json({ error: "移動先の座席は利用できません。" }, { status: 409 });
    } catch (error) {
      if (String((error as { code?: string })?.code ?? "") === "23505") {
        return Response.json({ error: "移動先の座席は他のスタッフが使用中です。" }, { status: 409 });
      }
      throw error;
    }
  } else if (action === "vacate") {
    const rows = await sql`
      update store_dining_sessions
      set status = 'cleaning', vacated_at = now(), updated_at = now()
      where id in (
        select distinct store_dining_session_tables.session_id
        from store_dining_session_tables
        join store_tables on store_tables.id = store_dining_session_tables.table_id
        where store_tables.store_id::text = ${storeId}
          and store_tables.label = any(${labels})
          and store_dining_session_tables.seat_key = ${sourceSeatKey}
          and store_dining_session_tables.released_at is null
      )
        and status in ('seated', 'dining')
      returning id::text
    `;
    if (!rows.length) return Response.json({ error: "現在の状態では退席処理できません。" }, { status: 409 });
  } else if (action === "clean") {
    const rows = await sql`
      with completed as (
        update store_dining_sessions
        set status = 'completed', cleaned_at = now(), completed_at = now(), updated_at = now()
        where id in (
          select distinct store_dining_session_tables.session_id
          from store_dining_session_tables
          join store_tables on store_tables.id = store_dining_session_tables.table_id
          where store_tables.store_id::text = ${storeId}
            and store_tables.label = any(${labels})
            and store_dining_session_tables.seat_key = ${sourceSeatKey}
            and store_dining_session_tables.released_at is null
        )
          and status = 'cleaning'
        returning id
      )
      update store_dining_session_tables
      set released_at = now()
      where session_id in (select id from completed)
        and released_at is null
      returning session_id::text
    `;
    if (!rows.length) return Response.json({ error: "現在の状態では清掃完了にできません。" }, { status: 409 });
  } else {
    const rows = await sql`
      with cancelled as (
        update store_dining_sessions
        set status = 'completed', completed_at = now(), updated_at = now()
        where id in (
          select distinct store_dining_session_tables.session_id
          from store_dining_session_tables
          join store_tables on store_tables.id = store_dining_session_tables.table_id
          where store_tables.store_id::text = ${storeId}
            and store_tables.label = any(${labels})
            and store_dining_session_tables.seat_key = ${sourceSeatKey}
            and store_dining_session_tables.released_at is null
        )
          and status = 'seated'
          and not exists (
            select 1 from store_dining_session_orders where store_dining_session_orders.session_id = store_dining_sessions.id
          )
        returning id
      )
      update store_dining_session_tables
      set released_at = now()
      where session_id in (select id from cancelled)
        and released_at is null
      returning session_id::text
    `;
    if (!rows.length) return Response.json({ error: "注文済みの座席は案内取消できません。" }, { status: 409 });
  }
  await sql`
    update store_tables
    set metadata = jsonb_set(metadata, '{sharedModeEnabled}', 'false'::jsonb, true), updated_at = now()
    where store_id::text = ${storeId}
      and coalesce((metadata ->> 'sharedModeEnabled')::boolean, false) = true
      and not exists (
        select 1 from store_dining_session_tables
        where store_dining_session_tables.table_id = store_tables.id
          and store_dining_session_tables.released_at is null
      )
  `;
  return Response.json({ ok: true, ...(await seatBoard(storeId)) });
}
