import { canAccessStore, requireOsSession, requireWritableOsSession } from "../../../../lib/api-auth";
import { assertProductsOrderable, getProductCatalogAccessSnapshot } from "../../../../lib/product-catalog-access";
import { roleHasPermission } from "../../../../lib/role-permissions";
import { sql } from "../../../../lib/db";
import { filterOrderTemplateItems, normalizeOrderTemplate } from "../../../../lib/order-template-policy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, max-age=0" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !await roleHasPermission(session.role, "module.orders")) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  const storeId = new URL(request.url).searchParams.get("storeId")?.trim() ?? "";
  if (!uuid.test(storeId)) return Response.json({ error: "店舗を指定してください。" }, { status: 400, headers });
  if (!await canAccessStore(session, storeId)) return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403, headers });
  try {
    const rows = await sql`select id::text, name, items from procurement_order_templates where store_id::text = ${storeId} and status = 'active' order by name, id limit 100`;
    const productIds = [...new Set(rows.flatMap(row => Array.isArray(row.items) ? row.items.map((item: { productId: string }) => item.productId) : []))];
    const [access, products, writable] = await Promise.all([
      getProductCatalogAccessSnapshot(session, productIds),
      productIds.length ? sql`select id::text, unit from products where id::text = any(${productIds})` : Promise.resolve([]),
      requireWritableOsSession()
    ]);
    const eligibleUnits = new Map(products.filter(product => access.orderableStoreIdsByProductId[String(product.id)]?.includes(storeId)).map(product => [String(product.id), String(product.unit)]));
    return Response.json({ templates: rows.map(row => ({ id: String(row.id), name: String(row.name), ...filterOrderTemplateItems(row.items, eligibleUnits) })), canManage: Boolean(writable && writable.id === session.id && writable.role === session.role) }, { headers });
  } catch {
    return Response.json({ error: "常用発注を読み込めませんでした。再読み込みしてください。" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const session = await requireWritableOsSession();
  if (!session || !await roleHasPermission(session.role, "module.orders")) return Response.json({ error: "権限がありません。" }, { status: 403, headers });
  const input = normalizeOrderTemplate(await request.json().catch(() => null));
  if (!input) return Response.json({ error: "常用発注の名前と商品・発注単位数量を確認してください。" }, { status: 400, headers });
  if (!await canAccessStore(session, input.storeId)) return Response.json({ error: "この店舗を操作する権限がありません。" }, { status: 403, headers });
  try {
    const access = await assertProductsOrderable(session, input.storeId, input.items.map(item => item.productId));
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status, headers });
    const expected = JSON.stringify(input.items);
    const results = await sql.transaction([
      sql`select id from products where id::text = any(${input.items.map(item => item.productId)}) order by id for share`,
      sql`
        insert into procurement_order_templates(store_id,name,items,created_by)
        select ${input.storeId}::uuid, ${input.name}, ${expected}::jsonb, ${session.id}::uuid
        where not exists (
          select 1 from jsonb_to_recordset(${expected}::jsonb) as expected("productId" text,"purchaseUnit" text, quantity integer)
          left join products on products.id::text = expected."productId"
          where products.id is null or products.unit is distinct from expected."purchaseUnit" or products.is_orderable is not true
        )
        returning id::text
      `
    ]);
    if (!results[1]?.[0]) return Response.json({ error: "商品または発注単位が更新されています。再確認してください。" }, { status: 409, headers });
    return Response.json({ ok: true, templateId: String(results[1][0].id) }, { headers });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return Response.json({ error: "この店舗には同じ名前の常用発注があります。別の名前を入力してください。" }, { status: 409, headers });
    return Response.json({ error: "常用発注を保存できませんでした。再試行してください。" }, { status: 503, headers });
  }
}
