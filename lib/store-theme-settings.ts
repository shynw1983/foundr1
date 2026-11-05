import { randomUUID } from "node:crypto";
import { getSessionStoreScope } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { sql } from "./db";
import { roleHasPermission } from "./role-permissions";
import { getStoreDisplayBrand } from "./store-display-brand";
import { getDefaultStoreTheme, normalizeStoreThemeColor, normalizeStoreThemeTarget, type StoreThemeContext, type StoreThemeTarget } from "./store-theme";

export const storeThemePermission = "store.theme.manage";
const themeManagementRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const storeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const moduleKeys: Record<StoreThemeTarget, string> = {
  operations: "store_theme", pickup: "store_theme_pickup", customer: "store_theme_customer", courier: "store_theme_courier"
};

type ThemeRecord = Pick<StoreThemeContext, "target" | "theme" | "brand" | "revision" | "updatedAt">;
type ThemeRow = { settings: unknown; updatedAt: string | Date | null };
type DisplayBrand = Awaited<ReturnType<typeof getStoreDisplayBrand>>;
export type StoreThemeAccess = Pick<StoreThemeContext, "storeId" | "storeName" | "stores" | "canManageTheme">;

export class StoreThemeError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "StoreThemeError";
  }
}

export async function canManageStoreTheme(session: EmployeeSession, options: { fresh?: boolean } = {}) {
  return themeManagementRoles.has(session.role) && await roleHasPermission(session.role, storeThemePermission, options);
}

/** Resolve only active stores from the verified session scope, including OS context restrictions. */
export async function getStoreThemeAccess(session: EmployeeSession, requestedStoreId = "", options: { freshPermissions?: boolean } = {}): Promise<StoreThemeAccess> {
  const storeId = requestedStoreId.trim();
  if (storeId && !storeIdPattern.test(storeId)) throw new StoreThemeError("店舗を確認してください。", 400, "invalid_store");
  const scope = await getSessionStoreScope(session);
  const rows = scope.allStores
    ? await sql`select id::text, name from stores where status = 'active' order by name, id`
    : scope.storeIds.length
      ? await sql`select id::text, name from stores where status = 'active' and id::text = any(${scope.storeIds}) order by name, id`
      : [];
  const stores = rows.map(row => ({ id: String(row.id), name: String(row.name) }));
  const selected = storeId ? stores.find(store => store.id === storeId) : stores[0];
  if (!selected) throw new StoreThemeError("この店舗のテーマを表示する権限がありません。", 403, "store_scope");
  return { storeId: selected.id, storeName: selected.name, stores, canManageTheme: await canManageStoreTheme(session, { fresh: options.freshPermissions }) };
}

function requireThemeTarget(value: unknown): StoreThemeTarget {
  const target = normalizeStoreThemeTarget(value);
  if (!target) throw new StoreThemeError("表示設定の対象を確認してください。", 400, "invalid_target");
  return target;
}

