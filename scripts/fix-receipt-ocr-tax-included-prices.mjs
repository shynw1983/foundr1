import { neon } from "@neondatabase/serverless";
import { loadLocalEnv } from "./db-env.mjs";

loadLocalEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const sql = neon(process.env.DATABASE_URL);

const eligibleCte = sql`
  with matched_lines as (
    select
      receipt_ocr_results.id as ocr_result_id,
      receipt_ocr_items.id as item_uuid,
      receipt_ocr_items.id::text as item_id,
      receipt_ocr_items.matched_product_id as product_id,
      receipt_ocr_items.purchase_actual_id,
      receipt_ocr_results.supplier_id,
      coalesce(receipt_ocr_results.confirmed_by, receipt_ocr_results.created_by) as employee_id,
      coalesce(accounting_line.value->>'unit', receipt_ocr_items.unit, '個') as unit,
      coalesce((accounting_line.value->>'quantity')::float, receipt_ocr_items.quantity::float) as quantity,
      coalesce((accounting_line.value->>'amount')::float, receipt_ocr_items.amount::float) as amount,
      coalesce(accounting_line.value->>'taxRate', receipt_ocr_items.tax_rate, '') as tax_rate,
      coalesce(accounting_line.value->>'taxMode', receipt_ocr_items.tax_mode, '') as tax_mode,
      coalesce((accounting_line.value->>'taxAmount')::float, 0) as tax_amount
    from receipt_ocr_items
    join receipt_ocr_results on receipt_ocr_results.id = receipt_ocr_items.receipt_ocr_result_id
    left join lateral jsonb_array_elements(coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb)) as accounting_line(value)
      on accounting_line.value->>'ocrItemId' = receipt_ocr_items.id::text
    where receipt_ocr_results.status = 'confirmed'
      and receipt_ocr_results.usage_type = 'shiire'
      and receipt_ocr_items.matched_product_id is not null
      and coalesce(receipt_ocr_items.match_status, '') <> 'ignored'
      and coalesce(receipt_ocr_items.reconciliation_status, '') <> 'ignored'
      and receipt_ocr_items.amount > 0
      and receipt_ocr_items.quantity > 0
  ),
  eligible as (
    select
      *,
      round((
        (
          amount
          + case
              when tax_mode = '外税' then greatest(
                tax_amount,
                case
                  when tax_rate in ('8%', '8') then round(amount * 0.08)
                  when tax_rate in ('10%', '10') then round(amount * 0.10)
                  else 0
                end
              )
              else 0
            end
        ) / nullif(quantity, 0)
      )::numeric, 2) as expected_unit_price
    from matched_lines
    where quantity > 0
      and amount > 0
  )
  select *
  from eligible
  where expected_unit_price > 0
`;

const beforeRows = await sql`
  with eligible as (${eligibleCte})
  select
    count(*)::int as scanned,
    count(*) filter (
      where exists (
        select 1
        from receipt_ocr_items
        where receipt_ocr_items.id = eligible.item_uuid
          and (
            receipt_ocr_items.unit_price is null
            or abs(receipt_ocr_items.unit_price::float - eligible.expected_unit_price::float) > 0.009
          )
      )
    )::int as item_mismatches,
    (
      select coalesce(sum(record_count - 1), 0)::int
      from (
        select receipt_note, count(*) as record_count
        from price_records
        where source = 'receipt_ocr'
          and coalesce(receipt_note, '') <> ''
        group by receipt_note
        having count(*) > 1
      ) duplicates
    ) as duplicate_price_records
  from eligible
`;

