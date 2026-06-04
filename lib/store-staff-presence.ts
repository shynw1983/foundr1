import { sql } from "./db";
import { getTokyoDateTimeParts, isPickupWithinBusinessHours } from "./store-business-hours";

export type StoreOperationForPublicMenu = {
  reservationsEnabled: boolean;
  statusNote: string;
  businessHours: unknown;
  reservationNote: string;
  minimumPickupMinutes?: number | null;
};

type StaffPresenceRow = {
  active_count: number | string | null;
  recent_count: number | string | null;
};

const staffNotClockedInStatusNote = "一時休止";

function toCount(value: unknown) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

async function getActiveStaffCount(storeId: string) {
  const rows = await sql`
    select
      count(*) filter (where latest_punch.punch_type in ('clock_in', 'break_end'))::int as active_count,
      count(*)::int as recent_count
    from (
      select distinct on (employee_id)
        employee_id,
        punch_type,
        punched_at
      from timecard_punches
      where store_id::text = ${storeId}
        and punched_at >= now() - interval '36 hours'
      order by employee_id, punched_at desc
    ) latest_punch
  ` as StaffPresenceRow[];

  const row = rows[0];
  return {
    activeStaffCount: toCount(row?.active_count),
    recentPunchCount: toCount(row?.recent_count)
  };
}

export async function applyStaffPresenceGateToPublicOperation(
  storeId: string | null | undefined,
  operation: StoreOperationForPublicMenu
): Promise<StoreOperationForPublicMenu> {
  if (!storeId || operation.reservationsEnabled === false) return operation;

  const current = getTokyoDateTimeParts();
  const isWithinBusinessHours = isPickupWithinBusinessHours(operation.businessHours, current.date, current.time);
  if (!isWithinBusinessHours) return operation;

  const presence = await getActiveStaffCount(storeId);
  if (presence.activeStaffCount > 0) return operation;

  return {
    ...operation,
    reservationsEnabled: false,
    statusNote: staffNotClockedInStatusNote
  };
}
