"use client";

import "./read-status-notice.css";
import { useOsTranslation } from "../app/os/components/OsTranslationProvider";

export function ReadStatusNotice({ state, onRetry, language: explicitLanguage }: {
  state: { failed: boolean; refreshing: boolean; lastSuccessAt: string; failureStatus?: number };
  onRetry: () => void;
  language?: string;
}) {
  const { language: uiLanguage } = useOsTranslation();
  const language = explicitLanguage || uiLanguage;
  if (!state.failed) return null;
  const text = (ja: string, cn: string, tw = cn) => language === "zh-Hant" ? tw : language.startsWith("zh") ? cn : ja;
  const denied = state.failureStatus === 401 || state.failureStatus === 403;
  return <aside className="read-status-notice" role="alert" data-i18n-ignore>
    <div><strong>{denied
      ? text("ログイン・権限を確認してください。自動更新を停止しました。", "请确认登录状态和权限，自动更新已停止。", "請確認登入狀態和權限，自動更新已停止。")
      : text("情報を更新できません。再取得しています。", "信息更新失败，正在重试。", "資訊更新失敗，正在重試。")}</strong>
      {state.lastSuccessAt ? <small>{text("最終取得", "最后成功更新", "最後成功更新")} {new Date(state.lastSuccessAt).toLocaleTimeString(language, { timeZone: "Asia/Tokyo" })}</small> : null}
    </div>
    <button className="secondary-button" type="button" disabled={state.refreshing} onClick={denied ? () => window.location.reload() : onRetry}>{denied ? text("ページを再読み込み", "重新载入页面", "重新載入頁面") : text("再取得", "重新获取", "重新取得")}</button>
  </aside>;
}
