import { cookies } from "next/headers";
import { authCookieName, readSessionToken } from "../../../../lib/auth";
import { sql } from "../../../../lib/db";
import { lookupLarkUserByEmail, sendLarkTextMessage } from "../../../../lib/lark";

type LarkLookupPayload = {
  employeeId?: string;
  email?: string;
};

async function requireOwner() {
  const cookieStore = await cookies();
  const session = readSessionToken(cookieStore.get(authCookieName)?.value);
  return session?.role === "owner" ? session : null;
}

export async function POST(request: Request) {
  const session = await requireOwner();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

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
        "FOUND R1 発注管理の Lark 連携テストです。",
        "このメッセージが届いていれば、発注依頼の通知を Lark で受け取れます。"
      ].join("\n")
    );

    if (employeeId) {
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
