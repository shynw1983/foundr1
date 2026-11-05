"use client";

import { useOsTranslation } from "../components/OsTranslationProvider";
import { weekdayKeys, weekdayLabels, type StoreBusinessHours, type WeekdayKey } from "../../../lib/store-business-hours";
import businessHoursStyles from "./business-hours.module.css";

export function BusinessHoursEditor({
  value,
  onChange
}: {
  value: StoreBusinessHours;
  onChange: (value: StoreBusinessHours) => void;
}) {
  const { t } = useOsTranslation();

  function updateDay(day: WeekdayKey, patch: Partial<StoreBusinessHours[WeekdayKey]>) {
    onChange({
      ...value,
      [day]: {
        ...value[day],
        ...patch
      }
    });
  }

  return (
    <div className={businessHoursStyles.editor} data-i18n-ignore>
      <span>{t("営業時間")}</span>
      <div className={businessHoursStyles.grid}>
        {weekdayKeys.map((day) => (
          <div className={businessHoursStyles.row} key={day} data-business-hours-day={day}>
            <div className={businessHoursStyles.dayControls}>
              <span className={businessHoursStyles.weekday}>{t(`${weekdayLabels[day]}曜日`)}</span>
              <label className={businessHoursStyles.choice}>
                <input
                  type="checkbox"
                  checked={value[day].closed}
                  onChange={(event) => updateDay(day, { closed: event.target.checked, ...(event.target.checked ? { open24Hours: false } : {}) })}
                  aria-label={t("{day} 休業", { day: t(`${weekdayLabels[day]}曜日`) })}
                />
                {t("休業")}
              </label>
              <label className={businessHoursStyles.choice}>
                <input
                  type="checkbox"
                  checked={value[day].open24Hours === true && !value[day].closed}
                  onChange={(event) => updateDay(day, { open24Hours: event.target.checked, ...(event.target.checked ? { closed: false } : {}) })}
                  aria-label={t("{day} 24時間営業", { day: t(`${weekdayLabels[day]}曜日`) })}
                />
                {t("24時間営業")}
              </label>
            </div>
            <input
              className={businessHoursStyles.time}
              type="time"
              value={value[day].open}
              disabled={value[day].closed || value[day].open24Hours === true}
              onChange={(event) => updateDay(day, { open: event.target.value })}
              aria-label={t("{day} 開店時間", { day: t(`${weekdayLabels[day]}曜日`) })}
            />
            <input
              className={businessHoursStyles.time}
              type="time"
              value={value[day].close}
              disabled={value[day].closed || value[day].open24Hours === true}
              onChange={(event) => updateDay(day, { close: event.target.value })}
              aria-label={t("{day} 閉店時間", { day: t(`${weekdayLabels[day]}曜日`) })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
