"use client";
import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { posGiftAllowed, type PosGiftItem } from "../../../lib/pos-bowl-benefits";
import type { PosDiscountRule } from "../../../lib/pos-discount-campaigns";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosDiscountCard.module.css";

type Preset = PosDiscountRule & { displayNames?: Record<string,string> };
type Translate = (key: string) => string;
function benefit(preset: Preset, t: Translate) {
  const discount = preset.discountType === "percent" ? `${preset.discountValue}%OFF` : `¥${preset.discountValue.toLocaleString("ja-JP")} OFF`;
  if (preset.applicationMode !== "campaign" || preset.campaignBasis !== "bowl_choice" || preset.bowlBenefitMode === "discount_only") return discount;
  return preset.bowlBenefitMode === "gift_only" ? t("プレゼントのみ") : `${discount} / ${t("プレゼント")}`;
}
function condition(preset: Preset, t: Translate) {
  if (preset.applicationMode !== "campaign") return preset.targetScope === "all" ? t("全商品") : preset.targetValue;
  return `${t(preset.campaignBasis === "bowl_choice" ? "1杯" : "会計全体")} · ¥${Number(preset.minimumSubtotal || 0).toLocaleString("ja-JP")}${t("以上")}${preset.targetScope !== "all" && preset.targetValue ? ` · ${preset.targetValue}` : ""}`;
}
export function discountMatches(preset: Preset, query: string, status: string, t: Translate = text => text) {
  if (status === "enabled" && !preset.enabled || status === "disabled" && preset.enabled) return false;
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase().replace(/,/g, "");
  return !needle || [preset.name, ...Object.values(preset.displayNames || {}), condition(preset,t), benefit(preset,t), preset.startsOn, preset.endsOn].join(" ").normalize("NFKC").toLocaleLowerCase().replace(/,/g, "").includes(needle);
}
export function PosDiscountCard({preset,gifts,open,dirty,disabled,onToggle,onEnabled,children}: {preset:Preset;gifts:PosGiftItem[];open:boolean;dirty:boolean;disabled:boolean;onToggle:()=>void;onEnabled:(value:boolean)=>void;children:ReactNode}) {
  const {t}=useOsTranslation(), id=useId();
  const mode = preset.applicationMode !== "campaign" ? t("手動割引") : t(preset.campaignBasis === "bowl_choice" ? "1杯ごとの特典" : "自動キャンペーン");
  const detail = `${condition(preset,t)} · ${benefit(preset,t)}${preset.bowlDefaultChoice === "discount" && preset.bowlBenefitMode !== "gift_only" ? ` · ${t("割引を自動選択")}` : ""}`;
  const hasGift = preset.applicationMode === "campaign" && preset.campaignBasis === "bowl_choice" && preset.bowlBenefitMode !== "discount_only";
  const giftCount = hasGift ? gifts.filter(gift=>posGiftAllowed(preset,gift)).length : 0;
  const period = preset.applicationMode !== "campaign" ? t("スタッフが選択") : !preset.startsOn && !preset.endsOn ? t("期間なし") : `${preset.startsOn || "—"} 〜 ${preset.endsOn || "—"}`;
  return <article className={`${styles.card} ${open?styles.open:""}`} data-pos-discount-key={preset.key}>
    <header className={styles.header}>
      <label className={`pos-admin-discount-enabled ${styles.enabled}`}><input type="checkbox" checked={preset.enabled} disabled={disabled} onChange={event=>onEnabled(event.target.checked)} /><span>{t(preset.enabled?"有効":"停止中")}</span></label>
      <button type="button" className={styles.toggle} data-pos-discount-toggle aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className={styles.info}><span className={styles.name}>{preset.name || t("名称未入力")}<small>{mode}</small>{dirty?<em data-pos-discount-dirty>{t("未保存")}</em>:null}</span><span className={styles.detail} title={detail}>{detail}{hasGift?` · ${t("プレゼント候補")} ${giftCount}${t("点")}`:""}</span><span className={styles.period}>{period}</span></span>
        <span className={styles.action}>{t(open?"閉じる":"編集")}{open?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</span>
      </button>
    </header>
    <div id={id} className={styles.body} hidden={!open}>{open?children:null}</div>
  </article>;
}
