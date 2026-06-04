"use client";

import { BriefcaseBusiness, CalendarCheck2, CalendarDays, ClipboardList, Clock3, FileText, Lightbulb, LogOut, MessageSquare, PackageCheck, RefreshCw, Search, Send, Settings, Store, Truck, UserCog, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MobileNavMenu } from "../../components/MobileNavMenu";
import { OsNavList } from "../../components/OsNavList";
import { UserBadge } from "../../components/UserBadge";
import { getJstMonthLabel } from "../../../../lib/timecard";

type StoreOption = { id: string; name: string };
type EmployeeOption = { id: string; name: string; role: string };
type ShiftRequestItem = {
  id: string;
  requestType: "availability" | "day_off" | "swap";
  status: "open" | "approved" | "rejected";
  targetShiftId: string | null;
  workDate: string | null;
  title: string;
  note: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  employeeId: string;
  employeeName: string;
  reviewedByName: string | null;
  windows: Array<{ id: string; workDate: string; availableStart: string | null; availableEnd: string | null; preference: string; note: string | null }>;
  candidates: Array<{ id: string; employeeId: string; employeeName: string; status: string; note: string | null; createdAt: string }>;
  messages: Array<{ id: string; employeeId: string | null; employeeName: string | null; message: string; createdAt: string }>;
};

type ShiftRequestPayload = {
  month: string;
  selectedStoreId: string;
  stores: StoreOption[];
  employees: EmployeeOption[];
  requests: ShiftRequestItem[];
  publications: Array<{ id: string; scheduleMonth: string; note: string | null; publishedAt: string; publishedByName: string | null }>;
};

const navItems: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "OS ホーム", href: "/os", icon: ClipboardList },
  { label: "発注依頼", href: "/os/orders", icon: PackageCheck },
  { label: "購入管理", href: "/os/procurement", icon: ClipboardList },
  { label: "発注履歴", href: "/os/history", icon: FileText },
  { label: "タイムカード", href: "/os/timecard", icon: Clock3 },
  { label: "シフト", href: "/os/timecard/schedule", icon: CalendarDays },
  { label: "シフト連絡", href: "/os/timecard/requests", icon: MessageSquare },
  { label: "給与", href: "/os/timecard/payroll", icon: WalletCards },
  { label: "商品マスタ", href: "/os/products", icon: BriefcaseBusiness },
  { label: "店舗・ブランド", href: "/os/stores", icon: Store },
  { label: "スタッフ管理", href: "/os/staff", icon: UserCog },
  { label: "発注先管理", href: "/os/suppliers", icon: Truck },
  { label: "現場記録", href: "/os/field-notes", icon: Lightbulb },
  { label: "商品比較", href: "/os/product-comparisons", icon: Search },
  { label: "システム設定", href: "/os/settings", icon: Settings },
  { label: "ログアウト", href: "/os/logout", icon: LogOut }
];

const typeLabels: Record<ShiftRequestItem["requestType"], string> = {
  availability: "希望シフト",
  day_off: "休み希望",
  swap: "交代募集"
};

