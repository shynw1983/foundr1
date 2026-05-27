import { requireOpsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const allowedProductSummaryFields = new Set([
  "japaneseNote",
  "productBrandName",
  "manufacturer",
  "category",
  "subcategory",
  "unit",
  "storageType",
  "brand",
  "mainSupplier",
  "backupSupplier",
  "referencePrice",
  "unitPrice"
]);

type UiPreferences = {
  productMasterSummaryFields?: string[];
};

export async function PATCH(request: Request) {
  const session = await requireOpsSession();
  if (!session) return Response.json({ error: "認証が必要です。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as UiPreferences;
  const productMasterSummaryFields = Array.isArray(body.productMasterSummaryFields)
    ? body.productMasterSummaryFields.filter((field) => allowedProductSummaryFields.has(field)).slice(0, 6)
    : undefined;

  const rows = await sql`
    select coalesce(ui_preferences, '{}'::jsonb) as "uiPreferences"
    from employees
    where id = ${session.id}
  `;
  const currentPreferences = (rows[0]?.uiPreferences ?? {}) as UiPreferences;
  const nextPreferences: UiPreferences = {
    ...currentPreferences,
    ...(productMasterSummaryFields ? { productMasterSummaryFields } : {})
  };

  await sql`
    update employees
    set ui_preferences = ${JSON.stringify(nextPreferences)}::jsonb,
        updated_at = now()
    where id = ${session.id}
  `;

  return Response.json({ ok: true, uiPreferences: nextPreferences });
}
