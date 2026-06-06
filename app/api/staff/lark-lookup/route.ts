import { requireStaffAdminSession, canManageTargetRole } from "../../../../lib/staff-admin-access";
import { sql } from "../../../../lib/db";
import { lookupLarkUserByEmail, sendLarkTextMessage } from "../../../../lib/lark";

type LarkLookupPayload = {
  employeeId?: string;
  email?: string;
};

export async function POST(request: Request) {
  const access = await requireStaffAdminSession();
  if (!access) return Response.json({ error: "権限がありません。" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as LarkLookupPayload;
  const employeeId = String(body.employeeId ?? "").trim();
  const email = String(body.email ?? "").trim();

  if (!email) {
    return Response.json({ error: "メールアドレスを入力してください。" }, { status: 400 });
  }

  try {
    const larkUser = await lookupLarkUserByEmail(email);
    const testResult = await sendLarkTextMessage(
      { larkOpenId: larkUser.openId },
      [
        "Foundr1 OS の Lark 連携テストです。",
        "このメッセージが届いていれば、発注依頼の通知を Lark で受け取れます。"
      ].join("\n")
    );

    if (employeeId) {
      const targetRows = await sql`
        select role
        from employees
        where id = ${employeeId}
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
        limit 1
      `;
      const targetRole = String(targetRows[0]?.role ?? "");
      if (!targetRole || !canManageTargetRole(access, targetRole)) {
        return Response.json({ error: "このスタッフを編集する権限がありません。" }, { status: 403 });
      }

      await sql`
        update employees
        set lark_open_id = ${larkUser.openId},
            lark_user_id = ${larkUser.userId || null},
            updated_at = now()
        where id = ${employeeId}
      `;
    }

    return Response.json({
      ok: true,
      openId: larkUser.openId,
      userId: larkUser.userId ?? "",
      email: larkUser.email,
      isActive: larkUser.isActive,
      testDelivered: testResult.delivered,
      testError: testResult.ok ? "" : testResult.error
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Lark ユーザーを確認できませんでした。" },
      { status: 400 }
    );
  }
}
