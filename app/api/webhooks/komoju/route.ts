import { handleKomojuWebhook } from "../../../../lib/komoju-webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleKomojuWebhook(request);
}
