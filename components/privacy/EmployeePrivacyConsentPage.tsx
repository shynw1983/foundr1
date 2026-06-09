"use client";

import { CheckCircle, FileText, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type PrivacyDocumentSummary = {
  documentId: string;
  companyId: string;
  companyLegalName: string;
  version: string;
  title: string;
  body: string;
  effectiveDate: string;
  storeNames: string[];
};

type ConsentResponse = {
  pendingConsents?: PrivacyDocumentSummary[];
  error?: string;
};

function getNextPath() {
  if (typeof window === "undefined") return "/store";
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (
    next?.startsWith("/")
    && !next.startsWith("//")
    && !next.startsWith("/os/privacy-consent")
    && !next.startsWith("/store/privacy-consent")
  ) {
    return next;
  }
  return "/store";
}

export function EmployeePrivacyConsentPage() {
  const [pendingConsents, setPendingConsents] = useState<PrivacyDocumentSummary[]>([]);
  const [expandedDocumentId, setExpandedDocumentId] = useState("");
  const [confirmedDocumentIds, setConfirmedDocumentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const allDocumentIds = useMemo(() => pendingConsents.map((document) => document.documentId), [pendingConsents]);
  const allConfirmed = allDocumentIds.length > 0 && allDocumentIds.every((documentId) => confirmedDocumentIds.includes(documentId));

  useEffect(() => {
    let isMounted = true;

    async function loadConsents() {
      setIsLoading(true);
      const response = await fetch("/api/privacy-consents", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = `/os/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
          return;
        }
        const body = await response.json().catch(() => ({})) as ConsentResponse;
        if (isMounted) setError(body.error ?? "文書を読み込めませんでした。");
        return;
      }
      const body = await response.json().catch(() => ({})) as ConsentResponse;
      if (!isMounted) return;

      const documents = body.pendingConsents ?? [];
      if (!documents.length) {
        window.location.href = getNextPath();
        return;
      }

      setPendingConsents(documents);
      setExpandedDocumentId(documents[0]?.documentId ?? "");
      setIsLoading(false);
    }

    void loadConsents();

    return () => {
      isMounted = false;
    };
  }, []);

  function toggleDocumentConfirmation(documentId: string) {
    setConfirmedDocumentIds((current) => (
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    ));
  }

  async function submitConsents() {
    if (!allConfirmed) return;
    setError("");
    setIsSubmitting(true);

    const response = await fetch("/api/privacy-consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentIds: allDocumentIds })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as ConsentResponse;
      setError(body.error ?? "同意記録を保存できませんでした。");
      setIsSubmitting(false);
      return;
    }

    window.location.href = getNextPath();
  }

  return (
    <main className="privacy-consent-shell">
      <section className="privacy-consent-panel">
        <div className="privacy-consent-heading">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 STORE</p>
            <h1>個人情報および個人番号の取扱い確認</h1>
            <p>勤務先会社ごとに、個人情報・GPS打刻・マイナンバーの取扱いを確認してください。</p>
          </div>
        </div>

        {isLoading ? (
          <div className="privacy-consent-loading">文書を読み込んでいます。</div>
        ) : (
          <>
            <div className="privacy-consent-summary">
              <FileText size={18} />
              <span>{pendingConsents.length}件の会社文書があります。</span>
            </div>

            <div className="privacy-consent-list">
              {pendingConsents.map((document) => {
                const isExpanded = expandedDocumentId === document.documentId;
                const isConfirmed = confirmedDocumentIds.includes(document.documentId);
                return (
                  <section className="privacy-consent-document" key={document.documentId}>
                    <button
                      className="privacy-consent-document-header"
                      type="button"
                      onClick={() => setExpandedDocumentId(isExpanded ? "" : document.documentId)}
                      aria-expanded={isExpanded}
                    >
                      <span>
                        <strong>{document.companyLegalName}</strong>
                        <small>
                          {document.version} / 制定日 {document.effectiveDate}
                          {document.storeNames.length ? ` / ${document.storeNames.join("、")}` : ""}
                        </small>
                      </span>
                      <span className={isConfirmed ? "status-pill is-active" : "status-pill"}>
                        {isConfirmed ? "確認済み" : "未確認"}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="privacy-consent-document-body">
                        <pre>{document.body}</pre>
                      </div>
                    ) : null}

                    <label className="privacy-consent-checkbox">
                      <input
                        type="checkbox"
                        checked={isConfirmed}
                        onChange={() => toggleDocumentConfirmation(document.documentId)}
                      />
                      <span>上記内容を確認し、同意します</span>
                    </label>
                  </section>
                );
              })}
            </div>

            {error ? <div className="login-error">{error}</div> : null}

            <div className="privacy-consent-actions">
              <a className="secondary-button" href="/os/logout">
                <LogOut size={16} />
                ログアウト
              </a>
              <button className="primary-button" type="button" disabled={!allConfirmed || isSubmitting} onClick={() => void submitConsents()}>
                <CheckCircle size={16} />
                {isSubmitting ? "保存中" : "確認して続行"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
