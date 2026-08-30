import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../lib/store-order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizedCommandStatus(status: string, error: string) {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return /timeout|timed out|waiting failed|waiting for selector|超时/i.test(error)
    ? "timed_out"
    : "failed";
  if (status === "processing") return "processing";
  return "queued";
}

function failedItemLabels(error: string, result: unknown) {
  const resultRows = result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).missingTargets)
    ? (result as Record<string, unknown>).missingTargets as unknown[]
    : [];
  if (resultRows.length) return resultRows.map(String).filter(Boolean);
  const retryList = error.match(/(?:正在重试|再試行中)[:：]\s*(.+)$/u)?.[1];
  if (retryList) return retryList.split("、").map((value) => value.trim()).filter(Boolean);
  const matchList = error.match(/(?:Multiple target matches|Target verification failed):\s*(.+?)(?:;|$)/iu)?.[1];
  if (!matchList) return [];
  return matchList.split(",").map((value) => value.replace(/=\d+\s*$/u, "").trim()).filter(Boolean);
}

function failedTargets(error: string, result: unknown, payload: unknown) {
  const labels = failedItemLabels(error, result);
  const targets = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).targets)
    ? (payload as Record<string, unknown>).targets as unknown[]
    : [];
  return labels.map((label) => {
    const target = targets.find((value) => value && typeof value === "object" && String((value as Record<string, unknown>).label ?? "") === label);
    return {
      label,
      kind: target && typeof target === "object" && (target as Record<string, unknown>).kind === "option" ? "option" : "item"
    };
  });
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = String(params.get("storeId") ?? "").trim();
  const storeId = requestedStoreId
    ? getScopedStoreFilter(access, requestedStoreId)
    : access.stores[0]?.id ?? "";
  if (!storeId || storeId === "__forbidden__") {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }
  const days = Math.max(1, Math.min(90, Number(params.get("days") ?? 30) || 30));
  const rows = await sql`
    with recent_runs as (
      select
        runs.id,
        runs.store_id,
        runs.run_type,
        runs.action,
        runs.item_label,
        runs.inventory_key,
        runs.source,
        runs.scheduled_for,
        runs.details,
        runs.created_at,
        employees.name as actor_name
      from menu_inventory_sync_runs runs
      left join employees on employees.id = runs.requested_by
      where runs.store_id::text = ${storeId}
        and runs.created_at >= now() - (${days}::text || ' days')::interval
      order by runs.created_at desc
      limit 200
    )
    select
      recent_runs.id::text,
      recent_runs.run_type as "runType",
      recent_runs.action,
      recent_runs.item_label as "itemLabel",
      recent_runs.inventory_key as "inventoryKey",
      recent_runs.source,
      recent_runs.scheduled_for::text as "scheduledFor",
      recent_runs.details,
      recent_runs.created_at::text as "createdAt",
      coalesce(recent_runs.actor_name, '') as "actorName",
      commands.id::text as "commandId",
      commands.platform,
      commands.status as "commandStatus",
      commands.last_error as "lastError",
      commands.attempts,
      commands.payload as "commandPayload",
      commands.result as "commandResult",
      commands.updated_at::text as "commandUpdatedAt"
    from recent_runs
    left join local_bridge_commands commands
      on coalesce(nullif(commands.payload->>'syncRunId', ''), commands.payload->>'fullSyncRunId') = recent_runs.id::text
    order by recent_runs.created_at desc, commands.created_at
  `;

  const grouped = new Map<string, Record<string, unknown> & { commands: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    const id = String(row.id);
    const run = grouped.get(id) ?? {
      id,
      runType: String(row.runType),
      action: String(row.action),
      itemLabel: String(row.itemLabel),
      inventoryKey: String(row.inventoryKey),
      source: String(row.source),
      scheduledFor: String(row.scheduledFor ?? ""),
      details: row.details && typeof row.details === "object" ? row.details : {},
      createdAt: String(row.createdAt),
      actorName: String(row.actorName),
      commands: [] as Array<Record<string, unknown>>
    };
    if (row.commandId) {
      run.commands.push({
        id: String(row.commandId),
        platform: String(row.platform),
        status: normalizedCommandStatus(String(row.commandStatus), String(row.lastError)),
        error: String(row.lastError),
        attempts: Number(row.attempts ?? 0),
        failedItems: failedItemLabels(String(row.lastError), row.commandResult),
        failedTargets: failedTargets(String(row.lastError), row.commandResult, row.commandPayload),
        desiredAvailable: row.commandPayload && typeof row.commandPayload === "object"
          ? (row.commandPayload as Record<string, unknown>).isAvailable === true
          : null,
        updatedAt: String(row.commandUpdatedAt)
      });
    }
    grouped.set(id, run);
  }

  const reports = [...grouped.values()].map((run) => {
    const platformMap = new Map<string, { platform: string; total: number; succeeded: number; failed: number; timedOut: number; processing: number; queued: number }>();
    // Web reservation reads the Store state directly, so it is complete as
    // soon as the source-of-truth change or daily reconciliation is recorded.
    platformMap.set("foundr1", { platform: "foundr1", total: 1, succeeded: 1, failed: 0, timedOut: 0, processing: 0, queued: 0 });
    for (const command of run.commands) {
      const platform = String(command.platform);
      const current = platformMap.get(platform) ?? {
        platform,
        total: 0,
        succeeded: 0,
        failed: 0,
        timedOut: 0,
        processing: 0,
        queued: 0
      };
      current.total += 1;
      if (command.status === "succeeded") current.succeeded += 1;
      else if (command.status === "failed") current.failed += 1;
      else if (command.status === "timed_out") current.timedOut += 1;
      else if (command.status === "processing") current.processing += 1;
      else current.queued += 1;
      platformMap.set(platform, current);
    }
    const platforms = [...platformMap.values()];
    const details = run.details as Record<string, unknown>;
    const status = details.phase === "failed_to_queue" || platforms.some((platform) => platform.failed || platform.timedOut)
      ? "failed"
      : platforms.some((platform) => platform.processing || platform.queued)
        ? "processing"
        : "succeeded";
    return {
      ...run,
      status,
      platforms,
      failedCommands: run.commands.filter((command) => command.status === "failed" || command.status === "timed_out"),
      commands: undefined
    };
  });

  return Response.json({ reports }, { headers: { "Cache-Control": "no-store" } });
}
