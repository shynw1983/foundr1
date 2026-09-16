"use client";

import "./read-status-notice.css";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";

export function ReadStatusNotice({ state, onRetry, language: explicitLanguage }: {
  state: { failed: boolean; refreshing: boolean; lastSuccessAt: string };
  onRetry: () => void;
  language?: string;
}) {
  const { language: uiLanguage } = useOsTranslation();
  const language = explicitLanguage || uiLanguage;
  if (!state.failed) return null;
  const text = (ja: string, cn: string, tw = cn) => language === "zh-Hant" ? tw : language.startsWith("zh") ? cn : ja;
  return <aside className="read-status-notice" role="alert" data-i18n-ignore>
    <div><strong>{text("情報を更新できません。再取得しています。", "信息更新失败，正在重试。", "資訊更新失敗，正在重試。")}</strong>
      {state.lastSuccessAt ? <small>{text("最終取得", "最后成功更新", "最後成功更新")} {new Date(state.lastSuccessAt).toLocaleTimeString(language, { timeZone: "Asia/Tokyo" })}</small> : null}
    </div>
    <button className="secondary-button" type="button" disabled={state.refreshing} onClick={onRetry}>{text("再取得", "重新获取", "重新取得")}</button>
  </aside>;
}
