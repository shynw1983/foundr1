'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PosMenuKind, PosMenuSetting } from '../../../lib/pos-menu-policy';
import styles from './PosMenuSettings.module.css';
type Target = {id:string;kind:PosMenuKind;name:string;category:string;brandPrice:number|null;legacyVisible:boolean;setting:PosMenuSetting|null};
type Props = {brandId:string;stores:Array<{id:string;name:string;brandIds:string[]}>;initialStoreId:string};
const kindNames = {item:'商品',group:'選択肢グループ',option:'追加・選択肢'};
export function PosMenuSettings({brandId,stores,initialStoreId}:Props){
  const [open,setOpen]=useState(false),[storeId,setStoreId]=useState(initialStoreId),[kind,setKind]=useState<PosMenuKind>('item');
  const [targets,setTargets]=useState<Target[]>([]),[revision,setRevision]=useState(''),[selected,setSelected]=useState('');
  const [visible,setVisible]=useState('inherit'),[pricing,setPricing]=useState('inherit'),[price,setPrice]=useState(''),[query,setQuery]=useState('');
  const [message,setMessage]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[reload,setReload]=useState(0);
  const generation=useRef(0);
  const eligible=useMemo(()=>stores.filter(s=>s.brandIds.includes(brandId)),[stores,brandId]);
  const effectiveStoreId=eligible.some(s=>s.id===storeId)?storeId:eligible.find(s=>s.id===initialStoreId)?.id||eligible[0]?.id||'';
  useEffect(()=>{
    const current=++generation.current,controller=new AbortController();
    setTargets([]);setSelected('');setRevision('');setMessage('');setSaving(false);setLoading(false);
    if(open&&brandId&&effectiveStoreId){
      setLoading(true);
      void fetch(`/api/os/menus/pos-settings?storeId=${encodeURIComponent(effectiveStoreId)}&brandId=${encodeURIComponent(brandId)}`,{cache:'no-store',signal:controller.signal})
        .then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);if(generation.current===current){setTargets(b.targets);setRevision(b.revision);}})
        .catch(e=>{if(!controller.signal.aborted&&generation.current===current)setMessage(e.message);})
        .finally(()=>{if(generation.current===current)setLoading(false);});
    }
    return()=>controller.abort();
  },[open,brandId,effectiveStoreId,reload]);
  const filtered=targets.filter(t=>t.kind===kind&&`${t.name} ${t.category}`.toLowerCase().includes(query.toLowerCase()));
  const target=targets.find(t=>`${t.kind}:${t.id}`===selected);
  function choose(t:Target){setSelected(`${t.kind}:${t.id}`);setVisible(t.setting?.visible===null||!t.setting?'inherit':t.setting.visible?'show':'hide');setPricing(t.setting?.price===null||!t.setting?'inherit':'custom');setPrice(t.setting?.price===null||!t.setting?'':String(t.setting.price));setMessage('');}
  async function save(){
    if(!target)return;
    if(target.kind!=='group'&&pricing==='custom'&&!/^\d{1,6}$/.test(price)){setMessage('店内価格は0〜999999円の整数で入力してください。');return;}
    const current=generation.current;setSaving(true);setMessage('');
    try{
      const r=await fetch('/api/os/menus/pos-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:effectiveStoreId,brandId,kind:target.kind,targetId:target.id,revision,
        visible:visible==='inherit'?null:visible==='show',price:target.kind==='group'||pricing==='inherit'?null:Number(price)})});
      const b=await r.json();if(!r.ok)throw new Error(b.error);
      if(current!==generation.current)return;
      setRevision(b.revision);setTargets(list=>list.map(t=>t===target?{...t,setting:{kind:t.kind,targetId:t.id,visible:visible==='inherit'?null:visible==='show',price:t.kind==='group'||pricing==='inherit'?null:Number(price)}}:t));
      setMessage('店内メニュー設定を保存しました。POS を再読込してください。');
    }catch(e){if(current===generation.current)setMessage(e instanceof Error?e.message:'設定を保存できません。');}
    finally{if(current===generation.current)setSaving(false);}
  }
  return <details className="panel" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className={styles.summary}>共通 POS メニュー設定</summary>
    <p>ブランドの共通メニューから、店舗の POS で販売する商品・選択肢と店内価格を設定します。</p>
    <p>独立メニューを使用中の店内飲食は「店舗の店内飲食メニュー」で編集してください。店頭持ち帰りと、独立メニュー未使用の店内飲食には、この設定を使用します。</p>
    <p>Web予約・外部デリバリーの公開設定や価格、欠品状態は変更しません。既存の50g規格はそのまま使用します。</p>
    <div className={styles.filters}>
      <label>対象店舗<select value={effectiveStoreId} disabled={saving} onChange={e=>setStoreId(e.target.value)}><option value="">店舗を選択</option>{eligible.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>対象の種類<select value={kind} disabled={saving} onChange={e=>{setKind(e.target.value as PosMenuKind);setSelected('');}}>{Object.entries(kindNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <label>検索<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button type="button" className="secondary-button" disabled={loading||saving||!effectiveStoreId} onClick={()=>setReload(n=>n+1)}>再読込</button>
    </div>
    {!brandId?<p>ブランドを選択してください。</p>:null}
    {loading?<p role="status">読み込み中...</p>:null}
    <div className={styles.body}>
      <div className={styles.list} aria-label="店内メニュー対象一覧">
        {filtered.map(t=><button type="button" key={`${t.kind}:${t.id}`} disabled={saving} aria-pressed={selected===`${t.kind}:${t.id}`} onClick={()=>choose(t)}>
          <span>{t.name}</span><small><span>{t.category}</span> · {t.kind==='group'?null:<span>¥{t.setting?.price??t.brandPrice??0}</span>} · <span>{t.setting?.visible===false?'POS 非公開':t.setting?.visible===true?'POS 公開':'公開設定を引継ぎ'}</span></small>
        </button>)}
        {!loading&&brandId&&effectiveStoreId&&revision&&!filtered.length?<p>対象がありません。</p>:null}
      </div>
      {target?<div className={styles.editor}>
        <h4>{target.name}</h4>
        <label>POS 公開設定<select value={visible} disabled={saving} onChange={e=>setVisible(e.target.value)}>
          <option value="inherit">既存設定を引継ぎ</option><option value="show">この店舗の POS に公開</option><option value="hide">この店舗の POS では非公開</option>
        </select></label>
        <p>非公開は欠品とは別の設定です。選択肢は親グループの公開設定にも従います。</p>
        {target.kind==='group'?<p>重量販売で使う追加グループは「公開」を選択してください。選択数・必須条件はブランド設定を使用します。</p>:<>
          <p>ブランド価格：¥{target.brandPrice??0}</p>
          <label>価格設定<select value={pricing} disabled={saving} onChange={e=>setPricing(e.target.value)}><option value="inherit">ブランド価格を使用</option><option value="custom">この店舗の POS 価格を設定</option></select></label>
          {pricing==='custom'?<label>店内価格（円）<input inputMode="numeric" value={price} disabled={saving} onChange={e=>setPrice(e.target.value)}/></label>:null}
          <p>重量販売の商品本体は、既存のグラム単価を使用します。選択肢の店内価格は1選択あたりの追加料金です。</p>
        </>}
        <button type="button" className="primary-button" disabled={saving||!revision} onClick={()=>void save()}>店内メニュー設定を保存</button>
      </div>:<p>左の一覧から設定する項目を選択してください。</p>}
    </div>
    {message?<p role="status">{message}</p>:null}
  </details>;
}
