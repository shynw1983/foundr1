import { requireMasterOsSession } from "../../../lib/api-auth";
import { sql } from "../../../lib/db";
import { serializeBusinessHours } from "../../../lib/store-business-hours";

type SupplierLocationInput = {
  locationName: string;
  type: string;
  area: string;
  address: string;
  phone: string;
  hours: string;
  businessHoursSettings: string;
  purchaseMethod: string;
  note: string;
};

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const businessHours = String(formData.get("businessHours") ?? "").trim();
  const businessHoursSettings = serializeBusinessHours(String(formData.get("businessHoursSettings") ?? ""));
  const orderUrl = String(formData.get("orderUrl") ?? "").trim();
  const locations = parseSupplierLocations(formData, channelType || "実店舗");

  if (!name) {
    return Response.json({ error: "発注先名を入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into suppliers (
      name,
      category,
      channel_type,
      reliability,
      address,
      phone,
      contact_person,
      business_hours,
      business_hours_settings,
      order_url,
      updated_at
    )
    values (
      ${name},
      ${category || null},
      ${channelType || "実店舗"},
      ${reliability || null},
      ${address || null},
      ${phone || null},
      ${contactPerson || null},
      ${businessHours || null},
      ${businessHoursSettings}::jsonb,
      ${orderUrl || null},
      now()
    )
    on conflict (name)
    do update set
      category = excluded.category,
      channel_type = excluded.channel_type,
      reliability = excluded.reliability,
      address = excluded.address,
      phone = excluded.phone,
      contact_person = excluded.contact_person,
      business_hours = excluded.business_hours,
      business_hours_settings = excluded.business_hours_settings,
      order_url = excluded.order_url,
      updated_at = now()
    returning id
  `;
  if (rows[0]?.id) {
    await saveSupplierLocations(rows[0].id, locations);
  }

  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const formData = await request.formData();
  const currentName = String(formData.get("currentName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const channelType = String(formData.get("channelType") ?? "").trim();
  const reliability = String(formData.get("reliability") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const businessHours = String(formData.get("businessHours") ?? "").trim();
  const businessHoursSettings = serializeBusinessHours(String(formData.get("businessHoursSettings") ?? ""));
  const orderUrl = String(formData.get("orderUrl") ?? "").trim();
  const locations = parseSupplierLocations(formData, channelType || "実店舗");

  if (!currentName || !name) {
    return Response.json({ error: "発注先名を入力してください。" }, { status: 400 });
  }

  const duplicateRows = await sql`
    select count(*)::int as count
    from suppliers
    where name = ${name}
      and name <> ${currentName}
  `;

  if (Number(duplicateRows[0]?.count ?? 0) > 0) {
    return Response.json(
      { error: "同じ名前の発注先がすでにあります。" },
      { status: 409 }
    );
  }

  const rows = await sql`
    update suppliers
    set
      name = ${name},
      category = ${category || null},
      channel_type = ${channelType || "実店舗"},
      reliability = ${reliability || null},
      address = ${address || null},
      phone = ${phone || null},
      contact_person = ${contactPerson || null},
      business_hours = ${businessHours || null},
      business_hours_settings = ${businessHoursSettings}::jsonb,
      order_url = ${orderUrl || null},
      updated_at = now()
    where name = ${currentName}
    returning id
  `;

  if (!rows[0]?.id) {
    return Response.json({ error: "発注先が見つかりません。" }, { status: 404 });
  }
  await saveSupplierLocations(rows[0].id, locations);

  return Response.json({ ok: true });
}

function parseSupplierLocations(formData: FormData, defaultType: string): SupplierLocationInput[] {
  const rawLocations = String(formData.get("locations") ?? "").trim();
  if (rawLocations) {
    try {
      const parsed = JSON.parse(rawLocations) as Array<Record<string, unknown>>;
      return dedupeSupplierLocations(parsed.map((location) => normalizeSupplierLocationInput({
        locationName: location.locationName,
        type: defaultType,
        area: location.area,
        address: location.address,
        phone: location.phone,
        hours: location.hours,
        businessHoursSettings: location.businessHoursSettings,
        purchaseMethod: location.purchaseMethod,
        note: location.note
      })));
    } catch {
      return [];
    }
  }

  return dedupeSupplierLocations(
    String(formData.get("locationNames") ?? "")
      .split(/[\n,、]/)
      .map((value) => normalizeSupplierLocationInput({ locationName: value, type: defaultType }))
  );
}

function normalizeSupplierLocationInput(input: Partial<Record<keyof SupplierLocationInput, unknown>>): SupplierLocationInput {
  return {
    locationName: String(input.locationName ?? "").trim(),
    type: String(input.type ?? "").trim() || "実店舗",
    area: String(input.area ?? "").trim(),
    address: String(input.address ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    hours: String(input.hours ?? "").trim(),
    businessHoursSettings: serializeBusinessHours(String(input.businessHoursSettings ?? "")),
    purchaseMethod: String(input.purchaseMethod ?? "").trim(),
    note: String(input.note ?? "").trim()
  };
}

function dedupeSupplierLocations(locations: SupplierLocationInput[]) {
  const seen = new Set<string>();
  return locations.filter((location) => {
    if (!location.locationName || seen.has(location.locationName)) return false;
    seen.add(location.locationName);
    return true;
  });
}

async function saveSupplierLocations(supplierId: string, locations: SupplierLocationInput[]) {
  const locationNames = locations.map((location) => location.locationName);
  await removeUnlistedSupplierLocations(supplierId, locationNames);

  for (const location of locations) {
    await sql`
      insert into supplier_locations (
        supplier_id,
        name,
        location_type,
        area,
        address,
        phone,
        opening_hours,
        opening_hours_settings,
        purchase_method,
        note
      )
      values (
        ${supplierId},
        ${location.locationName},
        ${location.type},
        ${location.area || null},
        ${location.address || null},
        ${location.phone || null},
        ${location.hours || null},
        ${location.businessHoursSettings}::jsonb,
        ${location.purchaseMethod || null},
        ${location.note || null}
      )
      on conflict (supplier_id, name)
      do update set
        name = excluded.name,
        location_type = excluded.location_type,
        area = excluded.area,
        address = excluded.address,
        phone = excluded.phone,
        opening_hours = excluded.opening_hours,
        opening_hours_settings = excluded.opening_hours_settings,
        purchase_method = excluded.purchase_method,
        note = excluded.note
    `;
  }
}

async function removeUnlistedSupplierLocations(supplierId: string, locationNames: string[]) {
  const obsoleteLocations = await sql`
    select id::text
    from supplier_locations
    where supplier_id = ${supplierId}
      and not (name = any(${locationNames}))
  `;
  const obsoleteLocationIds = obsoleteLocations.map((location) => String(location.id ?? "")).filter(Boolean);

  if (!obsoleteLocationIds.length) return;

  await sql`
    update purchase_actuals
    set supplier_location_id = null
    where supplier_location_id::text = any(${obsoleteLocationIds})
  `;
  await sql`
    update price_records
    set supplier_location_id = null
    where supplier_location_id::text = any(${obsoleteLocationIds})
  `;
  await sql`
    update product_supplier_options
    set preferred_location_id = null
    where preferred_location_id::text = any(${obsoleteLocationIds})
  `;
  await sql`
    update purchase_order_supplier_fulfillments
    set supplier_location_id = null
    where supplier_location_id::text = any(${obsoleteLocationIds})
  `;
  await sql`
    update receipt_ocr_results
    set supplier_location_id = null
    where supplier_location_id::text = any(${obsoleteLocationIds})
  `;
  await sql`
    delete from supplier_locations
    where id::text = any(${obsoleteLocationIds})
  `;
}

export async function DELETE(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json() as { name?: string };
  const name = String(body.name ?? "").trim();

  if (!name) {
    return Response.json({ error: "発注先名が必要です。" }, { status: 400 });
  }

  const rows = await sql`
    select id
    from suppliers
    where name = ${name}
  `;
  const supplierId = rows[0]?.id;

  if (!supplierId) {
    return Response.json({ error: "発注先が見つかりません。" }, { status: 404 });
  }

  await sql`
    update purchase_actuals
    set supplier_location_id = null
    where supplier_location_id in (
      select id from supplier_locations where supplier_id = ${supplierId}
    )
  `;
  await sql`
    update purchase_actuals
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    update price_records
    set supplier_location_id = null
    where supplier_location_id in (
      select id from supplier_locations where supplier_id = ${supplierId}
    )
  `;
  await sql`
    update price_records
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    update employee_scopes
    set supplier_id = null
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from product_supplier_options
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from supplier_locations
    where supplier_id = ${supplierId}
  `;
  await sql`
    delete from suppliers
    where id = ${supplierId}
  `;

  return Response.json({ ok: true });
}
