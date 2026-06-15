import { consumeApprovedTerminalLogin, getTerminalLoginRequest } from "../../../../../lib/store-terminal-login";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get("token") ?? "").trim();
  if (!token) {
    return Response.json({ error: "QRコードを更新してください。" }, { status: 400 });
  }

  const loginRequest = await getTerminalLoginRequest(token);
  if (!loginRequest) {
    return Response.json({ error: "QRコードを更新してください。" }, { status: 404 });
  }

  if (loginRequest.status === "approved") {
    const consumed = await consumeApprovedTerminalLogin(token, request);
    if (consumed) {
      const response = Response.json({ ok: true, status: "authenticated", employee: consumed.employee });
      response.headers.append("Set-Cookie", consumed.cookie);
      return response;
    }
  }

  return Response.json({
    ok: true,
    status: loginRequest.status,
    expiresAt: loginRequest.expiresAt
  });
}
