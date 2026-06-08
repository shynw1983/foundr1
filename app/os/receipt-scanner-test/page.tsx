"use client";

import { Camera, Download, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { AnalyticsShell } from "../analytics/components/AnalyticsShell";

export default function ReceiptScannerTestPage() {
  const [originalUrl, setOriginalUrl] = useState("");
  const [scannedUrl, setScannedUrl] = useState("");
  const [debugUrl, setDebugUrl] = useState("");
  const [message, setMessage] = useState("");
  const [debugMessage, setDebugMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [useAiBoundary, setUseAiBoundary] = useState(true);
  const [scanMode, setScanMode] = useState("auto");
  const [useStrongContrast, setUseStrongContrast] = useState(true);
  const originalUrlRef = useRef("");
  const scannedUrlRef = useRef("");
  const debugUrlRef = useRef("");

  useEffect(() => {
    return () => {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      if (scannedUrlRef.current) URL.revokeObjectURL(scannedUrlRef.current);
      if (debugUrlRef.current) URL.revokeObjectURL(debugUrlRef.current);
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
    setDebugMessage("");
    replaceObjectUrl(originalUrlRef, setOriginalUrl, URL.createObjectURL(file));
    replaceObjectUrl(scannedUrlRef, setScannedUrl, "");
    replaceObjectUrl(debugUrlRef, setDebugUrl, "");

    try {
      setMessage("検出輪郭を作成しています。");
      const debugResponse = await requestScannerImage(file, {
        boundaryMode: useAiBoundary ? "ai" : "auto",
        scanMode,
        contrastMode: useStrongContrast ? "strong" : "standard",
        outputMode: "debug_overlay"
      });
      if (!debugResponse.ok) {
        const body = await debugResponse.json().catch(() => null);
        throw new Error(body?.error ?? "検出輪郭の作成に失敗しました。");
      }
      const debugContentType = debugResponse.headers.get("content-type") ?? "";
      if (!debugContentType.includes("image/")) {
        throw new Error(`検出輪郭が画像として返りませんでした。content-type: ${debugContentType || "unknown"}`);
      }
      const debugBlob = await debugResponse.blob();
      if (debugBlob.size <= 0) {
        throw new Error("検出輪郭の画像データが空でした。");
      }
      replaceObjectUrl(debugUrlRef, setDebugUrl, URL.createObjectURL(debugBlob));
      const debugSize = debugResponse.headers.get("X-Receipt-Scanner-Size");
      const debugAiStatus = debugResponse.headers.get("X-Receipt-Scanner-AI");
      setDebugMessage(`検出輪郭を表示しました。${debugSize ? `画像 ${debugSize} / ` : ""}${formatAiStatus(debugAiStatus)}`);
      setMessage("スキャン補正画像を作成しています。");

      const response = await requestScannerImage(file, {
        boundaryMode: useAiBoundary ? "ai" : "auto",
        scanMode,
        contrastMode: useStrongContrast ? "strong" : "standard",
        outputMode: "scan"
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
      setMessage(`${sourceLabel} / ${modeLabel} / ${aiLabel}${outputSize ? ` / ${outputSize}` : ""}で完了しました。検出輪郭も確認できます。`);
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
          title="検出輪郭"
          imageUrl={debugUrl}
          emptyText="AIとローカル検出の輪郭が表示されます。"
          downloadUrl={debugUrl}
          downloadName="receipt-scan-debug.png"
          statusText={debugMessage}
          onImageError={() => {
            setDebugMessage("検出輪郭の画像を読み込めませんでした。もう一度実行してください。");
            replaceObjectUrl(debugUrlRef, setDebugUrl, "");
          }}
        />
        <ReceiptPreview
          title="補正後"
          imageUrl={scannedUrl}
          emptyText="スキャン補正後の画像が表示されます。"
          downloadUrl={scannedUrl}
          downloadName="receipt-scan-test.png"
        />
      </section>
    </AnalyticsShell>
  );
}

function ReceiptPreview({
  title,
  imageUrl,
  emptyText,
  downloadUrl,
  downloadName = "receipt-scan-test.png",
  statusText,
  onImageError
}: {
  title: string;
  imageUrl: string;
  emptyText: string;
  downloadUrl?: string;
  downloadName?: string;
  statusText?: string;
  onImageError?: () => void;
}) {
  return (
    <article className="panel receipt-scanner-preview-card">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
        </div>
        {downloadUrl ? (
          <a className="secondary-button" href={downloadUrl} download={downloadName}>
            <Download size={16} aria-hidden="true" />
            ダウンロード
          </a>
        ) : null}
      </div>
      <div className="receipt-scanner-preview-frame">
        {imageUrl ? <img src={imageUrl} alt={`${title}プレビュー`} onError={onImageError} /> : <p>{emptyText}</p>}
      </div>
      {statusText ? <p className="receipt-scanner-preview-status">{statusText}</p> : null}
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

function requestScannerImage(
  file: File,
  options: {
    boundaryMode: "ai" | "auto";
    scanMode: string;
    contrastMode: "strong" | "standard";
    outputMode: "scan" | "debug_overlay";
  }
) {
  const uploadData = new FormData();
  uploadData.set("receipt", file);
  uploadData.set("boundaryMode", options.boundaryMode);
  uploadData.set("scanMode", options.scanMode);
  uploadData.set("contrastMode", options.contrastMode);
  uploadData.set("outputMode", options.outputMode);
  return fetch("/api/receipt-scanner", {
    method: "POST",
    body: uploadData
  });
}

function formatAiStatus(status: string | null) {
  if (status === "used") return "AI使用";
  if (status === "failed") return "AI検出失敗";
  return "AIなし";
}
