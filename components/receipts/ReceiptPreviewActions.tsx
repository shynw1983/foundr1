"use client";

import { useEffect, useState } from "react";

type ReceiptPreviewActionsProps = {
  fileName: string;
  pdfUrl: string;
};

export function ReceiptPreviewActions({ fileName, pdfUrl }: ReceiptPreviewActionsProps) {
  const [canShareFile, setCanShareFile] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const pdfFileName = `${fileName}.pdf`;
  const showPrimaryFileAction = canShareFile || isAndroid;

  useEffect(() => {
    document.title = fileName;
  }, [fileName]);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsAndroid(/Android/i.test(navigator.userAgent));
    if (typeof File === "undefined") return;
    const testFile = new File([""], "receipt.pdf", { type: "application/pdf" });
    setCanShareFile(Boolean(navigator.canShare?.({ files: [testFile] })));
  }, []);

  const openPdf = () => {
    document.title = fileName;
  };

  const downloadPdfBlob = (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = pdfFileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const handlePrimaryFileAction = async () => {
    document.title = fileName;
    if (isSharing) return;
    setIsSharing(true);
    try {
      const response = await fetch(pdfUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Receipt PDF could not be generated.");
      const blob = await response.blob();
      if (isAndroid) {
        downloadPdfBlob(blob);
        return;
      }

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
    <div className={`online-receipt-actions${showPrimaryFileAction ? " has-file-share" : ""}`} aria-label="領収書操作">
      {showPrimaryFileAction ? (
        <button className="online-receipt-share-button" type="button" onClick={handlePrimaryFileAction} disabled={isSharing}>
          <span className="online-receipt-action-icon" aria-hidden="true">{isAndroid ? "DL" : "SH"}</span>
          <span className="online-receipt-action-text">
            <strong>{isSharing ? "準備中" : isAndroid ? "PDFを保存" : "PDFを保存/共有"}</strong>
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
