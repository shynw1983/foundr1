import { handleKomojuWebhook } from "../../../../../lib/komoju-webhooks";
import { getActiveStorePaymentAccountByStoreReference } from "../../../../../lib/store-payment-accounts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await context.params;
  const account = await getActiveStorePaymentAccountByStoreReference({
    storeReference: decodeURIComponent(storeId),
    provider: "komoju",
    allowFallback: true
  });
  if (!account?.webhookSecret) {
    return Response.json({ code: "STORE_PAYMENT_WEBHOOK_NOT_CONFIGURED", error: "KOMOJU webhook is not configured for this store." }, { status: 500 });
  }
  return handleKomojuWebhook(request, account);
}
