import { OnlineOrderReceipt } from "../../../../../components/receipts/OnlineOrderReceipt";
import { getDemoOnlineReceiptViewModel, getOnlineReceiptViewModel } from "../../../../../lib/receipt-data";

export const dynamic = "force-dynamic";

type ReceiptPreviewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function ReceiptPreviewPage({ searchParams }: ReceiptPreviewPageProps) {
  const params = await searchParams;
  const orderId = getParam(params, "orderId").trim();
  const pickupCode = getParam(params, "pickupCode").trim();
  const demo = getParam(params, "demo").trim().toLowerCase();
  const receipt = demo === "nanacha" || demo === "maamaa"
    ? getDemoOnlineReceiptViewModel(demo)
    : orderId && pickupCode ? await getOnlineReceiptViewModel({ orderId, pickupCode }) : null;

  if (!receipt) {
    return (
      <main className="online-receipt-preview-shell">
        <section className="online-receipt-empty">
          <h1>領収書を表示できません</h1>
          <p>注文番号、取餐番号、または決済状態を確認してください。</p>
          <p className="online-receipt-empty-example">
            例: /public/orders/receipt/preview?orderId=実際の注文ID&amp;pickupCode=N-1234
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="online-receipt-preview-shell">
      <OnlineOrderReceipt receipt={receipt} />
    </main>
  );
}
