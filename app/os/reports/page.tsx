"use client";

import {
  Boxes,
  ClipboardList,
  FileText,
  Lightbulb,
  LogOut,
  MessageSquareWarning,
  PackageCheck,
  Search,
  Store,
  Truck,
  UserCog
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MobileNavMenu } from "../components/MobileNavMenu";
import { OsNavList } from "../components/OsNavList";
import { UserBadge } from "../components/UserBadge";

type ReportItem = {
  id: string;
  source: "history" | "current";
  orderId: string;
  itemId: string;
  product: string;
  store: string;
  type: "price" | "quantity" | "note" | "unavailable" | "other";
  status: "open" | "resolved";
  message: string;
  resolutionNote: string;
  createdLabel: string;
  resolvedLabel: string;
  resolvedBy: string;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "商品マスタ", href: "/os/products", icon: Boxes },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "連絡・報告", href: "/os/reports", icon: MessageSquareWarning },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const typeLabels: Record<ReportItem["type"], string> = {
  price: "価格異常",
  quantity: "数量差異",
  note: "備考",
  unavailable: "購入不可",
  other: "その他"
};

const statusLabels: Record<ReportItem["status"], string> = {
  open: "未確認",
  resolved: "確認済み"
};

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | ReportItem["status"]>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | ReportItem["type"]>("all");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [canDeleteReports, setCanDeleteReports] = useState(false);

  useEffect(() => {
    async function loadReports() {
      setIsLoading(true);
      const [response, meResponse] = await Promise.all([
        fetch("/api/reports"),
        fetch("/api/auth/me", { cache: "no-store" })
      ]);
      if (meResponse.ok) {
        const body = await meResponse.json().catch(() => ({})) as { employee?: { permissions?: string[] } };
        setCanDeleteReports(body.employee?.permissions?.includes("history.delete") === true);
      }
      if (response.ok) {
        const data = await response.json() as { reports?: ReportItem[] };
        setReports(data.reports ?? []);
      }
      setIsLoading(false);
    }

    void loadReports();
  }, []);

  const filteredReports = useMemo(() => {
    const normalizedKeyword = searchKeyword.trim().toLowerCase();

    return reports.filter((report) => {
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (typeFilter !== "all" && report.type !== typeFilter) return false;
      if (!normalizedKeyword) return true;

      return [
        report.orderId,
        report.product,
        report.store,
        typeLabels[report.type],
        statusLabels[report.status],
        report.message,
        report.resolutionNote,
        report.resolvedBy
      ].some((value) => value.toLowerCase().includes(normalizedKeyword));
    });
  }, [reports, searchKeyword, statusFilter, typeFilter]);

  const openCount = reports.filter((report) => report.status === "open").length;
  const resolvedCount = reports.filter((report) => report.status === "resolved").length;

  async function deleteReport(report: ReportItem) {
    if (!window.confirm(`${typeLabels[report.type]} の連絡・報告を削除しますか？`)) return;

    const response = await fetch("/api/reports", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: report.id,
        source: report.source,
        itemId: report.itemId,
        type: report.type
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      window.alert(body.error ?? "連絡・報告を削除できませんでした。");
      return;
    }

    setReports((items) => items.filter((item) => item.id !== report.id));
  }

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="管理画面ナビゲーション">
        <a className="brand-block" href="/os" aria-label="OS ホームへ戻る">
          <div className="brand-mark">F1</div>
          <div>
            <p className="eyebrow">Foundr1 OS</p>
            <h1>Foundr1 OS</h1>
          </div>
        </a>
        <MobileNavMenu navItems={navItems} />
        <div className="sidebar-user">
          <UserBadge />
        </div>
        <OsNavList navItems={navItems} />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">店舗連絡と異常報告の履歴</p>
            <h2>連絡・報告</h2>
            <span className="source-indicator">データ同期済み</span>
          </div>
          <div className="report-summary">
            <span>未確認 {openCount} 件</span>
            <span>確認済み {resolvedCount} 件</span>
          </div>
        </header>

        <section className="panel">
          <div className="report-toolbar">
            <label className="search-box report-search">
              <Search size={17} />
              <input
                value={searchKeyword}
                placeholder="依頼番号・店舗・商品を検索"
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </label>
            <label className="filter-field">
              <span>状態</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">すべて</option>
                <option value="open">未確認</option>
                <option value="resolved">確認済み</option>
              </select>
            </label>
            <label className="filter-field">
              <span>種類</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
                <option value="all">すべて</option>
                <option value="price">価格異常</option>
                <option value="quantity">数量差異</option>
                <option value="note">備考</option>
                <option value="unavailable">購入不可</option>
                <option value="other">その他</option>
              </select>
            </label>
          </div>

          <div className="report-list">
            {isLoading ? <div className="empty-state">読み込み中</div> : null}
            {!isLoading && filteredReports.length === 0 ? <div className="empty-state">連絡・報告の記録はありません</div> : null}
            {filteredReports.map((report) => (
              <article className="report-row" key={report.id}>
                <div className="report-main">
                  <div className="report-title-line">
                    <strong>{report.product}</strong>
                    <span className={`report-type report-type-${report.type}`}>{typeLabels[report.type]}</span>
                  </div>
                  <p>{report.message}</p>
                  <small>
                    <a href={`/os/orders#order-${report.orderId}`}>依頼番号 {report.orderId}</a>
                    <span> · {report.store} · 発生 {report.createdLabel}</span>
                  </small>
                </div>
                <div className="report-status-block">
                  <span className={`report-status report-status-${report.status}`}>{statusLabels[report.status]}</span>
                  {report.status === "resolved" ? (
                    <small>
                      {report.resolvedLabel}
                      {report.resolvedBy ? ` · ${report.resolvedBy}` : ""}
                    </small>
                  ) : (
                    <a className="secondary-button" href={`/os/orders#order-${report.orderId}`}>店舗確認へ</a>
                  )}
                  {report.resolutionNote ? <em>{report.resolutionNote}</em> : null}
                  {canDeleteReports ? (
                    <button type="button" className="text-button danger-button" onClick={() => void deleteReport(report)}>
                      削除
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