const statusLabels: Record<ShiftRequestItem["status"], string> = {
  open: "未確認",
  approved: "承認済み",
  rejected: "却下"
};

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default function TimecardShiftRequestsPage() {
  const [data, setData] = useState<ShiftRequestPayload | null>(null);
  const [month, setMonth] = useState(getJstMonthLabel());
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ShiftRequestItem["status"]>("open");
  const [message, setMessage] = useState("");
  const [publishNote, setPublishNote] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  async function loadRequests(nextStoreId = selectedStoreId, nextMonth = month) {
    setIsLoading(true);
    setMessage("");
    const params = new URLSearchParams({ month: nextMonth });
    if (nextStoreId) params.set("storeId", nextStoreId);
    const response = await fetch(`/api/timecard/shift-requests?${params.toString()}`, { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as ShiftRequestPayload;
      setData(body);
      setSelectedStoreId(body.selectedStoreId);
      setMonth(body.month);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setMessage(body.error ?? "シフト連絡を読み込めませんでした。");
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  const filteredRequests = useMemo(() => {
    return (data?.requests ?? []).filter((request) => statusFilter === "all" || request.status === statusFilter);
  }, [data?.requests, statusFilter]);

  async function reviewRequest(request: ShiftRequestItem, approved: boolean, candidateId = "") {
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_request",
        storeId: selectedStoreId,
        requestId: request.id,
        candidateId,
        reviewNote: approved ? "" : "reject:"
      })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "申請を更新できませんでした。");
      return;
    }
    setMessage(approved ? "申請を承認しました。" : "申請を却下しました。");
    await loadRequests(selectedStoreId, month);
  }

  async function publishSchedule() {
    const response = await fetch("/api/timecard/shift-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish_schedule", storeId: selectedStoreId, month, note: publishNote })
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "シフトを公開できませんでした。");
      return;
    }
    setPublishNote("");
    setMessage("シフトを公開しました。");
    await loadRequests(selectedStoreId, month);
  }

  const latestPublication = data?.publications[0] ?? null;
  const openCount = (data?.requests ?? []).filter((request) => request.status === "open").length;

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

      <section className="workspace timecard-workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">希望シフト・休み希望・交代募集</p>
            <h2>シフト連絡</h2>
            <span className="source-indicator">{isLoading ? "読み込み中" : `未確認 ${openCount} 件`}</span>
          </div>
          <div className="timecard-toolbar">
            <input type="month" value={month} onChange={(event) => {
              setMonth(event.target.value);
              void loadRequests(selectedStoreId, event.target.value);
            }} />
            <select value={selectedStoreId} onChange={(event) => {
              setSelectedStoreId(event.target.value);
              void loadRequests(event.target.value, month);
            }}>
              {data?.stores.map((store) => <option value={store.id} key={store.id}>{store.name}</option>)}
            </select>
            <button className="secondary-button" type="button" onClick={() => loadRequests(selectedStoreId, month)}>
              <RefreshCw size={16} />
              更新
            </button>
          </div>
        </header>

        {message ? <div className="timecard-message">{message}</div> : null}

        <section className="panel shift-request-publish-panel">
          <div className="panel-title">
            <CalendarCheck2 />
            <div>
              <h3>シフト公開</h3>
              <p>{latestPublication ? `${formatDateTime(latestPublication.publishedAt)} に ${latestPublication.publishedByName ?? "管理者"} が公開` : "まだこの月のシフトは公開されていません。"}</p>
            </div>
          </div>
          <div className="shift-request-publish-actions">
            <input value={publishNote} placeholder="公開メモ（任意）" onChange={(event) => setPublishNote(event.target.value)} />
            <button className="primary-button" type="button" onClick={publishSchedule}>
              <Send size={16} />
              シフト公開
            </button>
          </div>
        </section>

        <section className="timecard-subtabs" aria-label="状態">
          <button className={statusFilter === "open" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("open")}>未確認</button>
          <button className={statusFilter === "approved" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("approved")}>承認済み</button>
          <button className={statusFilter === "rejected" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("rejected")}>却下</button>
          <button className={statusFilter === "all" ? "is-active" : ""} type="button" onClick={() => setStatusFilter("all")}>すべて</button>
        </section>

        <section className="shift-request-list">
          {isLoading ? <div className="empty-state">読み込み中</div> : null}
          {!isLoading && filteredRequests.length === 0 ? <div className="empty-state">対象のシフト連絡はありません。</div> : null}
          {filteredRequests.map((request) => (
            <article className={`panel shift-request-card is-${request.status}`} key={request.id}>
              <div className="shift-request-card-head">
                <div>
                  <span className="shift-request-type">{typeLabels[request.requestType]}</span>
                  <h3>{request.title || typeLabels[request.requestType]}</h3>
                  <p>{request.employeeName}・{request.workDate ?? "日付未設定"}・{formatDateTime(request.createdAt)}</p>
                </div>
                <strong>{statusLabels[request.status]}</strong>
              </div>

              <div className="shift-request-detail-grid">
                <div>
                  <span>希望内容</span>
                  {request.windows.length ? request.windows.map((window) => (
                    <strong key={window.id}>{window.workDate} {window.availableStart ?? "--:--"}-{window.availableEnd ?? "--:--"}</strong>
                  )) : <strong>{request.workDate ?? "-"}</strong>}
                </div>
                <div>
                  <span>メモ</span>
                  <strong>{request.note || "-"}</strong>
                </div>
                <div>
                  <span>確認</span>
                  <strong>{request.reviewedByName ? `${request.reviewedByName}・${formatDateTime(request.reviewedAt)}` : "未確認"}</strong>
                </div>
              </div>

              {request.requestType === "swap" ? (
                <div className="shift-candidate-list">
                  <span>交代候補</span>
                  {request.candidates.length ? request.candidates.map((candidate) => (
                    <div className="shift-candidate-row" key={candidate.id}>
                      <strong>{candidate.employeeName}</strong>
                      <small>{candidate.note || "メモなし"}・{candidate.status}</small>
                      {request.status === "open" ? (
                        <button className="secondary-button" type="button" onClick={() => reviewRequest(request, true, candidate.id)}>この候補で承認</button>
                      ) : null}
                    </div>
                  )) : <p className="empty-state-text">まだ応募はありません。</p>}
                </div>
              ) : null}

              {request.messages.length ? (
                <div className="shift-message-list">
                  {request.messages.map((item) => (
                    <p key={item.id}><strong>{item.employeeName ?? "スタッフ"}</strong> {item.message}</p>
                  ))}
                </div>
              ) : null}

              {request.status === "open" && request.requestType !== "swap" ? (
                <div className="shift-request-actions">
                  <button className="primary-button" type="button" onClick={() => reviewRequest(request, true)}>承認</button>
                  <button className="secondary-button" type="button" onClick={() => reviewRequest(request, false)}>却下</button>
                </div>
              ) : null}
              {request.status === "open" && request.requestType === "swap" && request.candidates.length === 0 ? (
                <div className="shift-request-actions">
                  <button className="secondary-button" type="button" onClick={() => reviewRequest(request, false)}>募集を却下</button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
