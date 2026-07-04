import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { normalizeMaamaaProductionReferenceSettings } from "../../../../lib/maamaa-production-rules";
import { roleHasPermission } from "../../../../lib/role-permissions";

const moduleKey = "maamaa_production_reference";
const scopeKey = "global";

async function requireProcedureReader() {
  return requireOsSession();
}

async function requireProcedureEditor() {
  const session = await requireOsSession();
  return session && (await roleHasPermission(session.role, "procedures.edit")) ? session : null;
}

async function readSettings() {
  const rows = await sql`
    select settings
    from module_settings
    where scope_key = ${scopeKey}
      and module_key = ${moduleKey}
    limit 1
  `;
  return normalizeMaamaaProductionReferenceSettings(rows[0]?.settings);
}

export async function GET() {
  const session = await requireProcedureReader();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const settings = await readSettings();
  const canEdit = await roleHasPermission(session.role, "procedures.edit");
  return Response.json({ settings, canEdit });
}

export async function PUT(request: Request) {
  const session = await requireProcedureEditor();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { settings?: unknown };
  const settings = normalizeMaamaaProductionReferenceSettings(body.settings);
  await sql`
    insert into module_settings (scope_key, module_key, settings, updated_by, updated_at)
    values (${scopeKey}, ${moduleKey}, ${JSON.stringify(settings)}::jsonb, ${session.id}, now())
    on conflict (scope_key, module_key)
    do update set
      settings = excluded.settings,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({ ok: true, settings });
}
