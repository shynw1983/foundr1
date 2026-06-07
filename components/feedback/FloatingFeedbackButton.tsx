"use client";

import { Check, MessageSquareWarning, Send, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

type ActiveFeedbackStaff = {
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  punchType: string;
  punchedAt: string;
};

export function FloatingFeedbackButton() {
  const pathname = usePathname();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [currentEmployeeRole, setCurrentEmployeeRole] = useState("");
  const [activeStaff, setActiveStaff] = useState<ActiveFeedbackStaff[]>([]);
  const [selectedStaffKey, setSelectedStaffKey] = useState("");
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);

  const context = useMemo(() => {
    if (!pathname) return null;
    if (pathname === "/os/login" || pathname.startsWith("/os/logout")) return null;
    if (pathname === "/store/feedback" || pathname === "/os/feedback") return null;
    if (pathname.startsWith("/store")) {
      return {
        source: "store" as const,
        module: deriveModule(pathname),
        detailHref: "/store/feedback"
      };
    }
    if (pathname.startsWith("/os")) {
      return {
        source: "os" as const,
        module: deriveModule(pathname),
        detailHref: "/os/feedback"
      };
    }
    return null;
  }, [pathname]);

  if (!context) return null;

  async function openPanel() {
    if (!context) return;
    setPageUrl(window.location.href);
    setStatus("idle");
    setMessage("");
    setIsPanelOpen(true);
    if (context.source !== "store") return;

    setIsLoadingStaff(true);
    const response = await fetch("/api/feedback?mode=active-staff", { cache: "no-store" });
    if (!response.ok) {
      setIsLoadingStaff(false);
      return;
    }
    const body = await response.json().catch(() => ({})) as {
      currentEmployeeRole?: string;
      activeStaff?: ActiveFeedbackStaff[];
    };
    const nextStaff = body.activeStaff ?? [];
    setCurrentEmployeeRole(body.currentEmployeeRole ?? "");
    setActiveStaff(nextStaff);
    setSelectedStaffKey((current) => current || staffKey(nextStaff[0]));
    setIsLoadingStaff(false);
  }

  function closePanel() {
    if (status === "sending") return;
    setIsPanelOpen(false);
  }

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || status === "sending") return;
    if (!reportDescription.trim()) {
      setStatus("error");
      setMessage("内容を入力してください");
      return;
    }

    setStatus("sending");
    setMessage("");

    const formData = new FormData();
    formData.append("source", context.source);
    formData.append("module", context.module);
    formData.append("category", "screen_issue");
    formData.append("severity", "normal");
    formData.append("title", reportTitle.trim());
    formData.append("description", reportDescription.trim());
    formData.append("expectedResult", "");
    formData.append("pageUrl", pageUrl || window.location.href);
    formData.append("userAgent", window.navigator.userAgent);
    formData.append("language", window.navigator.language);
    formData.append("viewportWidth", String(window.innerWidth));
    formData.append("viewportHeight", String(window.innerHeight));
    const selectedStaff = activeStaff.find((staff) => staffKey(staff) === selectedStaffKey) ?? null;
    formData.append("metadata", JSON.stringify({
      sourcePathname: window.location.pathname,
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      feedbackReporter: selectedStaff ? {
        employeeId: selectedStaff.employeeId,
        employeeName: selectedStaff.employeeName,
        storeId: selectedStaff.storeId,
        storeName: selectedStaff.storeName,
        timecardStatus: feedbackStaffStatusLabel(selectedStaff.punchType),
        selectedFromActiveTimecard: true
      } : null
    }));

    const response = await fetch("/api/feedback", {
      method: "POST",
      body: formData
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (!response.ok) {
      setStatus("error");
      setMessage(body.error ?? "送信できませんでした");
      return;
    }

    setStatus("sent");
    setMessage("送信しました");
    setReportTitle("");
    setReportDescription("");
    setIsPanelOpen(false);
    window.setTimeout(() => {
      setStatus("idle");
      setMessage("");
    }, 4200);
  }

  return (
    <div className="floating-feedback">
      {message ? (
        <div className="floating-feedback-toast" role="status">
          <span>{message}</span>
          {status === "sent" ? <a href={context.detailHref}>詳細を書く</a> : null}
        </div>
      ) : null}
      {isPanelOpen ? (
        <div className="floating-feedback-panel" role="dialog" aria-modal="false" aria-labelledby="floating-feedback-title">
          <div className="floating-feedback-panel-heading">
            <div>
              <p className="eyebrow">{context.source === "store" ? "Store Feedback" : "OS Feedback"}</p>
              <h2 id="floating-feedback-title">この画面の問題を送信</h2>
            </div>
            <button type="button" className="icon-button" aria-label="閉じる" onClick={closePanel} disabled={status === "sending"}>
              <X size={18} />
            </button>
          </div>
          <form className="floating-feedback-form" onSubmit={submitFeedback}>
            <label>
              ページ
              <input value={pageUrl} onChange={(event) => setPageUrl(event.target.value)} />
            </label>
            {currentEmployeeRole === "store_terminal" ? (
              <label>
                フィードバックしたスタッフ
                <select value={selectedStaffKey} onChange={(event) => setSelectedStaffKey(event.target.value)} disabled={isLoadingStaff || activeStaff.length === 0}>
                  {isLoadingStaff ? <option value="">出勤中スタッフを確認中...</option> : null}
                  {!isLoadingStaff && activeStaff.length === 0 ? <option value="">出勤中スタッフなし</option> : null}
                  {activeStaff.map((staff) => (
                    <option value={staffKey(staff)} key={staffKey(staff)}>
                      {staff.employeeName} / {staff.storeName} / {feedbackStaffStatusLabel(staff.punchType)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              タイトル
              <input
                value={reportTitle}
                onChange={(event) => setReportTitle(event.target.value)}
                placeholder="例: ボタンを押しても進まない"
              />
            </label>
            <label>
              内容
              <textarea
                value={reportDescription}
                onChange={(event) => setReportDescription(event.target.value)}
                placeholder="何が起きたか、どの操作で困ったかを書いてください。"
                rows={4}
                required
              />
            </label>
            <div className="floating-feedback-actions">
              <a href={context.detailHref}>詳細フォーム</a>
              <button className="primary-button" type="submit" disabled={status === "sending"}>
                <Send size={16} />
                {status === "sending" ? "送信中" : "送信"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <button
        className={`floating-feedback-button is-${status}`}
        type="button"
        aria-label="フィードバックを書く"
        title="フィードバックを書く"
        disabled={status === "sending"}
        onClick={() => void openPanel()}
      >
        {status === "sent" ? <Check size={22} /> : <MessageSquareWarning size={22} />}
      </button>
    </div>
  );
}

function deriveModule(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "store") return parts[1] || "home";
  if (parts[0] === "os") return parts[1] || "home";
  return "other";
}

function staffKey(staff: ActiveFeedbackStaff | undefined) {
  if (!staff) return "";
  return `${staff.employeeId}:${staff.storeId}`;
}

function feedbackStaffStatusLabel(punchType: string) {
  if (punchType === "break_start") return "休憩中";
  return "勤務中";
}
