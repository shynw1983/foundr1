import { OnlineOrderReceipt } from "../../../../../components/receipts/OnlineOrderReceipt";
import { ReceiptRecipientControls } from "../../../../../components/receipts/ReceiptRecipientControls";
import { ReceiptPreviewActions } from "../../../../../components/receipts/ReceiptPreviewActions";
import { getDemoOnlineReceiptViewModel, getOnlineReceiptViewModel } from "../../../../../lib/receipt-data";
import type { OnlineReceiptViewModel } from "../../../../../lib/receipt-data";
import type { ReceiptRecipientMode } from "../../../../../components/receipts/ReceiptRecipientControls";

export const dynamic = "force-dynamic";

type ReceiptPreviewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getReceiptFileName(receipt: OnlineReceiptViewModel) {
  return `receipt-${receipt.brand}-${receipt.pickupCode}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function getReceiptPdfUrl(params: {
  fileName: string;
  orderId: string;
  pickupCode: string;
  demo: string;
  recipientMode: ReceiptRecipientMode;
  recipientName: string;
}) {
  const search = new URLSearchParams();
  if (params.demo) {
    search.set("demo", params.demo);
  } else {
    search.set("orderId", params.orderId);
    search.set("pickupCode", params.pickupCode);
  }
  search.set("recipientMode", params.recipientMode);
  if (params.recipientName) search.set("recipientName", params.recipientName);
  return `/api/public/orders/receipt/pdf/${encodeURIComponent(`${params.fileName}.pdf`)}?${search.toString()}`;
}

function getRecipientMode(value: string): ReceiptRecipientMode {
  return value === "registered" || value === "custom" ? value : "blank";
}

function getRegisteredRecipientName(receipt: OnlineReceiptViewModel) {
  const name = receipt.recipientName.trim();
  return name && name !== "お客様" ? name : "";
}

function applyRecipientChoice(receipt: OnlineReceiptViewModel, mode: ReceiptRecipientMode, customName: string) {
  const registeredName = getRegisteredRecipientName(receipt);
  const recipientName = mode === "custom"
    ? customName.trim()
    : mode === "registered" ? registeredName : "";
  return {
    ...receipt,
    recipientName
  };
}

export default async function ReceiptPreviewPage({ searchParams }: ReceiptPreviewPageProps) {
  const params = await searchParams;
  const orderId = getParam(params, "orderId").trim();
  const pickupCode = getParam(params, "pickupCode").trim();
  const demo = getParam(params, "demo").trim().toLowerCase();
  const recipientMode = getRecipientMode(getParam(params, "recipientMode").trim());
  const recipientName = getParam(params, "recipientName").trim().slice(0, 80);
  const receipt = demo === "nanacha" || demo === "maamaa"
    ? getDemoOnlineReceiptViewModel(demo)
    : orderId && pickupCode ? await getOnlineReceiptViewModel({ orderId, pickupCode }) : null;

  if (!receipt) {
    return (
      <main className="online-receipt-preview-shell">
        <section className="online-receipt-empty">
          <h1>領収書を表示できません</h1>
          <p>注文番号、受取番号、または決済状態を確認してください。</p>
          <p className="online-receipt-empty-example">
            例: /public/orders/receipt/preview?orderId=実際の注文ID&amp;pickupCode=N-1234
          </p>
        </section>
      </main>
    );
  }

  const registeredName = getRegisteredRecipientName(receipt);
  const displayReceipt = applyRecipientChoice(receipt, recipientMode, recipientName);
  const receiptFileName = getReceiptFileName(receipt);

  return (
    <main className="online-receipt-preview-shell">
      <ReceiptPreviewActions fileName={receiptFileName} pdfUrl={getReceiptPdfUrl({ fileName: receiptFileName, orderId, pickupCode, demo, recipientMode, recipientName })} />
      <ReceiptRecipientControls
        orderId={orderId}
        pickupCode={pickupCode}
        demo={demo}
        mode={recipientMode}
        customName={recipientName}
        registeredName={registeredName}
      />
      <OnlineOrderReceipt receipt={displayReceipt} />
    </main>
  );
}
