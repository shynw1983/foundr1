import { randomUUID } from "node:crypto";
import { customerDisplayRecord, customerDisplayRevision, customerDisplayUuidPattern, normalizeCustomerDisplayWeighing } from "../../../../../lib/pos-customer-display";
import { getDisplayState, getStoreName, normalizeDisplayState, normalizeText, readMemberScanCommand, readMemberScanRequest } from "../../../../../lib/pos-customer-display-server";
import { assertRelayOrigin, ownerGuardSql } from "../../../../../lib/store-relay";
import type { RelayOwner } from "../../../../../lib/store-relay-policy";
import { requireOsSession } from "../../../../../lib/api-auth";
import { resolveCustomerStoreDisplayName } from "../../../../../lib/customer-display-names";
import { sql } from "../../../../../lib/db";
import { publishPosCustomerDisplayEvent } from "../../../../../lib/order-realtime";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";
import { normalizePosDisplayStandbySettings } from "../../../../../lib/pos-display-standby";

export const dynamic = "force-dynamic";

function normalizeCustomerDisplayMediaSettings(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const modeValue = normalizeText(record.mode);
  const transitionValue = normalizeText(record.transition);
  const backgroundColor = normalizeText(record.backgroundColor);
  const assets = Array.isArray(record.assets) ? record.assets : [];
  return {
    ...record,
    mode: modeValue === "slideshow" || modeValue === "video" ? modeValue : "default",
    transition: transitionValue === "slide" || transitionValue === "none" ? transitionValue : "fade",
    slideDurationSeconds: Math.max(3, Math.min(60, Math.round(Number(record.slideDurationSeconds) || 8))),
    videoMuted: record.videoMuted !== false,
    videoLoop: record.videoLoop !== false,
    backgroundColor: /^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : "#fbfbf8",
    standby: normalizePosDisplayStandbySettings(record.standby),
    assets: assets.flatMap((item, index) => {
      const asset = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const url = normalizeText(asset.url);
      if (!url) return [];
      const type = normalizeText(asset.type) === "video" ? "video" : "image";
      return [{
        id: normalizeText(asset.id) || `asset_${index + 1}`,
        type,
        url: url.slice(0, 500),
        name: normalizeText(asset.name).slice(0, 120) || type,
        durationSeconds: Math.max(3, Math.min(60, Math.round(Number(asset.durationSeconds) || Number(record.slideDurationSeconds) || 8))),
        fit: normalizeText(asset.fit) === "contain" ? "contain" : "cover"
      }];
    }).slice(0, 12)
  };
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>, bodyStoreId = "") {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = bodyStoreId || new URL(request.url).searchParams.get("storeId") || "";
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getCustomerDisplayStoreOptions(stores: Array<{ id: string; name: string }>) {
  if (!stores.length) return [];
  const rows = await sql`
    select
      id::text,
      name,
      coalesce(customer_display_names, '{}'::jsonb) as "customerDisplayNames"
    from stores
    where id::text = any(${stores.map((store) => store.id)})
  `;
  const displayNamesById = new Map((rows as Array<{ id: string; name: string; customerDisplayNames?: unknown }>).map((store) => [
    store.id,
    resolveCustomerStoreDisplayName({
      settings: store.customerDisplayNames,
      internalStoreName: normalizeText(store.name),
      platform: "foundr1_pos"
    })
  ]));
  return stores.map((store) => ({
    ...store,
    name: displayNamesById.get(store.id) || store.name
  }));
}

async function getCustomerDisplayMediaSettings(storeId: string) {
  const rows = await sql`
    select coalesce(customer_display_media_settings, '{}'::jsonb) as "customerDisplayMediaSettings"
    from pos_store_settings
    where store_id::text = ${storeId}
    limit 1
  `;
  return normalizeCustomerDisplayMediaSettings(rows[0]?.customerDisplayMediaSettings);
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access: { ...access, stores: await getCustomerDisplayStoreOptions(access.stores) },
    selectedStoreId,
    state: new URL(request.url).searchParams.get("debug") === "1" ? normalizeDisplayState({}, await getStoreName(selectedStoreId)) : await getDisplayState(selectedStoreId),
    ...(new URL(request.url).searchParams.get("debug") === "1" ? { debugMode: true } : {}),
    customerDisplayMediaSettings: await getCustomerDisplayMediaSettings(selectedStoreId)
  }, { headers: { "Cache-Control": "no-store" } });
}

