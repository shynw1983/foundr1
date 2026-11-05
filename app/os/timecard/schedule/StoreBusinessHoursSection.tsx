"use client";

import { useEffect, useRef, useState } from "react";
import { useOsTranslation } from "../../components/OsTranslationProvider";
import { GoogleBusinessHours } from "./GoogleBusinessHours";
import { ScheduleConfirmation } from "./ScheduleConfirmation";
import type { ScheduleDay } from "../../../../lib/shift-confirmation";
import styles from "./store-business-hours-section.module.css";

export function StoreBusinessHoursSection({ storeId, month, today, refreshKey, selectedDate, onClearDate, onDays }: {
  storeId: string;
  month: string;
  today: string;
  refreshKey: string;
  selectedDate?: string;
  onClearDate?: () => void;
  onDays?: (days: ScheduleDay[]) => void;
}) {
  const { t } = useOsTranslation();
  const [selection, setSelection] = useState<{ month: string; half: string }>();
  const [calendarRevision, setCalendarRevision] = useState(0);
  const googleSettings = useRef<HTMLDetailsElement>(null);
  const defaultHalf = today.startsWith(month) && Number(today.slice(8)) > 15 ? "second_half" : "first_half";
  const selectedHalf = selectedDate?.startsWith(month) ? (Number(selectedDate.slice(8)) > 15 ? "second_half" : "first_half") : undefined;
  const half = selectedHalf ?? (selection?.month === month ? selection.half : defaultHalf);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("storeId") === storeId && query.has("googleBusiness") && googleSettings.current) {
      googleSettings.current.open = true;
      googleSettings.current.scrollIntoView({ block: "start" });
    }
  }, [storeId]);

  return (
    <section id="store-business-hours" tabIndex={-1} className={styles.section} aria-labelledby="store-business-hours-title">
      <div className={styles.heading}>
        <h3 id="store-business-hours-title">{t("店舗営業時間")}</h3>
        <label className="store-context-selector is-os is-compact">
          <span>{t("営業日カレンダーの対象期間")}</span>
          <select value={half} onChange={(event) => {onClearDate?.();setSelection({ month, half: event.target.value });}}>
            <option value="first_half">{t("上半月")}</option>
            <option value="second_half">{t("下半月")}</option>
          </select>
        </label>
      </div>
      <ScheduleConfirmation
        key={`${month}-${half}`}
        storeId={storeId}
        periodKey={`${month}-${half}`}
        refreshKey={refreshKey}
        selectedDate={selectedDate}
        onDays={onDays}
        onChanged={() => setCalendarRevision((revision) => revision + 1)}
      />
      <details id="google-business-settings" className={styles.googleSettings} ref={googleSettings}>
        <summary>{t("Google 連携設定")}</summary>
        <GoogleBusinessHours storeId={storeId} refreshKey={`${refreshKey}:${calendarRevision}`} />
      </details>
    </section>
  );
}
