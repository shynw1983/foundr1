import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const expenseEditRoles = new Set(["owner", "manager"]);
const expenseCategories = new Set(["fixed", "variable", "misc"]);

function getCurrentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit"
  }).format(new Date());
}

function isMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

function normalizeCategory(value: unknown) {
  const category = String(value ?? "");
  return expenseCategories.has(category) ? category : "misc";
}

function normalizeAccountTitle(value: unknown) {
  const title = String(value ?? "").trim();
  return accountTitles.has(title) ? title : "雑費";
}

function getManagementCategoryFromAccountTitle(accountTitle: string) {
  if (fixedAccountTitles.has(accountTitle)) return "fixed";
  if (variableAccountTitles.has(accountTitle)) return "variable";
  return "misc";
}

function normalizeAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function normalizeTaxRate(value: unknown) {
  const text = String(value ?? "").replace("%", "").trim();
  if (text === "8" || text === "8.0") return "8%";
  if (text === "10" || text === "10.0") return "10%";
  if (text === "非課税" || text === "0") return "非課税";
  return "";
}

function normalizeTaxMode(value: unknown) {
  const mode = String(value ?? "").trim();
  return mode === "内税" || mode === "外税" ? mode : "不明";
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeTime(value: unknown) {
  const time = String(value ?? "").trim();
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

async function getVisibleStores(allStores: boolean, storeIds: string[]) {
  if (allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (storeIds.length === 0) return [];
  return sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${storeIds})
    order by name
  `;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month") ?? getCurrentMonth();
  const month = isMonth(monthParam) ? monthParam : getCurrentMonth();
  const scope = await getSessionStoreScope(session);
  const stores = await getVisibleStores(scope.allStores, scope.storeIds);
  const visibleStoreIds = stores.map((store) => String(store.id));
  const requestedStoreId = url.searchParams.get("storeId");
  const selectedStoreId = requestedStoreId && visibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : visibleStoreIds[0] ?? "";

  const expenses = selectedStoreId ? await sql`
    select
      id::text,
      store_id::text as "storeId",
      category,
      account_title as "accountTitle",
      name,
      amount::float,
      coalesce(tax_rate, '') as "taxRate",
      coalesce(tax_mode, '') as "taxMode",
      tax_amount::float as "taxAmount",
      coalesce(vendor_name, '') as "vendorName",
      coalesce(to_char(transaction_date, 'YYYY-MM-DD'), '') as "transactionDate",
      coalesce(to_char(transaction_time, 'HH24:MI'), '') as "transactionTime",
      coalesce(expense_receipt_id::text, '') as "expenseReceiptId",
      start_month as "startMonth",
      end_month as "endMonth",
      note,
      updated_at as "updatedAt"
    from analytics_expenses
    where store_id::text = ${selectedStoreId}
    order by
      case category
        when 'fixed' then 1
        when 'variable' then 2
        else 3
      end,
      start_month desc,
      name asc
  ` : [];

  const monthlyExpenses = expenses.filter((expense) => {
    const startMonth = String(expense.startMonth);
    const endMonth = expense.endMonth ? String(expense.endMonth) : "";
    return startMonth <= month && (!endMonth || endMonth >= month);
  });
  const monthlyTotals = monthlyExpenses.reduce((totals, expense) => {
    const category = normalizeCategory(expense.category) as "fixed" | "variable" | "misc";
    const amount = Number(expense.amount ?? 0);
    totals[category] += amount;
    totals.total += amount;
    return totals;
  }, { fixed: 0, variable: 0, misc: 0, total: 0 });

  return Response.json({
    month,
    stores,
    selectedStoreId,
    canEditExpenses: expenseEditRoles.has(session.role),
    expenses: expenses.map((expense) => ({
      id: String(expense.id),
      storeId: String(expense.storeId),
      category: normalizeCategory(expense.category),
      accountTitle: String(expense.accountTitle ?? ""),
      name: String(expense.name),
      amount: Number(expense.amount ?? 0),
      taxRate: String(expense.taxRate ?? ""),
      taxMode: String(expense.taxMode ?? ""),
      taxAmount: Number(expense.taxAmount ?? 0),
      vendorName: String(expense.vendorName ?? ""),
      transactionDate: String(expense.transactionDate ?? ""),
      transactionTime: String(expense.transactionTime ?? ""),
      expenseReceiptId: String(expense.expenseReceiptId ?? ""),
      startMonth: String(expense.startMonth),
      endMonth: expense.endMonth ? String(expense.endMonth) : "",
      note: String(expense.note ?? ""),
      updatedAt: new Date(String(expense.updatedAt)).toISOString()
    })),
    monthlyTotals
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費を変更する権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    storeId?: string;
    category?: string;
    accountTitle?: string;
    name?: string;
    amount?: number;
    startMonth?: string;
    endMonth?: string;
    note?: string;
  };
  const storeId = String(body.storeId ?? "");
  if (!await canAccessStore(session, storeId)) {
    return Response.json({ error: "この店舗の経費を変更する権限がありません。" }, { status: 403 });
  }

  const accountTitle = normalizeAccountTitle(body.accountTitle);
  const name = String(body.name ?? "").trim();
  const startMonth = String(body.startMonth ?? "");
  const endMonth = String(body.endMonth ?? "").trim();
  if (!name) return Response.json({ error: "経費名を入力してください。" }, { status: 400 });
  if (!isMonth(startMonth)) return Response.json({ error: "開始月を入力してください。" }, { status: 400 });
  if (endMonth && (!isMonth(endMonth) || endMonth < startMonth)) {
    return Response.json({ error: "終了月は開始月以降で入力してください。" }, { status: 400 });
  }

  const rows = await sql`
    insert into analytics_expenses (
      store_id,
      category,
      account_title,
      name,
      amount,
      start_month,
      end_month,
      note,
      created_by,
      updated_by,
      updated_at
    )
    values (
      ${storeId},
      ${getManagementCategoryFromAccountTitle(accountTitle)},
      ${accountTitle},
      ${name},
      ${normalizeAmount(body.amount)},
      ${startMonth},
      ${endMonth || null},
      ${String(body.note ?? "").trim()},
      ${session.id},
      ${session.id},
      now()
    )
    returning id::text
  `;

  return Response.json({ ok: true, id: String(rows[0]?.id ?? "") });
}

export async function PATCH(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費を変更する権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    id?: string;
    category?: string;
    accountTitle?: string;
    name?: string;
    amount?: number | string;
    taxRate?: string;
    taxMode?: string;
    taxAmount?: number | string;
    vendorName?: string;
    transactionDate?: string;
    transactionTime?: string;
    startMonth?: string;
    endMonth?: string;
    note?: string;
  };
  const id = String(body.id ?? "").trim();
  const rows = await sql`
    select store_id::text as "storeId"
    from analytics_expenses
    where id::text = ${id}
    limit 1
  `;
  const storeId = rows[0]?.storeId ? String(rows[0].storeId) : "";
  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この経費を変更する権限がありません。" }, { status: 403 });
  }

  const accountTitle = normalizeAccountTitle(body.accountTitle);
  const name = String(body.name ?? "").trim() || accountTitle;
  const amount = normalizeAmount(body.amount);
  const taxAmount = normalizeAmount(body.taxAmount);
  const startMonth = String(body.startMonth ?? "").trim();
  const endMonth = String(body.endMonth ?? "").trim();

  if (!name) return Response.json({ error: "経費名を入力してください。" }, { status: 400 });
  if (amount <= 0) return Response.json({ error: "金額を入力してください。" }, { status: 400 });
  if (taxAmount > amount) return Response.json({ error: "消費税は税込金額以下で入力してください。" }, { status: 400 });
  if (!isMonth(startMonth)) return Response.json({ error: "開始月を入力してください。" }, { status: 400 });
  if (endMonth && (!isMonth(endMonth) || endMonth < startMonth)) {
    return Response.json({ error: "終了月は開始月以降で入力してください。" }, { status: 400 });
  }

  await sql`
    update analytics_expenses
    set
      category = ${getManagementCategoryFromAccountTitle(accountTitle)},
      account_title = ${accountTitle},
      name = ${name},
      amount = ${amount},
      tax_rate = ${normalizeTaxRate(body.taxRate)},
      tax_mode = ${normalizeTaxMode(body.taxMode)},
      tax_amount = ${taxAmount},
      vendor_name = ${String(body.vendorName ?? "").trim()},
      transaction_date = ${normalizeDate(body.transactionDate) || null},
      transaction_time = ${normalizeTime(body.transactionTime) || null},
      start_month = ${startMonth},
      end_month = ${endMonth || null},
      note = ${String(body.note ?? "").trim()},
      updated_by = ${session.id},
      updated_at = now()
    where id::text = ${id}
  `;

  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!expenseEditRoles.has(session.role)) return Response.json({ error: "経費を変更する権限がありません。" }, { status: 403 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const rows = await sql`
    select store_id::text as "storeId"
    from analytics_expenses
    where id::text = ${id}
    limit 1
  `;
  const storeId = rows[0]?.storeId ? String(rows[0].storeId) : "";
  if (!storeId || !await canAccessStore(session, storeId)) {
    return Response.json({ error: "この経費を削除する権限がありません。" }, { status: 403 });
  }

  await sql`delete from analytics_expenses where id::text = ${id}`;
  return Response.json({ ok: true });
}

const accountTitles = new Set([
  "租税公課",
  "荷造運賃",
  "水道光熱費",
  "旅費交通費",
  "通信費",
  "広告宣伝費",
  "接待交際費",
  "損害保険料",
  "修繕費",
  "消耗品費",
  "減価償却費",
  "福利厚生費",
  "給料賃金",
  "外注工賃",
  "利子割引料",
  "地代家賃",
  "貸倒金",
  "支払手数料",
  "車両費",
  "リース料",
  "新聞図書費",
  "研修採用費",
  "会議費",
  "諸会費",
  "衛生管理費",
  "雑費"
]);

const fixedAccountTitles = new Set(["地代家賃", "リース料", "損害保険料", "減価償却費", "利子割引料"]);
const variableAccountTitles = new Set(["水道光熱費", "通信費", "旅費交通費", "車両費", "荷造運賃", "支払手数料"]);
