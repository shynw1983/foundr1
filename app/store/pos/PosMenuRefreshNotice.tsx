"use client";

import { RefreshCw } from "lucide-react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import styles from "./PosMenuRefreshNotice.module.css";

export function PosMenuRefreshNotice({ available, error, checking, blocked, hasDraft, onRefresh }: {
  available: boolean; error: string; checking: boolean; blocked: boolean; hasDraft: boolean; onRefresh: () => void;
}) {
  const { t } = useOsTranslation();
  if (!available && !error) return null;
  return <div className={styles.notice} role={error ? "alert" : "status"} data-pos-menu-update>
    <div>
      <p>{t(error || "メニューが更新されました。現在の会計は自動で変更しません。")}</p>
      {available && hasDraft ? <p>{t("更新すると未会計の商品と選択内容をクリアします。商品を選び直してください。")}</p> : null}
      {blocked ? <p>{t("会計や処理が完了してから、メニューを更新してください。")}</p> : null}
    </div>
    <button type="button" className="secondary-button" data-pos-menu-refresh disabled={checking || blocked} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" />{t(checking ? "更新確認中…" : "メニューを更新")}</button>
  </div>;
}
