"use client";

import { Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { StoreNavTabs } from "../components/StoreNavTabs";

type PrivacyConsentRecord = {
  consentId: string;
  companyLegalName: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
  agreedAt: string;
  storeNames: string[];
};

function formatDateTime(value: string) {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未記録";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildDownloadText(record: PrivacyConsentRecord) {
  const stores = record.storeNames.length ? record.storeNames.join("、") : "未設定";
  return [
    record.title,
    "",
    `会社名：${record.companyLegalName || "未設定"}`,
    `対象店舗：${stores}`,
    `文書バージョン：${record.version}`,
    `効力発生日：${record.effectiveDate || "未設定"}`,
    `同意日時：${formatDateTime(record.agreedAt)}`,
    "",
    record.body
  ].join("\n");
}

function downloadConsent(record: PrivacyConsentRecord) {
  const text = buildDownloadText(record);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  const companyName = (record.companyLegalName || "company").replace(/[\\/:*?"<>|]/g, "-");
  link.href = url;
  link.download = `${companyName}-個人情報文書-${record.version}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export default function StorePrivacyDocumentsPage() {
  const [records, setRecords] = useState<PrivacyConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    async function loadRecords() {
      setLoading(true);
      setError("");
      const response = await fetch("/api/privacy-consents/history", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as { consents?: PrivacyConsentRecord[]; error?: string };
      if (!isMounted) return;
      if (!response.ok) {
        setError(body.error ?? "文書を読み込めませんでした。");
        setLoading(false);
        return;
      }
      setRecords(body.consents ?? []);
      setLoading(false);
    }
    void loadRecords();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="store-workbench-shell">
      <header className="store-workbench-topbar">
        <a className="brand-block" href="/store" aria-label="Foundr1 店舗">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>個人情報文書</h1>
          </div>
        </a>
        <StoreNavTabs active="privacy-documents" />
      </header>

      <section className="privacy-consent-panel privacy-documents-panel">
        <div className="privacy-consent-heading">
          <div className="brand-mark">
            <FileText size={22} />
          </div>
          <div>
            <p className="eyebrow">Privacy Documents</p>
            <h1>同意済み文書の確認</h1>
            <p>過去に同意した個人情報・マイナンバー取扱文書を会社ごとに確認できます。</p>
          </div>
        </div>

        {loading ? <div className="privacy-consent-loading">読み込み中...</div> : null}
        {error ? <div className="login-error">{error}</div> : null}

        {!loading && !error && records.length === 0 ? (
          <div className="privacy-consent-loading">同意済みの文書はまだありません。</div>
        ) : null}

        <div className="privacy-consent-list">
          {records.map((record) => (
            <article className="privacy-consent-document" key={record.consentId}>
              <div className="privacy-consent-document-header">
                <span>
                  <strong>{record.companyLegalName || "会社未設定"}</strong>
                  <small>{record.title} / {record.version} / 同意日時 {formatDateTime(record.agreedAt)}</small>
                </span>
                <button className="secondary-button" type="button" onClick={() => downloadConsent(record)}>
                  <Download size={16} />
                  ダウンロード
                </button>
              </div>
              <div className="privacy-consent-document-body">
                <pre>{buildDownloadText(record)}</pre>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
