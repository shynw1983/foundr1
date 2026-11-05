"use client";

import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import type { PosCampaignFields } from "../../../lib/pos-discount-campaigns";
import type { PosGiftItem } from "../../../lib/pos-bowl-benefits";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosGiftSelector.module.css";

type Props = { value: PosCampaignFields; gifts: PosGiftItem[]; disabled: boolean; onChange: (patch: PosCampaignFields) => void };
type GiftGroup = { key: string; name: string; option: boolean; brandId: string; category: string; id: string; rows: PosGiftItem[] };
const unique = (ids: string[]) => [...new Set(ids)];

export function PosGiftSelector({ value, gifts, disabled, onChange }: Props) {
  const { t } = useOsTranslation();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const eligible = gifts.filter(g => g.available && g.fixed && !g.requiresOptions && Number.isSafeInteger(g.price) && g.price >= 0);
  const groups = new Map<string, GiftGroup>();
  const giftGroups = new Map<string, GiftGroup>();
  for (const gift of eligible) {
    const option = gift.kind === "option";
    const key = option ? `option:${gift.groupId}` : JSON.stringify([gift.brandId, gift.category]);
    if (!groups.has(key)) groups.set(key, { key, name: (option ? gift.groupName : gift.category) || t("未分類"), option, brandId: gift.brandId, category: gift.category, id: gift.groupId || "", rows: [] });
    const group = groups.get(key)!;
    group.rows.push(gift);
    giftGroups.set(gift.id, group);
  }
  const allGroups = [...groups.values()];
  const wholeGroup = (group: GiftGroup) => group.option
    ? (value.giftOptionGroupIds || []).includes(group.id)
    : (value.giftCategories || []).some(c => c.brandId === group.brandId && c.category === group.category);
  const groupFor = (gift: PosGiftItem) => giftGroups.get(gift.id)!;
  const selected = (gift: PosGiftItem) => wholeGroup(groupFor(gift)) || (gift.kind === "option" ? (value.giftOptionIds || []).includes(gift.optionId!) : (value.giftItemIds || []).includes(gift.id));
  const chosen = eligible.filter(selected);
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  const visible = allGroups.map(group => ({ ...group, visibleRows: group.rows.filter(gift => (!selectedOnly || selected(gift)) && (!needle || `${group.name} ${gift.name}`.normalize("NFKC").toLocaleLowerCase().includes(needle))) })).filter(group => group.visibleRows.length);
  const missingItems = (value.giftItemIds || []).filter(id => !eligible.some(g => g.kind !== "option" && g.id === id));
  const missingOptions = (value.giftOptionIds || []).filter(id => !eligible.some(g => g.kind === "option" && g.optionId === id));
  const missingCategories = (value.giftCategories || []).filter(c => !allGroups.some(g => !g.option && g.brandId === c.brandId && g.category === c.category));
  const missingGroups = (value.giftOptionGroupIds || []).filter(id => !allGroups.some(g => g.option && g.id === id));
  const missingCount = missingItems.length + missingOptions.length + missingCategories.length + missingGroups.length;
  const changeWhole = (group: GiftGroup, checked: boolean) => {
    if (group.option) onChange({ giftOptionGroupIds: checked ? unique([...(value.giftOptionGroupIds || []), group.id]) : (value.giftOptionGroupIds || []).filter(id => id !== group.id), giftOptionIds: (value.giftOptionIds || []).filter(id => !group.rows.some(g => g.optionId === id)) });
    else onChange({ giftCategories: [...(value.giftCategories || []).filter(c => c.brandId !== group.brandId || c.category !== group.category), ...(checked ? [{ brandId: group.brandId, category: group.category }] : [])], giftItemIds: (value.giftItemIds || []).filter(id => !group.rows.some(g => g.id === id)) });
  };
  const changeItem = (gift: PosGiftItem, checked: boolean) => {
    const group = groupFor(gift), whole = wholeGroup(group);
    if (group.option) onChange({
      giftOptionGroupIds: whole && !checked ? (value.giftOptionGroupIds || []).filter(id => id !== group.id) : value.giftOptionGroupIds || [],
      giftOptionIds: unique([...(value.giftOptionIds || []).filter(id => id !== gift.optionId), ...(whole && !checked ? group.rows.filter(g => g.id !== gift.id).map(g => g.optionId!) : checked ? [gift.optionId!] : [])])
    });
    else onChange({
      giftCategories: whole && !checked ? (value.giftCategories || []).filter(c => c.brandId !== group.brandId || c.category !== group.category) : value.giftCategories || [],
      giftItemIds: unique([...(value.giftItemIds || []).filter(id => id !== gift.id), ...(whole && !checked ? group.rows.filter(g => g.id !== gift.id).map(g => g.id) : checked ? [gift.id] : [])])
    });
  };
  const clear = () => onChange({ giftItemIds: [], giftCategories: [], giftOptionIds: [], giftOptionGroupIds: [] });
  return <section className={styles.selector} data-pos-gift-catalog aria-label={t("プレゼントの対象を選択")}>
    <div className={styles.toolbar}>
      <label className={styles.search} htmlFor={searchId}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>{t("商品名・グループ名で検索")}</span><input id={searchId} type="search" data-pos-gift-search value={query} onChange={event => setQuery(event.target.value)} placeholder={t("商品名・グループ名で検索")} /></label>
      <label className={styles.filter}><input type="checkbox" data-pos-gift-selected-only checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} />{t("選択済みだけ表示")}</label>
    </div>
    <div className={styles.layout}>
      <div className={styles.candidates} data-pos-gift-candidates>
        <p className={styles.hint}>{t("各項目を直接選択できます。全体選択は、今後追加する項目も対象になります。")}</p>
        {visible.map(group => <section key={group.key} className={styles.group} data-pos-gift-group={group.key}>
          <header><div><span className={styles.source}>{t(group.option ? "選択肢" : "商品")}</span><strong>{group.name}</strong><span className={styles.count}>{group.rows.filter(selected).length} / {group.rows.length}</span></div>
            <label className={styles.whole}><input type="checkbox" data-pos-gift-option-group={group.option ? group.id : undefined} data-pos-gift-category={!group.option ? "" : undefined} checked={wholeGroup(group)} disabled={disabled} onChange={event => changeWhole(group, event.target.checked)} /><span>{t("全体（今後の追加も含む）")}</span></label>
          </header>
          <div className={styles.items}>{group.visibleRows.map(gift => <label key={gift.id} className={`${styles.item} ${selected(gift) ? styles.checked : ""}`}>
            <input type="checkbox" data-pos-gift-item={gift.kind !== "option" ? gift.id : undefined} data-pos-gift-option={gift.kind === "option" ? gift.optionId : undefined} checked={selected(gift)} disabled={disabled} onChange={event => changeItem(gift, event.target.checked)} />
            <span>{gift.name}</span><small>¥{gift.price.toLocaleString("ja-JP")}</small>
          </label>)}</div>
        </section>)}
        {!visible.length ? <p className={styles.empty}>{t(selectedOnly ? "選択済みの対象はありません。" : "一致する対象がありません。検索条件を変更してください。")}</p> : null}
      </div>
      <aside className={styles.review} aria-label={t("選択内容の確認")}>
        <header><div><strong>{t("選択済み")}</strong><span data-pos-gift-selected-count aria-live="polite">{chosen.length}{t("点")}</span></div><button type="button" className="text-button" data-pos-gift-clear disabled={disabled || (!chosen.length && !missingCount)} onClick={clear}>{t("すべて解除")}</button></header>
        <p className={styles.hint}>{t("この中から1杯につき1点を選んで贈ります。")}</p>
        <div className={styles.chosen} data-pos-gift-summary>
          {allGroups.filter(wholeGroup).map(group => <div className={styles.groupChoice} key={group.key}><span>{group.name}<small>{t("グループ全体・追加分も対象")}</small></span><button type="button" disabled={disabled} onClick={() => changeWhole(group, false)} aria-label={`${group.name} ${t("全体を解除")}`}><X size={15} aria-hidden="true" /></button></div>)}
          {chosen.map(gift => <div className={styles.chosenItem} key={gift.id}><span><small>{t(gift.kind === "option" ? "選択肢" : "商品")} · {groupFor(gift).name}</small>{gift.name}</span><button type="button" data-pos-gift-remove={gift.id} disabled={disabled} onClick={() => changeItem(gift, false)} aria-label={`${gift.name} ${t("解除")}`}><X size={16} aria-hidden="true" /></button></div>)}
          {missingCount ? <p className={styles.warning}>{t("現在選べない設定があります。不要なものを解除してください。")}</p> : null}
          {missingItems.map(id => <Unavailable key={`p:${id}`} name={`${t("現在選べない商品")} (${id})`} disabled={disabled} remove={() => onChange({ giftItemIds: (value.giftItemIds || []).filter(v => v !== id) })} />)}
          {missingOptions.map(id => <Unavailable key={`o:${id}`} name={`${t("現在選べない選択肢")} (${id})`} disabled={disabled} remove={() => onChange({ giftOptionIds: (value.giftOptionIds || []).filter(v => v !== id) })} />)}
          {missingCategories.map(c => <Unavailable key={JSON.stringify(c)} name={`${c.category} · ${t("現在選べる商品なし")}`} disabled={disabled} remove={() => onChange({ giftCategories: (value.giftCategories || []).filter(v => v.brandId !== c.brandId || v.category !== c.category) })} />)}
          {missingGroups.map(id => <Unavailable key={id} name={`${t("現在選べない選択肢グループ")} (${id})`} disabled={disabled} remove={() => onChange({ giftOptionGroupIds: (value.giftOptionGroupIds || []).filter(v => v !== id) })} />)}
          {!chosen.length && !missingCount ? <p className={styles.empty}>{t("左の一覧から贈る対象を選択してください。")}</p> : null}
        </div>
        <p className={styles.hint}>{t("全体選択から1点外すと、残りは個別選択に切り替わります。")}</p>
      </aside>
    </div>
  </section>;
}
function Unavailable({ name, disabled, remove }: { name: string; disabled: boolean; remove: () => void }) {
  const { t } = useOsTranslation();
  return <div className={styles.chosenItem} data-pos-gift-unavailable><span>{name}</span><button type="button" disabled={disabled} onClick={remove} aria-label={`${name} ${t("解除")}`}><X size={16} aria-hidden="true" /></button></div>;
}
