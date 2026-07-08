import { requireOsSession } from "../../../../../../lib/api-auth";
import { sql } from "../../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveStoreId(request: Request, bodyStoreId = "") {
  const session = await requireOsSession();
  if (!session) return { session: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = bodyStoreId || new URL(request.url).searchParams.get("storeId") || "";
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { session, selectedStoreId: "", forbidden: true };
  return { session, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

function readScanRequest(value: unknown) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const request = state.memberScanRequest && typeof state.memberScanRequest === "object" && !Array.isArray(state.memberScanRequest)
    ? state.memberScanRequest as Record<string, unknown>
    : {};
  const id = normalizeText(request.id);
  const code = normalizeText(request.code);
  const createdAt = normalizeText(request.createdAt);
  if (!id || !code || !createdAt) return null;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 2 * 60 * 1000) return null;
  return { id, code, createdAt };
}

function readScanCommand(value: unknown) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const command = state.memberScanCommand && typeof state.memberScanCommand === "object" && !Array.isArray(state.memberScanCommand)
    ? state.memberScanCommand as Record<string, unknown>
    : {};
  const id = normalizeText(command.id);
  const action = normalizeText(command.action);
  const createdAt = normalizeText(command.createdAt);
  if (!id || action !== "open_scanner" || !createdAt) return null;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 2 * 60 * 1000) return null;
  return { id, action, createdAt };
}

export async function GET(request: Request) {
  const { session, selectedStoreId, forbidden } = await resolveStoreId(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const since = normalizeText(new URL(request.url).searchParams.get("since"));
  const commandSince = normalizeText(new URL(request.url).searchParams.get("commandSince"));
  const rows = await sql`
    select display_state as "displayState"
    from pos_customer_display_states
    where store_id::text = ${selectedStoreId}
    limit 1
  `;
  const requestState = readScanRequest(rows[0]?.displayState);
  const scanRequest = requestState && requestState.id !== since ? requestState : null;
  const commandState = readScanCommand(rows[0]?.displayState);
  const scanCommand = commandState && commandState.id !== commandSince ? commandState : null;
  return Response.json({ scanRequest, scanCommand }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { storeId?: string; code?: string; action?: string };
  const { session, selectedStoreId, forbidden } = await resolveStoreId(request, normalizeText(body.storeId));
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const currentRows = await sql`
    select display_state as "displayState"
    from pos_customer_display_states
    where store_id::text = ${selectedStoreId}
    limit 1
  `;
  const currentState = currentRows[0]?.displayState && typeof currentRows[0].displayState === "object"
    ? currentRows[0].displayState as Record<string, unknown>
    : {};
  const createdAt = new Date().toISOString();
  const action = normalizeText(body.action);
  const code = normalizeText(body.code);
  const memberScanCommand = action === "open_scanner"
    ? {
        id: crypto.randomUUID(),
        action: "open_scanner",
        createdAt
      }
    : null;
  const memberScanRequest = !memberScanCommand
    ? {
        id: crypto.randomUUID(),
        code,
        createdAt
      }
    : null;
  if (!memberScanCommand && !code) return Response.json({ error: "会員 QR を読み取れませんでした。" }, { status: 400 });
  const displayState = {
    ...currentState,
    ...(memberScanCommand ? { memberScanCommand } : {}),
    ...(memberScanRequest ? { memberScanRequest } : {})
  };

  await sql`
    insert into pos_customer_display_states (
      store_id,
      display_state,
      updated_by,
      updated_at
    )
    values (
      ${selectedStoreId},
      ${JSON.stringify(displayState)}::jsonb,
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      display_state = excluded.display_state,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({ ok: true, scanRequest: memberScanRequest, scanCommand: memberScanCommand });
}
