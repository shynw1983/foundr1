"use client";

import { useEffect, useState } from "react";
import { isPosBowl } from "../../../lib/pos-serving-policy";
import { resolveDineInItemFulfillmentMode, type StoreDineInCatalog, type StoreDineInChange } from "../../../lib/store-dine-in-menu-policy";
import type { PosItemFulfillmentMode } from "../../../lib/pos-item-fulfillment";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./DineInMenuEditor.module.css";

type Choice = PosItemFulfillmentMode | "inherit";
export function DineInFulfillmentSettings({ catalog, kind, targetId, disabled, onSubmit }: {
  catalog: StoreDineInCatalog;
  kind: "item" | "category";
  targetId: string;
  disabled: boolean;
  onSubmit: (command: Omit<StoreDineInChange, "operationId" | "revision">) => Promise<unknown>;
}) {
  const { t } = useOsTranslation();
  const item = kind === "item" ? catalog.items.find(item => item.id === targetId) : undefined;
  const category = kind === "category" ? catalog.categories.find(category => category.id === targetId) : undefined;
  const target = item || category;
  const saved = target?.fulfillmentMode || "inherit";
  const [choice, setChoice] = useState<Choice>(saved);
  useEffect(() => { setChoice(saved); }, [saved, kind, targetId]);
  if (!target) return null;
  const requiresCooking = item ? isPosBowl(item) : catalog.items.some(item => item.brandId === category!.brandId && item.category === category!.name && isPosBowl(item));
  const effective = item ? resolveDineInItemFulfillmentMode(catalog, item) : category!.fulfillmentMode || "prepare";
  const invalidChoice = choice === "immediate" && requiresCooking;
  return <form className={styles.form} data-dine-in-fulfillment-form onSubmit={event => {
    event.preventDefault();
    if (!disabled && !invalidChoice && choice !== saved) void onSubmit({ action: "setFulfillmentMode", kind, targetId, fulfillmentMode: choice });
  }}>
    <label htmlFor="dine-in-edit-fulfillment">{t("提供方法")}<select id="dine-in-edit-fulfillment" data-dine-in-fulfillment value={choice} disabled={disabled} onChange={event => setChoice(event.target.value as Choice)}>
      <option value="inherit">{t(kind === "item" ? "分類設定を引継ぐ" : "通常（調理・呼出し）")}</option>
      <option value="prepare">{t("調理・呼出し")}</option>
      <option value="immediate" disabled={requiresCooking}>{t("会計時にお渡し")}</option>
    </select></label>
    <p data-dine-in-fulfillment-effective>{t("現在の提供方法")}: <strong>{t(effective === "immediate" ? "会計時にお渡し" : "調理・呼出し")}</strong></p>
    {kind === "category" ? <p>{t("分類の設定は、この分類の商品に引き継がれます。商品ごとに変更できます。")}</p> : null}
    <p>{t("会計時にお渡しの商品は、提供待ち・呼出画面・調理用伝票に表示しません。レシートには表示します。")}</p>
    <p>{t("店頭POSの提供方法だけを変更します。Webサイト・外部デリバリー・過去の注文は変わりません。")}</p>
    {requiresCooking ? <p role="status">{t(kind === "item" ? "1杯ごとに調理する商品は、調理・呼出しで提供してください。" : "1杯ごとに調理する商品を含む分類は、会計時のお渡しに変更できません。")}</p> : null}
    <button type="submit" className="secondary-button compact-button" data-dine-in-action="setFulfillmentMode" disabled={disabled || invalidChoice || choice === saved}>{t("提供方法を保存")}</button>
  </form>;
}
