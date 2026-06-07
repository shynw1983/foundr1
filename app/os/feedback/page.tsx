"use client";

import { useEffect, useMemo, useState } from "react";
import { FeedbackForm } from "../../../components/feedback/FeedbackForm";
import { UserBadge } from "../components/UserBadge";

type FeedbackReport = {
  id: string;
  source: "store" | "os";
  module: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  expectedResult: string;
  pageUrl: string;
  screenshotUrl: string;
  reportedBy: string;
  storeName: string;
  brandName: string;
  viewportWidth?: number;
  viewportHeight?: number;
  language: string;
  metadata?: {
    feedbackReporter?: {
      employeeId?: string;
      employeeName?: string;
      storeName?: string;
      timecardStatus?: string;
      selectedFromActiveTimecard?: boolean;
    } | null;
  };
  adminNote: string;
  handledBy: string;
  createdLabel: string;
  updatedLabel: string;
};

const osModules = [
  { value: "procurement", label: "発注・購入管理" },
  { value: "products", label: "商品マスタ" },
  { value: "menus", label: "メニュー管理" },
  { value: "pos", label: "POS" },
  { value: "timecard", label: "タイムカード" },
  { value: "staff", label: "スタッフ・権限" },
  { value: "analytics", label: "分析・レポート" },
  { value: "store-operations", label: "店舗運営" },
  { value: "settings", label: "システム設定" },
  { value: "other", label: "その他" }
];

const osCategories = [
  { value: "bug", label: "Bug" },
  { value: "data_fix", label: "データ修正" },
  { value: "permission", label: "権限問題" },
  { value: "workflow", label: "業務フロー改善" },
  { value: "feature", label: "機能要望" },
  { value: "other", label: "その他" }
];

const sourceLabels = {
  store: "Store",
  os: "OS"
};

const statusOptions = [
  { value: "open", label: "未処理" },
  { value: "reviewing", label: "対応中" },
  { value: "resolved", label: "解決済み" },
  { value: "closed", label: "クローズ" }
];

const statusLabels = new Map(statusOptions.map((option) => [option.value, option.label]));
const severityLabels = new Map([
  ["normal", "まだ続けられる"],
  ["work_blocked", "業務に影響"],
  ["urgent", "作業できない"]
]);

export default function OsFeedbackPage() {
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [sourceFilter, setSourceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const filteredReports = useMemo(() => reports, [reports]);

  async function loadReports() {
    setLoading(true);
    const params = new URLSearchParams();
    if (sourceFilter) params.set("source", sourceFilter);
    if (statusFilter) params.set("status", statusFilter);
    const response = await fetch(`/api/feedback?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setReports([]);
      setMessage("フィードバックを読み込めませんでした。");
      setLoading(false);
      return;
    }
    const body = await response.json() as { reports?: FeedbackReport[] };
    setReports(body.reports ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadReports();
  }, [sourceFilter, statusFilter]);

  async function updateReport(report: FeedbackReport, status: string, adminNote: string) {
    setMessage("");
    const response = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: report.id,
        status,
        adminNote
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "更新できませんでした。");
      return;
    }
    setMessage("更新しました。");
    await loadReports();
  }

  return (
    <main className="os-home-shell feedback-management-shell">
      <header className="os-home-topbar">
        <a className="brand-block" href="/os" aria-label="Foundr1 OS ホーム">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>フィードバック</h1>
          </div>
        </a>
        <div className="os-home-user">
          <UserBadge />
        </div>
      </header>

      <FeedbackForm
        source="os"
        title="管理・システム利用の問題を報告"
        description="管理画面、権限、データ、業務フロー、レポートなど、運用中に気づいた問題や改善要望を残します。"
        moduleOptions={osModules}
        categoryOptions={osCategories}
        onSubmitted={loadReports}
      />

      <section className="feedback-board">
        <div className="section-heading feedback-board-heading">
          <div>
            <p className="eyebrow">Feedback Board</p>
            <h2>対応一覧</h2>
          </div>
          <div className="feedback-board-filters">
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="来源">
              <option value="">全来源</option>
              <option value="store">Store</option>
              <option value="os">OS</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="状態">
              <option value="">全状態</option>
              {statusOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {message ? <p className="feedback-board-message">{message}</p> : null}
        {loading ? <p className="empty-state">読み込み中...</p> : null}
        {!loading && !filteredReports.length ? <p className="empty-state">フィードバックはまだありません。</p> : null}

        <div className="feedback-report-list">
          {filteredReports.map((report) => (
            <FeedbackReportCard report={report} onUpdate={updateReport} key={report.id} />
          ))}
        </div>
      </section>
    </main>
  );
}

function FeedbackReportCard({
  report,
  onUpdate
}: {
  report: FeedbackReport;
  onUpdate: (report: FeedbackReport, status: string, adminNote: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(report.status);
  const [adminNote, setAdminNote] = useState(report.adminNote ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const feedbackReporter = report.metadata?.feedbackReporter ?? null;

  async function save() {
    setIsSaving(true);
    await onUpdate(report, status, adminNote);
    setIsSaving(false);
  }

  return (
    <article className={`feedback-report-card is-${report.severity}`}>
      <div className="feedback-report-main">
        <div className="feedback-report-topline">
          <span className={`source-pill is-${report.source}`}>{sourceLabels[report.source]}</span>
          <span className="status-pill">{statusLabels.get(report.status) ?? report.status}</span>
          <strong>{severityLabels.get(report.severity) ?? report.severity}</strong>
          <small>{report.createdLabel}</small>
        </div>
        <h3>{report.title || report.description.slice(0, 42)}</h3>
        <p>{report.description}</p>
        {report.expectedResult ? (
          <div className="feedback-report-note">
            <strong>期待する状態</strong>
            <span>{report.expectedResult}</span>
          </div>
        ) : null}
        <dl className="feedback-report-meta">
          <div>
            <dt>報告者</dt>
            <dd>
              {feedbackReporter?.employeeName || report.reportedBy || "不明"}
              {feedbackReporter?.selectedFromActiveTimecard ? `（Timecard${feedbackReporter.timecardStatus ? ` / ${feedbackReporter.timecardStatus}` : ""}）` : ""}
            </dd>
          </div>
          <div>
            <dt>店舗</dt>
            <dd>{report.storeName || "-"}</dd>
          </div>
          <div>
            <dt>対象</dt>
            <dd>{report.module || "-"}</dd>
          </div>
          <div>
            <dt>種類</dt>
            <dd>{report.category || "-"}</dd>
          </div>
          <div>
            <dt>画面</dt>
            <dd>{report.viewportWidth && report.viewportHeight ? `${report.viewportWidth}x${report.viewportHeight}` : "-"}</dd>
          </div>
          <div>
            <dt>言語</dt>
            <dd>{report.language || "-"}</dd>
          </div>
        </dl>
        <div className="feedback-report-links">
          {report.pageUrl ? <a href={report.pageUrl} target="_blank" rel="noreferrer">ページを開く</a> : null}
          {report.screenshotUrl ? <a href={report.screenshotUrl} target="_blank" rel="noreferrer">スクリーンショット</a> : null}
        </div>
      </div>
      <div className="feedback-report-controls">
        <label>
          状態
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {statusOptions.map((option) => (
              <option value={option.value} key={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          対応メモ
          <textarea value={adminNote} onChange={(event) => setAdminNote(event.target.value)} rows={5} />
        </label>
        <button className="secondary-button" type="button" disabled={isSaving} onClick={() => void save()}>
          {isSaving ? "保存中" : "保存"}
        </button>
      </div>
    </article>
  );
}
