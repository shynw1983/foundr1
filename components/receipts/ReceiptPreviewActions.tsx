"use client";

import { useEffect } from "react";

type ReceiptPreviewActionsProps = {
  fileName: string;
  pdfUrl: string;
};

export function ReceiptPreviewActions({ fileName, pdfUrl }: ReceiptPreviewActionsProps) {
  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  const openPdf = () => {
    document.title = fileName;
  };

  return (
    <div className="online-receipt-actions" aria-label="領収書操作">
      <a href={pdfUrl} target="_blank" rel="noreferrer" onClick={openPdf}>
        <span className="online-receipt-action-icon" aria-hidden="true">PDF</span>
        <span className="online-receipt-action-text">
          <strong>PDFを開く</strong>
          <small>{fileName}</small>
        </span>
      </a>
    </div>
  );
}
