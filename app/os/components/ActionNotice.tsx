"use client";

import { useCallback, useEffect, useState } from "react";

export type ActionNoticeState = {
  id: number;
  message: string;
  tone?: "success" | "info";
} | null;

export function useActionNotice() {
  const [notice, setNotice] = useState<ActionNoticeState>(null);

  const showNotice = useCallback((message: string, tone: "success" | "info" = "success") => {
    setNotice({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice((current) => current?.id === notice.id ? null : current);
    }, 2600);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  return {
    notice,
    showNotice,
    clearNotice: () => setNotice(null)
  };
}

export function ActionNotice({
  notice,
  onClose
}: {
  notice: ActionNoticeState;
  onClose: () => void;
}) {
  if (!notice) return null;

  return (
    <div className={`action-notice ${notice.tone === "info" ? "is-info" : ""}`} role="status" aria-live="polite">
      <span className="action-notice-icon" aria-hidden="true">
        {notice.tone === "info" ? "i" : "✓"}
      </span>
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="通知を閉じる">
        ×
      </button>
    </div>
  );
}
