import * as XLSX from "xlsx";
import { requireMasterOsSession, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type UploadPayload = {
  fileName?: string;
  fileBase64?: string;
  fiscalYear?: number | string;
};

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numberValue = Number(String(value ?? "").replace(/[,\s円]/g, ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizePrefecture(sheetName: string) {
  return sheetName.endsWith("県") || sheetName.endsWith("府") || sheetName.endsWith("都") || sheetName === "北海道"
    ? sheetName
    : `${sheetName}県`;
}

function detectFiscalYear(title: string, fallback: unknown) {
  const fallbackYear = Number(fallback);
  if (Number.isFinite(fallbackYear) && fallbackYear >= 2020 && fallbackYear <= 2100) return Math.round(fallbackYear);
  const reiwa = /令和\s*(\d+)\s*年/.exec(title);
  if (reiwa) return 2018 + Number(reiwa[1]);
  const western = /(20\d{2})年/.exec(title);
  return western ? Number(western[1]) : new Date().getFullYear();
}

function parseSocialInsuranceWorkbook(fileBase64: string, fiscalYearValue: unknown) {
  const workbook = XLSX.read(Buffer.from(fileBase64, "base64"), { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const firstRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" }) as unknown[][];
  const title = String(firstRows[0]?.find((value) => String(value).trim()) ?? "健康保険・厚生年金保険の保険料額表");
  const fiscalYear = detectFiscalYear(title, fiscalYearValue);
  const rows: Array<{
    prefecture: string;
    grade: string;
    standardMonthlyAmount: number;
    rewardMin: number | null;
    rewardMax: number | null;
    healthRateWithoutCare: number | null;
    healthRateWithCare: number | null;
    childSupportRate: number | null;
    pensionRate: number | null;
    healthHalfWithoutCare: number | null;
    healthHalfWithCare: number | null;
    childSupportHalf: number | null;
    pensionHalf: number | null;
    sortOrder: number;
  }> = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    const rateRow = sheetRows[7] ?? [];
    const prefecture = normalizePrefecture(sheetName);
    const healthRateWithoutCare = toNumber(rateRow[5]);
    const healthRateWithCare = toNumber(rateRow[7]);
    const childSupportRate = toNumber(rateRow[9]);
    const pensionRate = toNumber(rateRow[11]);

    for (const [index, row] of sheetRows.entries()) {
      if (index < 10) continue;
      const standardMonthlyAmount = toNumber(row[1]);
      const rewardMax = toNumber(row[4]);
      if (!standardMonthlyAmount || !rewardMax) continue;
      rows.push({
        prefecture,
        grade: String(row[0] ?? ""),
        standardMonthlyAmount,
        rewardMin: toNumber(row[2]),
        rewardMax,
        healthRateWithoutCare,
        healthRateWithCare,
        childSupportRate,
        pensionRate,
        healthHalfWithoutCare: toNumber(row[6]),
        healthHalfWithCare: toNumber(row[8]),
        childSupportHalf: toNumber(row[10]),
        pensionHalf: toNumber(row[12]),
        sortOrder: rows.length
      });
    }
  }

  if (!rows.length) throw new Error("社会保険料表の明細行を読み取れませんでした。");
  return { title, fiscalYear, rows };
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const tables = await sql`
    select
      social_insurance_tables.id::text,
      social_insurance_tables.fiscal_year as "fiscalYear",
      social_insurance_tables.title,
      social_insurance_tables.source_file_name as "sourceFileName",
      social_insurance_tables.effective_from as "effectiveFrom",
      social_insurance_tables.child_support_effective_from as "childSupportEffectiveFrom",
      social_insurance_tables.is_active as "isActive",
      social_insurance_tables.created_at as "createdAt",
      count(social_insurance_table_rows.id)::int as "rowCount"
    from social_insurance_tables
    left join social_insurance_table_rows
      on social_insurance_table_rows.table_id = social_insurance_tables.id
    group by social_insurance_tables.id
    order by social_insurance_tables.fiscal_year desc, social_insurance_tables.created_at desc
  `;

  return Response.json({ tables });
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as UploadPayload;
  const fileBase64 = String(body.fileBase64 ?? "");
  if (!fileBase64) return Response.json({ error: "社会保険料表ファイルを選択してください。" }, { status: 400 });

  let parsed: ReturnType<typeof parseSocialInsuranceWorkbook>;
  try {
    parsed = parseSocialInsuranceWorkbook(fileBase64, body.fiscalYear);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "社会保険料表を読み取れませんでした。" }, { status: 400 });
  }

  const upserted = await sql`
    insert into social_insurance_tables (
      fiscal_year,
      title,
      source_file_name,
      effective_from,
      child_support_effective_from,
      is_active,
      uploaded_by
    )
    values (
      ${parsed.fiscalYear},
      ${parsed.title},
      ${body.fileName ?? null},
      ${`${parsed.fiscalYear}-03-01`}::date,
      ${`${parsed.fiscalYear}-04-01`}::date,
      true,
      ${session.id}
    )
    on conflict (fiscal_year)
    do update set
      title = excluded.title,
      source_file_name = excluded.source_file_name,
      effective_from = excluded.effective_from,
      child_support_effective_from = excluded.child_support_effective_from,
      is_active = true,
      uploaded_by = excluded.uploaded_by,
      created_at = now()
    returning id::text
  `;
  const tableId = String(upserted[0]?.id ?? "");

  await sql`delete from social_insurance_table_rows where table_id = ${tableId}`;
  for (let index = 0; index < parsed.rows.length; index += 500) {
    const chunk = parsed.rows.slice(index, index + 500);
    await sql`
      insert into social_insurance_table_rows (
        table_id,
        prefecture,
        grade,
        standard_monthly_amount,
        reward_min,
        reward_max,
        health_rate_without_care,
        health_rate_with_care,
        child_support_rate,
        pension_rate,
        health_half_without_care,
        health_half_with_care,
        child_support_half,
        pension_half,
        sort_order
      )
      select
        ${tableId}::uuid,
        *
      from unnest(
        ${chunk.map((row) => row.prefecture)}::text[],
        ${chunk.map((row) => row.grade)}::text[],
        ${chunk.map((row) => row.standardMonthlyAmount)}::integer[],
        ${chunk.map((row) => row.rewardMin)}::integer[],
        ${chunk.map((row) => row.rewardMax)}::integer[],
        ${chunk.map((row) => row.healthRateWithoutCare)}::numeric[],
        ${chunk.map((row) => row.healthRateWithCare)}::numeric[],
        ${chunk.map((row) => row.childSupportRate)}::numeric[],
        ${chunk.map((row) => row.pensionRate)}::numeric[],
        ${chunk.map((row) => row.healthHalfWithoutCare)}::numeric[],
        ${chunk.map((row) => row.healthHalfWithCare)}::numeric[],
        ${chunk.map((row) => row.childSupportHalf)}::numeric[],
        ${chunk.map((row) => row.pensionHalf)}::numeric[],
        ${chunk.map((row) => row.sortOrder)}::integer[]
      )
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "settings.social_insurance.imported",
    targetType: "social_insurance_table",
    targetId: tableId,
    metadata: { fiscalYear: parsed.fiscalYear, rowCount: parsed.rows.length, fileName: body.fileName ?? null },
    request
  });

  return Response.json({ ok: true, tableId, fiscalYear: parsed.fiscalYear, title: parsed.title, rowCount: parsed.rows.length });
}
