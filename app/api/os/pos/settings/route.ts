import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

const writableRoles = new Set(["owner", "manager", "store_owner"]);
const priceTaxModes = new Set(["tax_included", "tax_excluded"]);

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRate(value: unknown, fallback: number) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return fallback;
  return Math.max(0, Math.min(100, Math.round(rate * 100) / 100));
}

async function resolveStoreId(request: Request, session: NonNullable<Awaited<ReturnType<typeof requireOsSession>>>) {
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getSettings(storeId: string) {
  const rows = await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      coalesce(pos_store_settings.dine_in_enabled, true) as "dineInEnabled",
      coalesce(pos_store_settings.dine_in_tax_rate, 10)::float as "dineInTaxRate",
      coalesce(pos_store_settings.takeout_tax_rate, 8)::float as "takeoutTaxRate",
      coalesce(nullif(pos_store_settings.external_payment_terminal_brand, ''), 'PayCAS') as "externalPaymentTerminalBrand",
      coalesce(nullif(pos_store_settings.price_tax_mode, ''), 'tax_included') as "priceTaxMode",
      coalesce(pos_store_settings.updated_at::text, '') as "updatedAt"
    from stores
    left join pos_store_settings on pos_store_settings.store_id = stores.id
    where stores.id::text = ${storeId}
    limit 1
  `;
  return rows[0] ?? null;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await resolveStoreId(request, session);
  if (forbidden || !selectedStoreId) return Response.json({ error: "権限がありません。" }, { status: 403 });

  return Response.json({
    access: { ...access, canManagePosSettings: writableRoles.has(session.role) },
    selectedStoreId,
    settings: await getSettings(selectedStoreId)
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!writableRoles.has(session.role)) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    storeId?: string;
    dineInEnabled?: boolean;
    dineInTaxRate?: number | string;
    takeoutTaxRate?: number | string;
    externalPaymentTerminalBrand?: string;
    priceTaxMode?: string;
  };
  const access = await getStoreOrderAccess(session);
  const storeId = getScopedStoreFilter(access, body.storeId);
  if (storeId === "__forbidden__" || !storeId) return Response.json({ error: "店舗を選択してください。" }, { status: 400 });

  const priceTaxMode = normalizeText(body.priceTaxMode) || "tax_included";
  if (!priceTaxModes.has(priceTaxMode)) return Response.json({ error: "価格の税区分が正しくありません。" }, { status: 400 });

  const dineInTaxRate = normalizeRate(body.dineInTaxRate, 10);
  const takeoutTaxRate = normalizeRate(body.takeoutTaxRate, 8);
  const externalPaymentTerminalBrand = normalizeText(body.externalPaymentTerminalBrand) || "PayCAS";
  await sql`
    insert into pos_store_settings (
      store_id,
      dine_in_enabled,
      dine_in_tax_rate,
      takeout_tax_rate,
      external_payment_terminal_brand,
      price_tax_mode,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${body.dineInEnabled !== false},
      ${dineInTaxRate},
      ${takeoutTaxRate},
      ${externalPaymentTerminalBrand},
      ${priceTaxMode},
      ${session.id},
      now()
    )
    on conflict (store_id)
    do update set
      dine_in_enabled = excluded.dine_in_enabled,
      dine_in_tax_rate = excluded.dine_in_tax_rate,
      takeout_tax_rate = excluded.takeout_tax_rate,
      external_payment_terminal_brand = excluded.external_payment_terminal_brand,
      price_tax_mode = excluded.price_tax_mode,
      updated_by = excluded.updated_by,
      updated_at = now()
  `;

  return Response.json({ ok: true, selectedStoreId: storeId, settings: await getSettings(storeId) });
}
