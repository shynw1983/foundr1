import { getSessionStoreScope } from "./api-auth";
import type { EmployeeSession } from "./auth";
import { sql } from "./db";

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function toTokyoDateParts(value: Date): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 0),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 0),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 0),
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  };
}

function addDays(parts: DateParts, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function dateKey(parts: Pick<DateParts, "year" | "month" | "day">) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function parseLegacyDeadline(label: string, createdAt: string | Date): DateParts | null {
  const timeMatch = label.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) return null;

  const base = toTokyoDateParts(new Date(createdAt));
  let dateParts = base;

  if (label.includes("明日")) {
    dateParts = addDays(base, 1);
  } else if (label.includes("昨日")) {
    dateParts = addDays(base, -1);
  } else {
    const dateMatch = label.match(/(\d{1,2})\/(\d{1,2})/);
    if (dateMatch) {
      dateParts = {
        ...base,
        month: Number(dateMatch[1]),
        day: Number(dateMatch[2])
      };
    }
  }

  return {
    ...dateParts,
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2])
  };
}

function formatDeadlineForToday(deadlineAt: string | Date | null, deadlineLabel: string, createdAt: string | Date) {
  const deadlineParts = deadlineAt ? toTokyoDateParts(new Date(deadlineAt)) : parseLegacyDeadline(deadlineLabel, createdAt);
  if (!deadlineParts) return deadlineLabel;

  const today = toTokyoDateParts(new Date());
  const diffDays = Math.round((dateKey(deadlineParts) - dateKey(today)) / 86_400_000);
  const time = `${String(deadlineParts.hour).padStart(2, "0")}:${String(deadlineParts.minute).padStart(2, "0")}`;

  if (diffDays === 0) return `本日 ${time}`;
  if (diffDays === 1) return `明日 ${time}`;
  if (diffDays === -1) return `昨日 ${time}`;

  return `${String(deadlineParts.month).padStart(2, "0")}/${String(deadlineParts.day).padStart(2, "0")} ${time}`;
}

