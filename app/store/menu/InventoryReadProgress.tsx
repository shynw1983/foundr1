"use client";
import {CheckCircle2, Clock3, LoaderCircle, XCircle} from "lucide-react";

export type InventoryRead = {id:string;platform:string;status:string;error:string;count:number};
export function InventoryReadProgress({reads,language,counts,unknownByPlatform,stagedByPlatform={},confirmedByPlatform={},onRetry,disabled}:{reads:InventoryRead[];language:string;counts:Record<string,number>;unknownByPlatform:Record<string,number>;stagedByPlatform?:Record<string,number>;confirmedByPlatform?:Record<string,number>;onRetry:(id:string)=>void;disabled:boolean}) {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  const names:Record<string,string>={uber_eats:'Uber',rocket_now:'Rocket Now',demae_can:'出前館'};
  const completed=reads.filter(r=>r.status==='succeeded').length;
  const failure=(error:string)=>/401|403|login|auth|MWA0007/i.test(error)?label('ログイン・権限を確認してください。','请检查平台登录和授权。','請檢查平台登入和授權。'):/timeout|timed.out|超时/i.test(error)?label('接続がタイムアウトしました。','连接超时。','連線逾時。'):label('読み取れませんでした。詳細を確認してください。','读取失败，请查看详细原因。','讀取失敗，請查看詳細原因。');
  return <section className="inventory-read-progress" aria-label={label('読取状況','读取进度','讀取進度')}>
    <p role="status" aria-live="polite" className="inventory-read-summary">{label('読取完了','已读取','已讀取')} {completed}/{reads.length} · {label('まだ販売状態は変更していません','尚未修改销售状态','尚未修改銷售狀態')}</p>
    <ul>{reads.map(r=>{
      const failed=['failed','timed_out'].includes(r.status), done=r.status==='succeeded', active=r.status==='processing';
      const tone=failed?'error':done?'success':active?'info':'neutral';
      const state=failed?label('読取失敗','读取失败','讀取失敗'):done?label('読取完了','读取完成','讀取完成'):active?label('読取中','读取中','讀取中'):label('待機中','等待中');
      return <li key={r.id} className="inventory-read-row">
        <span className="inventory-read-platform">{names[r.platform]??r.platform}</span>
        <span className={`inventory-state-tag inventory-sync-state is-${tone}`}><span aria-hidden="true">{failed?<XCircle size={16}/>:done?<CheckCircle2 size={16}/>:active?<LoaderCircle size={16} className="inventory-read-spinner"/>:<Clock3 size={16}/>}</span>{state}</span>
        <div className="inventory-read-detail">
          {done?<><span>{confirmedByPlatform[r.platform]??Math.max(0,r.count-(stagedByPlatform[r.platform]??0)-(unknownByPlatform[r.platform]??0))} {label('件の販売状態を確認','项销售状态已确认','項銷售狀態已確認')}</span>{(stagedByPlatform[r.platform]??0)>0&&<span className="inventory-read-note">{stagedByPlatform[r.platform]} {label('件は同期済み・未公開','项已同步・未上架','項已同步・未上架')}</span>}{(counts[r.platform]??0)>0&&<span className="inventory-read-note is-warning">≠ {counts[r.platform]} {label('件の差分','项差异','項差異')}</span>}{(unknownByPlatform[r.platform]??0)>0&&<span className="inventory-read-note is-warning">? {unknownByPlatform[r.platform]} {label('件の状態不明','项无法判断','項無法判斷')}</span>}</>:failed?<><span className="inventory-read-error">{failure(r.error)}</span><details><summary>{label('エラー詳細','错误详情','錯誤詳情')}</summary><p>{r.error}</p></details></>:<span>{active?label('販売状態を読み取っています…','正在读取销售状态…','正在讀取銷售狀態…'):label('順番に読み取ります','稍后读取','稍後讀取')}</span>}
        </div>
        {failed&&<button className="secondary-button" type="button" disabled={disabled} onClick={()=>onRetry(r.id)}>{label('このプラットフォームを再読み取り','重新读取该平台','重新讀取該平台')}</button>}
      </li>;
    })}</ul>
  </section>;
}
