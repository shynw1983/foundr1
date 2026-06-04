import { requireOsSession } from "../../../../lib/api-auth";
import { createOsNotification } from "../../../../lib/web-push";

export async function POST() {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "権限がありません。" }, { status: 403 });

  await createOsNotification({
    employeeId: session.id,
    type: "web_push_test",
    title: "Foundr1 テスト通知",
    message: "この端末でプッシュ通知を受信できます。",
    href: "/store/timecard"
  });

  return Response.json({ ok: true });
}
