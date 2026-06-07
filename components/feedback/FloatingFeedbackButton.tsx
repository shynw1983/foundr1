"use client";

import { Check, MessageSquareWarning } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

export function FloatingFeedbackButton() {
  const pathname = usePathname();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

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

  async function sendQuickFeedback() {
    if (!context || status === "sending") return;
    setStatus("sending");
    setMessage("");

    const formData = new FormData();
    formData.append("source", context.source);
    formData.append("module", context.module);
    formData.append("category", "quick_marker");
    formData.append("severity", "normal");
    formData.append("title", "クイック報告");
    formData.append("description", "この画面で確認が必要です。");
    formData.append("expectedResult", "");
    formData.append("pageUrl", window.location.href);
    formData.append("userAgent", window.navigator.userAgent);
    formData.append("language", window.navigator.language);
    formData.append("viewportWidth", String(window.innerWidth));
    formData.append("viewportHeight", String(window.innerHeight));
    formData.append("metadata", JSON.stringify({
      quickMarker: true,
      sourcePathname: window.location.pathname,
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }));

    const response = await fetch("/api/feedback", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      setStatus("error");
      setMessage("送信できませんでした");
      window.setTimeout(() => {
        setStatus("idle");
        setMessage("");
      }, 2800);
      return;
    }

    setStatus("sent");
    setMessage("現在の画面を送信しました");
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
      <button
        className={`floating-feedback-button is-${status}`}
        type="button"
        aria-label="現在の画面をフィードバックとして送信"
        title="現在の画面をフィードバックとして送信"
        disabled={status === "sending"}
        onClick={() => void sendQuickFeedback()}
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
