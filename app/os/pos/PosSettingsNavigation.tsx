"use client";
import { useOsTranslation } from "../components/OsTranslationProvider";
import styles from "./PosSettingsNavigation.module.css";
export const posSettingsPanes = [
  {id:"general",label:"税率・販売",save:"税率・販売設定を保存"},
  {id:"fulfillment",label:"提供・受け渡し",save:"受け渡し設定を保存"},
  {id:"tare",label:"ボウルの重さ",save:"ボウルの重さを保存"},
  {id:"filter",label:"はかりの揺れ対策",save:"揺れ対策を保存"},
  {id:"customerDisplayStandby",label:"客席表示・待機画面",save:"待機画面を保存"},
  {id:"customerDisplayMedia",label:"客席表示・広告",save:"広告設定を保存"},
  {id:"receiptConnection",label:"プリンター接続",save:"プリンター接続設定を保存"},
  {id:"printing",label:"印刷・伝票",save:"印刷・伝票設定を保存"},
  {id:"discount",label:"割引・キャンペーン",save:"割引を保存"},
  {id:"overview",label:"営業状況",save:""}
] as const;
export type PosSettingsPane = typeof posSettingsPanes[number]["id"];
export const posSettingsGroups = [
 {id:"general",label:"会計・営業",save:"会計・営業設定を保存",sections:["general","fulfillment"]},
 {id:"scale",label:"はかり",save:"はかり設定を保存",sections:["tare","filter"]},
 {id:"printing",label:"印刷・伝票",save:"印刷・伝票設定を保存",sections:["receiptConnection","printing"]},
 {id:"customerDisplay",label:"客席表示",save:"客席表示設定を保存",sections:["customerDisplayStandby","customerDisplayMedia"]},
 {id:"discount",label:"割引・キャンペーン",save:"割引を保存",sections:["discount"]}
] as const;
export type PosSettingsGroup = typeof posSettingsGroups[number]["id"];
export function PosSettingsNavigation({active,onChange,dirty,disabled}:{active:PosSettingsGroup;onChange:(pane:PosSettingsGroup)=>void;dirty:Partial<Record<PosSettingsGroup,boolean>>;disabled:boolean}) {
 const {t}=useOsTranslation();
 return <div className={styles.navigation} role="tablist" aria-label={t("POS 設定の機能")} data-pos-settings-navigation>{posSettingsGroups.map((pane,index)=><button key={pane.id} id={`pos-settings-tab-${pane.id}`} type="button" role="tab" aria-selected={active===pane.id} aria-controls={active===pane.id?`pos-settings-group-${pane.id}`:undefined} tabIndex={active===pane.id?0:-1} data-pos-settings-tab={pane.id} disabled={disabled} onClick={()=>onChange(pane.id)} onKeyDown={event=>{
  const offset=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;
  if(!offset&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?posSettingsGroups.length-1:(index+offset+posSettingsGroups.length)%posSettingsGroups.length;onChange(posSettingsGroups[target].id);document.getElementById(`pos-settings-tab-${posSettingsGroups[target].id}`)?.focus();
 }}>{t(pane.label)}{dirty[pane.id]?<small data-pos-settings-dirty={pane.id}>{t("未保存")}</small>:null}</button>)}</div>;
}
