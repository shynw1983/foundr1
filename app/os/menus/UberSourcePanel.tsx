"use client";

import {useCallback,useEffect,useState} from 'react';
import {useOsTranslation} from '../components/OsTranslationProvider';
import styles from './UberSourcePanel.module.css';

type SourceData={
  source:null|{enabled:boolean;auto_publish:boolean;revision:number;last_checked_at:string|null;last_error:string};
  runs:Array<{revision:number;created_at:string;summary:{added:number;observed:number;archived:number;pendingRemoval:number}}>;
  jobs:Array<{platform:string;status:string;updated_at:string;last_error:string;revision:string}>;
  prices:Array<{id:string;kind:string;name:string;mode:'manual'|'automatic';price:number;uberPrice:number}>;
};
const platformNames:Record<string,string>={rocket_now:'Rocket Now',demae_can:'出前館'};
const statusNames:Record<string,string>={pending:'待機中',processing:'処理中',succeeded:'検証済み',failed:'失敗'};

export function UberSourcePanel({brandId}:{brandId:string}) {
  const {t}=useOsTranslation();
  const [data,setData]=useState<SourceData|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [mode,setMode]=useState<'manual'|'automatic'>('manual');
  const [price,setPrice]=useState('');
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(`/api/menus/uber-source?brandId=${encodeURIComponent(brandId)}`,{signal,cache:'no-store'});
    if(response.status===403){setData(null);return;}
    const value=await response.json();
    if(!response.ok)throw new Error(value.error??'連携状態を取得できませんでした。');
    setData(value);setError('');
  },[brandId]);
  useEffect(()=>{
    setData(null);setSelected('');setSearch('');setNotice('');setError('');
    if(!brandId)return;
    const controller=new AbortController();
    void load(controller.signal).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[brandId,load]);
  const submit=async(action:'scan'|'price')=>{
    setBusy(true);setNotice('');setError('');
    try {
      const response=await fetch('/api/menus/uber-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brandId,action,targetId:selected,mode,price})});
      const value=await response.json();
      if(!response.ok)throw new Error(value.error??'保存できませんでした。');
      setNotice(action==='scan'?(value.queued?'Uber の読み取りを予約しました。':'読み取りはすでに待機・処理中です。'):'OS 基準価格を保存しました。配信完了は下の状態で確認してください。');
      await load();
    }catch(failure){setError(failure instanceof Error?failure.message:'保存できませんでした。');}
    finally{setBusy(false);}
  };
  if(!data?.source && !error)return null;
  const source=data?.source;
  const selectedPrice=data?.prices.find(row=>row.id===selected);
  return <section className={`menu-publish-preview ${styles.panel}`} data-i18n-ignore aria-label={t('Uber 原本連携')}>
    <div className="menu-publish-preview-head">
      <div><strong>{t('Uber 原本連携')}</strong><span>{t('Uber → OS → Rocket Now・出前館')}</span></div>
      <button type="button" className="secondary-button compact-button" disabled={busy} onClick={()=>void load().catch(failure=>setError(failure.message))}>{t('状態を更新')}</button>
    </div>
    {source&&<>
      <p>{t(source.enabled?'Uber 原本の読み取り：有効':'Uber 原本の読み取り：未有効化')} / {t(source.auto_publish?'他社への自動配信：有効':'他社への自動配信：未有効化')}</p>
      <p>{t('Rocket Now は Uber 実価格、出前館は OS 基準価格。新規作成は非公開。メニュー同期では販売を再開しません。')}</p>
      <p>{t('画像は読み取りのみです。画像の登録・変更・削除は各配達サービスの管理画面で行ってください。')}</p>
      <p>{t('最終読み取り')}：{source.last_checked_at?new Date(source.last_checked_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):t('未実行')} / {t('取込版')}：{source.revision}</p>
      {source.last_error&&<p role="alert">{source.last_error}</p>}
      <button type="button" className="primary-button compact-button" disabled={busy||!source.enabled} onClick={()=>void submit('scan')}>{t('Uber から今すぐ読み取る')}</button>
      <ul>{['rocket_now','demae_can'].map(platform=>{
        const job=data?.jobs.find(row=>row.platform===platform);
        return <li key={platform}>{platformNames[platform]}：{job?t(statusNames[job.status]??job.status):t('未実行')}{job&&<> / {t('取込版')} {job.revision}{job.last_error&&<p role="alert">{job.last_error}</p>}</>}</li>;
      })}</ul>
      <details><summary>{t('OS 基準価格の設定')}</summary>
        <p>{t('既存価格は維持。自動計算を選ぶと Uber 価格 × 0.8 を 10 円単位に丸めます。Rocket Now の価格には影響しません。')}</p>
        <div className={`menu-publish-scope-fields ${styles.fields}`}>
          <label><span>{t('商品・選択肢を検索')}</span><input value={search} onChange={event=>setSearch(event.target.value)}/></label>
          <label><span>{t('商品・選択肢')}</span><select value={selected} onChange={event=>{const row=data?.prices.find(value=>value.id===event.target.value);setSelected(event.target.value);setMode(row?.mode??'manual');setPrice(String(row?.price??''));}}>
            <option value="">{t('選択してください')}</option>
            {data?.prices.filter(row=>row.id===selected||row.name.toLowerCase().includes(search.toLowerCase())).map(row=><option key={row.id} value={row.id}>{row.name} / ¥{row.price} ({row.kind==='item'?t('商品'):t('選択肢')})</option>)}
          </select></label>
          <label><span>{t('価格の決め方')}</span><select value={mode} onChange={event=>setMode(event.target.value as 'manual'|'automatic')}><option value="manual">{t('手動価格を維持')}</option><option value="automatic">{t('Uber から自動計算')}</option></select></label>
          {mode==='manual'&&<label><span>{t('OS 基準価格')}</span><input type="number" min="0" step="1" value={price} onChange={event=>setPrice(event.target.value)}/></label>}
        </div>
        {selectedPrice&&<p>Uber / Rocket Now：¥{selectedPrice.uberPrice} · OS / {t('出前館')}：¥{mode==='automatic'?Math.round(selectedPrice.uberPrice*0.8/10)*10:price}</p>}
        <button type="button" className="primary-button compact-button" disabled={busy||!source.enabled||!selected||(mode==='manual'&&(!price.trim()||!Number.isSafeInteger(Number(price))||Number(price)<0))} onClick={()=>void submit('price')}>{t('基準価格を保存')}</button>
      </details>
    </>}
    {notice&&<p role="status">{t(notice)}</p>}
    {error&&<p role="alert">{t(error)}</p>}
  </section>;
}