function displayLock(storeId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`pos-customer-display:${storeId}`},0))`;
}
function displayError(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }

async function writerGuard(storeId: string, value: unknown, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const owner = customerDisplayRecord(value);
  const configured = await sql`select id from store_relay_stations where store_id::text=${storeId} and enabled and (print_enabled or scale_enabled)`;
  if (!configured.length) {
    return { owner: null, statements: [sql`select 1 / case when not exists(select 1 from store_relay_stations
      where store_id::text=${storeId} and enabled and (print_enabled or scale_enabled)) then 1 else 0 end as display_unowned`] };
  }
  if (!customerDisplayUuidPattern.test(String(owner.stationId)) || typeof owner.token !== "string"
    || !owner.token || !Number.isSafeInteger(owner.epoch)) displayError("レジの操作権を確認してください。");
  const validated = owner as RelayOwner;
  return { owner: validated, statements: [
    sql`select id from store_relay_stations where id::text=${validated.stationId} for update`,
    ownerGuardSql(storeId, validated, session)
  ] };
}

export async function POST(request: Request) {
  try {
    assertRelayOrigin(request);
    const session = await requireOsSession();
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "表示内容を確認してください。" }, { status: 400 });
    const body = raw as Record<string, unknown>;
    const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session, normalizeText(body.storeId));
    if (forbidden || !selectedStoreId || !access.stores.some(store => store.id === selectedStoreId)) return Response.json({ error: "権限がありません。" }, { status: 403 });
    const init = sql`insert into pos_customer_display_states(store_id) values(${selectedStoreId}::uuid) on conflict(store_id) do nothing`;
    const guard = await writerGuard(selectedStoreId, body.owner, session);

    if (body.action === "claim") {
      if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) displayError("客席表示を再読み込みしてください。", 400);
      const streamId = randomUUID();
      const writer = { id: streamId, sequence: 0, sessionId: session.sessionId, employeeId: session.id,
        stationId: guard.owner?.stationId ?? null, epoch: guard.owner?.epoch ?? null };
      const result = await sql.transaction([...guard.statements, displayLock(selectedStoreId), init,
        sql`update pos_customer_display_states set display_state=coalesce(display_state,'{}'::jsonb)
          ||jsonb_build_object('_displayWriter',${JSON.stringify(writer)}::jsonb,'weighing',null,
            'revision',coalesce((display_state->>'revision')::bigint,0)+1),updated_by=${session.id}::uuid,updated_at=now()
          where store_id::text=${selectedStoreId} and coalesce((display_state->>'revision')::bigint,0)=${Number(body.expectedRevision)} returning store_id`
      ]);
      if (!result.at(-1)?.length) displayError("客席表示の操作端末が変わりました。", 409);
      const state = await getDisplayState(selectedStoreId);
      await publishPosCustomerDisplayEvent(selectedStoreId, state).catch(() => undefined);
      return Response.json({ ok: true, selectedStoreId, streamId, revision: state.revision, state }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action) displayError("表示の操作を確認してください。", 400);
    const inputState = customerDisplayRecord(body.state);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) displayError("表示内容を確認してください。", 400);
    const ordered = body.streamId !== undefined || body.sequence !== undefined;
    if (ordered && (!customerDisplayUuidPattern.test(String(body.streamId)) || !Number.isSafeInteger(body.sequence) || Number(body.sequence) < 1)) displayError("表示の更新順を確認してください。", 400);
    const preview = ordered ? normalizeCustomerDisplayWeighing(inputState.weighing) : null;
    if (ordered && inputState.weighing != null && !preview) displayError("計量表示の内容を確認してください。", 400);
    if (preview?.source === "capture" && !guard.owner) displayError("レジの操作権を確認してください。");
    const storeName = await getStoreName(selectedStoreId);
    const normalized = normalizeDisplayState(inputState, storeName);
    const updatedLabel = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    const { revision: _revision, serverNow: _serverNow, ...display } = normalized;
    const displayState = { ...display, weighing: preview, storeName, updatedLabel,
      ...(readMemberScanCommand(inputState) ? { memberScanCommand: readMemberScanCommand(inputState) } : {}),
      ...(readMemberScanRequest(inputState) ? { memberScanRequest: readMemberScanRequest(inputState) } : {}) };
    const waitingState = preview?.source === "capture" ? {
      ...displayState, weighing: normalizeCustomerDisplayWeighing({ ...preview, source: "waiting", status: "waiting",
        quantity: null, amount: null, captureId: undefined, grossGrams: undefined, tareGrams: undefined, tarePresetId: undefined })
    } : displayState;
    const result = await sql.transaction([...guard.statements, displayLock(selectedStoreId), init,
      sql`update pos_customer_display_states set display_state=case when ${preview?.source === "capture"}
        and not exists(select 1 from store_relay_scale_captures c join store_relay_stations s on s.id=c.station_id
          where c.id::text=${preview?.captureId ?? ""} and s.store_id::text=${selectedStoreId} and s.scale_enabled
            and c.station_id::text=${guard.owner?.stationId ?? ""} and c.epoch=${guard.owner?.epoch ?? -1}
            and c.employee_id::text=${session.id} and c.order_id is null
            and round(c.grams / ${preview?.unit === "kg" ? 1000 : 1}::numeric,3)=${Number(preview?.quantity) || 0}::numeric)
        then ${JSON.stringify(waitingState)}::jsonb else ${JSON.stringify(displayState)}::jsonb end
        ||jsonb_build_object('revision',coalesce((display_state->>'revision')::bigint,0)+1)
        ||case when ${ordered} then jsonb_build_object('_displayWriter',display_state->'_displayWriter'
          ||jsonb_build_object('sequence',${Number(body.sequence) || 0}::bigint)) else '{}'::jsonb end
        ||case when display_state ? 'memberScanCommand' then jsonb_build_object('memberScanCommand',display_state->'memberScanCommand') else '{}'::jsonb end
        ||case when display_state ? 'memberScanRequest' then jsonb_build_object('memberScanRequest',display_state->'memberScanRequest') else '{}'::jsonb end,
        updated_by=${session.id}::uuid,updated_at=now()
        where store_id::text=${selectedStoreId}
          and ((${ordered} and display_state->'_displayWriter'->>'id'=${String(body.streamId || '')}
            and display_state->'_displayWriter'->>'sessionId'=${session.sessionId || ''}
            and display_state->'_displayWriter'->>'employeeId'=${session.id}
            and coalesce((display_state->'_displayWriter'->>'sequence')::bigint,0)<${Number(body.sequence) || 0}
            and display_state->'_displayWriter'->>'stationId' is not distinct from ${guard.owner?.stationId ?? null}
            and (display_state->'_displayWriter'->>'epoch')::int is not distinct from ${guard.owner?.epoch ?? null}::int)
          or (${!ordered} and not (display_state ? '_displayWriter')))
        returning store_id`
    ]);
    const applied = Boolean(result.at(-1)?.length);
    if (!applied) {
      const current = await sql`select display_state->'_displayWriter' as writer from pos_customer_display_states where store_id::text=${selectedStoreId}`;
      const writer = customerDisplayRecord(current[0]?.writer);
      if (!ordered || writer.id !== body.streamId || writer.sessionId !== session.sessionId || writer.employeeId !== session.id
        || Number(writer.sequence) < Number(body.sequence)) displayError("客席表示の操作端末が変わりました。", 409);
    }
    const state = await getDisplayState(selectedStoreId);
    if (applied) await publishPosCustomerDisplayEvent(selectedStoreId, state).catch(() => undefined);
    return Response.json({ ok: true, selectedStoreId, state, ...(!applied ? { ignored: true } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = error as { status?: number; code?: string; message?: string };
    if (failure.code === "22012") return Response.json({ error: "レジまたは計量の状態が変わりました。接続を確認してください。" }, { status: 409 });
    if (failure.status) return Response.json({ error: failure.message }, { status: failure.status });
    console.error("customer display", error);
    return Response.json({ error: "客席表示を更新できませんでした。" }, { status: 500 });
  }
}
