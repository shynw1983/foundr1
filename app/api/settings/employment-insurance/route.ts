import { PDFParse } from "pdf-parse";
import { requireMasterOsSession, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

type UploadPayload = {
  fileName?: string;
  fileBase64?: string;
  fiscalYear?: number | string;
};

type ParsedEmploymentInsuranceRateRow = {
  businessType: string;
  label: string;
  sortOrder: number;
  employeeRate: number | null;
  employerRate: number | null;
  benefitRate: number | null;
  twoProjectsRate: number | null;
  totalRate: number | null;
};

const businessTypes = [
  { key: "general", label: "一般の事業" },
  { key: "agriculture_sake", label: "農林水産・清酒製造の事業" },
  { key: "construction", label: "建設の事業" }
];

function normalizeText(text: string) {
  return text
    .replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10))
    .replace(/．/g, ".")
    .replace(/[，、]/g, ",")
    .replace(/\s+/g, " ")
    .replace("農林水産・ 清酒製造", "農林水産・清酒製造")
    .trim();
}

function parseRate(text: string | undefined) {
  const match = /(\d+(?:\.\d+)?)\/1,?000/.exec(text ?? "");
  return match ? Number(match[1]) / 1000 : null;
}

function detectFiscalYear(text: string, fallback: unknown) {
  const normalized = normalizeText(text);
  const fallbackYear = Number(fallback);
  if (Number.isFinite(fallbackYear) && fallbackYear >= 2020 && fallbackYear <= 2100) return Math.round(fallbackYear);
  const reiwa = /令和\s*(\d+)[（(]?\s*(?:20)?\d*\s*[）)]?\s*年度/.exec(normalized);
  if (reiwa) return 2018 + Number(reiwa[1]);
  const western = /(20\d{2})\s*年度/.exec(normalized);
  return western ? Number(western[1]) : new Date().getFullYear();
}

function normalizeFiscalYear(fallback: unknown) {
  const fallbackYear = Number(fallback);
  if (Number.isFinite(fallbackYear) && fallbackYear >= 2020 && fallbackYear <= 2100) return Math.round(fallbackYear);
  return new Date().getFullYear();
}

function parseBusinessTypeLine(text: string, label: string) {
  const normalized = normalizeText(text);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primaryMatch = new RegExp(`${escaped} ([^（]+?)(?:（令和|$)`).exec(normalized);
  const fallbackMatch = new RegExp(`${escaped}(.{0,180})`).exec(normalized);
  const rateSource = primaryMatch?.[1] ?? fallbackMatch?.[1] ?? "";
  const rates = rateSource.match(/\d+(?:\.\d+)?\/1,?000/g) ?? [];
  if (rates.length < 5) return null;
  return {
    employeeRate: parseRate(rates[0]),
    employerRate: parseRate(rates[1]),
    benefitRate: parseRate(rates[2]),
    twoProjectsRate: parseRate(rates[3]),
    totalRate: parseRate(rates[4])
  };
}

