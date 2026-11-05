"use client";

import { useEffect, useMemo, useState } from "react";
import { getDineInEffectiveItemGroupIds, getDineInGroupItemIds, type StoreDineInCatalog } from "../../../lib/store-dine-in-menu-policy";
import { useOsTranslation } from "../components/OsTranslationProvider";
import type { DineInMenuCommand } from "./DineInMenuComposer";
import styles from "./DineInMenuEditor.module.css";

type Row = { id: string; name: string; search: string; context: string; visible: boolean };
type Props = { catalog: StoreDineInCatalog; targetId: string; disabled: boolean; completionId: string; onSubmit: (command: DineInMenuCommand) => Promise<unknown> };

function AssociationPicker({ rows, currentIds, mode, targetId, disabled, completionId, onSubmit }: Props & {
  rows: Row[]; currentIds: string[]; mode: "item" | "group";
}) {
  const { t } = useOsTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [ids, setIds] = useState(currentIds);
  const signature = currentIds.join(":");
  useEffect(() => { setIds(signature ? signature.split(":") : []); }, [signature, targetId, completionId]);
  useEffect(() => { setQuery(""); setFilter("all"); }, [targetId]);
  const current = useMemo(() => new Set(currentIds), [signature]);
  const selected = new Set(ids);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => (!normalizedQuery || row.search.toLocaleLowerCase().includes(normalizedQuery))
    && (filter === "all" || (filter === "linked") === current.has(row.id)));
  const changed = ids.length !== currentIds.length || ids.some(id => !current.has(id));
  const prefix = `dine-in-association-${mode}-${targetId}`;
  const action = mode === "item" ? "setItemOptionGroups" : "setGroupItems";
  return <section className={styles.associations} data-dine-in-item-groups={mode === "item" ? targetId : undefined} data-dine-in-group-items={mode === "group" ? targetId : undefined}>
    <h4>{t(mode === "item" ? "使用する選択グループ" : "このグループを使う商品")}</h4>
    <p className={styles.associationCount}><span data-association-current-count={currentIds.length}>{t(mode === "item" ? "現在 {count} グループに関連付け" : "現在 {count} 商品に関連付け", { count: currentIds.length })}</span><span data-association-draft-count={ids.length}>{t("選択中 {count} 件", { count: ids.length })}{changed ? ` · ${t("未保存")}` : ""}</span></p>
    <p className={styles.help}>{t("チェックして保存すると関連付けを更新します。チェックを外してもグループ・選択肢・商品自体は削除しません。")}</p>
    <p className={styles.help}>{t(mode === "item" ? "同じグループを選ぶと共用します。商品ごとに別の内容にしたい場合は、グループを取り込んで独立したコピーを作成してください。" : "このグループの名前・選択肢・価格・選び方の変更は、関連付けたすべての商品に反映します。独立したコピーは変更しません。")}</p>
    {mode === "group" && !currentIds.length ? <p className={styles.help}>{t("関連付けが0件でもグループは残ります。使う商品を選んで保存すると、その商品の選択肢として使用できます。")}</p> : null}
    <form className={styles.creationForm} onSubmit={event => {
      event.preventDefault();
      if (disabled || !changed) return;
      void onSubmit(mode === "item" ? { action, targetId, groupIds: ids } : { action, targetId, itemIds: ids });
    }}>
      <div className={styles.formColumns}>
        <label htmlFor={`${prefix}-search`}>{t(mode === "item" ? "選択グループを検索" : "商品を検索")}<input id={`${prefix}-search`} type="search" data-association-search value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder={t("名前・関連する商品で検索")} /></label>
        <label htmlFor={`${prefix}-filter`}>{t("関連付けの状態")}<select id={`${prefix}-filter`} data-association-filter value={filter} disabled={disabled} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">{t("すべて")}</option><option value="linked">{t("関連付け済み")}</option><option value="unlinked">{t("未関連")}</option></select></label>
      </div>
      <div className={styles.associationChoices}>{filtered.map(row => <label key={row.id} className={styles.addonChoice}>
        <input type="checkbox" data-association-id={row.id} checked={selected.has(row.id)} disabled={disabled} onChange={event => {
          const checked = event.target.checked; setIds(previous => checked ? [...previous, row.id] : previous.filter(id => id !== row.id));
        }} />
        <span>{row.name}<small className={styles.choiceHint}>{row.context}</small></span>
        {!row.visible ? <small>{t(mode === "item" ? "グループ非公開" : "POS 非公開")}</small> : null}
      </label>)}</div>
      {!filtered.length ? <p className={styles.help}>{t(mode === "item" ? "該当する選択グループがありません。" : "該当する商品がありません。")}</p> : null}
      {mode === "item" ? <p className={styles.help}>{t("非表示のグループは、関連付けても POS に表示されません。選ぶ順番は「この商品の選択グループの表示順」で変更できます。")}</p> : null}
      <button type="submit" className="secondary-button compact-button" data-dine-in-action={action} disabled={disabled || !changed}>{t("関連付けを保存")}</button>
    </form>
  </section>;
}

export function DineInItemGroupsEditor(props: Props) {
  const { t } = useOsTranslation();
  const item = props.catalog.items.find(item => item.id === props.targetId);
  const consumers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const product of props.catalog.items) for (const groupId of getDineInEffectiveItemGroupIds(props.catalog, product.id)) {
      const current = map.get(groupId) || []; current.push(product.name); map.set(groupId, current);
    }
    return map;
  }, [props.catalog]);
  if (!item) return null;
  const rows = props.catalog.optionGroups.filter(group => group.brandId === item.brandId).map(group => {
    const names = consumers.get(group.id) || [];
    const context = `${t("選択肢 {count} 件", { count: group.options.length })} · ${names.length ? names.join(" / ") : t("未関連")}`;
    return { id: group.id, name: group.name, context, visible: group.visible, search: `${group.name} ${group.sourceName} ${names.join(" ")}` };
  });
  return <AssociationPicker {...props} rows={rows} currentIds={getDineInEffectiveItemGroupIds(props.catalog, item.id)} mode="item" />;
}

export function DineInGroupItemsEditor(props: Props) {
  const { t } = useOsTranslation();
  const group = props.catalog.optionGroups.find(group => group.id === props.targetId);
  if (!group) return null;
  const items = props.catalog.items.filter(item => item.brandId === group.brandId);
  const currentIds = getDineInGroupItemIds(props.catalog, group.id);
  const rows = items.map(item => ({ id: item.id, name: item.name, visible: item.visible, context: item.category || t("未分類"), search: `${item.name} ${item.sourceName} ${item.category}` }));
  return <AssociationPicker {...props} rows={rows} currentIds={currentIds} mode="group" />;
}
