import { requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";
import { normalizeQuickDashboardPreferences, type QuickDashboardPreferences } from "../../../../lib/quick-dashboard";

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
  kitchenDisplayMode?: "order_only" | "simple" | "detailed";
  quickDashboard?: QuickDashboardPreferences;
};

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "認証が必要です。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as UiPreferences;
  const productMasterSummaryFields = Array.isArray(body.productMasterSummaryFields)
    ? body.productMasterSummaryFields.filter((field) => allowedProductSummaryFields.has(field)).slice(0, 6)
    : undefined;
  const kitchenDisplayMode = body.kitchenDisplayMode === "order_only"
    || body.kitchenDisplayMode === "simple"
    || body.kitchenDisplayMode === "detailed"
    ? body.kitchenDisplayMode
    : undefined;
  const quickDashboard = body.quickDashboard ? normalizeQuickDashboardPreferences(body.quickDashboard) : undefined;

  const rows = await sql`
    select coalesce(ui_preferences, '{}'::jsonb) as "uiPreferences"
    from employees
    where id = ${session.id}
  `;
  const currentPreferences = (rows[0]?.uiPreferences ?? {}) as UiPreferences;
  const nextPreferences: UiPreferences = {
    ...currentPreferences,
    ...(productMasterSummaryFields ? { productMasterSummaryFields } : {}),
    ...(kitchenDisplayMode ? { kitchenDisplayMode } : {}),
    ...(quickDashboard ? { quickDashboard } : {})
  };

  await sql`
    update employees
    set ui_preferences = ${JSON.stringify(nextPreferences)}::jsonb,
        updated_at = now()
    where id = ${session.id}
  `;

  return Response.json({ ok: true, uiPreferences: nextPreferences });
}
