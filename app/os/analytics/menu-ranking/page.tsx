"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { AnalyticsShell } from "../components/AnalyticsShell";
import { useOsTranslation } from "../../components/OsTranslationProvider";
import { rankingPool, rankingOrders, rankingPosition, type MenuRanking, type RankingMain, type RankingMode, type RankingOption } from "../../../../lib/menu-ranking";
import styles from "./page.module.css";

const modes: [RankingMode, string][] = [["topping", "有料・任意トッピング"], ["noodle", "麺の選択・変更"], ["main", "主商品"], ["controls", "設定・その他"], ["all", "全選択肢"]];
const categories: Record<string, string> = {"配料与加料":"トッピング", "面条选择/更换":"麺の選択・変更", "汤底设定/辣麻/药膳":"辛さ・痺れ・薬膳設定", "份量设定":"量の設定", "最低订单金额确认":"最低注文金額の確認", "风味增强":"風味の追加", "汤底选择（modifier）":"スープの選択", "饮料/其他附加选项":"ドリンク・その他", "汤底/主餐":"スープ・主食", "其他/历史选项":"その他・過去の選択肢"};
type Item = RankingOption | RankingMain;
const isOption = (p: Item): p is RankingOption => "category" in p;
const fmt = (v: number | null) => v === null ? "—" : v.toFixed(2) + "%";
const jst = (v: string | null | undefined) => v ? new Date(v).toLocaleString("ja-JP", {timeZone:"Asia/Tokyo", hour12:false}) + " JST" : "—";
export default function MenuRankingPage() {
  const {t} = useOsTranslation();
  const [data, setData] = useState<MenuRanking | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<RankingMode>("topping"), [query, setQuery] = useState(""), [membership, setMembership] = useState("all"), [sort, setSort] = useState("units"), [candidates, setCandidates] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {const controller = new AbortController();setError("");setData(null);
    fetch("/api/analytics/menu-ranking?month=2026-09", {cache:"no-store",signal:controller.signal}).then(async r => {const body = await r.json();if (!r.ok) throw new Error(body.error || "読み込みに失敗しました。");setData(body);}).catch(e => {if (e.name !== "AbortError") setError(e.message);});
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {if(selected && dialog.current && !dialog.current.open) dialog.current.showModal();}, [selected]);
  const pool = useMemo(() => data ? rankingPool(data, mode) : [], [data, mode]);
  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const list = pool.filter(p => (!q || [p.name,p.uber_id,...p.aliases].join(" ").toLocaleLowerCase().includes(q)) && (membership === "all" || (membership === "current" ? p.current_member : !p.current_member)) && (!candidates || (isOption(p) && p.candidate)));
    list.sort((a,b) => (sort === "orders" ? rankingOrders(b)-rankingOrders(a) : sort === "low" ? a.units-b.units : b.units-a.units) || a.uber_id.localeCompare(b.uber_id));
    const result: Record<string,Item[]> = {};
    for(const p of list) {const key = mode === "all" || mode === "controls" ? isOption(p) ? p.category : "主商品" : "";(result[key] ||= []).push(p);}
    return result;
  }, [pool,query,membership,sort,candidates,mode]);
  const visible = Object.values(groups).reduce((n,items) => n+items.length,0);
  const close = () => {dialog.current?.close();setSelected(null);};
  const badge = (p: Item) => <span className={styles.badges}><span>{t(p.current_member ? "現在のカタログ" : "過去のカタログのみ")}</span>{p.stockout_warning && <span>{t("9月の欠品証拠あり")}</span>}{isOption(p) && p.short_exposure_warning && <span>{t("月内に所属を初観測")}</span>}{isOption(p) && p.candidate && <span>{t("低記録・要確認")}</span>}</span>;
  return <AnalyticsShell eyebrow="MENU RANKING" title={t("メニューランキング")} sourceLabel={t("2026年9月・検証済み保存スナップショット")}>
    <div className={styles.page}>
      <div className={styles.context}><strong data-i18n-ignore>{data?.store.name || "—"}</strong><span>2026/9/1—9/30 JST · Uber Eats</span><span>{t("他の月は未接続・自動更新なし")}</span></div>
      <p className={styles.notice}>{data && <span>{data.summary.captured_orders} / {data.summary.noncancelled_orders} / {data.summary.cancelled_orders} · </span>}{t("捕獲注文／未キャンセル／キャンセル。全完了注文・全期間の網羅性は未確認。他プラットフォームは対象外で、データなしをゼロとして扱いません。")}</p>
      {error ? <div role="alert" className={styles.notice}><p>{t(error)}</p><button onClick={() => setRetry(n=>n+1)}>{t("再試行")}</button></div> : !data ? <p role="status">{t("読み込み中…")}</p> : <>
        <div className={styles.stats}>{[["9月のランキング対象",data.summary.september_or_current_rankable_count,`${data.summary.option_identity_count} ID · ${data.summary.preperiod_predecessor_count} ${t("旧IDは別記")}`],["現在の選択肢",data.summary.current_option_identity_count,`${data.summary.historical_only_option_identity_count} ${t("過去のみのID")}`],["有料・任意トッピング",data.summary.paid_optional_topping_identity_count,t("無料・必須設定と別比較")],["選択行の照合率",fmt(Number(data.summary.raw_modifier_match_rate_pct)),`${data.summary.matched_raw_modifier_rows} / ${data.summary.total_raw_modifier_rows} · ${t("注文網羅率ではない")}`]].map(([label,value,note])=><div key={String(label)}><span>{t(String(label))}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
        <h3>{t("有料・任意トッピング 上位5件（数量）")}</h3>
        <div className={styles.top}>{rankingPool(data,"topping").slice().sort((a,b)=>b.units-a.units).slice(0,5).map((p,i)=><button key={p.uber_id} onClick={()=>setSelected(p)}><small>#{i+1}</small><b data-i18n-ignore>{p.name.split(/[｜|]/)[0]}</b><strong>{p.units} <small>{t("個")}</small></strong><span>{rankingOrders(p)} {t("選択注文")}</span></button>)}</div>
        <section className={styles.ranking}>
          <div className={styles.tabs} role="group" aria-label={t("ランキング区分")}>{modes.map(([key,label])=><button key={key} aria-pressed={mode===key} onClick={()=>{setMode(key);setCandidates(false);}}>{t(label)} · {rankingPool(data,key).length}</button>)}</div>
          <div className={styles.tools}><label>{t("名称・過去名・ID検索")}<input type="search" value={query} placeholder={t("名称またはUber ID")} onChange={e=>setQuery(e.target.value)}/></label><label>{t("カタログ所属")}<select value={membership} onChange={e=>setMembership(e.target.value)}><option value="all">{t("現在と過去")}</option><option value="current">{t("現在のカタログ")}</option><option value="historical">{t("過去のカタログのみ")}</option></select></label><label>{t("区分内の並び順")}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="units">{t("数量の多い順")}</option><option value="orders">{t("選択注文の多い順")}</option><option value="low">{t("低記録から")}</option></select></label></div>
          <label className={styles.check}><input type="checkbox" checked={candidates} onChange={e=>{setCandidates(e.target.checked);if(e.target.checked)setMode("topping");}}/>{t("低選択の確認候補のみ（廃止リストではありません）")}</label>
          <p className={styles.help}>{t("数量＝主商品数量×選択肢数量。同一IDは所属グループを集約し、選択注文は重複除外。別IDは統合しません。順位は元の区分内順位を保持し、絞り込みで再採番しません。")}</p>
          <p aria-live="polite">{visible} / {pool.length} {t("件表示")}</p>
          {visible===0 && <p>{t("該当する項目はありません。")}</p>}
          {Object.entries(groups).map(([category,items])=><div key={category}>{category && <h3>{t(categories[category] || category)}</h3>}<div className={styles.rowHead}><span>{t("区分内順位・商品")}</span><span>{t("数量 / 選択注文")}</span><span>{t(mode==="main"?"捕獲注文の構成比":"歴史所属の代理選択率")}</span></div>{items.map(p=><button className={styles.row} key={p.uber_id} onClick={()=>setSelected(p)}><span className={styles.name}><small>#{rankingPosition(p,mode,sort,pool) ?? "—"}</small><span><b data-i18n-ignore>{p.name.split(/[｜|]/)[0]}</b><small data-i18n-ignore>{p.name.split(/[｜|]/).slice(1).join(" · ")}</small>{badge(p)}</span></span><span className={styles.amount}><b>{p.units}</b> {t("個")}<small>{rankingOrders(p)} {t("選択注文")}</small></span><span className={styles.rate}>{isOption(p)?fmt(p.option_rate_pct):fmt(p.share_of_captured_orders_pct)}<small>{isOption(p)?`${p.selecting_eligible_orders} / ${p.eligible_orders}`:`${p.orders} / ${data.summary.noncancelled_orders}`}</small></span></button>)}</div>)}
        </section>
        <details className={styles.method}><summary>{t("集計方法・未照合・データの制限")}</summary><p>{t("完全な履歴カタログ図は9/8以降です。代理率の分子は代理分母内の選択注文のみ。欠品時間や連続露出は未補正で、実際のコンバージョン率ではありません。")}</p><p>{t("ゼロは照合できた捕獲選択なしの意味です。全月の需要ゼロではありません。支払・調理状態は決済や履行の証明ではなく、売上・利益・リピート率は算出しません。再計算金額と保存総額の不一致があり、決済確認には利用できません。")}</p><p>{data.summary.matched_noncancelled_modifier_units} / {data.summary.unresolved_noncancelled_modifier_units} / {data.summary.matched_cancelled_modifier_units} · {t("照合済み数量／未照合数量／キャンセル数量。無料・必須設定の数量を有料配料の売上として比較しません。")}</p><p>{t("捕獲注文なしの日は営業状況や全注文なしの証明ではありません。保存カタログの状態はリアルタイム在庫ではありません。")} · {jst(String(data.summary.current_catalog_at))}</p><h4>{t("未照合の選択肢（順位から除外）")}</h4>{data.unresolved.map((p,i)=><p key={i} data-i18n-ignore>{p.name} · {p.units} / {p.orders} · {p.dates.join(", ")} · {p.reason}</p>)}<details><summary>{t("原資料の集計定義")}</summary>{Object.entries(data.methodology).map(([key,value])=><p key={key} data-i18n-ignore><b>{key}</b> · {value}</p>)}</details></details>
        <details className={styles.method}><summary>{t("ランキング対象外の身元（旧ID・説明ノード）")}</summary>{[...data.options.filter(p=>p.preperiod_predecessor_only),...data.mains.filter(p=>p.informational_nonproduct)].map(p=><p key={p.uber_id} data-i18n-ignore>{p.name}<br/>{p.uber_id}</p>)}</details>
        <p className={styles.help}>{t("出典：all-menu-september-ranking.json。9月の保存分析のみ。メニュー変更・自動判断は実行しません。")}</p>
      </>}
    </div>
    <dialog ref={dialog} className={styles.dialog} onClose={()=>setSelected(null)} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
      {selected && <><button className={styles.close} aria-label={t("閉じる")} onClick={close}><X size={20}/></button><h3 data-i18n-ignore>{selected.name.split(/[｜|]/)[0]}</h3><p data-i18n-ignore>{selected.name.split(/[｜|]/).slice(1).join(" · ")}</p>{badge(selected)}<div className={styles.stats}><div><span>{t("9月の捕獲数量")}</span><strong>{selected.units}</strong><small>{t("未キャンセルのみ")}</small></div><div><span>{t("独立選択注文")}</span><strong>{rankingOrders(selected)}</strong><small>{t("他商品の注文数と合算不可")}</small></div></div>
      {isOption(selected)?<><h4>{t("歴史所属の代理選択率")}</h4><p>{selected.selecting_eligible_orders} ÷ {selected.eligible_orders} = {fmt(selected.option_rate_pct)}</p><p>{t("代理分母外の選択注文")}: {selected.selecting_orders_outside_denominator}</p><p>{t("完全な履歴カタログ図は9/8以降です。代理率の分子は代理分母内の選択注文のみ。欠品時間や連続露出は未補正で、実際のコンバージョン率ではありません。")}</p><h4>{t("分類・供給の限定")}</h4><p data-i18n-ignore>{selected.required_optional} · {selected.free_paid} · {selected.ranking_warning}</p><p>{t("保存時の価格とグループ既定値による分類で、決済済み売上ではありません。")}</p><p>{t("所属の初観測")}: {jst(selected.first_graph_membership?.time)}<br/>{t("直前の未所属観測")}: {jst(selected.last_graph_absent_before_first?.time)}</p><p>{t("観測境界は発売日や連続露出の証明ではありません。")}</p><p>{t("最初・最後の選択観測")}: {selected.first_selling_day || "—"} / {selected.last_selling_day || "—"} JST</p><p>{t("確認済み欠品操作数")}: {selected.verified_unavailable_command_count}</p>{selected.candidate && <p className={styles.notice}>{t("低記録の確認候補です。保存された9月の証拠で欠品が見つからなくても全月露出は未確認。調達・表示・供給価値を確認し、低記録だけで廃止を判断しません。")}</p>}</>:<p>{t("捕獲注文の構成比")}: {selected.orders} / {data?.summary.noncancelled_orders} = {fmt(selected.share_of_captured_orders_pct)}</p>}
      <h4>{t("保存時のカタログ状態")}</h4><p>{t(selected.current_available===true?"保存時に販売可":selected.current_available===false?"保存時に販売不可":"販売可否は不明")} · {jst(selected.current_availability_asof)}</p><p>{t("キャンセル選択数量")}: {selected.cancelled_units}</p><h4>{t("商品身元・過去名・所属")}</h4><p data-i18n-ignore>ID: {selected.uber_id}</p>{selected.aliases.map((alias,i)=><p data-i18n-ignore key={i}>{alias}</p>)}{isOption(selected)&&<><p data-i18n-ignore>{selected.current_groups.join("；") || "—"}</p><p data-i18n-ignore>{selected.historical_memberships.join("；") || "—"}</p></>}
      <p>{t("異なるIDは同名でも統合しません。現在状態は全月の在庫証明ではありません。")}</p></>}
    </dialog>
  </AnalyticsShell>;
}
