"use client";

import { useEffect, useMemo, useState } from "react";

type FeedbackSource = "store" | "os";

type FeedbackOption = {
  value: string;
  label: string;
};

type FeedbackFormProps = {
  source: FeedbackSource;
  title: string;
  description: string;
  moduleOptions: FeedbackOption[];
  categoryOptions: FeedbackOption[];
  compact?: boolean;
  onSubmitted?: () => void;
};

const severityOptions = [
  { value: "normal", label: "まだ続けられる" },
  { value: "work_blocked", label: "業務に影響" },
  { value: "urgent", label: "作業できない" }
];

export function FeedbackForm({
  source,
  title,
  description,
  moduleOptions,
  categoryOptions,
  compact = false,
  onSubmitted
}: FeedbackFormProps) {
  const [module, setModule] = useState(moduleOptions[0]?.value ?? "");
  const [category, setCategory] = useState(categoryOptions[0]?.value ?? "bug");
  const [severity, setSeverity] = useState("normal");
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [expectedResult, setExpectedResult] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedFileLabel = useMemo(() => {
    if (!screenshot) return "スクリーンショットを選択";
    return screenshot.name.length > 24 ? `${screenshot.name.slice(0, 21)}...` : screenshot.name;
  }, [screenshot]);

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("");

    if (!reportDescription.trim()) {
      setStatusMessage("内容を入力してください。");
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.append("source", source);
    formData.append("module", module);
    formData.append("category", category);
    formData.append("severity", severity);
    formData.append("title", reportTitle.trim());
    formData.append("description", reportDescription.trim());
    formData.append("expectedResult", expectedResult.trim());
    formData.append("pageUrl", pageUrl);
    formData.append("userAgent", window.navigator.userAgent);
    formData.append("language", window.navigator.language);
    formData.append("viewportWidth", String(window.innerWidth));
    formData.append("viewportHeight", String(window.innerHeight));
    formData.append("metadata", JSON.stringify({
      sourcePathname: window.location.pathname,
      devicePixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }));
    if (screenshot) formData.append("screenshot", screenshot);

    const response = await fetch("/api/feedback", {
      method: "POST",
      body: formData
    });
    const body = await response.json().catch(() => ({})) as { error?: string };

    if (!response.ok) {
      setStatusMessage(body.error ?? "送信できませんでした。");
      setIsSubmitting(false);
      return;
    }

    setReportTitle("");
    setReportDescription("");
    setExpectedResult("");
    setScreenshot(null);
    setStatusMessage("送信しました。確認して対応します。");
    setIsSubmitting(false);
    onSubmitted?.();
  }

  return (
    <section className={`feedback-submit-panel${compact ? " is-compact" : ""}`}>
      <div className="feedback-submit-heading">
        <div>
          <p className="eyebrow">{source === "store" ? "Store Feedback" : "OS Feedback"}</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <form className="feedback-submit-form" onSubmit={submitFeedback}>
        <div className="form-grid two-columns">
          <label>
            対象
            <select value={module} onChange={(event) => setModule(event.target.value)}>
              {moduleOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            種類
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categoryOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="feedback-severity-group">
          <legend>影響度</legend>
          <div>
            {severityOptions.map((option) => (
              <label className="segmented-option" key={option.value}>
                <input
                  type="radio"
                  name={`${source}-severity`}
                  value={option.value}
                  checked={severity === option.value}
                  onChange={(event) => setSeverity(event.target.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          タイトル
          <input
            value={reportTitle}
            onChange={(event) => setReportTitle(event.target.value)}
            placeholder={source === "store" ? "例: POS の会計ボタンが押せない" : "例: 権限設定の表示が分かりにくい"}
          />
        </label>

        <label>
          内容
          <textarea
            value={reportDescription}
            onChange={(event) => setReportDescription(event.target.value)}
            placeholder="何が起きたか、どの操作で困ったかを書いてください。"
            rows={compact ? 4 : 5}
            required
          />
        </label>

        <label>
          期待する状態
          <textarea
            value={expectedResult}
            onChange={(event) => setExpectedResult(event.target.value)}
            placeholder="本来どうなってほしいかがあれば書いてください。"
            rows={3}
          />
        </label>

        <div className="feedback-form-footer">
          <label className="feedback-file-button">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)}
            />
            {selectedFileLabel}
          </label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "送信中" : "送信"}
          </button>
        </div>

        {statusMessage ? <p className="feedback-submit-status">{statusMessage}</p> : null}
      </form>
    </section>
  );
}