export async function getProcurementDashboardData(session?: EmployeeSession) {
  const scope = session ? await getSessionStoreScope(session) : { allStores: true, storeIds: [] };
  const [
    stores,
    brands,
    products,
    suppliers,
    productCategories,
    productSubcategories,
    supplierLocations,
    productBrandUsages,
    productSupplierOptions,
    staffOptions,
    orders,
    purchaseOrderItems,
    deliveryBatches,
    supplierFulfillments,
    procurementStaffAvailability,
    priceSignals
  ] =
    await Promise.all([
      sql`
        select
          stores.id::text,
          stores.name,
          companies.name as "companyName",
          coalesce(companies.legal_name, '') as "companyLegalName",
          coalesce(companies.representative_name, '') as "companyRepresentativeName",
          coalesce(companies.invoice_registration_number, '') as "invoiceRegistrationNumber",
          coalesce(companies.receipt_purpose_text, 'テイクアウト飲食代') as "receiptPurposeText",
          coalesce(companies.receipt_tax_rate, 8)::float as "receiptTaxRate",
          coalesce(companies.address, '') as "companyAddress",
          coalesce(companies.phone, '') as "companyPhone",
          coalesce(companies.privacy_contact_name, '') as "privacyContactName",
          coalesce(companies.privacy_contact_email, '') as "privacyContactEmail",
          coalesce(companies.privacy_contact_phone, '') as "privacyContactPhone",
          stores.owner_name as owner,
          coalesce(stores.customer_display_names, '{}'::jsonb) as "customerDisplayNames",
          coalesce(stores.default_procurement_staff_id::text, '') as "defaultProcurementStaffId",
          stores.business_hours as "businessHours",
          coalesce(stores.reservation_note, '') as "reservationNote",
          coalesce(stores.payroll_cycle_type, 'month_end') as "payrollCycleType",
          coalesce(stores.payroll_closing_day, 31)::int as "payrollClosingDay",
          coalesce(stores.social_insurance_prefecture, '福岡県') as "socialInsurancePrefecture",
          coalesce(stores.weather_location_name, '') as "weatherLocationName",
          stores.weather_latitude::float as "weatherLatitude",
          stores.weather_longitude::float as "weatherLongitude",
          coalesce(stores.attendance_location_enabled, false) as "attendanceLocationEnabled",
          stores.attendance_latitude::float as "attendanceLatitude",
          stores.attendance_longitude::float as "attendanceLongitude",
          coalesce(stores.attendance_radius_meters, 100)::int as "attendanceRadiusMeters",
          coalesce(stores.attendance_accuracy_threshold_meters, 100)::int as "attendanceAccuracyThresholdMeters",
          coalesce(stores.shift_first_half_submission_deadline_day, 25)::int as "shiftFirstHalfSubmissionDeadlineDay",
          coalesce(stores.shift_second_half_submission_deadline_day, 10)::int as "shiftSecondHalfSubmissionDeadlineDay",
          to_char(coalesce(stores.shift_submission_deadline_time, '23:59'::time), 'HH24:MI') as "shiftSubmissionDeadlineTime",
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', store_sales_sources.id::text,
              'platform', store_sales_sources.source_platform,
              'label', store_sales_sources.source_label,
              'sourceType', store_sales_sources.source_type,
              'brandName', store_sales_sources.brand_name,
              'isEnabled', store_sales_sources.is_enabled
            ) order by store_sales_sources.sort_order, store_sales_sources.source_label, store_sales_sources.brand_name)
            from store_sales_sources
            where store_sales_sources.store_id = stores.id
          ), '[]'::jsonb) as "salesSources",
          (
            select jsonb_build_object(
              'provider', store_payment_accounts.provider,
              'accountName', store_payment_accounts.account_name,
              'secretKeyEnvName', store_payment_accounts.secret_key_env_name,
              'hasSecretKey', store_payment_accounts.secret_key <> '' or store_payment_accounts.secret_key_env_name <> '',
              'webhookSecretEnvName', store_payment_accounts.webhook_secret_env_name,
              'hasWebhookSecret', store_payment_accounts.webhook_secret <> '' or store_payment_accounts.webhook_secret_env_name <> '',
              'paymentTypes', store_payment_accounts.payment_types,
              'paymentTypesEnvName', store_payment_accounts.payment_types_env_name,
              'isActive', store_payment_accounts.is_active
            )
            from store_payment_accounts
            where store_payment_accounts.store_id = stores.id
              and store_payment_accounts.provider = 'komoju'
              and store_payment_accounts.is_active = true
            order by store_payment_accounts.updated_at desc
            limit 1
          ) as "paymentAccount",
          coalesce(array_agg(brands.name order by brands.name) filter (where brands.name is not null and brands.name <> '共通'), '{}') as brands
        from stores
        left join store_brands on store_brands.store_id = stores.id
        left join brands on brands.id = store_brands.brand_id
        left join companies on companies.id = stores.company_id
        where (${scope.allStores} or stores.id::text = any(${scope.storeIds}))
        group by stores.id, companies.name, companies.legal_name, companies.representative_name, companies.invoice_registration_number, companies.receipt_purpose_text, companies.receipt_tax_rate, companies.address, companies.phone, companies.privacy_contact_name, companies.privacy_contact_email, companies.privacy_contact_phone
        order by stores.name
      `,
      sql`select name, brand_type as type from brands order by name`,
      sql`
        select
          id::text,
          name,
          coalesce(product_brand_name, '') as "productBrandName",
          coalesce(manufacturer, '') as manufacturer,
          category,
          coalesce(subcategory, '未分類') as subcategory,
          unit,
          reference_price::float as "referencePrice",
          coalesce(origin_countries, '{}') as "originCountries",
          package_quantity::float as "packageQuantity",
          coalesce(package_quantity_unit, '') as "packageQuantityUnit",
          coalesce(product_family_name, '') as "productFamilyName",
          coalesce(variant_name, '') as "variantName",
          coalesce(is_default_variant, false) as "isDefaultVariant",
          coalesce(variant_sort_order, 0) as "variantSortOrder",
          coalesce(spec_note, '') as "specNote",
          coalesce(japanese_note, '') as "japaneseNote",
          coalesce(storage_type, '') as "storageType",
          coalesce(usage_type, 'ingredient') as "usageType",
          coalesce(is_imported, false) as "isImported",
          coalesce(import_origin_country, '') as "importOriginCountry",
          coalesce(import_currency, 'CNY') as "importCurrency",
          import_original_price::float as "importOriginalPrice",
          coalesce(import_exchange_rate, 1)::float as "importExchangeRate",
          import_price_jpy::float as "importPriceJpy",
          coalesce(import_freight_rate_original_per_kg, 20)::float as "importFreightRateOriginalPerKg",
          coalesce(import_freight_rate_jpy_per_kg, 0)::float as "importFreightRateJpyPerKg",
          coalesce(import_weight_strategy, 'standard_1kg') as "importWeightStrategy",
          coalesce(import_weight_kg, 1)::float as "importWeightKg",
          coalesce(import_freight_cost_jpy, 0)::float as "importFreightCostJpy",
          coalesce(import_tax_cost_jpy, 0)::float as "importTaxCostJpy",
          coalesce(import_other_cost_jpy, 0)::float as "importOtherCostJpy",
          coalesce(photo_url, '') as "photoUrl",
          coalesce(brand_scope, 'unset') as "brandScope",
          coalesce((
            select suppliers.name
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = 'メイン'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "mainSupplier",
          coalesce((
            select product_supplier_options.purchase_url
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = 'メイン'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "mainPurchaseUrl",
          coalesce((
            select suppliers.name
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = '予備'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "backupSupplier",
          coalesce((
            select product_supplier_options.purchase_url
            from product_supplier_options
            join suppliers on suppliers.id = product_supplier_options.supplier_id
            where product_supplier_options.product_id = products.id
              and product_supplier_options.role = '予備'
              and product_supplier_options.is_active = true
            order by suppliers.name
            limit 1
          ), '') as "backupPurchaseUrl",
          case
            when coalesce(products.brand_scope, 'unset') = 'common' then '共通'
            when exists (
              select 1 from product_brand_usages
              join brands on brands.id = product_brand_usages.brand_id
              where product_brand_usages.product_id = products.id
            )
            then (
              select string_agg(brands.name, ' / ' order by brands.name)
              from product_brand_usages
              join brands on brands.id = product_brand_usages.brand_id
              where product_brand_usages.product_id = products.id
            )
            else '未設定'
          end as brand
        from products
        where (
          ${scope.allStores}
          or coalesce(products.brand_scope, 'unset') = 'common'
          or exists (
            select 1
            from product_brand_usages scoped_product_brands
            join store_brands scoped_store_brands
              on scoped_store_brands.brand_id = scoped_product_brands.brand_id
            where scoped_product_brands.product_id = products.id
              and scoped_store_brands.store_id::text = any(${scope.storeIds})
          )
        )
        order by name
      `,
      sql`
        select
          name,
          category,
          reliability,
          channel_type as "channelType",
          coalesce(address, '') as address,
          coalesce(phone, '') as phone,
          coalesce(contact_person, '') as "contactPerson",
          coalesce(business_hours, '') as "businessHours",
          coalesce(order_url, '') as "orderUrl"
        from suppliers
        order by name
      `,
      sql`
        select name, sort_order as "sortOrder"
        from product_categories
        order by sort_order, name
      `,
      sql`
        select
          product_categories.name as category,
          product_subcategories.name,
          product_subcategories.sort_order as "sortOrder"
        from product_subcategories
        join product_categories on product_categories.id = product_subcategories.category_id
        order by product_categories.sort_order, product_categories.name, product_subcategories.sort_order, product_subcategories.name
      `,
      sql`
        select
          suppliers.name as supplier,
          supplier_locations.name as "locationName",
          supplier_locations.location_type as type,
          supplier_locations.area,
          supplier_locations.opening_hours as hours,
          supplier_locations.purchase_method as "purchaseMethod",
          supplier_locations.note
        from supplier_locations
        join suppliers on suppliers.id = supplier_locations.supplier_id
        order by suppliers.name, supplier_locations.name
      `,
      sql`
        select
          products.name as product,
          brands.name as brand,
          product_brand_usages.usage_note as usage,
          product_brand_usages.default_order_quantity as "defaultOrderQuantity",
          product_brand_usages.spec_note as "specNote",
          product_brand_usages.priority
        from product_brand_usages
        join products on products.id = product_brand_usages.product_id
        join brands on brands.id = product_brand_usages.brand_id
        where (
          ${scope.allStores}
          or exists (
            select 1
            from store_brands scoped_store_brands
            where scoped_store_brands.brand_id = product_brand_usages.brand_id
              and scoped_store_brands.store_id::text = any(${scope.storeIds})
          )
        )
        order by products.name, brands.name
      `,
      sql`
        select
          products.name as product,
          json_agg(
            json_build_object(
              'supplier', suppliers.name,
              'role', product_supplier_options.role,
              'referencePrice', product_supplier_options.reference_price::float,
              'minOrder', product_supplier_options.min_order_quantity,
              'leadTime', product_supplier_options.lead_time,
              'purchaseUrl', coalesce(product_supplier_options.purchase_url, ''),
              'note', product_supplier_options.note
            )
            order by
              case product_supplier_options.role
                when 'メイン' then 1
                when '予備' then 2
                when '緊急' then 3
                else 9
              end,
              suppliers.name
          ) as options
        from product_supplier_options
        join products on products.id = product_supplier_options.product_id
        join suppliers on suppliers.id = product_supplier_options.supplier_id
        where product_supplier_options.is_active = true
          and (
            ${scope.allStores}
            or coalesce(products.brand_scope, 'unset') = 'common'
            or exists (
              select 1
              from product_brand_usages scoped_product_brands
              join store_brands scoped_store_brands
                on scoped_store_brands.brand_id = scoped_product_brands.brand_id
              where scoped_product_brands.product_id = products.id
                and scoped_store_brands.store_id::text = any(${scope.storeIds})
            )
          )
        group by products.name
        order by products.name
      `,
      sql`
        select
          employees.id::text as id,
          employees.name,
          employees.role,
          coalesce(array_agg(stores.name order by stores.name) filter (where stores.name is not null), '{}') as "storeNames"
        from employees
        left join employee_scopes
          on employee_scopes.employee_id = employees.id
          and employee_scopes.scope_type = 'store'
        left join stores on stores.id = employee_scopes.store_id
        where employees.status = 'active'
          and employees.role <> 'store_terminal'
          and (
            ${scope.allStores}
            or employees.id::text = ${session?.id ?? ""}
            or employee_scopes.store_id::text = any(${scope.storeIds})
          )
        group by employees.id
        order by employees.name
      `,
      sql`
        select
          purchase_orders.order_no as id,
          stores.name as store,
          coalesce(order_brands.brand_names, brands.name, '共通') as brand,
          requested_employees.id::text as "requesterStaffId",
          coalesce(requested_employees.name, '') as "requesterName",
          assigned_employees.id::text as "buyerStaffId",
          coalesce(assigned_employees.name, '') as "buyerName",
          coalesce(purchase_orders.deadline_label, '') as "deadlineLabel",
          purchase_orders.deadline_at as "deadlineAt",
          purchase_orders.created_at as "createdAt",
          purchase_orders.requested_item_count as items,
          purchase_orders.priority,
          coalesce(purchase_orders.note, '') as note,
          case
            when order_progress.total_count is null or order_progress.total_count = 0 then purchase_orders.status
            when order_progress.received_count + order_progress.unavailable_count = order_progress.total_count then '完了'
            when order_progress.delivered_count + order_progress.unavailable_count = order_progress.total_count then '確認待ち'
            when order_progress.in_delivery_count > 0 then '配送中'
            when order_progress.delivered_count > 0 then '一部納品済み'
            when order_progress.purchased_count + order_progress.unavailable_count = 0 then '購入待ち'
            when order_progress.purchased_count + order_progress.unavailable_count < order_progress.total_count then '一部購入済み'
            else '配送待ち'
          end as status
        from purchase_orders
        join stores on stores.id = purchase_orders.store_id
        left join brands on brands.id = purchase_orders.brand_id
        left join employees requested_employees on requested_employees.id = purchase_orders.requested_by
        left join employees assigned_employees on assigned_employees.id = purchase_orders.assigned_to
        left join lateral (
          select string_agg(distinct brands.name, ' / ' order by brands.name) as brand_names
          from purchase_order_items
          join brands on brands.id = purchase_order_items.brand_id
          where purchase_order_items.purchase_order_id = purchase_orders.id
        ) order_brands on true
        left join lateral (
          select
            count(purchase_order_items.id)::int as total_count,
            count(purchase_order_items.id) filter (
              where purchase_order_items.status in ('purchased', 'in_delivery', 'delivered', 'received')
                or exists (
                  select 1
                  from purchase_actuals
                  where purchase_actuals.purchase_order_item_id = purchase_order_items.id
                )
            )::int as purchased_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status = 'in_delivery')::int as in_delivery_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status in ('delivered', 'received'))::int as delivered_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status = 'received')::int as received_count,
            count(purchase_order_items.id) filter (where purchase_order_items.status = 'unavailable')::int as unavailable_count
          from purchase_order_items
          where purchase_order_items.purchase_order_id = purchase_orders.id
        ) order_progress on true
        where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        order by purchase_orders.created_at desc
      `,
      sql`
        select
          purchase_order_items.id::text as id,
          purchase_orders.order_no as "orderId",
          products.id::text as "productId",
          coalesce(nullif(purchase_order_items.temporary_product_name, ''), products.name, '臨時購入品') as "productName",
          coalesce(item_brands.name, order_brands.name, '共通') as "brandName",
          coalesce(products.reference_price::float, 0) as "referencePrice",
          purchase_order_items.requested_quantity::float as "requestedQuantity",
          coalesce(nullif(purchase_order_items.requested_unit, ''), nullif(purchase_order_items.temporary_product_unit, ''), products.unit, '個') as unit,
          coalesce(
            purchase_order_items.actual_quantity::float,
            purchase_actuals.actual_quantity::float,
            purchase_order_items.requested_quantity::float
          ) as "actualQuantity",
          coalesce(
            purchase_order_items.actual_price::text,
            purchase_actuals.actual_price::text,
            ''
          ) as "actualPrice",
          coalesce(purchase_actual_locations.name, '') as "supplierLocationName",
          (
            purchase_order_items.status in ('purchased', 'in_delivery', 'delivered', 'received')
            or purchase_actuals.id is not null
          ) as purchased,
          purchase_order_items.status = 'unavailable' as unavailable,
          purchase_order_items.store_feedback_confirmed_at is not null as "storeFeedbackConfirmed",
          case
            when purchase_order_items.status = 'in_delivery' then 'in_delivery'
            when purchase_order_items.status = 'received' then 'received'
            when purchase_order_items.status = 'delivered' then 'delivered'
            else 'pending'
          end as "deliveryStatus",
          delivery_batch_items.delivery_batch_id::text as "deliveryBatchId",
          coalesce(selected_suppliers.name, '') as supplier,
          case
            when purchase_order_items.procurement_note is not null
            then purchase_order_items.procurement_note
            when purchase_order_items.note like '%note=%'
            then split_part(purchase_order_items.note, 'note=', 2)
            else coalesce(purchase_actuals.note, '')
          end as note,
          case
            when purchase_order_items.price_exception_note is not null
            then purchase_order_items.price_exception_note
            when purchase_actuals.price_is_exception
            then coalesce(purchase_actuals.note, '')
            else ''
          end as "priceExceptionNote"
        from purchase_order_items
        join purchase_orders on purchase_orders.id = purchase_order_items.purchase_order_id
        left join products on products.id = purchase_order_items.product_id
        left join brands item_brands on item_brands.id = purchase_order_items.brand_id
        left join brands order_brands on order_brands.id = purchase_orders.brand_id
        left join suppliers selected_suppliers on selected_suppliers.id = purchase_order_items.selected_supplier_id
        left join lateral (
          select
            purchase_actuals.id,
            purchase_actuals.actual_quantity,
            purchase_actuals.actual_price,
            purchase_actuals.supplier_location_id,
            purchase_actuals.note,
            purchase_actuals.price_is_exception
          from purchase_actuals
          where purchase_actuals.purchase_order_item_id = purchase_order_items.id
          order by purchase_actuals.recorded_at desc
          limit 1
        ) purchase_actuals on true
        left join supplier_locations purchase_actual_locations on purchase_actual_locations.id = purchase_actuals.supplier_location_id
        left join delivery_batch_items on delivery_batch_items.purchase_order_item_id = purchase_order_items.id
        where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        order by purchase_orders.created_at desc, purchase_order_items.id
      `,
      sql`
        select
          delivery_batches.id::text as id,
          purchase_orders.order_no as "orderId",
          delivery_batches.batch_no as "batchNo",
          delivery_batches.status,
          to_char(delivery_batches.created_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "createdLabel",
          to_char(delivery_batches.delivered_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "deliveredLabel",
          to_char(delivery_batches.store_confirmed_at at time zone 'Asia/Tokyo', 'MM/DD HH24:MI') as "storeConfirmedLabel",
          coalesce(array_agg(delivery_batch_items.purchase_order_item_id::text order by delivery_batch_items.purchase_order_item_id), '{}') as "itemIds"
        from delivery_batches
        join purchase_orders on purchase_orders.id = delivery_batches.purchase_order_id
        left join delivery_batch_items on delivery_batch_items.delivery_batch_id = delivery_batches.id
        where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        group by delivery_batches.id, purchase_orders.order_no
        order by delivery_batches.created_at desc
      `,
      sql`
        select
          purchase_order_supplier_fulfillments.id::text as id,
          purchase_orders.order_no as "orderId",
          coalesce(suppliers.name, purchase_order_supplier_fulfillments.supplier_name) as supplier,
          coalesce(to_char(purchase_order_supplier_fulfillments.expected_arrival_date, 'YYYY-MM-DD'), '') as "expectedArrivalDate",
          coalesce(purchase_order_supplier_fulfillments.online_order_status, 'not_started') as status,
          coalesce(purchase_order_supplier_fulfillments.receipt_photo_url, '') as "receiptPhotoUrl",
          coalesce(supplier_locations.name, '') as "supplierLocationName",
          coalesce(to_char(purchase_order_supplier_fulfillments.updated_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "receiptUploadedLabel",
          coalesce(to_char(purchase_order_supplier_fulfillments.receipt_confirmed_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI'), '') as "receiptConfirmedLabel",
          coalesce(receipt_confirmers.name, '') as "receiptConfirmedBy"
        from purchase_order_supplier_fulfillments
        join purchase_orders on purchase_orders.id = purchase_order_supplier_fulfillments.purchase_order_id
        left join suppliers on suppliers.id = purchase_order_supplier_fulfillments.supplier_id
        left join supplier_locations on supplier_locations.id = purchase_order_supplier_fulfillments.supplier_location_id
        left join employees receipt_confirmers on receipt_confirmers.id = purchase_order_supplier_fulfillments.receipt_confirmed_by
        where (${scope.allStores} or purchase_orders.store_id::text = any(${scope.storeIds}))
        order by purchase_orders.created_at desc, supplier
      `,
      sql`
        select
          procurement_staff_unavailable_slots.employee_id::text as "employeeId",
          to_char(procurement_staff_unavailable_slots.unavailable_date, 'YYYY-MM-DD') as date,
          procurement_staff_unavailable_slots.slot,
          coalesce(procurement_staff_unavailable_slots.note, '') as note
        from procurement_staff_unavailable_slots
        join employees on employees.id = procurement_staff_unavailable_slots.employee_id
        left join employee_scopes
          on employee_scopes.employee_id = employees.id
          and employee_scopes.scope_type = 'store'
        where procurement_staff_unavailable_slots.unavailable_date >= (current_date - interval '14 days')
          and procurement_staff_unavailable_slots.unavailable_date < (current_date + interval '90 days')
          and (
            ${scope.allStores}
            or employees.id::text = ${session?.id ?? ""}
            or employee_scopes.store_id::text = any(${scope.storeIds})
          )
        group by procurement_staff_unavailable_slots.employee_id, procurement_staff_unavailable_slots.unavailable_date, procurement_staff_unavailable_slots.slot, procurement_staff_unavailable_slots.note
        order by procurement_staff_unavailable_slots.unavailable_date, procurement_staff_unavailable_slots.slot
      `,
      sql`
        with ranked_prices as (
          select
            price_records.product_id,
            price_records.supplier_id,
            price_records.product_id::text as "productId",
            price_records.supplier_id::text as "supplierId",
            products.name as product,
            coalesce(suppliers.name, '未設定') as supplier,
            price_records.price::float as price,
            row_number() over (
              partition by price_records.product_id, price_records.supplier_id
              order by price_records.recorded_at desc
            ) as row_no
          from price_records
          join products on products.id = price_records.product_id
          left join suppliers on suppliers.id = price_records.supplier_id
        ),
        latest_prices as (
          select * from ranked_prices where row_no = 1
        ),
        previous_prices as (
          select * from ranked_prices where row_no = 2
        ),
        fallback_prices as (
          select
            product_supplier_options.product_id,
            product_supplier_options.supplier_id,
            product_supplier_options.reference_price::float as price
          from product_supplier_options
          where product_supplier_options.reference_price is not null
            and product_supplier_options.reference_price > 0
        )
        select
          latest_prices."productId",
          latest_prices."supplierId",
          latest_prices.product,
          latest_prices.supplier,
          latest_prices.price as "latestPrice",
          coalesce(previous_prices.price, fallback_prices.price) as "baselinePrice",
          round(
            (
              (latest_prices.price - coalesce(previous_prices.price, fallback_prices.price))
              / nullif(coalesce(previous_prices.price, fallback_prices.price), 0)
              * 100
            )::numeric,
            1
          )::float as "changeRate"
        from latest_prices
        left join previous_prices
          on previous_prices.product_id = latest_prices.product_id
          and (
            previous_prices.supplier_id = latest_prices.supplier_id
            or (previous_prices.supplier_id is null and latest_prices.supplier_id is null)
          )
        left join fallback_prices
          on fallback_prices.product_id = latest_prices.product_id
          and (
            fallback_prices.supplier_id = latest_prices.supplier_id
            or (fallback_prices.supplier_id is null and latest_prices.supplier_id is null)
          )
        where coalesce(previous_prices.price, fallback_prices.price) <> 0
          and latest_prices.price <> coalesce(previous_prices.price, fallback_prices.price)
        order by abs((latest_prices.price - coalesce(previous_prices.price, fallback_prices.price)) / coalesce(previous_prices.price, fallback_prices.price)) desc
        limit 8
      `
    ]);

  const displayOrders = orders.map((order) => ({
    ...order,
    deadline: formatDeadlineForToday(order.deadlineAt, order.deadlineLabel, order.createdAt)
  }));

  return {
    stores,
    brands,
    products,
    suppliers,
    productCategories,
    productSubcategories,
    supplierLocations,
    productBrandUsages,
    productSupplierOptions,
    staffOptions,
    orders: displayOrders,
    purchaseOrderItems,
    deliveryBatches,
    supplierFulfillments,
    procurementStaffAvailability,
    priceSignals,
    currentUserId: session?.id ?? ""
  };
}