function readThemeRow(target: StoreThemeTarget, displayBrand: DisplayBrand, row?: ThemeRow): ThemeRecord {
  const settings = row?.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
    ? row.settings as Record<string, unknown> : {};
  const fallback = getDefaultStoreTheme(target);
  const mode = target === "operations" || settings.mode === "custom" ? "custom" : "brand";
  const brandColor = normalizeStoreThemeColor(displayBrand?.primaryColor);
  const brand = target !== "operations" && displayBrand && brandColor
    ? { name: displayBrand.name, logoUrl: displayBrand.logoUrl, primaryColor: brandColor } : null;
  const primaryColor = mode === "brand" ? brandColor ?? fallback.primaryColor
    : normalizeStoreThemeColor(settings.primaryColor) ?? fallback.primaryColor;
  const revision = typeof settings.revision === "string" && settings.revision.length > 0 ? settings.revision : null;
  return {
    target,
    theme: { primaryColor, mode, paletteVersion: 1 },
    brand,
    revision,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

export async function getStoreThemeSettings(storeId: string, targetValue?: unknown): Promise<ThemeRecord> {
  const target = requireThemeTarget(targetValue);
  const [rows, brand] = await Promise.all([
    sql`select settings, updated_at as "updatedAt" from module_settings
      where scope_key = ${`store:${storeId}`} and module_key = ${moduleKeys[target]} limit 1`,
    target === "operations" ? Promise.resolve(null) : getStoreDisplayBrand(storeId)
  ]);
  return readThemeRow(target, brand, rows[0] as ThemeRow | undefined);
}

/** A compare-and-swap and its audit record commit together; a conflict writes neither. */
export async function saveStoreThemeSettings(input: {
  storeId: string; target?: unknown; mode?: unknown; primaryColor?: unknown; expectedRevision: string | null; actorId: string; request: Request;
}): Promise<ThemeRecord | null> {
  const target = requireThemeTarget(input.target);
  const mode = input.mode === undefined && target === "operations" ? "custom" : input.mode;
  if ((mode !== "brand" && mode !== "custom") || (target === "operations" && mode !== "custom")) {
    throw new StoreThemeError("テーマカラーの設定方法を確認してください。", 400, "invalid_mode");
  }
  const primaryColor = mode === "custom" ? normalizeStoreThemeColor(input.primaryColor) : null;
  if (!storeIdPattern.test(input.storeId) || (mode === "custom" && !primaryColor)) throw new StoreThemeError("店舗とテーマカラーを確認してください。", 400, "invalid_theme");
  const brand = target === "operations" ? null : await getStoreDisplayBrand(input.storeId);
  const revision = randomUUID();
  // Brand mode stores the policy, never a snapshot of a brand's current color.
  const settings = { ...(mode === "custom" ? { primaryColor } : {}), mode, paletteVersion: 1, revision };
  const fallback = getDefaultStoreTheme(target);
  const defaultTheme = { ...(fallback.mode === "custom" ? { primaryColor: fallback.primaryColor } : {}), mode: fallback.mode, paletteVersion: 1 };
  const scopeKey = `store:${input.storeId}`;
  const moduleKey = moduleKeys[target];
  const ipAddress = input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || input.request.headers.get("x-real-ip") || null;
  const userAgent = input.request.headers.get("user-agent");
  const rows = await sql`
    with previous as materialized (
      select settings from module_settings where scope_key = ${scopeKey} and module_key = ${moduleKey}
    ), saved as (
      insert into module_settings (scope_key, module_key, settings, updated_by, updated_at)
      select ${scopeKey}, ${moduleKey}, ${JSON.stringify(settings)}::jsonb, ${input.actorId}::uuid, now()
      where exists (select 1 from stores where id = ${input.storeId}::uuid and status = 'active')
        and (${input.expectedRevision}::text is null or exists (
          select 1 from previous where settings ->> 'revision' = ${input.expectedRevision}::text
        ))
      on conflict (scope_key, module_key) do update set
        settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      where module_settings.settings ->> 'revision' is not distinct from ${input.expectedRevision}::text
      returning settings, updated_at
    ), audited as (
      insert into os_audit_logs (actor_employee_id, action, target_type, target_id, metadata, ip_address, user_agent)
      select ${input.actorId}::uuid, 'store.theme.updated', 'store', ${input.storeId},
        jsonb_build_object(
          'target', ${target}::text,
          'moduleKey', ${moduleKey}::text,
          'oldTheme', coalesce((select settings - 'revision' from previous), ${JSON.stringify(defaultTheme)}::jsonb),
          'newTheme', saved.settings - 'revision',
          'previousRevision', ${input.expectedRevision}::text,
          'revision', saved.settings ->> 'revision',
          'changedAt', saved.updated_at
        ), ${ipAddress}, ${userAgent}
      from saved returning id
    )
    select saved.settings, saved.updated_at as "updatedAt" from saved cross join audited
  `;
  return rows[0] ? readThemeRow(target, brand, rows[0] as ThemeRow) : null;
}
