import { sql } from "./db";
import { normalizeStoreModuleSettings, type StoreModuleSettings } from "./module-setting-defaults";
import { normalizeNavigationMenuSettings, type NavigationMenuSettings } from "./navigation-setting-defaults";

export async function getStoreModuleSettings(scopeKey = "global") {
  const rows = await sql`
    select settings
    from module_settings
    where scope_key = ${scopeKey}
      and module_key = 'store'
    limit 1
  `;
  return normalizeStoreModuleSettings(rows[0]?.settings);
}

export async function saveStoreModuleSettings(settings: StoreModuleSettings, employeeId: string, scopeKey = "global") {
  const normalized = normalizeStoreModuleSettings(settings);
  await sql`
    insert into module_settings (scope_key, module_key, settings, updated_by, updated_at)
    values (${scopeKey}, 'store', ${JSON.stringify(normalized)}::jsonb, ${employeeId}, now())
    on conflict (scope_key, module_key)
    do update set
      settings = excluded.settings,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;
  return normalized;
}

export async function getNavigationMenuSettings(scopeKey = "global") {
  const rows = await sql`
    select settings
    from module_settings
    where scope_key = ${scopeKey}
      and module_key = 'navigation'
    limit 1
  `;
  return normalizeNavigationMenuSettings(rows[0]?.settings);
}

export async function saveNavigationMenuSettings(settings: NavigationMenuSettings, employeeId: string, scopeKey = "global") {
  const normalized = normalizeNavigationMenuSettings(settings);
  await sql`
    insert into module_settings (scope_key, module_key, settings, updated_by, updated_at)
    values (${scopeKey}, 'navigation', ${JSON.stringify(normalized)}::jsonb, ${employeeId}, now())
    on conflict (scope_key, module_key)
    do update set
      settings = excluded.settings,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;
  return normalized;
}
