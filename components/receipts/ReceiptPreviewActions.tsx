"use client";

import { useEffect, useState } from "react";

type ReceiptPreviewActionsProps = {
  fileName: string;
  pdfUrl: string;
};

export function ReceiptPreviewActions({ fileName, pdfUrl }: ReceiptPreviewActionsProps) {
  const [canShareFile, setCanShareFile] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const pdfFileName = `${fileName}.pdf`;

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof File === "undefined") return;
    const testFile = new File([""], "receipt.pdf", { type: "application/pdf" });
    setCanShareFile(Boolean(navigator.canShare?.({ files: [testFile] })));
  }, []);

  const openPdf = () => {
    document.title = fileName;
  };

  const sharePdfFile = async () => {
    document.title = fileName;
    if (isSharing) return;
    setIsSharing(true);
    try {
      const response = await fetch(pdfUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Receipt PDF could not be generated.");
      const blob = await response.blob();
      const file = new File([blob], pdfFileName, { type: "application/pdf" });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName
        });
        return;
      }

      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("Failed to share receipt PDF", error);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className={`online-receipt-actions${canShareFile ? " has-file-share" : ""}`} aria-label="領収書操作">
      {canShareFile ? (
        <button className="online-receipt-share-button" type="button" onClick={sharePdfFile} disabled={isSharing}>
          <span className="online-receipt-action-icon" aria-hidden="true">SH</span>
          <span className="online-receipt-action-text">
            <strong>{isSharing ? "準備中" : "PDFを保存/共有"}</strong>
            <small>{pdfFileName}</small>
          </span>
        </button>
      ) : null}
      <a className="online-receipt-open-button" href={pdfUrl} target="_blank" rel="noreferrer" onClick={openPdf}>
        <span className="online-receipt-action-icon" aria-hidden="true">PDF</span>
        <span className="online-receipt-action-text">
          <strong>PDFを開く</strong>
          <small>{fileName}</small>
        </span>
      </a>
    </div>
  );
}
