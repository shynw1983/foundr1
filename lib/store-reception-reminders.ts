import { sql } from "./db";
import { getTokyoDateTimeParts, isPickupWithinBusinessHours } from "./store-business-hours";
import { getStoreReceptionModeLabel, normalizeStoreReceptionMode, type StoreReceptionMode } from "./store-reception-mode";
import { createOsNotification } from "./web-push";

type ReceptionReminderRow = {
  storeId: string;
  storeName: string;
  businessHours: unknown;
  acceptanceMode: StoreReceptionMode;
  changedAt: string | Date;
  changedByName: string;
  lastRemindedAt: string | Date | null;
};

async function getReceptionNotificationRecipients(storeId: string, changedByEmployeeId?: string) {
  const rows = await sql`
    select distinct employees.id::text
    from employees
    left join employee_scopes
      on employee_scopes.employee_id = employees.id
      and employee_scopes.scope_type = 'store'
    where employees.status = 'active'
      and (
        employees.id::text = ${changedByEmployeeId ?? ''}
        or employees.role in ('owner', 'manager')
        or (
          employees.role in ('store_owner', 'store_manager')
          and employee_scopes.store_id::text = ${storeId}
        )
      )
  `;
  return rows.map((row) => String(row.id));
}

async function notifyRecipients(input: {
  storeId: string;
  changedByEmployeeId?: string;
  title: string;
  message: string;
  type: string;
}) {
  const recipients = await getReceptionNotificationRecipients(input.storeId, input.changedByEmployeeId);
  await Promise.all(recipients.map((employeeId) => createOsNotification({
    employeeId,
    type: input.type,
    title: input.title,
    message: input.message,
    href: `/store/orders?storeId=${encodeURIComponent(input.storeId)}#reception-settings`
  })));
  return recipients.length;
}

export async function notifyStoreReceptionModeChange(input: {
  storeId: string;
  mode: StoreReceptionMode;
  changedByEmployeeId: string;
}) {
  const storeRows = await sql`select name from stores where id::text = ${input.storeId} limit 1`;
  const storeName = String(storeRows[0]?.name ?? "店舗");
  const label = getStoreReceptionModeLabel(input.mode);
  const persistenceNote = input.mode === "auto" ? "自動判定を再開しました。" : "この状態は自動では解除されません。";
  return notifyRecipients({
    storeId: input.storeId,
    changedByEmployeeId: input.changedByEmployeeId,
    type: "store_reception_mode_changed",
    title: `Web予約を${label}に変更しました`,
    message: `${storeName}：${label}に切り替わりました。${persistenceNote}`
  });
}

function isReminderDue(row: ReceptionReminderRow, now: Date) {
  const changedAt = new Date(row.changedAt).getTime();
  const lastRemindedAt = row.lastRemindedAt ? new Date(row.lastRemindedAt).getTime() : 0;
  const elapsedMinutes = (now.getTime() - changedAt) / 60_000;
  const sinceReminderMinutes = lastRemindedAt ? (now.getTime() - lastRemindedAt) / 60_000 : Number.POSITIVE_INFINITY;
  const current = getTokyoDateTimeParts(now);
  const isWithinBusinessHours = isPickupWithinBusinessHours(row.businessHours, current.date, current.time);

  if (row.acceptanceMode === "force_open") {
    if (!isWithinBusinessHours) return elapsedMinutes >= 15 && sinceReminderMinutes >= 60;
    return elapsedMinutes >= 120 && sinceReminderMinutes >= 120;
  }
  return isWithinBusinessHours && elapsedMinutes >= 15 && sinceReminderMinutes >= 60;
}

export async function sendStoreReceptionModeReminders(now = new Date()) {
  const rows = await sql`
    select
      stores.id::text as "storeId",
      stores.name as "storeName",
      stores.business_hours as "businessHours",
      store_operations.reservation_acceptance_mode as "acceptanceMode",
      coalesce(store_operations.acceptance_mode_changed_at, store_operations.updated_at) as "changedAt",
      coalesce(employees.name, '') as "changedByName",
      store_operations.acceptance_mode_last_reminded_at as "lastRemindedAt"
    from store_operations
    join stores on stores.id = store_operations.store_id
    left join employees on employees.id = store_operations.acceptance_mode_changed_by
    where stores.status = 'active'
      and store_operations.reservation_acceptance_mode in ('force_open', 'force_closed')
      and (store_operations.temporary_status_until is null or store_operations.temporary_status_until > now())
  ` as ReceptionReminderRow[];

  let notified = 0;
  for (const rawRow of rows) {
    const row = { ...rawRow, acceptanceMode: normalizeStoreReceptionMode(rawRow.acceptanceMode) };
    if (!isReminderDue(row, now)) continue;
    const label = getStoreReceptionModeLabel(row.acceptanceMode);
    const actor = row.changedByName ? `（${row.changedByName}が設定）` : "";
    notified += await notifyRecipients({
      storeId: row.storeId,
      type: "store_reception_mode_reminder",
      title: `Web予約は${label}中です`,
      message: `${row.storeName}は現在も${label}中です${actor}。必要に応じて受付設定を確認してください。`
    });
    await sql`
      update store_operations
      set acceptance_mode_last_reminded_at = now()
      where store_id::text = ${row.storeId}
        and reservation_acceptance_mode = ${row.acceptanceMode}
    `;
  }
  return { checked: rows.length, notified };
}
