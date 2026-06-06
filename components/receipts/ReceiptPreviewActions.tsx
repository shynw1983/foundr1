"use client";

export function ReceiptPreviewActions() {
  return (
    <div className="online-receipt-actions" aria-label="領収書操作">
      <button type="button" onClick={() => window.print()}>
        PDF保存
      </button>
    </div>
  );
}
