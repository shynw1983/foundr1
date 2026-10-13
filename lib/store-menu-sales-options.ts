import { sql } from "./db";

export type StoreMenuSalesOption = {
  id: string;
  brandId: string;
  brandName: string;
  groupId: string;
  groupKey: string;
  groupName: string;
  groupDisplayNames: Record<string, string>;
  optionKey: string;
  externalId: string;
  name: string;
  displayNames: Record<string, string>;
  priceDelta: number | null;
  isAvailable: boolean;
  stockStatus: "available" | "low_stock" | "unavailable";
  platformAvailability: Record<string, "available" | "unavailable">;
  statusNote: string;
};

/**
 * Shared option scope for Store sales controls, the inventory picker and audits.
 * Customer selection rules and price do not determine whether an option can be
 * unavailable. Keep every active option in an active group for this store;
 * exact platform mappings and publication exclusions are enforced separately.
 * Callers must authorize the store before loading this projection.
 */
export async function loadStoreMenuSalesOptions(storeId: string) {
  return await sql`
    select
      menu_options.id::text,
      menu_option_groups.brand_id::text as "brandId",
      brands.name as "brandName",
      menu_option_groups.id::text as "groupId",
      menu_option_groups.group_key as "groupKey",
      menu_option_groups.name as "groupName",
      coalesce(menu_option_groups.display_names, '{}'::jsonb) as "groupDisplayNames",
      menu_options.option_key as "optionKey",
      coalesce(menu_options.external_id, '') as "externalId",
      menu_options.name,
      coalesce(menu_options.display_names, '{}'::jsonb) as "displayNames",
      menu_options.price_delta::float as "priceDelta",
      case
        when menu_option_store_settings.is_available = false
          or menu_option_store_settings.stock_status = 'unavailable' then false
        else true
      end as "isAvailable",
      case
        when menu_option_store_settings.is_available = false then 'unavailable'
        else coalesce(menu_option_store_settings.stock_status, 'available')
      end as "stockStatus",
      coalesce((
        select jsonb_object_agg(platform_settings.platform, platform_settings.availability)
        from menu_platform_availability_settings platform_settings
        where platform_settings.store_id = ${storeId}
          and platform_settings.target_kind = 'option'
          and platform_settings.target_id = menu_options.id
      ), '{}'::jsonb) as "platformAvailability",
      coalesce(menu_option_store_settings.status_note, '') as "statusNote"
    from menu_options
    join menu_option_groups on menu_option_groups.id = menu_options.option_group_id
    join brands on brands.id = menu_option_groups.brand_id
    join store_brands
      on store_brands.brand_id = menu_option_groups.brand_id
      and store_brands.store_id = ${storeId}
    left join menu_option_store_settings
      on menu_option_store_settings.menu_option_id = menu_options.id
      and menu_option_store_settings.store_id = ${storeId}
    where menu_options.is_active = true
      and menu_option_groups.is_active = true
    order by brands.name, menu_option_groups.sort_order, menu_options.sort_order,
      menu_options.name, menu_options.id
  ` as StoreMenuSalesOption[];
}
