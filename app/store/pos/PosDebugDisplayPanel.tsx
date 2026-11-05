"use client";

import { useEffect, useState } from "react";
import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import { isPosDebugId } from "../../../lib/pos-debug-display";
import type { PosDebugDisplayStatus } from "./usePosDebugDisplay";
import styles from "./PosDebugMode.module.css";

export function PosDebugDisplayPanel({ storeId, sessionId, status, error, onRetry }: {
  storeId: string; sessionId: string; status: PosDebugDisplayStatus; error: string; onRetry: () => void;
}) {
  const { t } = useOsTranslation();
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    let active = true;
    setUrl(""); setQr(""); setCopyStatus("");
    if (!isPosDebugId(storeId) || !isPosDebugId(sessionId)) return;
    const target = new URL("/store/pos/customer-display/debug", location.origin);
    target.searchParams.set("storeId", storeId); target.searchParams.set("sessionId", sessionId);
    setUrl(target.toString());
    void import("qrcode").then(module => module.toDataURL(target.toString(), { width: 220, margin: 2 }))
      .then(value => { if (active) setQr(value); }).catch(() => { if (active) setCopyStatus(t("QRコードを表示できません。リンクを使用してください。")); });
    return () => { active = false; };
  }, [storeId, sessionId, t]);
  const label = status === "connected" ? "テスト客席表示：接続済み" : status === "connecting" ? "テスト客席表示：接続中"
    : status === "disconnected" || status === "error" ? "テスト客席表示：未接続" : "テスト客席表示：接続待ち";
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopyStatus(t("リンクをコピーしました。")); }
    catch { setCopyStatus(t("リンクを長押ししてコピーしてください。")); }
  }
  return <details className={styles.displayPanel} data-pos-debug-display-panel>
    <summary>{t(label)} <span>{t("客席表示を接続")}</span></summary>
    <p>{t("客席表示の端末で、この QR コードを読み取ってください。同じ店舗のアカウントでログインすると接続できます。")}</p>
    <p>{t("通常の客席表示とは別のテスト画面です。POS を再読込した場合は、新しい QR コードで接続してください。")}</p>
    <div className={styles.displayPairing}>
      {qr ? <img src={qr} width={220} height={220} alt={t("テスト客席表示への接続 QR コード")} /> : null}
      <div>{url ? <>
        <a className="secondary-button" data-pos-debug-display-link href={url} target="_blank" rel="noreferrer">{t("テスト客席表示を開く")}</a>
        <button type="button" className="secondary-button" onClick={() => void copy()}>{t("接続リンクをコピー")}</button>
      </> : null}
      {(status === "error" || status === "disconnected") ? <button type="button" className="secondary-button" onClick={onRetry}>{t("再接続")}</button> : null}
      </div>
    </div>
    {error ? <p role="alert">{t(error)}</p> : null}
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
  </details>;
}
