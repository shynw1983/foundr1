import { writeAuditLog } from "../../../../lib/audit-log";
import { requireOwnerOsSession, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import {
  configurableRoles,
  getAllRolePermissions,
  normalizeConfigurableRole,
  normalizePermissionKeys,
  rolePermissionDefinitions
} from "../../../../lib/role-permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    roles: configurableRoles,
    definitions: rolePermissionDefinitions,
    rolePermissions: await getAllRolePermissions(),
    canEdit: session.role === "owner"
  });
}

export async function POST(request: Request) {
  const session = await requireOwnerOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => null) as { rolePermissions?: Array<{ role?: string; permissions?: unknown }> } | null;
  const payload = Array.isArray(body?.rolePermissions) ? body.rolePermissions : [];

  for (const rolePayload of payload) {
    const role = normalizeConfigurableRole(String(rolePayload.role ?? ""));
    if (!role) continue;
    const permissionKeys = normalizePermissionKeys(role, rolePayload.permissions);
    const permissionSet = new Set(permissionKeys);

    for (const definition of rolePermissionDefinitions) {
      await sql`
        insert into role_permissions (role, permission_key, is_enabled, updated_by, updated_at)
        values (${role}, ${definition.key}, ${permissionSet.has(definition.key)}, ${session.id}, now())
        on conflict (role, permission_key)
        do update set
          is_enabled = excluded.is_enabled,
          updated_by = excluded.updated_by,
          updated_at = now()
      `;
    }
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "role_permissions.update",
    targetType: "role_permissions",
    metadata: { roles: payload.map((item) => item.role).filter(Boolean) }
  });

  return Response.json({
    ok: true,
    rolePermissions: await getAllRolePermissions()
  });
}
