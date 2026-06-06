"use client";

import { useEffect } from "react";

type ReceiptPreviewActionsProps = {
  fileName: string;
};

export function ReceiptPreviewActions({ fileName }: ReceiptPreviewActionsProps) {
  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  const savePdf = () => {
    document.title = fileName;
    window.requestAnimationFrame(() => window.print());
  };

  return (
    <div className="online-receipt-actions" aria-label="領収書操作">
      <button type="button" onClick={savePdf}>
        <span className="online-receipt-action-icon" aria-hidden="true">PDF</span>
        <span className="online-receipt-action-text">
          <strong>PDFを保存</strong>
          <small>{fileName}</small>
        </span>
      </button>
    </div>
  );
}
