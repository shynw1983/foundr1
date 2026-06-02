import * as XLSX from "xlsx";
import { requireMasterOsSession, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type UploadPayload = {
  fileName?: string;
  fileBase64?: string;
  taxYear?: number | string;
};

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[,\s円]/g, "");
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function detectTaxYear(title: string, fallback: unknown) {
  const fallbackYear = Number(fallback);
  if (Number.isFinite(fallbackYear) && fallbackYear >= 2020 && fallbackYear <= 2100) return Math.round(fallbackYear);
  const reiwa = /令和\s*(\d+)\s*年/.exec(title);
  if (reiwa) return 2018 + Number(reiwa[1]);
  const western = /(20\d{2})年/.exec(title);
  return western ? Number(western[1]) : new Date().getFullYear();
}

function parseWithholdingTaxWorkbook(fileBase64: string, taxYearValue: unknown) {
  const workbook = XLSX.read(Buffer.from(fileBase64, "base64"), { type: "buffer" });
  const sheetName = workbook.SheetNames.find((name) => name.includes("月額")) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("月額表シートを読み取れませんでした。");

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
  const title = String(rows[0]?.find((value) => String(value).trim()) ?? "給与所得の源泉徴収税額表");
  const taxYear = detectTaxYear(title, taxYearValue);
  const parsedRows: Array<{
    salaryMin: number;
    salaryMax: number | null;
    kouTaxes: number[];
    otsuTax: number | null;
    otsuRate: number | null;
    formulaNote: string | null;
    sortOrder: number;
  }> = [];

  for (const [index, row] of rows.entries()) {
    if (index < 7) continue;
    const minValue = toNumber(row[1]);
    const maxValue = toNumber(row[2]);
    const kouTaxes = Array.from({ length: 8 }, (_, offset) => toNumber(row[3 + offset]) ?? 0);
    const otsuTax = toNumber(row[11]);

    if (index === 7 && minValue !== null && String(row[2]).includes("未満")) {
      parsedRows.push({
        salaryMin: 0,
        salaryMax: minValue,
        kouTaxes,
        otsuTax: null,
        otsuRate: 0.03063,
        formulaNote: "乙欄: 社会保険料等控除後の給与等の金額の3.063%",
        sortOrder: parsedRows.length
      });
      continue;
    }

    if (minValue === null || maxValue === null || minValue >= maxValue) continue;
    if (!kouTaxes.some((value) => value > 0) && otsuTax === null) continue;
    parsedRows.push({
      salaryMin: minValue,
      salaryMax: maxValue,
      kouTaxes,
      otsuTax,
      otsuRate: null,
      formulaNote: null,
      sortOrder: parsedRows.length
    });
  }

  if (!parsedRows.length) throw new Error("税額表の明細行を読み取れませんでした。");
  return { title, taxYear, rows: parsedRows };
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const tables = await sql`
    select
      withholding_tax_tables.id::text,
      withholding_tax_tables.tax_year as "taxYear",
      withholding_tax_tables.table_type as "tableType",
      withholding_tax_tables.title,
      withholding_tax_tables.source_file_name as "sourceFileName",
      withholding_tax_tables.effective_from as "effectiveFrom",
      withholding_tax_tables.is_active as "isActive",
      withholding_tax_tables.created_at as "createdAt",
      count(withholding_tax_table_rows.id)::int as "rowCount"
    from withholding_tax_tables
    left join withholding_tax_table_rows
      on withholding_tax_table_rows.table_id = withholding_tax_tables.id
    group by withholding_tax_tables.id
    order by withholding_tax_tables.tax_year desc, withholding_tax_tables.created_at desc
  `;

  return Response.json({ tables });
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as UploadPayload;
  const fileBase64 = String(body.fileBase64 ?? "");
  if (!fileBase64) return Response.json({ error: "源泉税表ファイルを選択してください。" }, { status: 400 });

  let parsed: ReturnType<typeof parseWithholdingTaxWorkbook>;
  try {
    parsed = parseWithholdingTaxWorkbook(fileBase64, body.taxYear);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "源泉税表を読み取れませんでした。" }, { status: 400 });
  }

  const upserted = await sql`
    insert into withholding_tax_tables (
      tax_year,
      table_type,
      title,
      source_file_name,
      effective_from,
      is_active,
      uploaded_by
    )
    values (
      ${parsed.taxYear},
      'monthly',
      ${parsed.title},
      ${body.fileName ?? null},
      ${`${parsed.taxYear}-01-01`}::date,
      true,
      ${session.id}
    )
    on conflict (tax_year, table_type)
    do update set
      title = excluded.title,
      source_file_name = excluded.source_file_name,
      effective_from = excluded.effective_from,
      is_active = true,
      uploaded_by = excluded.uploaded_by,
      created_at = now()
    returning id::text
  `;
  const tableId = String(upserted[0]?.id ?? "");

  await sql`delete from withholding_tax_table_rows where table_id = ${tableId}`;
  for (const row of parsed.rows) {
    await sql`
      insert into withholding_tax_table_rows (
        table_id,
        salary_min,
        salary_max,
        kou_tax_0,
        kou_tax_1,
        kou_tax_2,
        kou_tax_3,
        kou_tax_4,
        kou_tax_5,
        kou_tax_6,
        kou_tax_7,
        otsu_tax,
        otsu_rate,
        formula_note,
        sort_order
      )
      values (
        ${tableId},
        ${row.salaryMin},
        ${row.salaryMax},
        ${row.kouTaxes[0]},
        ${row.kouTaxes[1]},
        ${row.kouTaxes[2]},
        ${row.kouTaxes[3]},
        ${row.kouTaxes[4]},
        ${row.kouTaxes[5]},
        ${row.kouTaxes[6]},
        ${row.kouTaxes[7]},
        ${row.otsuTax},
        ${row.otsuRate},
        ${row.formulaNote},
        ${row.sortOrder}
      )
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "settings.withholding_tax.imported",
    targetType: "withholding_tax_table",
    targetId: tableId,
    metadata: { taxYear: parsed.taxYear, rowCount: parsed.rows.length, fileName: body.fileName ?? null },
    request
  });

  return Response.json({ ok: true, tableId, taxYear: parsed.taxYear, title: parsed.title, rowCount: parsed.rows.length });
}
