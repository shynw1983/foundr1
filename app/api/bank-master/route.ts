import { requireStaffViewSession } from "../../../lib/staff-admin-access";
import { sql } from "../../../lib/db";
import { builtInBanks, builtInBranches } from "../../../lib/bank-master";

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function digits(value: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

export async function GET(request: Request) {
  const access = await requireStaffViewSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("query"));
  const bankCode = digits(url.searchParams.get("bankCode"));

  const savedBanks = await sql`
    select distinct
      payroll_bank_code as code,
      payroll_bank_name as name
    from employees
    where payroll_bank_code is not null
      and payroll_bank_name is not null
      and (
        ${access.allStores}
        or exists (
          select 1
          from employee_scopes
          where employee_scopes.employee_id = employees.id
            and employee_scopes.scope_type = 'store'
            and employee_scopes.store_id::text = any(${access.storeIds})
        )
        or exists (
          select 1
          from employee_work_stores
          where employee_work_stores.employee_id = employees.id
            and employee_work_stores.store_id::text = any(${access.storeIds})
        )
      )
  `;

  const bankByCode = new Map(builtInBanks.map((bank) => [bank.code, bank]));
  for (const bank of savedBanks) {
    const code = digits(String(bank.code ?? ""));
    const name = String(bank.name ?? "").trim();
    if (code && name && !bankByCode.has(code)) bankByCode.set(code, { code, name, kana: "" });
  }

  const banks = Array.from(bankByCode.values())
    .filter((bank) => {
      if (!query) return true;
      return bank.code.includes(query) || bank.name.toLowerCase().includes(query) || bank.kana.toLowerCase().includes(query);
    })
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, 40);

  const savedBranches = bankCode ? await sql`
    select distinct
      payroll_branch_code as code,
      payroll_branch_name as name
    from employees
    where payroll_bank_code = ${bankCode}
      and payroll_branch_code is not null
      and payroll_branch_name is not null
      and (
        ${access.allStores}
        or exists (
          select 1
          from employee_scopes
          where employee_scopes.employee_id = employees.id
            and employee_scopes.scope_type = 'store'
            and employee_scopes.store_id::text = any(${access.storeIds})
        )
        or exists (
          select 1
          from employee_work_stores
          where employee_work_stores.employee_id = employees.id
            and employee_work_stores.store_id::text = any(${access.storeIds})
        )
      )
  ` : [];

  const branchesByCode = new Map(
    builtInBranches
      .filter((branch) => !bankCode || branch.bankCode === bankCode)
      .map((branch) => [branch.code, branch])
  );
  for (const branch of savedBranches) {
    const code = digits(String(branch.code ?? ""));
    const name = String(branch.name ?? "").trim();
    if (code && name && !branchesByCode.has(code)) branchesByCode.set(code, { bankCode, code, name, kana: "" });
  }

  const branches = Array.from(branchesByCode.values())
    .filter((branch) => {
      if (!query) return true;
      return branch.code.includes(query) || branch.name.toLowerCase().includes(query) || branch.kana.toLowerCase().includes(query);
    })
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, 80);

  return Response.json({ banks, branches });
}
