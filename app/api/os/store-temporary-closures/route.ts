import { NextResponse } from "next/server";
import { canAccessStore, requireOsSession } from "../../../../lib/api-auth";
import { cancelTemporaryClosure, createTemporaryClosure, getAffectedOrdersForTemporaryClosures, getUpcomingTemporaryClosures } from "../../../../lib/store-temporary-closures";

export const dynamic = "force-dynamic";

const temporaryClosureRoles = new Set(["owner", "manager", "store_owner", "store_manager"]);

async function authorizeStore(storeId: string) {
  const session = await requireOsSession();
  if (!session) return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  if (!temporaryClosureRoles.has(session.role)) {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  if (!(await canAccessStore(session, storeId))) {
    return { error: NextResponse.json({ error: "店舗を選択できません。" }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  const storeId = new URL(request.url).searchParams.get("storeId") || "";
  const auth = await authorizeStore(storeId);
  if (auth.error) return auth.error;

  const [temporaryClosures, affectedOrders] = await Promise.all([
    getUpcomingTemporaryClosures(storeId),
    getAffectedOrdersForTemporaryClosures(storeId)
  ]);

  return NextResponse.json({ temporaryClosures, affectedOrders }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    action?: string;
    storeId?: string;
    closureId?: string;
    closureDate?: string;
    closureStartTime?: string;
    closureEndTime?: string;
    closureReason?: string;
    closurePublicMessage?: string;
  };
  const storeId = String(body.storeId ?? "").trim();
  const auth = await authorizeStore(storeId);
  if (auth.error) return auth.error;

  if (body.action === "create_temporary_closure") {
    try {
      await createTemporaryClosure({
        storeId,
        date: body.closureDate ?? "",
        startTime: body.closureStartTime ?? "",
        endTime: body.closureEndTime ?? "",
        reason: body.closureReason,
        publicMessage: body.closurePublicMessage,
        createdBy: auth.session.id
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "臨時休業を保存できませんでした。" }, { status: 400 });
    }
  }

  if (body.action === "cancel_temporary_closure") {
    await cancelTemporaryClosure({ storeId, closureId: String(body.closureId ?? "") });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "操作内容が不正です。" }, { status: 400 });
}
