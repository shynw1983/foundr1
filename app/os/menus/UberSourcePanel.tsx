"use client";

import {useCallback,useEffect,useState} from 'react';
import {useOsTranslation} from '../components/OsTranslationProvider';
import styles from './UberSourcePanel.module.css';
import {canRetryMenuJob,menuSyncIssue} from '../../../lib/menu-sync-status';
import type {MenuChange} from '../../../lib/uber-menu-diff';
import {meaningfulMenuChanges,menuChangeValue} from '../../../lib/menu-change-display';

type Job={id:string;platform:string;status:string;updated_at:string;last_error:string;revision:string|null;phase:string|null;attempts:number;available_at:string;progress?:{completed?:number;total?:number};retries?:Array<{at:string;error:string;attempts:number}>};

type SourceData={
  source:null|{enabled:boolean;auto_publish:boolean;revision:number;last_checked_at:string|null;last_error:string};
  runs:Array<{id:string;revision:number;created_at:string;trigger:string;summary:{added:number;observed:number;archived:number;pendingRemoval:number;moved?:number;renamed?:number;repriced?:number;noChanges?:boolean;changes?:MenuChange[]}}>;
  jobs:Job[];jobHistory:Job[];
  successes:Array<{platform:string;revision:string|null;completed_at:string}>;
  devices:Array<{platform:string;last_seen_at:string|null}>;
  nextCheck:string;
  prices:Array<{id:string;kind:string;name:string;mode:'manual'|'automatic';price:number;uberPrice:number}>;
};
const platformNames:Record<string,string>={uber_eats:'Uber → OS',rocket_now:'Rocket Now',demae_can:'出前館'};
const statusNames:Record<string,string>={pending:'待機中',processing:'処理中',succeeded:'検証済み',failed:'失敗'};
const phaseNames:Record<string,string>={capturing:'Uber 読取中',locating:'接続確認中',preflight:'事前確認中',content:'商品名・価格を同期中',creating:'非公開の商品を作成中',received:'作成結果を確認中',identified:'商品を識別済み',migrating:'選択グループを移行中',relationships:'分類・グループを同期中',retiring:'削除・非公開を反映中',verifying:'保存結果を確認中',blocked:'確認が必要です'};
const platformUrls:Record<string,string>={uber_eats:'https://merchants.ubereats.com',rocket_now:'https://store.rocketnow.co.jp',demae_can:'https://partner.demae-can.com/merchant-admin/'};

