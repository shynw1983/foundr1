import { requireOsSession } from "../../../../../lib/api-auth";
import { writeAuditLog } from "../../../../../lib/audit-log";
import { approveTerminalLoginRequest, canApproveTerminalLogin, getTerminalLoginRequest, getTerminalLoginStoreOptions } from "../../../../../lib/store-terminal-login";

export async function GET(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });
  if (!canApproveTerminalLogin(session)) {
    return Response.json({ error: "店舗端末ログインを承認する権限がありません。" }, { status: 403 });
  }

  const url = new URL(request.url);
  const token = String(url.searchParams.get("token") ?? "").trim();
  const loginRequest = token ? await getTerminalLoginRequest(token) : null;
  if (!loginRequest || loginRequest.status !== "pending") {
    return Response.json({ error: "QRコードの有効期限が切れたか、すでに使用されています。" }, { status: 400 });
  }

  return Response.json({
    ok: true,
    request: {
      status: loginRequest.status,
      expiresAt: loginRequest.expiresAt
    },
    stores: await getTerminalLoginStoreOptions(session)
  });
}

export async function POST(request: Request) {
  const session = await requireOsSession();
  if (!session) return Response.json({ error: "ログインしてください。" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    token?: string;
    storeId?: string;
    terminalEmployeeId?: string;
  };

  const result = await approveTerminalLoginRequest({
    token: String(body.token ?? "").trim(),
    approver: session,
    storeId: String(body.storeId ?? "").trim(),
    terminalEmployeeId: String(body.terminalEmployeeId ?? "").trim()
  });

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  await writeAuditLog({
    actorEmployeeId: session.id,
    action: "auth.store_terminal_qr_approved",
    targetType: "store_terminal_login",
    metadata: {
      storeName: result.storeName,
      terminalName: result.terminalName
    },
    request
  });

  return Response.json({ ok: true, storeName: result.storeName, terminalName: result.terminalName });
}
