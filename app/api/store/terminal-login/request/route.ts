import QRCode from "qrcode";
import { createTerminalLoginRequest } from "../../../../../lib/store-terminal-login";

export async function POST(request: Request) {
  const loginRequest = await createTerminalLoginRequest(request);
  const url = new URL(`/os/store-terminal-login?token=${encodeURIComponent(loginRequest.token)}`, request.url);
  const approveUrl = url.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(approveUrl, {
    margin: 1,
    width: 280,
    color: {
      dark: "#123c34",
      light: "#ffffff"
    }
  });

  return Response.json({
    ok: true,
    token: loginRequest.token,
    approveUrl,
    qrCodeDataUrl,
    expiresAt: loginRequest.expiresAt
  });
}