export function UberSourcePanel({brandId}:{brandId:string}) {
  const {t,language}=useOsTranslation();
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  const dateLabel=(value:string)=>new Date(value).toLocaleString(language,{timeZone:'Asia/Tokyo'});
  const [data,setData]=useState<SourceData|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState('');
  const [mode,setMode]=useState<'manual'|'automatic'>('manual');
  const [price,setPrice]=useState('');
  const [showAll,setShowAll]=useState(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch(`/api/menus/uber-source?brandId=${encodeURIComponent(brandId)}`,{signal,cache:'no-store'});
    if(response.status===403){setData(null);return;}
    const value=await response.json();
    if(!response.ok)throw new Error(value.error??'連携状態を取得できませんでした。');
    if(!signal?.aborted){setData(value);setError('');}
  },[brandId]);
  useEffect(()=>{
    setData(null);setSelected('');setSearch('');setNotice('');setError('');
    if(!brandId)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      try{await load(controller.signal);}catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'連携状態を取得できませんでした。');}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>void refresh(),5000);}
    };
    void refresh();
    return()=>{controller.abort();clearTimeout(timer);};
  },[brandId,load]);
  const submit=async(action:'scan'|'price'|'retry',jobId?:string)=>{
    setBusy(true);setNotice('');setError('');
    try {
      const response=await fetch('/api/menus/uber-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brandId,action,jobId,targetId:selected,mode,price})});
      const value=await response.json();
      if(!response.ok)throw new Error(value.error??'保存できませんでした。');
      setNotice(action==='retry'?'このプラットフォームだけ再試行を予約しました。':action==='scan'?(value.queued?'Uber の読み取りを予約しました。':'読み取りはすでに待機・処理中です。'):'OS 基準価格を保存しました。配信完了は下の状態で確認してください。');
      await load();
    }catch(failure){setError(failure instanceof Error?failure.message:'保存できませんでした。');}
    finally{setBusy(false);}
  };
  if(!data?.source && !error)return null;
  const source=data?.source;
  const selectedPrice=data?.prices.find(row=>row.id===selected);
  const active=data?.jobs.some(job=>['pending','processing'].includes(job.status));
  const failed=data?.jobs.filter(job=>job.status==='failed')??[];
  const jobLabel=(job:Job)=>t(job.status==='processing'&&job.phase?phaseNames[job.phase]??statusNames.processing:job.status==='pending'&&job.attempts>0?'自動再試行を待機中':statusNames[job.status]??job.status);
  const problem=menuSyncIssue(failed[0]?.last_error||source?.last_error,language);
  const retryButton=(job:Job)=>canRetryMenuJob(job,data?.jobs.find(row=>row.platform===job.platform)?.id,source?.revision??0)?<button type="button" className="secondary-button compact-button" disabled={busy||active||!source?.enabled} onClick={()=>void submit('retry',job.id)}>{t('接続・保存結果を確認して再試行')}</button>:null;
  return <section id="uber-menu-sync" className={`menu-publish-preview ${styles.panel}`} data-i18n-ignore aria-label={t('メニュー同期センター')}>
    <div className="menu-publish-preview-head">
      <div><strong>{t('メニュー同期センター')}</strong><span>{t('Uber → OS → Rocket Now・出前館')}</span></div>
      <button type="button" className="secondary-button compact-button" disabled={busy} onClick={()=>void load().catch(failure=>setError(failure.message))}>{t('状態を更新')}</button>
    </div>
    <p>{language==='ja'?'メニュー更新で既存商品の売切を解除することはありません。販売状態は Store で操作します。':language==='zh-Hant'?'更新菜單不會恢復現有缺貨商品的銷售。銷售狀態請在 Store 操作。':'更新菜单不会恢复现有缺货商品的销售。销售状态请在 Store 操作。'} <a href="/store/menu">{language==='ja'?'Store の販売状態へ':language==='zh-Hant'?'前往 Store 銷售狀態':'前往 Store 销售状态'}</a></p>
    {source&&<>
      <div className={styles.overview} data-tone={problem?'warning':active?'working':'success'} role="status">
        <strong>{failed.length?label(`${failed.length} プラットフォームへの反映が未完了です`,`${failed.length} 个平台的菜单尚未同步完成`,`${failed.length} 個平台的菜單尚未同步完成`):problem?t(problem.title):active?t('メニュー同期を実行中です'):source.revision?t('最新の同期結果を確認できます'):t('まだ同期していません')}</strong>
        <p>{failed.length?label('Uber の読み取り成功と他社への反映成功は別です。下の各平台に原因と次の操作を表示しています。','Uber 读取成功不代表其他平台已同步。请看下方每个平台的失败原因和处理方式。','Uber 讀取成功不代表其他平台已同步。請看下方每個平台的失敗原因和處理方式。'):problem?t(problem.action):t('各プラットフォームの結果は下に表示します。成功済みの同期を再実行する必要はありません。')}</p>
        {failed.length>0&&<p>{t('対応が必要')}：{failed.map(job=>platformNames[job.platform]).join('・')}</p>}
      </div>
      <div className={styles.actions}>
        <button type="button" className="primary-button compact-button" disabled={busy||active||!source.enabled} onClick={()=>void submit('scan')}>{t('Uber の最新メニューを確認')}</button>
        <span>{t('毎日12:00（日本時間）に自動確認')} · {t('新規商品は非公開')} · {t('画像は同期しません')}</span>
      </div>
      <p className={styles.meta}>{t('次回確認')}：{source.enabled?dateLabel(data!.nextCheck):t('無効')} · {t('最終読み取り')}：{source.last_checked_at?dateLabel(source.last_checked_at):t('未実行')}</p>
      <ul className={styles.jobs} aria-live="polite">{['uber_eats','rocket_now','demae_can'].map(platform=>{
        const job=data?.jobs.find(row=>row.platform===platform);
        const issue=menuSyncIssue(job?.last_error,language),success=data?.successes.find(row=>row.platform===platform);
        const device=data?.devices.filter(row=>row.platform===platform||row.platform==='desktop').sort((a,b)=>Date.parse(b.last_seen_at??'')-Date.parse(a.last_seen_at??''))[0];
        const offline=!device?.last_seen_at||Date.now()-Date.parse(device.last_seen_at)>120000;
        return <li key={platform} data-state={job?.status}><div className={styles.platformHead}><strong>{platformNames[platform]}</strong><span className={styles.badge}>{job?jobLabel(job):t('未実行')}</span></div>
          {job&&<><small>{job.revision&&<>{t('取込版')} {job.revision} · </>}{dateLabel(job.updated_at)}</small>
            {job.status==='processing'&&<ol className={styles.steps}>{['接続確認','差分確認','書き込み','回読確認'].map((step,index)=><li key={step} data-current={index===(['locating','capturing'].includes(job.phase??'')?0:job.phase==='preflight'?1:job.phase==='verifying'?3:2)}>{t(step)}</li>)}</ol>}
            {typeof job.progress?.completed==='number'&&typeof job.progress?.total==='number'&&<span>{t('処理済み')} {job.progress.completed} / {job.progress.total}</span>}
            {job.status==='pending'&&job.attempts>0&&<small>{t('次の再試行')}：{dateLabel(job.available_at)} · {job.attempts} / 3</small>}
            {issue&&<><div className={styles.failure}><strong>{label('失敗理由','失败原因','失敗原因')}</strong><p>{t(issue.title)}</p><strong>{label('次の対応','下一步','下一步')}</strong><p>{t(issue.action)}</p></div><details><summary>{label('技術情報（調査用）','技术信息（排查用）','技術資訊（排查用）')}</summary><code>{job.last_error}</code></details></>}
            {job.status==='failed'&&platform!=='uber_eats'&&issue?.retry!==false&&retryButton(job)}
          </>}
          <small>{t('最終成功')}：{success?`${success.revision?`${t('取込版')} ${success.revision} · `:''}${dateLabel(success.completed_at)}`:t('未実行')}</small>
          {offline&&<small>{t('Bridge の接続を確認してください')} · {device?.last_seen_at?dateLabel(device.last_seen_at):t('接続記録なし')}</small>}
          <a href={platformUrls[platform]} target="_blank" rel="noreferrer">{t('管理画面を開く')} ↗</a>
          {platform==='demae_can'&&<small>{t('普通のブラウザと Bridge のログインは別です。Bridge の専用画面を確認してください。')}</small>}
        </li>;
      })}</ul>
      <div className={styles.history}><strong>{t('同期履歴')}</strong>
        {data?.runs.length?data.runs.slice(0,showAll?20:5).map(run=><details key={run.id} className={styles.run}><summary><span>{dateLabel(run.created_at)} · {t('取込版')} {run.revision} · {t(run.trigger==='manual'?'手動':run.trigger==='scheduled'?'自動':'過去の記録')}</span><small>{run.summary.noChanges?t('確認済み・変更なし（配信なし）'):`${t('新規')} ${run.summary.added} · ${t('名称変更')} ${run.summary.renamed??'—'} · ${t('価格変更')} ${run.summary.repriced??'—'} · ${t('移動')} ${run.summary.moved??'—'} · ${t('削除')} ${run.summary.archived}`}</small></summary>
          {!run.summary.noChanges&&<div className={styles.runJobs}>{data.jobHistory.filter(job=>job.revision===String(run.revision)).map(job=><div key={job.id}><span>{platformNames[job.platform]}：{jobLabel(job)}</span>{job.last_error&&<p>{t(menuSyncIssue(job.last_error)!.title)}</p>}{job.retries?.map((retry,index)=><small key={`${retry.at}-${index}`}>{dateLabel(retry.at)} · {t('手動再試行')} · {t(menuSyncIssue(retry.error)?.title??'同期を完了できませんでした')}</small>)}{job.status==='failed'&&data.jobs.some(row=>row.id===job.id)&&menuSyncIssue(job.last_error)?.retry!==false&&retryButton(job)}</div>)}</div>}
          {run.summary.pendingRemoval>0&&<p>{t('削除候補（再確認待ち）')}：{run.summary.pendingRemoval}</p>}
          {meaningfulMenuChanges(run.summary.changes).length?<div className={styles.changes}>{meaningfulMenuChanges(run.summary.changes).map((change,index)=><div key={`${change.sourceKey}-${index}`}><strong>{change.name}</strong><span>{t(change.field)}</span><p><span>{label('変更前','修改前','修改前')}：{menuChangeValue(change,change.before,language)}</span><br/><span>{label('変更後','修改后','修改後')}：{menuChangeValue(change,change.after,language)}</span></p>{change.field==='数量ルール'&&<details><summary>{label('詳細ルール（技術情報）','完整规则（技术信息）','完整規則（技術資訊）')}</summary><code>{change.before} → {change.after}</code></details>}{change.kind==='added'&&<small>{t('新規商品は非公開')}</small>}</div>)}</div>:<p>{run.summary.changes?.length?label('設定値は同じです。データ内の項目順だけの違いは変更として表示しません。','设置值没有变化，已隐藏仅字段排列顺序不同的记录。','設定值沒有變化，已隱藏僅欄位排列順序不同的記錄。'):t(run.summary.noChanges?'メニューに変更はありません。':'この履歴には詳細な差分が保存されていません。')}</p>}
          {run.summary.noChanges&&<p className={styles.meta}>{label('今回の確認では再配信していません。過去の配信失敗が解消したことを意味しません。','这次检查未重新发布菜单，不代表之前的同步失败已解决。','這次檢查未重新發佈菜單，不代表之前的同步失敗已解決。')}</p>}
        </details>):<p>{t('未実行')}</p>}
        {(data?.runs.length??0)>5&&<button type="button" className="secondary-button compact-button" onClick={()=>setShowAll(!showAll)}>{t(showAll?'最近5件に戻す':'過去の履歴を表示')}</button>}
      </div>
      <details><summary>{t('同期設定')}</summary><div className={styles.settings}>
        <p>{t(source.enabled?'Uber 原本の読み取り：有効':'Uber 原本の読み取り：未有効化')} / {t(source.auto_publish?'他社への自動配信：有効':'他社への自動配信：未有効化')}</p>
        <p>{t('Rocket Now は Uber 実価格、出前館は OS 基準価格。新規作成は非公開。メニュー同期では販売を再開しません。')}</p>
        <p>{t('画像は読み取りのみです。画像の登録・変更・削除は各配達サービスの管理画面で行ってください。')}</p>
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
      </div></details>
    </>}
    {notice&&<p role="status">{t(notice)}</p>}
    {error&&<p role="alert">{t(error)}</p>}
  </section>;
}
