import { PDFParse } from "pdf-parse";
import { requireMasterOsSession, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type UploadPayload = {
  fileName?: string;
  fileBase64?: string;
  fiscalYear?: number | string;
};

const businessTypes = [
  { key: "general", label: "一般の事業" },
  { key: "agriculture_sake", label: "農林水産・清酒製造の事業" },
  { key: "construction", label: "建設の事業" }
];

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").replace(/，/g, ",").trim();
}

function parseRate(text: string | undefined) {
  const match = /(\d+(?:\.\d+)?)\/1,?000/.exec(text ?? "");
  return match ? Number(match[1]) / 1000 : null;
}

function detectFiscalYear(text: string, fallback: unknown) {
  const fallbackYear = Number(fallback);
  if (Number.isFinite(fallbackYear) && fallbackYear >= 2020 && fallbackYear <= 2100) return Math.round(fallbackYear);
  const reiwa = /令和\s*(\d+)[（(]?\s*20?\s*\d*\s*[）)]?\s*年度/.exec(text);
  if (reiwa) return 2018 + Number(reiwa[1]);
  const western = /(20\d{2})\s*年度/.exec(text);
  return western ? Number(western[1]) : new Date().getFullYear();
}

function parseBusinessTypeLine(text: string, label: string) {
  const normalized = normalizeText(text).replace("農林水産・ 清酒製造", "農林水産・清酒製造");
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped} ([^（]+?)(?:（令和|$)`).exec(normalized);
  if (!match) return null;
  const rates = match[1].match(/\d+(?:\.\d+)?\/1,?000/g) ?? [];
  if (rates.length < 5) return null;
  return {
    employeeRate: parseRate(rates[0]),
    employerRate: parseRate(rates[1]),
    benefitRate: parseRate(rates[2]),
    twoProjectsRate: parseRate(rates[3]),
    totalRate: parseRate(rates[4])
  };
}

async function parseEmploymentInsurancePdf(fileBase64: string, fiscalYearValue: unknown) {
  const parser = new PDFParse({ data: Buffer.from(fileBase64, "base64") });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.text;
  const fiscalYear = detectFiscalYear(text, fiscalYearValue);
  const rows = businessTypes.map((businessType, index) => {
    const parsed = parseBusinessTypeLine(text, businessType.label);
    if (!parsed?.employeeRate || !parsed.totalRate) return null;
    return {
      businessType: businessType.key,
      label: businessType.label,
      sortOrder: index,
      ...parsed
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) throw new Error("雇用保険料率を読み取れませんでした。解析器の更新が必要です。");
  return {
    title: `令和${fiscalYear - 2018}年度 雇用保険料率`,
    fiscalYear,
    effectiveFrom: `${fiscalYear}-04-01`,
    effectiveTo: `${fiscalYear + 1}-03-31`,
    rows
  };
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const tables = await sql`
    select
      employment_insurance_rate_tables.id::text,
      employment_insurance_rate_tables.fiscal_year as "fiscalYear",
      employment_insurance_rate_tables.title,
      employment_insurance_rate_tables.source_file_name as "sourceFileName",
      employment_insurance_rate_tables.effective_from as "effectiveFrom",
      employment_insurance_rate_tables.effective_to as "effectiveTo",
      employment_insurance_rate_tables.is_active as "isActive",
      employment_insurance_rate_tables.created_at as "createdAt",
      count(employment_insurance_rate_rows.id)::int as "rowCount"
    from employment_insurance_rate_tables
    left join employment_insurance_rate_rows
      on employment_insurance_rate_rows.table_id = employment_insurance_rate_tables.id
    group by employment_insurance_rate_tables.id
    order by employment_insurance_rate_tables.fiscal_year desc, employment_insurance_rate_tables.created_at desc
  `;

  return Response.json({ tables });
}

export async function POST(request: Request) {
  const session = await requireMasterOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as UploadPayload;
  const fileBase64 = String(body.fileBase64 ?? "");
  if (!fileBase64) return Response.json({ error: "雇用保険料率ファイルを選択してください。" }, { status: 400 });

  let parsed: Awaited<ReturnType<typeof parseEmploymentInsurancePdf>>;
  try {
    parsed = await parseEmploymentInsurancePdf(fileBase64, body.fiscalYear);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "雇用保険料率を読み取れませんでした。" }, { status: 400 });
  }

  const upserted = await sql`
    insert into employment_insurance_rate_tables (
      fiscal_year,
      title,
      source_file_name,
      effective_from,
      effective_to,
      is_active,
      uploaded_by
    )
    values (
      ${parsed.fiscalYear},
      ${parsed.title},
      ${body.fileName ?? null},
      ${parsed.effectiveFrom}::date,
      ${parsed.effectiveTo}::date,
      true,
      ${session.id}
    )
    on conflict (fiscal_year)
    do update set
      title = excluded.title,
      source_file_name = excluded.source_file_name,
      effective_from = excluded.effective_from,
      effective_to = excluded.effective_to,
      is_active = true,
      uploaded_by = excluded.uploaded_by,
      created_at = now()
    returning id::text
  `;
  const tableId = String(upserted[0]?.id ?? "");

  await sql`delete from employment_insurance_rate_rows where table_id = ${tableId}`;
  for (const row of parsed.rows) {
    await sql`
      insert into employment_insurance_rate_rows (
        table_id,
        business_type,
        employee_rate,
        employer_rate,
        benefit_rate,
        two_projects_rate,
        total_rate,
        sort_order
      )
      values (
        ${tableId},
        ${row.businessType},
        ${row.employeeRate},
        ${row.employerRate},
        ${row.benefitRate},
        ${row.twoProjectsRate},
        ${row.totalRate},
        ${row.sortOrder}
      )
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "settings.employment_insurance.imported",
    targetType: "employment_insurance_rate_table",
    targetId: tableId,
    metadata: { fiscalYear: parsed.fiscalYear, rowCount: parsed.rows.length, fileName: body.fileName ?? null },
    request
  });

  return Response.json({ ok: true, tableId, fiscalYear: parsed.fiscalYear, title: parsed.title, rowCount: parsed.rows.length });
}
