import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import {
  buildGmoPayrollCsv,
  buildZenginPayrollFile,
  normalizePayrollAccountType,
  sha256Hex,
  validatePayrollTransferItem,
  validatePayrollTransferOrigin,
  type PayrollTransferItem,
  type PayrollTransferOrigin
} from "../../../../lib/payroll-bank-transfer";

type PayrollPaymentRequest = {
  storeId?: string;
  month?: string;
  paymentDate?: string;
  fileFormat?: string;
  bankProvider?: string;
  transferType?: string;
  companyCode?: string;
  companyName?: string;
  debitBankCode?: string;
  debitBankName?: string;
  debitBranchCode?: string;
  debitBranchName?: string;
  debitAccountType?: string;
  debitAccountNumber?: string;
  debitAccountHolderKana?: string;
};

type PayrollRowSnapshot = {
  employeeId?: unknown;
  employeeName?: unknown;
  totalPay?: unknown;
  alerts?: unknown;
};

const payrollPaymentRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

function isValidMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function digits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeKana(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function getFileName(input: { month: string; paymentDate: string; storeName: string; fileFormat: string }) {
  const safeStoreName = input.storeName.replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, "_").slice(0, 24) || "store";
  const extension = input.fileFormat === "gmo_csv" ? "csv" : "txt";
  return `payroll_${input.month}_${input.paymentDate}_${safeStoreName}.${extension}`;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session || !payrollPaymentRoles.has(session.role)) {
    return Response.json({ error: "給与振込ファイルを表示する権限がありません。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const storeId = url.searchParams.get("storeId") ?? "";
  const month = url.searchParams.get("month") ?? "";
  if (!storeId || !isValidMonth(month)) {
    return Response.json({ error: "店舗と月度を指定してください。" }, { status: 400 });
  }
  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の給与振込ファイルを表示できません。" }, { status: 403 });
  }

  const batches = await sql`
    select
      payroll_payment_batches.id::text,
      payroll_payment_batches.payroll_month as "payrollMonth",
      to_char(payroll_payment_batches.payment_date, 'YYYY-MM-DD') as "paymentDate",
      payroll_payment_batches.bank_provider as "bankProvider",
      payroll_payment_batches.file_format as "fileFormat",
      payroll_payment_batches.file_name as "fileName",
      payroll_payment_batches.total_amount::float as "totalAmount",
      payroll_payment_batches.transfer_count::int as "transferCount",
      payroll_payment_batches.status,
      payroll_payment_batches.created_at as "createdAt",
      employees.name as "createdByName"
    from payroll_payment_batches
    left join employees on employees.id = payroll_payment_batches.created_by
    where payroll_payment_batches.store_id::text = ${storeId}
      and payroll_payment_batches.payroll_month = ${month}
    order by payroll_payment_batches.created_at desc
    limit 10
  `;

  return Response.json({ batches });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session || !payrollPaymentRoles.has(session.role)) {
    return Response.json({ error: "給与振込ファイルを作成する権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as PayrollPaymentRequest;
  const storeId = String(body.storeId ?? "");
  const month = String(body.month ?? "");
  const paymentDate = String(body.paymentDate ?? "");
  const fileFormat = body.fileFormat === "gmo_csv" ? "gmo_csv" : "zengin";
  const transferType = body.transferType === "bonus" || body.transferType === "general" ? body.transferType : "salary";
  const bankProvider = body.bankProvider === "gmo_aozora" || body.bankProvider === "fukuoka" ? body.bankProvider : "zengin";

  if (!storeId || !isValidMonth(month) || !isValidDate(paymentDate)) {
    return Response.json({ error: "店舗、月度、振込指定日を指定してください。" }, { status: 400 });
  }
  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の給与振込ファイルを作成できません。" }, { status: 403 });
  }

  const confirmations = await sql`
    select
      timecard_payroll_confirmations.id::text,
      timecard_payroll_confirmations.payroll_rows as "payrollRows",
      stores.name as "storeName",
      coalesce(companies.name, stores.name) as "companyName"
    from timecard_payroll_confirmations
    join stores on stores.id = timecard_payroll_confirmations.store_id
    left join companies on companies.id = stores.company_id
    where timecard_payroll_confirmations.store_id::text = ${storeId}
      and timecard_payroll_confirmations.payroll_month = ${month}
    limit 1
  `;
  const confirmation = confirmations[0];
  if (!confirmation || !Array.isArray(confirmation.payrollRows)) {
    return Response.json({ error: "先にこの月度の給与を確定してください。" }, { status: 409 });
  }

  const payrollRows = (confirmation.payrollRows as PayrollRowSnapshot[])
    .map((row) => ({
      employeeId: String(row.employeeId ?? ""),
      employeeName: String(row.employeeName ?? ""),
      amount: Math.round(Number(row.totalPay ?? 0) || 0),
      payrollAlerts: Array.isArray(row.alerts) ? row.alerts.map(String).filter(Boolean) : []
    }))
    .filter((row) => row.employeeId && row.amount > 0);

  if (!payrollRows.length) {
    return Response.json({ error: "振込対象の給与明細がありません。" }, { status: 409 });
  }

  const employeeIds = payrollRows.map((row) => row.employeeId);
  const employeeBankRows = await sql`
    select
      id::text,
      name,
      name_kana as "nameKana",
      payroll_bank_code as "bankCode",
      payroll_bank_name as "bankName",
      payroll_branch_code as "branchCode",
      payroll_branch_name as "branchName",
      coalesce(payroll_account_type, 'ordinary') as "accountType",
      payroll_account_number as "accountNumber",
      payroll_account_holder_kana as "accountHolderKana"
    from employees
    where id::text = any(${employeeIds})
  `;
  const bankByEmployeeId = new Map(employeeBankRows.map((row) => [String(row.id), row]));

  const items: PayrollTransferItem[] = payrollRows.map((row) => {
    const employee = bankByEmployeeId.get(row.employeeId);
    return {
      employeeId: row.employeeId,
      employeeName: row.employeeName || String(employee?.name ?? ""),
      employeeNameKana: employee?.nameKana ? String(employee.nameKana) : null,
      bankCode: employee?.bankCode ? String(employee.bankCode) : "",
      bankName: employee?.bankName ? String(employee.bankName) : "",
      branchCode: employee?.branchCode ? String(employee.branchCode) : "",
      branchName: employee?.branchName ? String(employee.branchName) : "",
      accountType: normalizePayrollAccountType(employee?.accountType ? String(employee.accountType) : "ordinary"),
      accountNumber: employee?.accountNumber ? String(employee.accountNumber) : "",
      accountHolderKana: employee?.accountHolderKana ? String(employee.accountHolderKana) : "",
      amount: row.amount,
      alerts: row.payrollAlerts
    };
  });

  const itemErrors = items
    .map((item) => ({ item, alerts: validatePayrollTransferItem(item) }))
    .filter((result) => result.alerts.length > 0);
  if (itemErrors.length) {
    return Response.json({
      error: "振込ファイルを作成する前に、給与明細または振込口座を確認してください。",
      itemErrors: itemErrors.map((result) => ({
        employeeId: result.item.employeeId,
        employeeName: result.item.employeeName,
        alerts: result.alerts
      }))
    }, { status: 409 });
  }

  const origin: PayrollTransferOrigin = {
    companyCode: body.companyCode ?? "0",
    companyName: normalizeKana(body.companyName) || normalizeKana(String(confirmation.companyName ?? "")),
    debitBankCode: digits(body.debitBankCode),
    debitBankName: String(body.debitBankName ?? ""),
    debitBranchCode: digits(body.debitBranchCode),
    debitBranchName: String(body.debitBranchName ?? ""),
    debitAccountType: normalizePayrollAccountType(body.debitAccountType),
    debitAccountNumber: digits(body.debitAccountNumber),
    debitAccountHolderKana: normalizeKana(body.debitAccountHolderKana)
  };
  const originAlerts = validatePayrollTransferOrigin(origin);
  if (originAlerts.length) {
    return Response.json({ error: "出金口座情報を確認してください。", originAlerts }, { status: 409 });
  }

  const fileContent = fileFormat === "gmo_csv"
    ? buildGmoPayrollCsv(items)
    : buildZenginPayrollFile({ transferType, paymentDate, origin, items });
  const fileName = getFileName({ month, paymentDate, storeName: String(confirmation.storeName ?? "store"), fileFormat });
  const fileSha256 = sha256Hex(fileContent);
  const totalAmount = items.reduce((sum, item) => sum + Math.round(Number(item.amount) || 0), 0);

  const batchRows = await sql`
    insert into payroll_payment_batches (
      store_id,
      payroll_confirmation_id,
      payroll_month,
      payment_date,
      bank_provider,
      transfer_type,
      company_name,
      debit_bank_code,
      debit_bank_name,
      debit_branch_code,
      debit_branch_name,
      debit_account_type,
      debit_account_number,
      debit_account_holder_kana,
      total_amount,
      transfer_count,
      file_format,
      file_name,
      file_sha256,
      created_by,
      updated_at
    )
    values (
      ${storeId},
      ${confirmation.id},
      ${month},
      ${paymentDate}::date,
      ${bankProvider},
      ${transferType},
      ${origin.companyName},
      ${origin.debitBankCode},
      ${origin.debitBankName ?? ""},
      ${origin.debitBranchCode},
      ${origin.debitBranchName ?? ""},
      ${origin.debitAccountType},
      ${origin.debitAccountNumber},
      ${origin.debitAccountHolderKana},
      ${totalAmount},
      ${items.length},
      ${fileFormat},
      ${fileName},
      ${fileSha256},
      ${session.id},
      now()
    )
    returning id::text
  `;
  const batchId = String(batchRows[0]?.id ?? "");

  for (const item of items) {
    await sql`
      insert into payroll_payment_batch_items (
        batch_id,
        employee_id,
        employee_name,
        employee_name_kana,
        bank_code,
        bank_name,
        branch_code,
        branch_name,
        account_type,
        account_number,
        account_holder_kana,
        transfer_amount,
        row_alerts
      )
      values (
        ${batchId},
        ${item.employeeId},
        ${item.employeeName},
        ${item.employeeNameKana ?? null},
        ${digits(item.bankCode)},
        ${item.bankName ?? ""},
        ${digits(item.branchCode)},
        ${item.branchName ?? ""},
        ${normalizePayrollAccountType(item.accountType)},
        ${digits(item.accountNumber)},
        ${normalizeKana(item.accountHolderKana)},
        ${Math.round(Number(item.amount) || 0)},
        ${JSON.stringify(item.alerts ?? [])}::jsonb
      )
    `;
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "timecard.payroll_payment.exported",
    targetType: "payroll_payment_batch",
    targetId: batchId,
    metadata: { storeId, month, paymentDate, bankProvider, fileFormat, transferType, totalAmount, transferCount: items.length, fileSha256 },
    request
  });

  return Response.json({
    batchId,
    fileName,
    fileContent,
    fileSha256,
    totalAmount,
    transferCount: items.length
  });
}
