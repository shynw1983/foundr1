import { sql } from "./db";
import { normalizeSnsColor } from "./sns-library-document";
import { SnsLibraryError, type SnsLibraryAccess } from "./sns-library";
function colors(settings: unknown) {
  const value = settings && typeof settings === "object" ? (settings as { colors?: unknown }).colors : null;
  return Array.isArray(value) ? [...new Set(value.map(normalizeSnsColor).filter((color): color is string => Boolean(color)))].slice(0, 32) : [];
}
export async function getSnsFavoriteColors(access: SnsLibraryAccess) {
  const rows = await sql`select settings from module_settings where scope_key=${`employee:${access.session.id}`} and module_key='sns_preferences' limit 1`;
  return colors(rows[0]?.settings);
}
export async function changeSnsFavoriteColor(access: SnsLibraryAccess, action: unknown, value: unknown) {
  const color = normalizeSnsColor(value);
  if (!color || (action !== "add" && action !== "remove")) throw new SnsLibraryError("色と操作内容を確認してください。", 400, "invalid_color");
  // ON CONFLICT locks the current account's row; every concurrent add/remove uses
  // the latest colors, rather than replacing a stale client-side palette.
  const rows = await sql`insert into module_settings(scope_key,module_key,settings,updated_by,updated_at)
    values(${`employee:${access.session.id}`},'sns_preferences',${JSON.stringify({ version: 1, colors: action === "add" ? [color] : [] })}::jsonb,${access.session.id}::uuid,now())
    on conflict(scope_key,module_key) do update set
      settings=jsonb_set(module_settings.settings,'{colors}',case when ${action}='remove' then
        coalesce((select jsonb_agg(item) from jsonb_array_elements_text(module_settings.settings->'colors') as entries(item) where item<>${color}),'[]'::jsonb)
        when module_settings.settings->'colors' ? ${color} then module_settings.settings->'colors'
        else (module_settings.settings->'colors') || jsonb_build_array(${color}::text) end),
      updated_by=excluded.updated_by,updated_at=now()
    where ${action}='remove' or module_settings.settings->'colors' ? ${color} or jsonb_array_length(module_settings.settings->'colors')<32
    returning settings`;
  if (!rows[0]) throw new SnsLibraryError("お気に入りの色は32色まで保存できます。", 409, "palette_full");
  return colors(rows[0].settings);
}
