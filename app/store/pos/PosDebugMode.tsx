"use client";

import { useOsTranslation } from "../../os/components/OsTranslationProvider";
import styles from "./PosDebugMode.module.css";

export type PosDebugResult = {
  number: string;
  storeName: string;
  orderType: string;
  paymentLabel: string;
  subtotal: number;
  discount: number;
  tax: number;
  taxRate: number;
  taxIncluded: boolean;
  total: number;
  tendered: number | null;
  change: number | null;
  note: string;
  items: Array<{ key: string; name: string; quantity: number; amount: number; weight: string; options: string; note: string }>;
};

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

export function PosDebugBanner({ onExit, compact = false }: { onExit: () => void; compact?: boolean }) {
  const { t } = useOsTranslation();
  return <div className={`${styles.banner} ${compact ? styles.compact : ""}`} data-pos-debug-banner role="note">
    <div><strong>{t("テストモード")}</strong><span>{t("保存なし・実際の決済なし")}</span>
      {!compact ? <small>{t("開店確認は不要です。入力・テスト結果はこの画面内だけで、終了・再読込すると消えます。")}</small> : null}
    </div>
    <button type="button" className="secondary-button" data-pos-debug-exit onClick={onExit}>{t("テストを終了")}</button>
  </div>;
}

/** Display-only data: this component has no network, storage or printer integration. */
export function PosDebugResultPreview({ result, onClear }: { result: PosDebugResult; onClear: () => void }) {
  const { t } = useOsTranslation();
  return <section className={styles.result} data-pos-debug-result aria-label={t("テスト結果")}>
    <header><div><strong>{t("テスト・未会計")}</strong><span>{result.number}</span></div>
      <button type="button" className="secondary-button" data-pos-debug-clear onClick={onClear}>{t("結果を閉じる")}</button></header>
    <p>{t("画面上の確認用です。注文・売上・厨房伝票は作成されません。")}</p>
    <div className={styles.meta}><span>{result.storeName}</span><span>{t(result.orderType)} / {t(result.paymentLabel)}</span></div>
    <div className={styles.lines}>{result.items.map((item, index) => <div className={styles.line} key={`${item.key}:${index}`}>
      <div><strong>{item.name} × {item.quantity}</strong>{item.weight ? <small>{item.weight}</small> : null}
        {item.options ? <small>{item.options}</small> : null}{item.note ? <small>{item.note}</small> : null}</div>
      <span>{yen(item.amount)}</span>
    </div>)}</div>
    {result.note ? <p>{t("メモ")}: {result.note}</p> : null}
    <dl className={styles.totals}>
      <dt>{t("小計")}</dt><dd>{yen(result.subtotal)}</dd>
      {result.discount > 0 ? <><dt>{t("割引")}</dt><dd>−{yen(result.discount)}</dd></> : null}
      <dt>{t(result.taxIncluded ? "内消費税" : "消費税")} {result.taxRate}%</dt><dd>{yen(result.tax)}</dd>
      <dt>{t("テスト合計")}</dt><dd><strong>{yen(result.total)}</strong></dd>
      {result.tendered !== null ? <><dt>{t("お預かり")}</dt><dd>{yen(result.tendered)}</dd><dt>{t("お釣り")}</dt><dd>{yen(result.change ?? 0)}</dd></> : null}
    </dl>
  </section>;
}
