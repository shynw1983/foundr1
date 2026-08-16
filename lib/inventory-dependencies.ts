import { sql } from "./db";
import {
  findMaamaaSetRule,
  normalizeMaamaaProductionReferenceSettings
} from "./maamaa-production-rules";
import {
  dependentSetRuleNames,
  inventoryDependencyMatches,
  type InventoryDependencyProduct
} from "./inventory-dependency-rules";
import type { UberInventoryItemTarget } from "./uber-inventory-targets";

type MenuItemRow = {
  id: string;
  brandId: string;
  externalId: string;
  name: string;
  displayNames: Record<string, unknown> | null;
  isAvailable: boolean;
};

function aliases(row: MenuItemRow) {
  return Array.from(new Set([
    row.name,
    ...Object.values(row.displayNames ?? {}).map(String)
  ].map((value) => value.trim()).filter(Boolean)));
}

function asTarget(row: MenuItemRow): UberInventoryItemTarget {
  return {
    kind: "item",
    targetId: row.id,
    menuCatalogItemId: row.id,
    brandId: row.brandId,
    inventoryKey: `item:${row.externalId || row.id}`,
    label: row.name,
    aliases: aliases(row),
    isAvailable: row.isAvailable
  };
}

export async function loadDependentMenuItemTargets(input: {
  storeId: string;
  brandId: string;
  ingredientLabel: string;
}) {
  const { storeId, brandId, ingredientLabel } = input;
  const [menuRows, procedureRows, settingsRows] = await Promise.all([
    sql`
      select
        menu_catalog_items.id::text,
        menu_catalog_items.brand_id::text as "brandId",
        coalesce(menu_catalog_items.external_id, '') as "externalId",
        menu_catalog_items.name,
        menu_catalog_items.display_names as "displayNames",
        coalesce(menu_store_settings.is_available, true) as "isAvailable"
      from menu_catalog_items
      join store_brands
        on store_brands.brand_id = menu_catalog_items.brand_id
        and store_brands.store_id::text = ${storeId}
      left join menu_store_settings
        on menu_store_settings.menu_catalog_item_id = menu_catalog_items.id
        and menu_store_settings.store_id::text = ${storeId}
      where menu_catalog_items.is_active = true
        and (menu_catalog_items.store_id is null or menu_catalog_items.store_id::text = ${storeId})
        and (${brandId} = '' or menu_catalog_items.brand_id::text = ${brandId})
    `,
    sql`
      with linked_products as (
        select procedure_steps.procedure_book_id, procedure_step_actions.product_id
        from procedure_steps
        join procedure_step_actions on procedure_step_actions.procedure_step_id = procedure_steps.id
        where procedure_step_actions.product_id is not null
          and procedure_step_actions.affects_availability = true
      )
      select distinct
        procedure_books.menu_catalog_item_id::text as "menuCatalogItemId",
        products.id::text as "productId",
        products.name as "productName",
        coalesce(products.product_family_name, products.name) as "productFamilyName",
        coalesce(products.japanese_note, '') as "japaneseNote"
      from linked_products
      join procedure_books on procedure_books.id = linked_products.procedure_book_id
      join products on products.id = linked_products.product_id
      where procedure_books.status = 'published'
        and procedure_books.menu_catalog_item_id is not null
        and coalesce(products.usage_type, 'ingredient') = 'ingredient'
        and (${brandId} = '' or procedure_books.brand_id::text = ${brandId})
        and (
          not exists (
            select 1 from procedure_book_stores where procedure_book_id = procedure_books.id
          )
          or exists (
            select 1 from procedure_book_stores
            where procedure_book_id = procedure_books.id and store_id::text = ${storeId}
          )
        )
    `,
    sql`
      select settings
      from module_settings
      where scope_key = 'global' and module_key = 'maamaa_production_reference'
      limit 1
    `
  ]);

  const rows = menuRows as MenuItemRow[];
  const selectedIds = new Set<string>();
  for (const dependency of procedureRows) {
    const names = [dependency.productName, dependency.productFamilyName, dependency.japaneseNote];
    if (names.some((name) => inventoryDependencyMatches(ingredientLabel, name))) {
      selectedIds.add(String(dependency.menuCatalogItemId));
    }
  }

  const settings = normalizeMaamaaProductionReferenceSettings(settingsRows[0]?.settings);
  const configuredProductIds = Array.from(new Set(settings.setRules.flatMap((rule) => (
    rule.items ?? []
  )).map((item) => item.productId).filter(Boolean) as string[]));
  const productRows = configuredProductIds.length ? await sql`
    select
      id::text,
      name,
      coalesce(product_family_name, name) as "familyName",
      coalesce(japanese_note, '') as "japaneseNote"
    from products
    where id::text = any(${configuredProductIds})
  ` : [];
  const productsById = new Map(productRows.map((product) => [String(product.id), {
    id: String(product.id),
    name: String(product.name ?? ""),
    familyName: String(product.familyName ?? ""),
    japaneseNote: String(product.japaneseNote ?? "")
  }]));
  const matchedSetRules = new Set(dependentSetRuleNames(ingredientLabel, settings, productsById));
  for (const row of rows) {
    const names = aliases(row);
    if (names.some((name) => {
      const rule = findMaamaaSetRule(name, settings.setRules);
      return Boolean(rule && matchedSetRules.has(rule.name))
        || [...matchedSetRules].some((ruleName) => inventoryDependencyMatches(name, ruleName));
    })) selectedIds.add(row.id);
  }

  return rows.filter((row) => selectedIds.has(row.id)).map(asTarget);
}
