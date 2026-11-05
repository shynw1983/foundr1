import { getSessionStoreScope, requireOsSession } from "../../../../lib/api-auth";
import { writeAuditLog } from "../../../../lib/audit-log";
import { sql } from "../../../../lib/db";
import { getPermissionsForRole } from "../../../../lib/role-permissions";
import { parseScopedStoreSettings } from "../../../../lib/store-settings-policy";
import { normalizeBusinessHours } from "../../../../lib/store-business-hours";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function authorize(write = false) {
  const session = await requireOsSession();
  if (!session) return { error: json({ error: "ログインしてください。" }, 401) };
  const permissions = await getPermissionsForRole(session.role, { fresh: true });
  if (!permissions.has("module.storeSettings") || (write && !permissions.has("stores.manageSettings"))) {
    return { error: json({ error: "権限がありません。" }, 403) };
  }
  return { session, permissions, scope: await getSessionStoreScope(session) };
}

export async function GET() {
  const access = await authorize();
  if (access.error) return access.error;
  const { scope, permissions } = access;
  const stores = await sql`
    select id::text, name, updated_at::text as revision, business_hours as "businessHours",
      coalesce(reservation_note, '') as "reservationNote", coalesce(weather_location_name, '') as "attendanceAddress",
      attendance_location_enabled as "attendanceLocationEnabled", attendance_latitude::float as "attendanceLatitude",
      attendance_longitude::float as "attendanceLongitude", attendance_radius_meters as "attendanceRadiusMeters",
      attendance_accuracy_threshold_meters as "attendanceAccuracyThresholdMeters",
      jsonb_build_object(
        'payrollCycleType', payroll_cycle_type, 'payrollClosingDay', payroll_closing_day,
        'prescribedMonthlyWorkMinutes', prescribed_monthly_work_minutes,
        'socialInsurancePrefecture', social_insurance_prefecture, 'socialInsuranceDeductionTiming', social_insurance_deduction_timing,
        'shiftFirstHalfSubmissionDeadlineDay', shift_first_half_submission_deadline_day,
        'shiftSecondHalfSubmissionDeadlineDay', shift_second_half_submission_deadline_day,
        'shiftSubmissionDeadlineTime', to_char(shift_submission_deadline_time, 'HH24:MI')
      ) as payroll
    from stores where status = 'active' and (${scope.allStores} or id::text = any(${scope.storeIds}))
    order by name
  `;
  return json({ stores: stores.map(store => ({ ...store, businessHours: normalizeBusinessHours(store.businessHours) })), canEdit: permissions.has("stores.manageSettings") });
}

export async function PATCH(request: Request) {
  const access = await authorize(true);
  if (access.error) return access.error;
  let input;
  try { input = parseScopedStoreSettings(await request.json()); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "入力内容を確認してください。" }, 400); }
  const { scope, session } = access;
  if (!scope.allStores && !scope.storeIds.includes(input.storeId)) return json({ error: "権限がありません。" }, 403);
  const headquarters = ["owner", "manager"].includes(session.role);
  // Older operations-only forms must leave every existing payroll value intact.
  const payroll = input.payroll;
  // Match the current assignment again inside the write, and reject stale forms.
  const rows = await sql`
    update stores set business_hours = ${JSON.stringify({ weekly: input.businessHours })}::jsonb,
      reservation_note = ${input.reservationNote}, attendance_location_enabled = ${input.attendanceLocationEnabled},
      attendance_latitude = ${input.attendanceLatitude}, attendance_longitude = ${input.attendanceLongitude},
      attendance_radius_meters = ${input.attendanceRadiusMeters}, attendance_accuracy_threshold_meters = ${input.attendanceAccuracyThresholdMeters},
      weather_location_name = case when ${input.attendanceAddress} = '' then name else ${input.attendanceAddress} end,
      weather_latitude = ${input.attendanceLatitude}, weather_longitude = ${input.attendanceLongitude},
      payroll_cycle_type = case when ${!!payroll} then ${payroll?.payrollCycleType ?? null} else payroll_cycle_type end,
      payroll_closing_day = case when ${!!payroll} then ${payroll?.payrollClosingDay ?? null}::integer else payroll_closing_day end,
      prescribed_monthly_work_minutes = case when ${!!payroll} then ${payroll?.prescribedMonthlyWorkMinutes ?? null}::integer else prescribed_monthly_work_minutes end,
      social_insurance_prefecture = case when ${!!payroll} then ${payroll?.socialInsurancePrefecture ?? null} else social_insurance_prefecture end,
      social_insurance_deduction_timing = case when ${!!payroll} then ${payroll?.socialInsuranceDeductionTiming ?? null} else social_insurance_deduction_timing end,
      shift_first_half_submission_deadline_day = case when ${!!payroll} then ${payroll?.shiftFirstHalfSubmissionDeadlineDay ?? null}::integer else shift_first_half_submission_deadline_day end,
      shift_second_half_submission_deadline_day = case when ${!!payroll} then ${payroll?.shiftSecondHalfSubmissionDeadlineDay ?? null}::integer else shift_second_half_submission_deadline_day end,
      shift_submission_deadline_time = case when ${!!payroll} then ${payroll?.shiftSubmissionDeadlineTime ?? null}::time else shift_submission_deadline_time end,
      updated_at = now()
    where id::text = ${input.storeId} and status = 'active' and updated_at::text = ${input.revision}
      and (${scope.allStores} or id::text = any(${scope.storeIds}))
      and (${headquarters} or exists (
        select 1 from employee_scopes where employee_id = ${session.id} and scope_type = 'store' and store_id = stores.id
      ))
    returning updated_at::text as revision
  `;
  if (!rows[0]) return json({ error: "設定または権限が変更されました。再読み込みして確認してください。" }, 409);
  await writeAuditLog({ actorEmployeeId: session.id, action: "stores.scoped_settings.update", targetType: "store", targetId: input.storeId, metadata: { fields: ["businessHours", "reservationNote", "attendanceLocation", ...(payroll ? ["payroll", "shiftSubmissionDeadlines"] : [])] }, request });
  return json({ ok: true, revision: rows[0].revision });
}