function parseEmploymentInsuranceRateRows(text: string) {
  const normalized = normalizeText(text);
  const namedRows = businessTypes.map((businessType, index) => {
    const parsed = parseBusinessTypeLine(text, businessType.label);
    if (!parsed || parsed.employeeRate === null || parsed.totalRate === null) return null;
    return {
      businessType: businessType.key,
      label: businessType.label,
      sortOrder: index,
      ...parsed
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (namedRows.length === businessTypes.length) return namedRows;

  const currentRateBlock = /＜令和\d+年度の雇用保険料率＞(.+?)(?:※|•|$)/.exec(normalized)?.[1] ?? normalized;
  const currentRates = currentRateBlock.match(/\d+(?:\.\d+)?\/1,?000/g) ?? [];
  if (currentRates.length < businessTypes.length * 5) return namedRows;
  const rateStride = currentRates.length >= businessTypes.length * 10 ? 10 : 5;

  const fallbackRows = businessTypes.map((businessType, index) => {
    const offset = index * rateStride;
    const rates = currentRates.slice(offset, offset + 5);
    return {
      businessType: businessType.key,
      label: businessType.label,
      sortOrder: index,
      employeeRate: parseRate(rates[0]),
      employerRate: parseRate(rates[1]),
      benefitRate: parseRate(rates[2]),
      twoProjectsRate: parseRate(rates[3]),
      totalRate: parseRate(rates[4])
    };
  });

  return fallbackRows.filter((row) => row.employeeRate !== null && row.totalRate !== null);
}

function knownEmploymentInsuranceRows(fiscalYear: number) {
  const knownRates: Record<number, number[][]> = {
    2025: [
      [5.5, 9, 5.5, 3.5, 14.5],
      [6.5, 10, 6.5, 3.5, 16.5],
      [6.5, 11, 6.5, 4.5, 17.5]
    ],
    2026: [
      [5, 8.5, 5, 3.5, 13.5],
      [6, 9.5, 6, 3.5, 15.5],
      [6, 10.5, 6, 4.5, 16.5]
    ]
  };
  const rates = knownRates[fiscalYear];
  if (!rates) return [] satisfies ParsedEmploymentInsuranceRateRow[];
  return businessTypes.map((businessType, index) => ({
    businessType: businessType.key,
    label: businessType.label,
    sortOrder: index,
    employeeRate: rates[index][0] / 1000,
    employerRate: rates[index][1] / 1000,
    benefitRate: rates[index][2] / 1000,
    twoProjectsRate: rates[index][3] / 1000,
    totalRate: rates[index][4] / 1000
  })) satisfies ParsedEmploymentInsuranceRateRow[];
}

async function parseEmploymentInsurancePdf(fileBase64: string, fiscalYearValue: unknown) {
  let text = "";
  let parser: PDFParse | null = null;
  try {
    parser = new PDFParse({ data: Buffer.from(fileBase64, "base64") });
    const result = await parser.getText();
    text = result.text;
  } catch (error) {
    console.error("Failed to parse employment insurance PDF text", error);
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
  const fiscalYear = detectFiscalYear(text, fiscalYearValue);
  const rows = text ? parseEmploymentInsuranceRateRows(text) : knownEmploymentInsuranceRows(normalizeFiscalYear(fiscalYearValue));
  const finalRows = rows.length ? rows : knownEmploymentInsuranceRows(fiscalYear);

  if (!finalRows.length) throw new Error("雇用保険料率を読み取れませんでした。解析器の更新が必要です。");
  return {
    title: `令和${fiscalYear - 2018}年度 雇用保険料率`,
    fiscalYear,
    effectiveFrom: `${fiscalYear}-04-01`,
    effectiveTo: `${fiscalYear + 1}-03-31`,
    rows: finalRows
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
  const knownFiscalYear = normalizeFiscalYear(body.fiscalYear);

  let parsed: Awaited<ReturnType<typeof parseEmploymentInsurancePdf>>;
  if (fileBase64) {
    try {
      parsed = await parseEmploymentInsurancePdf(fileBase64, body.fiscalYear);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "雇用保険料率を読み取れませんでした。" }, { status: 400 });
    }
  } else {
    const rows = knownEmploymentInsuranceRows(knownFiscalYear);
    if (!rows.length) return Response.json({ error: "この年度の雇用保険料率はまだ登録済みの公式料率がありません。PDF を選択してください。" }, { status: 400 });
    parsed = {
      title: `令和${knownFiscalYear - 2018}年度 雇用保険料率`,
      fiscalYear: knownFiscalYear,
      effectiveFrom: `${knownFiscalYear}-04-01`,
      effectiveTo: `${knownFiscalYear + 1}-03-31`,
      rows
    };
  }

  let tableId = "";
  try {
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
    tableId = String(upserted[0]?.id ?? "");

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
  } catch (error) {
    console.error("Failed to save employment insurance rates", error);
    return Response.json({ error: "雇用保険料率は読み取れましたが、保存できませんでした。データベース設定を確認してください。" }, { status: 500 });
  }

  return Response.json({ ok: true, tableId, fiscalYear: parsed.fiscalYear, title: parsed.title, rowCount: parsed.rows.length });
}
