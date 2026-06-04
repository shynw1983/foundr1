import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getCashBreakdownTotal, normalizeCashBreakdown, type CashBreakdown } from "../../../../../lib/pos-cash-denominations";
import { getStoreCashBusinessDayState } from "../../../../../lib/store-business-hours";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type CashAction = "open" | "movement" | "close" | "delete_movement" | "delete_session" | "clear_date" | "recalculate";

const cashCorrectionRoles = new Set(["owner", "manager"]);

type CashSessionRow = {
  id: string;
  storeId: string;
  storeName: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  openingCashBreakdown: CashBreakdown;
  openingNote: string;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  countedCashBreakdown: CashBreakdown;
  differenceAmount: number | null;
  closingNote: string;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string;
};

type ActiveCashResponsibleEmployee = {
  id: string;
  name: string;
  role: string;
  punchedAt: string;
};

type CashBusinessState = ReturnType<typeof getStoreCashBusinessDayState>;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function toMoney(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(99999999, Math.round(amount)));
}

function getSubmittedCashAmount(breakdown: unknown, fallbackAmount: unknown) {
  const total = getCashBreakdownTotal(breakdown);
  return total > 0 ? total : toMoney(fallbackAmount);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getSelectedStoreId(request: Request, session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return { access: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
}

async function getCashBusinessState(storeId: string): Promise<CashBusinessState> {
  const rows = await sql`
    select business_hours as "businessHours"
    from stores
    where id::text = ${storeId}
    limit 1
  `;
  return getStoreCashBusinessDayState(rows[0]?.businessHours ?? {});
}

async function getSessionFinancials(sessionId: string) {
  const [orderRows, movementRows] = await Promise.all([
    sql`
      select coalesce(sum(amount), 0)::int as "cashSales"
      from store_customer_orders
      where pos_cash_session_id::text = ${sessionId}
        and order_source = 'store_pos'
        and payment_status = 'paid'
        and payment_provider = 'cash'
        and status <> 'cancelled'
    `,
    sql`
      select
        coalesce(sum(amount) filter (where movement_type = 'cash_in'), 0)::int as "cashIn",
        coalesce(sum(amount) filter (where movement_type = 'cash_out'), 0)::int as "cashOut",
        count(*)::int as "movementCount"
      from pos_cash_movements
      where session_id::text = ${sessionId}
    `
  ]);
  const cashSales = Number(orderRows[0]?.cashSales ?? 0);
  const cashIn = Number(movementRows[0]?.cashIn ?? 0);
  const cashOut = Number(movementRows[0]?.cashOut ?? 0);
  const movementCount = Number(movementRows[0]?.movementCount ?? 0);
  return { cashSales, cashIn, cashOut, movementCount };
}

async function enrichSession(row: CashSessionRow) {
  const financials = await getSessionFinancials(row.id);
  const expectedCashAmount = row.status === "closed"
    ? Number(row.expectedCashAmount ?? 0)
    : Number(row.openingAmount ?? 0) + financials.cashSales + financials.cashIn - financials.cashOut;
  const countedCashAmount = row.countedCashAmount === null ? null : Number(row.countedCashAmount);
  const differenceAmount = countedCashAmount === null ? null : countedCashAmount - expectedCashAmount;
  return {
    ...row,
    openingAmount: Number(row.openingAmount ?? 0),
    openingCashBreakdown: normalizeCashBreakdown(row.openingCashBreakdown),
    expectedCashAmount,
    countedCashAmount,
    countedCashBreakdown: normalizeCashBreakdown(row.countedCashBreakdown),
    differenceAmount,
    ...financials
  };
}

async function recalculateSession(sessionId: string) {
  const rows = await sql`
    select
      pos_cash_sessions.id::text,
      pos_cash_sessions.opening_amount as "openingAmount",
      pos_cash_sessions.counted_cash_amount as "countedCashAmount",
      pos_cash_sessions.status
    from pos_cash_sessions
    where id::text = ${sessionId}
    limit 1
  `;
  const row = rows[0] as { id: string; openingAmount: number; countedCashAmount: number | null; status: string } | undefined;
  if (!row) return;
  const financials = await getSessionFinancials(sessionId);
  const expectedCashAmount = Number(row.openingAmount ?? 0) + financials.cashSales + financials.cashIn - financials.cashOut;
  const countedCashAmount = row.countedCashAmount === null ? null : Number(row.countedCashAmount);
  const differenceAmount = countedCashAmount === null ? null : countedCashAmount - expectedCashAmount;
  await sql`
    update pos_cash_sessions
    set
      expected_cash_amount = ${expectedCashAmount},
      difference_amount = ${differenceAmount},
      updated_at = now()
    where id::text = ${sessionId}
  `;
}

async function recalculateDateSessions(storeId: string, businessDate: string) {
  const rows = await sql`
    select id::text
    from pos_cash_sessions
    where store_id::text = ${storeId}
      and business_date = ${businessDate}
  `;
  for (const row of rows as Array<{ id: string }>) {
    await recalculateSession(row.id);
  }
}

async function getOpenSession(storeId: string) {
  const rows = await sql`
    select
      pos_cash_sessions.id::text,
      pos_cash_sessions.store_id::text as "storeId",
      stores.name as "storeName",
      pos_cash_sessions.business_date::text as "businessDate",
      pos_cash_sessions.register_name as "registerName",
      pos_cash_sessions.status,
      pos_cash_sessions.opening_amount as "openingAmount",
      pos_cash_sessions.opening_cash_breakdown as "openingCashBreakdown",
      pos_cash_sessions.opening_note as "openingNote",
      pos_cash_sessions.expected_cash_amount as "expectedCashAmount",
      pos_cash_sessions.counted_cash_amount as "countedCashAmount",
      pos_cash_sessions.counted_cash_breakdown as "countedCashBreakdown",
      pos_cash_sessions.difference_amount as "differenceAmount",
      pos_cash_sessions.closing_note as "closingNote",
      coalesce(opened_by.name, '') as "openedByName",
      coalesce(closed_by.name, '') as "closedByName",
      coalesce(pos_cash_sessions.opened_at::text, '') as "openedAt",
      coalesce(pos_cash_sessions.closed_at::text, '') as "closedAt"
    from pos_cash_sessions
    join stores on stores.id = pos_cash_sessions.store_id
    left join employees opened_by on opened_by.id = pos_cash_sessions.opened_by
    left join employees closed_by on closed_by.id = pos_cash_sessions.closed_by
    where pos_cash_sessions.store_id::text = ${storeId}
      and pos_cash_sessions.status = 'open'
    order by pos_cash_sessions.opened_at desc
    limit 1
  `;
  const row = rows[0] as CashSessionRow | undefined;
  return row ? enrichSession(row) : null;
}

async function getSessions(storeId: string, businessDate: string) {
  const rows = await sql`
    select
      pos_cash_sessions.id::text,
      pos_cash_sessions.store_id::text as "storeId",
      stores.name as "storeName",
      pos_cash_sessions.business_date::text as "businessDate",
      pos_cash_sessions.register_name as "registerName",
      pos_cash_sessions.status,
      pos_cash_sessions.opening_amount as "openingAmount",
      pos_cash_sessions.opening_cash_breakdown as "openingCashBreakdown",
      pos_cash_sessions.opening_note as "openingNote",
      pos_cash_sessions.expected_cash_amount as "expectedCashAmount",
      pos_cash_sessions.counted_cash_amount as "countedCashAmount",
      pos_cash_sessions.counted_cash_breakdown as "countedCashBreakdown",
      pos_cash_sessions.difference_amount as "differenceAmount",
      pos_cash_sessions.closing_note as "closingNote",
      coalesce(opened_by.name, '') as "openedByName",
      coalesce(closed_by.name, '') as "closedByName",
      coalesce(pos_cash_sessions.opened_at::text, '') as "openedAt",
      coalesce(pos_cash_sessions.closed_at::text, '') as "closedAt"
    from pos_cash_sessions
    join stores on stores.id = pos_cash_sessions.store_id
    left join employees opened_by on opened_by.id = pos_cash_sessions.opened_by
    left join employees closed_by on closed_by.id = pos_cash_sessions.closed_by
    where pos_cash_sessions.store_id::text = ${storeId}
      and pos_cash_sessions.business_date = ${businessDate}
    order by pos_cash_sessions.opened_at desc
  `;
  return Promise.all((rows as CashSessionRow[]).map(enrichSession));
}

async function getMovements(storeId: string, businessDate: string, sessionId?: string) {
  return sql`
    select
      pos_cash_movements.id::text,
      pos_cash_movements.session_id::text as "sessionId",
      pos_cash_movements.movement_type as "movementType",
      pos_cash_movements.amount,
      pos_cash_movements.reason,
      pos_cash_movements.source,
      coalesce(employees.name, '') as "createdByName",
      to_char(pos_cash_movements.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime",
      pos_cash_movements.created_at::text as "createdAt"
    from pos_cash_movements
    join pos_cash_sessions on pos_cash_sessions.id = pos_cash_movements.session_id
    left join employees on employees.id = pos_cash_movements.created_by
    where pos_cash_movements.store_id::text = ${storeId}
      and pos_cash_sessions.business_date = ${businessDate}
      and (${sessionId ?? ""} = '' or pos_cash_movements.session_id::text = ${sessionId ?? ""})
    order by pos_cash_movements.created_at desc
    limit 200
  `;
}

async function getActiveCashResponsibleEmployees(storeId: string) {
  const rows = await sql`
    select
      employees.id::text,
      employees.name,
      employees.role,
      latest_punch.punched_at::text as "punchedAt"
    from (
      select distinct on (timecard_punches.employee_id)
        timecard_punches.employee_id,
        timecard_punches.punch_type,
        timecard_punches.punched_at
      from timecard_punches
      where timecard_punches.store_id::text = ${storeId}
        and timecard_punches.punched_at >= now() - interval '36 hours'
      order by timecard_punches.employee_id, timecard_punches.punched_at desc
    ) latest_punch
    join employees on employees.id = latest_punch.employee_id
    where latest_punch.punch_type in ('clock_in', 'break_end')
      and employees.status = 'active'
    order by latest_punch.punched_at desc, employees.name
  `;
  return rows as ActiveCashResponsibleEmployee[];
}

async function getOrders(storeId: string, businessDate: string) {
  return sql`
    select
      store_customer_orders.id::text,
      store_customer_orders.pickup_code as "pickupCode",
      store_customer_orders.amount,
      store_customer_orders.payment_provider as "paymentMethod",
      coalesce(store_customer_orders.customer_summary ->> 'cashierName', '') as "cashierName",
      to_char(store_customer_orders.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as "createdTime",
      store_customer_orders.created_at::text as "createdAt"
    from store_customer_orders
    left join pos_cash_sessions on pos_cash_sessions.id = store_customer_orders.pos_cash_session_id
    where store_customer_orders.store_id::text = ${storeId}
      and store_customer_orders.order_source = 'store_pos'
      and store_customer_orders.status <> 'cancelled'
      and coalesce(pos_cash_sessions.business_date, (store_customer_orders.created_at at time zone 'Asia/Tokyo')::date) = ${businessDate}
    order by store_customer_orders.created_at desc
    limit 200
  `;
}

async function getPaymentTotals(storeId: string, businessDate: string) {
  return sql`
    select
      store_customer_orders.payment_provider as "paymentMethod",
      count(*)::int as count,
      coalesce(sum(store_customer_orders.amount), 0)::int as amount
    from store_customer_orders
    left join pos_cash_sessions on pos_cash_sessions.id = store_customer_orders.pos_cash_session_id
    where store_customer_orders.store_id::text = ${storeId}
      and store_customer_orders.order_source = 'store_pos'
      and store_customer_orders.status <> 'cancelled'
      and coalesce(pos_cash_sessions.business_date, (store_customer_orders.created_at at time zone 'Asia/Tokyo')::date) = ${businessDate}
    group by store_customer_orders.payment_provider
    order by store_customer_orders.payment_provider
  `;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const businessState = await getCashBusinessState(selectedStoreId);
  const businessDate = normalizeText(new URL(request.url).searchParams.get("date")) || businessState.businessDate;

  const [activeSession, sessions] = await Promise.all([
    getOpenSession(selectedStoreId),
    getSessions(selectedStoreId, businessDate)
  ]);
  const [movements, orders, paymentTotals, activeCashResponsibleEmployees] = await Promise.all([
    getMovements(selectedStoreId, businessDate),
    getOrders(selectedStoreId, businessDate),
    getPaymentTotals(selectedStoreId, businessDate),
    getActiveCashResponsibleEmployees(selectedStoreId)
  ]);
  const totals = sessions.reduce((sum, item) => ({
    openingAmount: sum.openingAmount + item.openingAmount,
    expectedCashAmount: sum.expectedCashAmount + item.expectedCashAmount,
    countedCashAmount: sum.countedCashAmount + Number(item.countedCashAmount ?? 0),
    differenceAmount: sum.differenceAmount + Number(item.differenceAmount ?? 0),
    cashSales: sum.cashSales + item.cashSales,
    cashIn: sum.cashIn + item.cashIn,
    cashOut: sum.cashOut + item.cashOut
  }), { openingAmount: 0, expectedCashAmount: 0, countedCashAmount: 0, differenceAmount: 0, cashSales: 0, cashIn: 0, cashOut: 0 });

  return Response.json({
    access: { ...access, canManageCashReconciliation: cashCorrectionRoles.has(session.role) },
    selectedStoreId,
    businessDate,
    businessState,
    activeSession,
    sessions,
    movements,
    orders,
    paymentTotals,
    activeCashResponsibleEmployees,
    totals
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    action?: CashAction;
    storeId?: string;
    openingAmount?: number;
    openingBreakdown?: CashBreakdown;
    countedCashAmount?: number;
    countedBreakdown?: CashBreakdown;
    amount?: number;
    movementType?: string;
    note?: string;
    reason?: string;
    registerName?: string;
    movementId?: string;
    sessionId?: string;
    businessDate?: string;
    closingResponsibleEmployeeId?: string;
  };
  const storeId = normalizeText(body.storeId);
  const action = normalizeText(body.action) as CashAction;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  const canManageCashReconciliation = cashCorrectionRoles.has(session.role);
  const businessState = await getCashBusinessState(storeFilter);

  if (action === "open") {
    const existing = await getOpenSession(storeFilter);
    if (existing) return Response.json({ error: "すでに開いているレジ締めがあります。" }, { status: 400 });
    const openingBreakdown = normalizeCashBreakdown(body.openingBreakdown);
    const openingAmount = getSubmittedCashAmount(openingBreakdown, body.openingAmount);
    const note = normalizeText(body.note);
    const registerName = normalizeText(body.registerName) || "POS";
    await sql`
      insert into pos_cash_sessions (
        store_id,
        business_date,
        register_name,
        opening_amount,
        opening_cash_breakdown,
        opening_note,
        expected_cash_amount,
        source,
        opened_by
      )
      values (
        ${storeFilter},
        ${businessState.businessDate},
        ${registerName},
        ${openingAmount},
        ${JSON.stringify(openingBreakdown)},
        ${note},
        ${openingAmount},
        'manual',
        ${session.id}
      )
    `;
  } else if (action === "movement") {
    const activeSession = await getOpenSession(storeFilter);
    if (!activeSession) return Response.json({ error: "先に日次レジ締めを開始してください。" }, { status: 400 });
    const movementType = normalizeText(body.movementType);
    if (!["cash_in", "cash_out"].includes(movementType)) {
      return Response.json({ error: "入金または出金を選択してください。" }, { status: 400 });
    }
    const amount = toMoney(body.amount);
    if (amount <= 0) return Response.json({ error: "金額を入力してください。" }, { status: 400 });
    const reason = normalizeText(body.reason || body.note);
    if (!reason) return Response.json({ error: "理由を入力してください。" }, { status: 400 });
    await sql`
      insert into pos_cash_movements (
        session_id,
        store_id,
        movement_type,
        amount,
        reason,
        source,
        created_by
      )
      values (
        ${activeSession.id},
        ${storeFilter},
        ${movementType},
        ${amount},
        ${reason},
        'manual',
        ${session.id}
      )
    `;
  } else if (action === "close") {
    const activeSession = await getOpenSession(storeFilter);
    if (!activeSession) return Response.json({ error: "開いているレジ締めがありません。" }, { status: 400 });
    const countedBreakdown = normalizeCashBreakdown(body.countedBreakdown);
    const countedCashAmount = getSubmittedCashAmount(countedBreakdown, body.countedCashAmount);
    const latestSession = await enrichSession(activeSession);
    const expectedCashAmount = latestSession.expectedCashAmount;
    const differenceAmount = countedCashAmount - expectedCashAmount;
    const note = normalizeText(body.note);
    if (differenceAmount !== 0 && !note) {
      return Response.json({ error: "差額があるため理由を入力してください。" }, { status: 400 });
    }
    const closingResponsibleEmployeeId = normalizeText(body.closingResponsibleEmployeeId);
    if (!closingResponsibleEmployeeId || !isUuid(closingResponsibleEmployeeId)) {
      return Response.json({ error: "締め責任者を選択してください。" }, { status: 400 });
    }
    const activeEmployees = await getActiveCashResponsibleEmployees(storeFilter);
    if (!activeEmployees.some((employee) => employee.id === closingResponsibleEmployeeId)) {
      return Response.json({ error: "出勤中の従業員から締め責任者を選択してください。" }, { status: 400 });
    }
    await sql`
      update pos_cash_sessions
      set
        status = 'closed',
        expected_cash_amount = ${expectedCashAmount},
        counted_cash_amount = ${countedCashAmount},
        counted_cash_breakdown = ${JSON.stringify(countedBreakdown)},
        difference_amount = ${differenceAmount},
        closing_note = ${note},
        closed_by = ${closingResponsibleEmployeeId},
        closed_at = now(),
        updated_at = now()
      where id::text = ${activeSession.id}
        and status = 'open'
    `;
  } else if (action === "delete_movement") {
    if (!canManageCashReconciliation) return Response.json({ error: "レジ締めを修正する権限がありません。" }, { status: 403 });
    const movementId = normalizeText(body.movementId);
    if (!movementId) return Response.json({ error: "入出金記録を選択してください。" }, { status: 400 });
    const rows = await sql`
      delete from pos_cash_movements
      where id::text = ${movementId}
        and store_id::text = ${storeFilter}
      returning session_id::text as "sessionId"
    `;
    const deleted = rows[0] as { sessionId: string } | undefined;
    if (!deleted) return Response.json({ error: "入出金記録が見つかりません。" }, { status: 404 });
    await recalculateSession(deleted.sessionId);
  } else if (action === "delete_session") {
    if (!canManageCashReconciliation) return Response.json({ error: "レジ締めを修正する権限がありません。" }, { status: 403 });
    const targetSessionId = normalizeText(body.sessionId);
    if (!targetSessionId) return Response.json({ error: "レジ締め記録を選択してください。" }, { status: 400 });
    const rows = await sql`
      delete from pos_cash_sessions
      where id::text = ${targetSessionId}
        and store_id::text = ${storeFilter}
      returning id::text
    `;
    if (!rows[0]) return Response.json({ error: "レジ締め記録が見つかりません。" }, { status: 404 });
  } else if (action === "clear_date") {
    if (!canManageCashReconciliation) return Response.json({ error: "レジ締めを修正する権限がありません。" }, { status: 403 });
    const targetDate = normalizeText(body.businessDate) || businessState.businessDate;
    await sql`
      delete from pos_cash_sessions
      where store_id::text = ${storeFilter}
        and business_date = ${targetDate}
    `;
  } else if (action === "recalculate") {
    if (!canManageCashReconciliation) return Response.json({ error: "レジ締めを修正する権限がありません。" }, { status: 403 });
    const targetDate = normalizeText(body.businessDate) || businessState.businessDate;
    await recalculateDateSessions(storeFilter, targetDate);
  } else {
    return Response.json({ error: "操作を選択してください。" }, { status: 400 });
  }

  const businessDate = normalizeText(body.businessDate) || businessState.businessDate;
  const [activeSession, sessions] = await Promise.all([
    getOpenSession(storeFilter),
    getSessions(storeFilter, businessDate)
  ]);
  const [movements, orders, paymentTotals, activeCashResponsibleEmployees] = await Promise.all([
    getMovements(storeFilter, businessDate),
    getOrders(storeFilter, businessDate),
    getPaymentTotals(storeFilter, businessDate),
    getActiveCashResponsibleEmployees(storeFilter)
  ]);
  return Response.json({ ok: true, selectedStoreId: storeFilter, businessDate, businessState, activeSession, sessions, movements, orders, paymentTotals, activeCashResponsibleEmployees });
}
