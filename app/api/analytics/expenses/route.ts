import { canAccessStore, getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { sql } from "../../../../lib/db";

const expenseEditRoles = new Set(["owner", "manager", "buyer"]);
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

function normalizeAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
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
      name,
      amount::float,
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
      name: String(expense.name),
      amount: Number(expense.amount ?? 0),
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
      ${normalizeCategory(body.category)},
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
