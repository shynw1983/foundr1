import { requireMasterOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { getSalesSourceDefinition, salesSourceDefinitions } from "../../../lib/sales-sources";
import { serializeBusinessHours } from "../../../lib/store-business-hours";

async function normalizeStoreBrands(brandNames: string[]) {
  const concreteBrands = await sql`
    select name
    from brands
    where name <> '共通'
    order by name
  `;
  const concreteBrandNames = concreteBrands.map((brand) => String(brand.name));

  if (brandNames.includes("共通")) return concreteBrandNames;

  return Array.from(new Set(brandNames.filter((brandName) => brandName && brandName !== "共通")));
}

async function resolveCompanyId(companyName: string) {
  const name = companyName.trim();
  if (!name) return null;

  const rows = await sql`
    insert into companies (name, updated_at)
    values (${name}, now())
    on conflict (name)
    do update set updated_at = now()
    returning id
  `;

  return rows[0]?.id ?? null;
}

function normalizePayrollCycleType(value: string) {
  return value === "specified_day" ? "specified_day" : "month_end";
}

function normalizePayrollClosingDay(value: string, payrollCycleType: string) {
  if (payrollCycleType === "month_end") return 31;
  const day = Math.round(Number(value));
  return Number.isFinite(day) ? Math.max(1, Math.min(30, day)) : 25;
}

function normalizeSalesSources(formData: FormData, brandNames: string[]) {
  const concreteBrandNames = brandNames.filter((brandName) => brandName && brandName !== "共通");

  return salesSourceDefinitions.flatMap((definition, index) => {
    const enabled = formData.get(`salesSource:${definition.platform}:enabled`) === "on";
    if (!enabled) return [];
    const sourceBrands = definition.sourceType === "delivery" ? concreteBrandNames : [""];
    const labels = sourceBrands.length > 0 ? sourceBrands : [""];

    return labels.map((brandName, brandIndex) => ({
      platform: definition.platform,
      label: definition.label,
      sourceType: definition.sourceType,
      brandName,
      sortOrder: (index + 1) * 100 + brandIndex
    }));
  });
}

async function replaceStoreSalesSources(storeId: string, formData: FormData, brandNames: string[]) {
  const sources = normalizeSalesSources(formData, brandNames);
  await sql`delete from store_sales_sources where store_id = ${storeId}`;

  for (const source of sources) {
    const definition = getSalesSourceDefinition(source.platform);
    await sql`
      insert into store_sales_sources (
        store_id,
        source_platform,
        source_label,
        source_type,
        brand_name,
        is_enabled,
        sort_order,
        metadata,
        updated_at
      )
      values (
        ${storeId},
        ${source.platform},
        ${definition?.label ?? source.label},
        ${definition?.sourceType ?? source.sourceType},
        ${source.brandName},
        true,
        ${source.sortOrder},
        ${JSON.stringify({ importSupported: Boolean(definition?.importSupported) })}::jsonb,
        now()
      )
    `;
  }
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const companyName = String(formData.get("companyName") ?? "").trim();
  const businessHours = serializeBusinessHours(String(formData.get("businessHours") ?? ""));
  const reservationNote = String(formData.get("reservationNote") ?? "").trim();
  const payrollCycleType = normalizePayrollCycleType(String(formData.get("payrollCycleType") ?? ""));
  const payrollClosingDay = normalizePayrollClosingDay(String(formData.get("payrollClosingDay") ?? ""), payrollCycleType);
  const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? "福岡県").trim() || "福岡県";
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));
  const companyId = await resolveCompanyId(companyName);

  if (!name) {
    return Response.json({ error: "店舗名を入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into stores (name, company_id, owner_name, business_hours, reservation_note, payroll_cycle_type, payroll_closing_day, social_insurance_prefecture, updated_at)
    values (${name}, ${companyId}, ${owner}, ${businessHours}::jsonb, ${reservationNote}, ${payrollCycleType}, ${payrollClosingDay}, ${socialInsurancePrefecture}, now())
    on conflict (name)
    do update set
      company_id = excluded.company_id,
      owner_name = excluded.owner_name,
      business_hours = excluded.business_hours,
      reservation_note = excluded.reservation_note,
      payroll_cycle_type = excluded.payroll_cycle_type,
      payroll_closing_day = excluded.payroll_closing_day,
      social_insurance_prefecture = excluded.social_insurance_prefecture,
      updated_at = now()
    returning id
  `;
  const storeId = rows[0]?.id;
  if (!storeId) return Response.json({ error: "店舗を保存できませんでした。" }, { status: 500 });

  await sql`delete from store_brands where store_id = ${storeId}`;

  for (const brandName of brandNames) {
    await sql`
      insert into store_brands (store_id, brand_id)
      select ${storeId}, brands.id
      from brands
      where brands.name = ${brandName}
      on conflict do nothing
    `;
  }

  await replaceStoreSalesSources(String(storeId), formData, brandNames);

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const nextName = String(formData.get("name") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const companyName = String(formData.get("companyName") ?? "").trim();
  const businessHours = serializeBusinessHours(String(formData.get("businessHours") ?? ""));
  const reservationNote = String(formData.get("reservationNote") ?? "").trim();
  const payrollCycleType = normalizePayrollCycleType(String(formData.get("payrollCycleType") ?? ""));
  const payrollClosingDay = normalizePayrollClosingDay(String(formData.get("payrollClosingDay") ?? ""), payrollCycleType);
  const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? "福岡県").trim() || "福岡県";
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));
  const companyId = await resolveCompanyId(companyName);

  if (!currentName || !nextName) {
    return Response.json({ error: "店舗名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from stores
    where name = ${nextName}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の店舗がすでにあります。" },
      { status: 409 }
    );
  }

  const rows = await sql`
    update stores
    set
      name = ${nextName},
      company_id = ${companyId},
      owner_name = ${owner},
      business_hours = ${businessHours}::jsonb,
      reservation_note = ${reservationNote},
      payroll_cycle_type = ${payrollCycleType},
      payroll_closing_day = ${payrollClosingDay},
      social_insurance_prefecture = ${socialInsurancePrefecture},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;
  const storeId = rows[0]?.id;

  if (!storeId) {
    return Response.json({ error: "店舗が見つかりません。" }, { status: 404 });
  }

  await sql`delete from store_brands where store_id = ${storeId}`;

  for (const brandName of brandNames) {
    await sql`
      insert into store_brands (store_id, brand_id)
      select ${storeId}, brands.id
      from brands
      where brands.name = ${brandName}
      on conflict do nothing
    `;
  }

  await replaceStoreSalesSources(String(storeId), formData, brandNames);

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { name?: string };

  if (!body.name) {
    return Response.json({ error: "店舗名が必要です。" }, { status: 400 });
  }

  const linkedOrders = await sql`
    select count(*)::int as count
    from purchase_orders
    join stores on stores.id = purchase_orders.store_id
    where stores.name = ${body.name}
  `;

  if (Number(linkedOrders[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "この店舗は発注依頼で使用されているため削除できません。" },
      { status: 409 }
    );
  }

  await sql`
    delete from stores
    where name = ${body.name}
  `;

  return Response.json({ ok: true });
}
