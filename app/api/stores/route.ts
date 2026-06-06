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

async function resolveCompanyId(input: {
  name: string;
  legalName?: string;
  invoiceRegistrationNumber?: string;
  address?: string;
  phone?: string;
}) {
  const companyName = input.name.trim();
  const legalName = String(input.legalName ?? "").trim();
  const invoiceRegistrationNumber = String(input.invoiceRegistrationNumber ?? "").trim();
  const address = String(input.address ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  if (!companyName) return null;

  const rows = await sql`
    insert into companies (
      name,
      legal_name,
      invoice_registration_number,
      address,
      phone,
      updated_at
    )
    values (
      ${companyName},
      ${legalName || null},
      ${invoiceRegistrationNumber},
      ${address},
      ${phone},
      now()
    )
    on conflict (name)
    do update set
      legal_name = coalesce(nullif(${legalName}, ''), companies.legal_name),
      invoice_registration_number = ${invoiceRegistrationNumber},
      address = ${address},
      phone = ${phone},
      updated_at = now()
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

function normalizeCoordinate(value: string, min: number, max: number) {
  if (!value.trim()) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

function normalizeMeters(value: string, fallback: number) {
  const meters = Math.round(Number(value));
  return Number.isFinite(meters) ? Math.max(10, Math.min(2000, meters)) : fallback;
}

function normalizeDayOfMonth(value: string, fallback: number) {
  const day = Math.round(Number(value));
  return Number.isFinite(day) ? Math.max(1, Math.min(28, day)) : fallback;
}

function normalizeTimeText(value: string, fallback = "23:59") {
  const text = value.trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

async function normalizeDefaultProcurementStaffId(value: FormDataEntryValue | null) {
  const staffId = String(value ?? "").trim();
  if (!staffId) return null;

  const rows = await sql`
    select id::text
    from employees
    where id::text = ${staffId}
      and status = 'active'
    limit 1
  `;

  return rows[0]?.id ?? null;
}

function normalizeSalesSources(formData: FormData, brandNames: string[]) {
  const concreteBrandNames = brandNames.filter((brandName) => brandName && brandName !== "共通");

  return salesSourceDefinitions.flatMap((definition, index) => {
    const sourceBrands = definition.sourceType === "delivery"
      ? concreteBrandNames.filter((brandName) => formData.get(`salesSource:${definition.platform}:brand:${brandName}:enabled`) === "on")
      : (formData.get(`salesSource:${definition.platform}:enabled`) === "on" ? [""] : []);

    return sourceBrands.map((brandName, brandIndex) => ({
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

function parsePaymentTypes(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function replaceStorePaymentAccount(storeId: string, formData: FormData) {
  const enabled = formData.get("komojuEnabled") === "on";
  if (!enabled) {
    await sql`
      update store_payment_accounts
      set is_active = false, updated_at = now()
      where store_id = ${storeId}
        and provider = 'komoju'
    `;
    return;
  }

  const accountName = String(formData.get("komojuAccountName") ?? "").trim();
  const secretKey = String(formData.get("komojuSecretKey") ?? "").trim();
  const secretKeyEnvName = String(formData.get("komojuSecretKeyEnvName") ?? "").trim();
  const webhookSecret = String(formData.get("komojuWebhookSecret") ?? "").trim();
  const webhookSecretEnvName = String(formData.get("komojuWebhookSecretEnvName") ?? "").trim();
  const paymentTypes = parsePaymentTypes(String(formData.get("komojuPaymentTypes") ?? ""));
  const paymentTypesEnvName = String(formData.get("komojuPaymentTypesEnvName") ?? "").trim();

  const existingRows = await sql`
    select id::text
    from store_payment_accounts
    where store_id = ${storeId}
      and provider = 'komoju'
    order by updated_at desc
    limit 1
  `;
  const existingId = existingRows[0]?.id;

  if (existingId) {
    await sql`
      update store_payment_accounts
      set
        account_name = ${accountName},
        secret_key = case when ${secretKey} <> '' then ${secretKey} else secret_key end,
        secret_key_env_name = ${secretKeyEnvName},
        webhook_secret = case when ${webhookSecret} <> '' then ${webhookSecret} else webhook_secret end,
        webhook_secret_env_name = ${webhookSecretEnvName},
        payment_types = ${paymentTypes},
        payment_types_env_name = ${paymentTypesEnvName},
        is_active = true,
        updated_at = now()
      where id = ${existingId}
    `;
    return;
  }

  await sql`
    insert into store_payment_accounts (
      store_id,
      provider,
      account_name,
      secret_key,
      secret_key_env_name,
      webhook_secret,
      webhook_secret_env_name,
      payment_types,
      payment_types_env_name
    )
    values (
      ${storeId},
      'komoju',
      ${accountName},
      ${secretKey},
      ${secretKeyEnvName},
      ${webhookSecret},
      ${webhookSecretEnvName},
      ${paymentTypes},
      ${paymentTypesEnvName}
    )
  `;
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const owner = String(formData.get("owner") ?? "").trim();
  const companyName = String(formData.get("companyName") ?? "").trim();
  const companyLegalName = String(formData.get("companyLegalName") ?? "").trim();
  const invoiceRegistrationNumber = String(formData.get("invoiceRegistrationNumber") ?? "").trim();
  const companyAddress = String(formData.get("companyAddress") ?? "").trim();
  const companyPhone = String(formData.get("companyPhone") ?? "").trim();
  const businessHours = serializeBusinessHours(String(formData.get("businessHours") ?? ""));
  const reservationNote = String(formData.get("reservationNote") ?? "").trim();
  const payrollCycleType = normalizePayrollCycleType(String(formData.get("payrollCycleType") ?? ""));
  const payrollClosingDay = normalizePayrollClosingDay(String(formData.get("payrollClosingDay") ?? ""), payrollCycleType);
  const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? "福岡県").trim() || "福岡県";
  const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
  const attendanceLatitude = normalizeCoordinate(String(formData.get("attendanceLatitude") ?? ""), -90, 90);
  const attendanceLongitude = normalizeCoordinate(String(formData.get("attendanceLongitude") ?? ""), -180, 180);
  const attendanceAddress = String(formData.get("attendanceAddress") ?? "").trim();
  const weatherLocationName = attendanceAddress || String(formData.get("weatherLocationName") ?? "").trim() || name;
  const weatherLatitude = attendanceLatitude ?? normalizeCoordinate(String(formData.get("weatherLatitude") ?? ""), -90, 90);
  const weatherLongitude = attendanceLongitude ?? normalizeCoordinate(String(formData.get("weatherLongitude") ?? ""), -180, 180);
  const attendanceRadiusMeters = normalizeMeters(String(formData.get("attendanceRadiusMeters") ?? ""), 100);
  const attendanceAccuracyThresholdMeters = normalizeMeters(String(formData.get("attendanceAccuracyThresholdMeters") ?? ""), 100);
  const shiftFirstHalfSubmissionDeadlineDay = normalizeDayOfMonth(String(formData.get("shiftFirstHalfSubmissionDeadlineDay") ?? ""), 25);
  const shiftSecondHalfSubmissionDeadlineDay = normalizeDayOfMonth(String(formData.get("shiftSecondHalfSubmissionDeadlineDay") ?? ""), 10);
  const shiftSubmissionDeadlineTime = normalizeTimeText(String(formData.get("shiftSubmissionDeadlineTime") ?? ""));
  const defaultProcurementStaffId = await normalizeDefaultProcurementStaffId(formData.get("defaultProcurementStaffId"));
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));
  const companyId = await resolveCompanyId({
    name: companyName,
    legalName: companyLegalName,
    invoiceRegistrationNumber,
    address: companyAddress,
    phone: companyPhone
  });

  if (!name) {
    return Response.json({ error: "店舗名を入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into stores (
      name,
      company_id,
      owner_name,
      business_hours,
      reservation_note,
      payroll_cycle_type,
      payroll_closing_day,
      social_insurance_prefecture,
      weather_location_name,
      weather_latitude,
      weather_longitude,
      attendance_location_enabled,
      attendance_latitude,
      attendance_longitude,
      attendance_radius_meters,
      attendance_accuracy_threshold_meters,
      shift_first_half_submission_deadline_day,
      shift_second_half_submission_deadline_day,
      shift_submission_deadline_time,
      default_procurement_staff_id,
      updated_at
    )
    values (
      ${name},
      ${companyId},
      ${owner},
      ${businessHours}::jsonb,
      ${reservationNote},
      ${payrollCycleType},
      ${payrollClosingDay},
      ${socialInsurancePrefecture},
      ${weatherLocationName || null},
      ${weatherLatitude},
      ${weatherLongitude},
      ${attendanceLocationEnabled},
      ${attendanceLatitude},
      ${attendanceLongitude},
      ${attendanceRadiusMeters},
      ${attendanceAccuracyThresholdMeters},
      ${shiftFirstHalfSubmissionDeadlineDay},
      ${shiftSecondHalfSubmissionDeadlineDay},
      ${shiftSubmissionDeadlineTime}::time,
      ${defaultProcurementStaffId},
      now()
    )
    on conflict (name)
    do update set
      company_id = excluded.company_id,
      owner_name = excluded.owner_name,
      business_hours = excluded.business_hours,
      reservation_note = excluded.reservation_note,
      payroll_cycle_type = excluded.payroll_cycle_type,
      payroll_closing_day = excluded.payroll_closing_day,
      social_insurance_prefecture = excluded.social_insurance_prefecture,
      weather_location_name = excluded.weather_location_name,
      weather_latitude = excluded.weather_latitude,
      weather_longitude = excluded.weather_longitude,
      attendance_location_enabled = excluded.attendance_location_enabled,
      attendance_latitude = excluded.attendance_latitude,
      attendance_longitude = excluded.attendance_longitude,
      attendance_radius_meters = excluded.attendance_radius_meters,
      attendance_accuracy_threshold_meters = excluded.attendance_accuracy_threshold_meters,
      shift_first_half_submission_deadline_day = excluded.shift_first_half_submission_deadline_day,
      shift_second_half_submission_deadline_day = excluded.shift_second_half_submission_deadline_day,
      shift_submission_deadline_time = excluded.shift_submission_deadline_time,
      default_procurement_staff_id = excluded.default_procurement_staff_id,
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
  await replaceStorePaymentAccount(String(storeId), formData);

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
  const companyLegalName = String(formData.get("companyLegalName") ?? "").trim();
  const invoiceRegistrationNumber = String(formData.get("invoiceRegistrationNumber") ?? "").trim();
  const companyAddress = String(formData.get("companyAddress") ?? "").trim();
  const companyPhone = String(formData.get("companyPhone") ?? "").trim();
  const businessHours = serializeBusinessHours(String(formData.get("businessHours") ?? ""));
  const reservationNote = String(formData.get("reservationNote") ?? "").trim();
  const payrollCycleType = normalizePayrollCycleType(String(formData.get("payrollCycleType") ?? ""));
  const payrollClosingDay = normalizePayrollClosingDay(String(formData.get("payrollClosingDay") ?? ""), payrollCycleType);
  const socialInsurancePrefecture = String(formData.get("socialInsurancePrefecture") ?? "福岡県").trim() || "福岡県";
  const attendanceLocationEnabled = formData.get("attendanceLocationEnabled") === "on";
  const attendanceLatitude = normalizeCoordinate(String(formData.get("attendanceLatitude") ?? ""), -90, 90);
  const attendanceLongitude = normalizeCoordinate(String(formData.get("attendanceLongitude") ?? ""), -180, 180);
  const attendanceAddress = String(formData.get("attendanceAddress") ?? "").trim();
  const weatherLocationName = attendanceAddress || String(formData.get("weatherLocationName") ?? "").trim() || nextName;
  const weatherLatitude = attendanceLatitude ?? normalizeCoordinate(String(formData.get("weatherLatitude") ?? ""), -90, 90);
  const weatherLongitude = attendanceLongitude ?? normalizeCoordinate(String(formData.get("weatherLongitude") ?? ""), -180, 180);
  const attendanceRadiusMeters = normalizeMeters(String(formData.get("attendanceRadiusMeters") ?? ""), 100);
  const attendanceAccuracyThresholdMeters = normalizeMeters(String(formData.get("attendanceAccuracyThresholdMeters") ?? ""), 100);
  const shiftFirstHalfSubmissionDeadlineDay = normalizeDayOfMonth(String(formData.get("shiftFirstHalfSubmissionDeadlineDay") ?? ""), 25);
  const shiftSecondHalfSubmissionDeadlineDay = normalizeDayOfMonth(String(formData.get("shiftSecondHalfSubmissionDeadlineDay") ?? ""), 10);
  const shiftSubmissionDeadlineTime = normalizeTimeText(String(formData.get("shiftSubmissionDeadlineTime") ?? ""));
  const defaultProcurementStaffId = await normalizeDefaultProcurementStaffId(formData.get("defaultProcurementStaffId"));
  const brandNames = await normalizeStoreBrands(formData.getAll("brand").map((value) => String(value)));
  const companyId = await resolveCompanyId({
    name: companyName,
    legalName: companyLegalName,
    invoiceRegistrationNumber,
    address: companyAddress,
    phone: companyPhone
  });

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
      weather_location_name = ${weatherLocationName || null},
      weather_latitude = ${weatherLatitude},
      weather_longitude = ${weatherLongitude},
      attendance_location_enabled = ${attendanceLocationEnabled},
      attendance_latitude = ${attendanceLatitude},
      attendance_longitude = ${attendanceLongitude},
      attendance_radius_meters = ${attendanceRadiusMeters},
      attendance_accuracy_threshold_meters = ${attendanceAccuracyThresholdMeters},
      shift_first_half_submission_deadline_day = ${shiftFirstHalfSubmissionDeadlineDay},
      shift_second_half_submission_deadline_day = ${shiftSecondHalfSubmissionDeadlineDay},
      shift_submission_deadline_time = ${shiftSubmissionDeadlineTime}::time,
      default_procurement_staff_id = ${defaultProcurementStaffId},
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
  await replaceStorePaymentAccount(String(storeId), formData);

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