const rawResultRows = await sql`
  with eligible as (${eligibleCte}),
  rebuilt as (
    select
      receipt_ocr_results.id,
      jsonb_agg(
        case
          when eligible.item_id is not null then jsonb_set(accounting_line.value, '{unitPrice}', to_jsonb(eligible.expected_unit_price), true)
          else accounting_line.value
        end
        order by accounting_line.ordinality
      ) as accounting_lines
    from receipt_ocr_results
    join lateral jsonb_array_elements(coalesce(receipt_ocr_results.raw_result->'accountingLines', '[]'::jsonb)) with ordinality as accounting_line(value, ordinality) on true
    left join eligible on eligible.ocr_result_id = receipt_ocr_results.id and accounting_line.value->>'ocrItemId' = eligible.item_id
    where exists (
      select 1
      from eligible target
      where target.ocr_result_id = receipt_ocr_results.id
    )
    group by receipt_ocr_results.id
  )
  update receipt_ocr_results
  set raw_result = jsonb_set(coalesce(raw_result, '{}'::jsonb), '{accountingLines}', rebuilt.accounting_lines, true)
  from rebuilt
  where receipt_ocr_results.id = rebuilt.id
  returning receipt_ocr_results.id::text
`;

const itemRows = await sql`
  with eligible as (${eligibleCte})
  update receipt_ocr_items
  set
    unit_price = eligible.expected_unit_price,
    updated_at = now()
  from eligible
  where receipt_ocr_items.id = eligible.item_uuid
    and (
      receipt_ocr_items.unit_price is null
      or abs(receipt_ocr_items.unit_price::float - eligible.expected_unit_price::float) > 0.009
    )
  returning receipt_ocr_items.id::text
`;

const actualRows = await sql`
  with eligible as (${eligibleCte})
  update purchase_actuals
  set actual_price = eligible.expected_unit_price
  from eligible
  where purchase_actuals.id = eligible.purchase_actual_id
    and (
      purchase_actuals.actual_price is null
      or abs(purchase_actuals.actual_price::float - eligible.expected_unit_price::float) > 0.009
    )
  returning purchase_actuals.id::text
`;

const deletedRows = await sql`
  with eligible as (${eligibleCte})
  delete from price_records
  using eligible
  where price_records.source = 'receipt_ocr'
    and price_records.receipt_note = eligible.item_id
  returning price_records.id::text
`;

const insertedRows = await sql`
  with eligible as (${eligibleCte})
  insert into price_records (
    product_id,
    supplier_id,
    price,
    unit,
    source,
    receipt_note,
    recorded_by
  )
  select
    product_id,
    supplier_id,
    expected_unit_price,
    coalesce(nullif(trim(unit), ''), '個'),
    'receipt_ocr',
    item_id,
    employee_id
  from eligible
  returning id::text
`;

const afterRows = await sql`
  select
    (
      select count(*)::int
      from (
        select receipt_note
        from price_records
        where source = 'receipt_ocr'
          and coalesce(receipt_note, '') <> ''
        group by receipt_note
        having count(*) > 1
      ) duplicates
    ) as duplicate_groups,
    (
      with product_stats as (
        select product_id, percentile_cont(0.5) within group (order by price) as median_price, count(*) as count
        from price_records
        where source = 'receipt_ocr'
          and price > 0
        group by product_id
        having count(*) >= 4
      )
      select count(*)::int
      from price_records
      join product_stats on product_stats.product_id = price_records.product_id
      where price_records.price > product_stats.median_price * 3
        and price_records.price - product_stats.median_price > 100
    ) as outliers
`;

const targetRows = await sql`
  select
    products.name,
    price_records.price::float,
    receipt_ocr_items.unit_price::float as "ocrUnitPrice",
    receipt_ocr_items.quantity::float,
    receipt_ocr_items.amount::float,
    price_records.receipt_note as "receiptNote"
  from products
  join price_records on price_records.product_id = products.id
  join receipt_ocr_items on receipt_ocr_items.id::text = price_records.receipt_note
  where products.name ilike ${"%粉末チャンポ%"}
  order by price_records.price desc
  limit 10
`;

console.log(JSON.stringify({
  before: beforeRows[0] ?? {},
  updatedRawResults: rawResultRows.length,
  updatedOcrItems: itemRows.length,
  updatedPurchaseActuals: actualRows.length,
  deletedPriceRecords: deletedRows.length,
  insertedPriceRecords: insertedRows.length,
  after: afterRows[0] ?? {}
}, null, 2));
console.table(targetRows);
