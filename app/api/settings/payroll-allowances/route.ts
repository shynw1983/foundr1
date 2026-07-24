import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";

const payrollSettingsRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);
const ruleTypes = new Set(["fixed_monthly", "one_person_busy_hourly", "time_performance_multiplier", "performance_tier_per_shift"]);

function normalizeDate(value: unknown, fallback: string | null) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function normalizeTime(value: unknown, fallback: string) {
  const text = String(value ?? "");
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeWeekdays(value: unknown) {
  if (!Array.isArray(value)) return [0, 1, 2, 3, 4, 5, 6];
  const weekdays = Array.from(new Set(value.map((item) => Math.round(Number(item))).filter((item) => item >= 0 && item <= 6)));
  return weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6];
}

async function getVisibleStores(session: Awaited<ReturnType<typeof requireOsSession>>) {
  if (!session) return [];
  const scope = await getSessionStoreScope(session);
  if (scope.allStores) {
    return sql`
      select id::text, name
      from stores
      where status = 'active'
      order by name
    `;
  }
  if (!scope.storeIds.length) return [];
  return sql`
    select id::text, name
    from stores
    where status = 'active'
      and id::text = any(${scope.storeIds})
    order by name
  `;
}

export async function GET() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!payrollSettingsRoles.has(session.role)) return Response.json({ error: "給与設定を表示する権限がありません。" }, { status: 403 });

  const stores = await getVisibleStores(session);
  const storeIds = stores.map((store) => String(store.id));
  const employees = storeIds.length ? await sql`
    select distinct employees.id::text, employees.name
    from employees
    join employee_work_stores on employee_work_stores.employee_id = employees.id
    where employee_work_stores.store_id::text = any(${storeIds})
      and employees.status = 'active'
    order by employees.name
  ` : [];
  const rules = storeIds.length ? await sql`
    select
      payroll_allowance_rules.id::text,
      payroll_allowance_rules.name,
      payroll_allowance_rules.rule_type as "ruleType",
      payroll_allowance_rules.store_id::text as "storeId",
      stores.name as "storeName",
      payroll_allowance_rules.employee_id::text as "employeeId",
      employees.name as "employeeName",
      payroll_allowance_rules.amount,
      payroll_allowance_rules.base_multiplier as "baseMultiplier",
      payroll_allowance_rules.trigger_multiplier as "triggerMultiplier",
      payroll_allowance_rules.sales_threshold as "salesThreshold",
      payroll_allowance_rules.order_threshold as "orderThreshold",
      payroll_allowance_rules.source_platform as "sourcePlatform",
      payroll_allowance_rules.tier_config as tiers,
      payroll_allowance_rules.include_in_premium_base as "includeInPremiumBase",
      to_char(payroll_allowance_rules.valid_from, 'YYYY-MM-DD') as "validFrom",
      to_char(payroll_allowance_rules.valid_to, 'YYYY-MM-DD') as "validTo",
      payroll_allowance_rules.is_enabled as "isEnabled",
      coalesce(
        json_agg(
          json_build_object(
            'weekday', payroll_allowance_rule_windows.weekday,
            'startTime', to_char(payroll_allowance_rule_windows.start_time, 'HH24:MI'),
            'endTime', to_char(payroll_allowance_rule_windows.end_time, 'HH24:MI')
          )
          order by payroll_allowance_rule_windows.weekday, payroll_allowance_rule_windows.start_time
        ) filter (where payroll_allowance_rule_windows.id is not null),
        '[]'::json
      ) as windows
    from payroll_allowance_rules
    left join stores on stores.id = payroll_allowance_rules.store_id
    left join employees on employees.id = payroll_allowance_rules.employee_id
    left join payroll_allowance_rule_windows on payroll_allowance_rule_windows.rule_id = payroll_allowance_rules.id
    where payroll_allowance_rules.store_id is null
      or payroll_allowance_rules.store_id::text = any(${storeIds})
    group by payroll_allowance_rules.id, stores.name, employees.name
    order by payroll_allowance_rules.is_enabled desc, payroll_allowance_rules.created_at desc
  ` : [];

  return Response.json({ stores, employees, rules });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!payrollSettingsRoles.has(session.role)) return Response.json({ error: "給与設定を変更する権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    action?: string;
    id?: string;
    name?: string;
    ruleType?: string;
    storeId?: string;
    employeeId?: string;
    amount?: number | string;
    includeInPremiumBase?: boolean;
    validFrom?: string;
    validTo?: string;
    weekdays?: number[];
    startTime?: string;
    endTime?: string;
    baseMultiplier?: number | string;
    triggerMultiplier?: number | string;
    salesThreshold?: number | string;
    orderThreshold?: number | string;
    sourcePlatform?: string;
    tiers?: Array<{ salesThreshold?: number | string; amount?: number | string }>;
  };
  const stores = await getVisibleStores(session);
  const visibleStoreIds = new Set(stores.map((store) => String(store.id)));

  if (body.action === "disable") {
    const id = String(body.id ?? "");
    const updated = await sql`
      update payroll_allowance_rules
      set is_enabled = false,
          updated_at = now()
      where id::text = ${id}
        and (store_id is null or store_id::text = any(${Array.from(visibleStoreIds)}))
      returning id::text
    `;
    if (!updated.length) return Response.json({ error: "対象の手当ルールが見つかりません。" }, { status: 404 });
    await writeAuditLog({
      actorEmployeeId: session.id,
      action: "settings.payroll_allowance.disabled",
      targetType: "payroll_allowance_rule",
      targetId: id,
      metadata: { id },
      request
    });
    return Response.json({ ok: true });
  }

  const ruleType = ruleTypes.has(String(body.ruleType)) ? String(body.ruleType) : "";
  const name = String(body.name ?? "").trim();
  const amount = Math.max(0, Math.round(Number(body.amount ?? 0) || 0));
  const baseMultiplier = Math.max(1, Number(body.baseMultiplier ?? 1) || 1);
  const triggerMultiplier = Math.max(baseMultiplier, Number(body.triggerMultiplier ?? baseMultiplier) || baseMultiplier);
  const salesThreshold = Math.max(0, Math.round(Number(body.salesThreshold ?? 0) || 0));
  const orderThreshold = Math.max(0, Math.round(Number(body.orderThreshold ?? 0) || 0));
  const sourcePlatform = "uber_eats";
  const tiers = (Array.isArray(body.tiers) ? body.tiers : [])
    .map((tier) => ({
      salesThreshold: Math.max(0, Math.round(Number(tier.salesThreshold ?? 0) || 0)),
      amount: Math.max(0, Math.round(Number(tier.amount ?? 0) || 0))
    }))
    .filter((tier) => tier.salesThreshold > 0 && tier.amount > 0)
    .sort((a, b) => a.salesThreshold - b.salesThreshold);
  const storeId = body.storeId && visibleStoreIds.has(String(body.storeId)) ? String(body.storeId) : null;
  const employeeId = body.employeeId ? String(body.employeeId) : null;
  const validFrom = normalizeDate(body.validFrom, new Date().toISOString().slice(0, 10)) as string;
  const validTo = normalizeDate(body.validTo, null);
  const hasValidAmount = ruleType === "time_performance_multiplier"
    ? baseMultiplier > 1 && triggerMultiplier >= baseMultiplier && (salesThreshold > 0 || orderThreshold > 0)
    : ruleType === "performance_tier_per_shift"
      ? tiers.length > 0
      : amount > 0;
  if (!ruleType || !name || !hasValidAmount) {
    return Response.json({ error: "ルール名と、選択した種類に必要な加算率・条件・金額を入力してください。" }, { status: 400 });
  }
  if (validTo && validTo < validFrom) {
    return Response.json({ error: "有効終了日は有効開始日以降にしてください。" }, { status: 400 });
  }

  const [rule] = await sql`
    insert into payroll_allowance_rules (
      name,
      rule_type,
      store_id,
      employee_id,
      amount,
      base_multiplier,
      trigger_multiplier,
      sales_threshold,
      order_threshold,
      source_platform,
      tier_config,
      include_in_premium_base,
      valid_from,
      valid_to,
      created_by
    )
    values (
      ${name},
      ${ruleType},
      ${storeId},
      ${employeeId},
      ${amount},
      ${ruleType === "time_performance_multiplier" ? baseMultiplier : null},
      ${ruleType === "time_performance_multiplier" ? triggerMultiplier : null},
      ${ruleType === "time_performance_multiplier" ? salesThreshold || null : null},
      ${ruleType === "time_performance_multiplier" ? orderThreshold || null : null},
      ${sourcePlatform},
      ${JSON.stringify(ruleType === "performance_tier_per_shift" ? tiers : [])}::jsonb,
      ${body.includeInPremiumBase !== false},
      ${validFrom}::date,
      ${validTo}::date,
      ${session.id}
    )
    returning id::text
  `;

  if (ruleType !== "fixed_monthly") {
    const weekdays = normalizeWeekdays(body.weekdays);
    const startTime = normalizeTime(body.startTime, "18:00");
    const endTime = normalizeTime(body.endTime, "21:00");
    for (const weekday of weekdays) {
      await sql`
        insert into payroll_allowance_rule_windows (rule_id, weekday, start_time, end_time)
        values (${String(rule.id)}, ${weekday}, ${startTime}::time, ${endTime}::time)
      `;
    }
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "settings.payroll_allowance.created",
    targetType: "payroll_allowance_rule",
    targetId: String(rule.id),
    metadata: { name, ruleType, storeId, employeeId, amount, baseMultiplier, triggerMultiplier, salesThreshold, orderThreshold, tiers, validFrom, validTo },
    request
  });
  return Response.json({ ok: true, id: String(rule.id) });
}
