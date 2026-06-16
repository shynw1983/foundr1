import { requireStaffViewSession } from "../../../lib/staff-admin-access";
import { sql } from "../../../lib/db";
import { builtInBanks, builtInBranches } from "../../../lib/bank-master";
import type { BankMasterBank, BankMasterBranch } from "../../../lib/bank-master";

function normalizeQuery(value: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function digits(value: string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeKanaGroup(value: string | null) {
  return String(value ?? "").trim();
}

type TerarenBank = {
  code?: string;
  name?: string;
  kana?: string;
  hira?: string;
  normalize?: {
    name?: string;
    kana?: string;
    hira?: string;
  };
};

async function fetchJsonWithTimeout<T>(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBank(item: TerarenBank): BankMasterBank | null {
  const code = digits(item.code ?? "");
  const name = String(item.normalize?.name ?? item.name ?? "").trim();
  if (!code || !name) return null;
  return {
    code,
    name,
    kana: String(item.normalize?.kana ?? item.kana ?? ""),
    hira: String(item.normalize?.hira ?? item.hira ?? "")
  };
}

function normalizeBranch(bankCode: string, item: TerarenBank): BankMasterBranch | null {
  const code = digits(item.code ?? "");
  const name = String(item.normalize?.name ?? item.name ?? "").trim();
  if (!bankCode || !code || !name) return null;
  return {
    bankCode,
    code,
    name,
    kana: String(item.normalize?.kana ?? item.kana ?? ""),
    hira: String(item.normalize?.hira ?? item.hira ?? "")
  };
}

async function getRemoteBanks() {
  const data = await fetchJsonWithTimeout<TerarenBank[]>("https://bank.teraren.com/banks.json");
  return Array.isArray(data) ? data.map(normalizeBank).filter((bank): bank is BankMasterBank => Boolean(bank)) : [];
}

async function getRemoteBranches(bankCode: string) {
  if (!bankCode) return [];
  const data = await fetchJsonWithTimeout<TerarenBank[]>(`https://bank.teraren.com/banks/${bankCode}/branches.json`);
  return Array.isArray(data) ? data.map((branch) => normalizeBranch(bankCode, branch)).filter((branch): branch is BankMasterBranch => Boolean(branch)) : [];
}

function matchesQuery(item: { code: string; name: string; kana?: string; hira?: string }, query: string) {
  if (!query) return true;
  return item.code.includes(query)
    || item.name.toLowerCase().includes(query)
    || String(item.kana ?? "").toLowerCase().includes(query)
    || String(item.hira ?? "").toLowerCase().includes(query);
}

function matchesKanaGroup(item: { hira?: string }, kanaGroup: string) {
  if (!kanaGroup) return true;
  const hira = String(item.hira ?? "");
  return Boolean(hira) && Array.from(kanaGroup).some((kana) => hira.startsWith(kana));
}

function sortByHiraThenCode<T extends { code: string; hira?: string; kana?: string; name: string }>(a: T, b: T) {
  return String(a.hira || a.kana || a.name).localeCompare(String(b.hira || b.kana || b.name), "ja") || a.code.localeCompare(b.code);
}

export async function GET(request: Request) {
  const access = await requireStaffViewSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const query = normalizeQuery(url.searchParams.get("query"));
  const kanaGroup = normalizeKanaGroup(url.searchParams.get("kanaGroup"));
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

  const remoteBanks = await getRemoteBanks();
  const bankByCode = new Map(builtInBanks.map((bank) => [bank.code, bank]));
  for (const bank of remoteBanks) {
    bankByCode.set(bank.code, bank);
  }
  for (const bank of savedBanks) {
    const code = digits(String(bank.code ?? ""));
    const name = String(bank.name ?? "").trim();
    if (code && name && !bankByCode.has(code)) bankByCode.set(code, { code, name, kana: "", hira: "" });
  }

  const banks = Array.from(bankByCode.values())
    .filter((bank) => matchesQuery(bank, query))
    .filter((bank) => matchesKanaGroup(bank, kanaGroup))
    .sort(sortByHiraThenCode)
    .slice(0, query || kanaGroup ? 80 : 20);

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

  const remoteBranches = await getRemoteBranches(bankCode);
  const branchesByCode = new Map(
    (remoteBranches.length ? remoteBranches : builtInBranches)
      .filter((branch) => !bankCode || branch.bankCode === bankCode)
      .map((branch) => [branch.code, branch])
  );
  for (const branch of savedBranches) {
    const code = digits(String(branch.code ?? ""));
    const name = String(branch.name ?? "").trim();
    if (code && name && !branchesByCode.has(code)) branchesByCode.set(code, { bankCode, code, name, kana: "", hira: "" });
  }

  const branches = Array.from(branchesByCode.values())
    .filter((branch) => matchesQuery(branch, query))
    .filter((branch) => matchesKanaGroup(branch, kanaGroup))
    .sort(sortByHiraThenCode)
    .slice(0, query || kanaGroup ? 80 : 20);

  return Response.json({ banks, branches });
}
