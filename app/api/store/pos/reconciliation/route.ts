import { requireOsSession } from "../../../../../lib/api-auth";
import { sql } from "../../../../../lib/db";
import { getScopedStoreFilter, getStoreOrderAccess } from "../../../../../lib/store-order-access";

export const dynamic = "force-dynamic";

type CashAction = "open" | "movement" | "close";

type CashSessionRow = {
  id: string;
  storeId: string;
  storeName: string;
  businessDate: string;
  registerName: string;
  status: string;
  openingAmount: number;
  openingNote: string;
  expectedCashAmount: number;
  countedCashAmount: number | null;
  differenceAmount: number | null;
  closingNote: string;
  openedByName: string;
  closedByName: string;
  openedAt: string;
  closedAt: string;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function toMoney(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(99999999, Math.round(amount)));
}

function getJstDate(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function getSelectedStoreId(request: Request, session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return { access: null, selectedStoreId: "", forbidden: false };
  const access = await getStoreOrderAccess(session);
  const requestedStoreId = new URL(request.url).searchParams.get("storeId");
  const storeFilter = getScopedStoreFilter(access, requestedStoreId);
  if (storeFilter === "__forbidden__") return { access, selectedStoreId: "", forbidden: true };
  return { access, selectedStoreId: storeFilter ?? access.stores[0]?.id ?? "", forbidden: false };
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
    expectedCashAmount,
    countedCashAmount,
    differenceAmount,
    ...financials
  };
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
      pos_cash_sessions.opening_note as "openingNote",
      pos_cash_sessions.expected_cash_amount as "expectedCashAmount",
      pos_cash_sessions.counted_cash_amount as "countedCashAmount",
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
      pos_cash_sessions.opening_note as "openingNote",
      pos_cash_sessions.expected_cash_amount as "expectedCashAmount",
      pos_cash_sessions.counted_cash_amount as "countedCashAmount",
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

async function getRecentMovements(storeId: string, sessionId?: string) {
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
    left join employees on employees.id = pos_cash_movements.created_by
    where pos_cash_movements.store_id::text = ${storeId}
      and (${sessionId ?? ""} = '' or pos_cash_movements.session_id::text = ${sessionId ?? ""})
    order by pos_cash_movements.created_at desc
    limit 12
  `;
}

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { access, selectedStoreId, forbidden } = await getSelectedStoreId(request, session);
  if (forbidden) return Response.json({ error: "権限がありません。" }, { status: 403 });
  const businessDate = normalizeText(new URL(request.url).searchParams.get("date")) || getJstDate();

  const [activeSession, sessions] = await Promise.all([
    getOpenSession(selectedStoreId),
    getSessions(selectedStoreId, businessDate)
  ]);
  const movements = await getRecentMovements(selectedStoreId, activeSession?.id);
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
    access,
    selectedStoreId,
    businessDate,
    activeSession,
    sessions,
    movements,
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
    countedCashAmount?: number;
    amount?: number;
    movementType?: string;
    note?: string;
    reason?: string;
    registerName?: string;
  };
  const storeId = normalizeText(body.storeId);
  const action = normalizeText(body.action) as CashAction;
  const access = await getStoreOrderAccess(session);
  const storeFilter = getScopedStoreFilter(access, storeId);
  if (storeFilter === "__forbidden__" || !storeFilter) {
    return Response.json({ error: "権限がありません。" }, { status: 403 });
  }

  if (action === "open") {
    const existing = await getOpenSession(storeFilter);
    if (existing) return Response.json({ error: "すでに開いているレジ締めがあります。" }, { status: 400 });
    const openingAmount = toMoney(body.openingAmount);
    const note = normalizeText(body.note);
    const registerName = normalizeText(body.registerName) || "POS";
    await sql`
      insert into pos_cash_sessions (
        store_id,
        business_date,
        register_name,
        opening_amount,
        opening_note,
        expected_cash_amount,
        source,
        opened_by
      )
      values (
        ${storeFilter},
        ${getJstDate()},
        ${registerName},
        ${openingAmount},
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
    const countedCashAmount = toMoney(body.countedCashAmount);
    const latestSession = await enrichSession(activeSession);
    const expectedCashAmount = latestSession.expectedCashAmount;
    const differenceAmount = countedCashAmount - expectedCashAmount;
    const note = normalizeText(body.note);
    if (differenceAmount !== 0 && !note) {
      return Response.json({ error: "差額があるため理由を入力してください。" }, { status: 400 });
    }
    await sql`
      update pos_cash_sessions
      set
        status = 'closed',
        expected_cash_amount = ${expectedCashAmount},
        counted_cash_amount = ${countedCashAmount},
        difference_amount = ${differenceAmount},
        closing_note = ${note},
        closed_by = ${session.id},
        closed_at = now(),
        updated_at = now()
      where id::text = ${activeSession.id}
        and status = 'open'
    `;
  } else {
    return Response.json({ error: "操作を選択してください。" }, { status: 400 });
  }

  const businessDate = getJstDate();
  const [activeSession, sessions] = await Promise.all([
    getOpenSession(storeFilter),
    getSessions(storeFilter, businessDate)
  ]);
  const movements = await getRecentMovements(storeFilter, activeSession?.id);
  return Response.json({ ok: true, selectedStoreId: storeFilter, businessDate, activeSession, sessions, movements });
}
