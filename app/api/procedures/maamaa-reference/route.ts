import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { normalizeMaamaaProductionReferenceSettings, type MaamaaProductionReferenceSettings } from "../../../../lib/maamaa-production-rules";
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

async function enrichSettingsWithSkuCategories(settings: MaamaaProductionReferenceSettings) {
  const productIds = Array.from(new Set([
    ...settings.productionRules.map((rule) => rule.productId).filter(Boolean),
    ...settings.setRules.flatMap((rule) => (rule.items ?? []).map((item) => item.productId).filter(Boolean))
  ] as string[]));
  if (!productIds.length) return settings;

  const products = await sql`
    select id::text, category, coalesce(subcategory, '未分類') as subcategory
    from products
    where id::text = any(${productIds})
  `;
  const productsById = new Map(products.map((product) => [String(product.id), {
    category: String(product.category ?? ""),
    subcategory: String(product.subcategory ?? "")
  }]));

  return {
    ...settings,
    productionRules: settings.productionRules.map((rule) => {
      const product = rule.productId ? productsById.get(rule.productId) : null;
      return product ? { ...rule, productCategory: product.category, productSubcategory: product.subcategory } : rule;
    }),
    setRules: settings.setRules.map((rule) => ({
      ...rule,
      items: rule.items?.map((item) => {
        const product = item.productId ? productsById.get(item.productId) : null;
        return product ? { ...item, productCategory: product.category, productSubcategory: product.subcategory } : item;
      })
    }))
  };
}

export async function GET() {
  const session = await requireProcedureReader();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const settings = await enrichSettingsWithSkuCategories(await readSettings());
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

  return Response.json({ ok: true, settings: await enrichSettingsWithSkuCategories(settings) });
}
