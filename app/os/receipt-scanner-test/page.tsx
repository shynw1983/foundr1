"use client";

import { Camera, Download, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { AnalyticsShell } from "../analytics/components/AnalyticsShell";

export default function ReceiptScannerTestPage() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [scannedUrl, setScannedUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [useAiBoundary, setUseAiBoundary] = useState(true);
  const [scanMode, setScanMode] = useState("auto");
  const [useStrongContrast, setUseStrongContrast] = useState(true);
  const originalUrlRef = useRef("");
  const scannedUrlRef = useRef("");

  useEffect(() => {
    return () => {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      if (scannedUrlRef.current) URL.revokeObjectURL(scannedUrlRef.current);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("receipt");
    if (!(file instanceof File) || file.size === 0) {
      setMessage("レシート写真を選択してください。");
      return;
    }

    setIsProcessing(true);
    setMessage("");
    replaceObjectUrl(originalUrlRef, setOriginalUrl, URL.createObjectURL(file));
    replaceObjectUrl(scannedUrlRef, setScannedUrl, "");

    try {
      const uploadData = new FormData();
      uploadData.set("receipt", file);
      uploadData.set("boundaryMode", useAiBoundary ? "ai" : "auto");
      uploadData.set("scanMode", scanMode);
      uploadData.set("contrastMode", useStrongContrast ? "strong" : "standard");
      const response = await fetch("/api/receipt-scanner", {
        method: "POST",
        body: uploadData
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "スキャン補正に失敗しました。");
      }
      const imageBlob = await response.blob();
      replaceObjectUrl(scannedUrlRef, setScannedUrl, URL.createObjectURL(imageBlob));
      const boundarySource = response.headers.get("X-Receipt-Scanner-Boundary");
      const resolvedMode = response.headers.get("X-Receipt-Scanner-Mode");
      const aiStatus = response.headers.get("X-Receipt-Scanner-AI");
      const outputSize = response.headers.get("X-Receipt-Scanner-Size");
      const modeLabel = resolvedMode === "long_receipt" ? "長レシート補正" : "標準補正";
      const aiLabel = aiStatus === "used" ? "AI使用" : aiStatus === "failed" ? "AI検出失敗・ローカル補正" : "AIなし";
      const sourceLabel = boundarySource === "ai" ? "AI紙面検出" : "ローカル紙面検出";
      setMessage(`${sourceLabel} / ${modeLabel} / ${aiLabel}${outputSize ? ` / ${outputSize}` : ""}で完了しました。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "スキャン補正に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <AnalyticsShell
      eyebrow="Receipt Scan Test"
      title="レシートスキャン補正テスト"
      sourceLabel="写真補正 / 透視補正 / 白黒化"
      workspaceClassName="analytics-workspace"
    >
      <section className="panel analytics-overview-panel">
        <div className="panel-title">
          <Camera size={20} aria-hidden="true" />
          <div>
            <h3>レシート写真をスキャン風に補正</h3>
            <p>背景を除き、紙面をまっすぐに補正してから白黒の確認用画像を生成します。</p>
          </div>
        </div>

        <form className="expense-form receipt-scanner-form" onSubmit={handleSubmit}>
          <label>
            <span>レシート写真</span>
            <input type="file" name="receipt" accept="image/*" />
          </label>
          <label className="receipt-scanner-mode-select">
            <span>補正モード</span>
            <select value={scanMode} onChange={(event) => setScanMode(event.currentTarget.value)}>
              <option value="auto">自動</option>
              <option value="standard">標準スキャン</option>
              <option value="long_receipt">長レシート補正</option>
            </select>
          </label>
          <label className="receipt-scanner-ai-toggle">
            <span>AI紙面検出</span>
            <input
              type="checkbox"
              checked={useAiBoundary}
              onChange={(event) => setUseAiBoundary(event.currentTarget.checked)}
            />
          </label>
          <label className="receipt-scanner-ai-toggle">
            <span>コントラスト強</span>
            <input
              type="checkbox"
              checked={useStrongContrast}
              onChange={(event) => setUseStrongContrast(event.currentTarget.checked)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={isProcessing}>
            <RefreshCw size={18} aria-hidden="true" />
            {isProcessing ? "補正中" : "スキャン補正する"}
          </button>
        </form>

        {message ? <p className="form-message">{message}</p> : null}
      </section>

      <section className="receipt-scanner-preview-grid" aria-label="スキャン補正プレビュー">
        <ReceiptPreview title="元の写真" imageUrl={originalUrl} emptyText="写真を選択すると元画像が表示されます。" />
        <ReceiptPreview
          title="補正後"
          imageUrl={scannedUrl}
          emptyText="スキャン補正後の画像が表示されます。"
          downloadUrl={scannedUrl}
        />
      </section>
    </AnalyticsShell>
  );
}

function ReceiptPreview({
  title,
  imageUrl,
  emptyText,
  downloadUrl
}: {
  title: string;
  imageUrl: string;
  emptyText: string;
  downloadUrl?: string;
}) {
  return (
    <article className="panel receipt-scanner-preview-card">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
        </div>
        {downloadUrl ? (
          <a className="secondary-button" href={downloadUrl} download="receipt-scan-test.png">
            <Download size={16} aria-hidden="true" />
            ダウンロード
          </a>
        ) : null}
      </div>
      <div className="receipt-scanner-preview-frame">
        {imageUrl ? <img src={imageUrl} alt={`${title}プレビュー`} /> : <p>{emptyText}</p>}
      </div>
    </article>
  );
}

function replaceObjectUrl(
  ref: MutableRefObject<string>,
  setter: (value: string) => void,
  nextUrl: string
) {
  if (ref.current) URL.revokeObjectURL(ref.current);
  ref.current = nextUrl;
  setter(nextUrl);
}
