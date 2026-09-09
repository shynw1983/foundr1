"use client";
import {useEffect,useState} from 'react';
import styles from './UberSourcePanel.module.css';

export type MenuProgress={targetName?:string;completed?:number;total?:number;startedAt?:number;lastResponseAt?:number;updatedAt?:number;requestsCompleted?:number;action?:string;requestState?:string;retry?:number;recent?:Array<{at:number;action:string;targetName:string}>};
const actions:Record<string,string[]>={read_menu:['メニュー一覧を読み取り','读取菜单列表','讀取菜單列表','Reading menu'],read_options:['選択グループ・選択肢を読み取り','读取选项组和选项','讀取選項組和選項','Reading option groups and options'],read_availability:['販売状態を確認（変更なし）','核对销售状态（不修改）','核對銷售狀態（不修改）','Checking availability (read only)'],save:['メニューを保存','保存菜单','儲存菜單','Saving menu']};
export function MenuJobProgress({progress:p={},updatedAt,language}:{progress?:MenuProgress;updatedAt:string;language:string}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const index=language==='ja'?0:language==='zh-Hans'?1:language==='zh-Hant'?2:3;
  const text=(ja:string,cn:string,tw:string,en:string)=>[ja,cn,tw,en][index];
  const action=(key:string)=>actions[key]?.[index]??text('処理中','处理中','處理中','Processing');
  const seconds=(at:number)=>Math.max(0,Math.floor((now-at)/1000));
  const stale=seconds(p.updatedAt??Date.parse(updatedAt))>60;
  const count=typeof p.completed==='number'&&typeof p.total==='number'&&p.total>0;
  return <div className={styles.liveProgress} data-warning={stale||p.requestState==='retrying'}>
    <strong>{stale?text('進捗更新が途絶えています','进度暂未更新','進度暫未更新','Progress update overdue'):p.requestState==='retrying'?text('読み取りを再試行中','正在重试读取','正在重試讀取','Retrying read'):action(p.action??'')}</strong>
    {p.targetName&&<p>{p.targetName}</p>}
    {!p.startedAt&&<p>{text('詳細な処理状況は次回の Bridge 起動後に表示されます。','详细动作将在 Bridge 下次启动后显示。','詳細動作將在 Bridge 下次啟動後顯示。','Detailed actions become available after the next Bridge start.')}</p>}
    {count&&<><span>{text('この段階の完了','本阶段完成','本階段完成','Completed in this stage')}：{p.completed} / {p.total}</span><progress aria-label={text('この段階の完了','本阶段完成','本階段完成','Stage progress')} value={p.completed} max={p.total}/></>}
    {p.startedAt&&<span>{text('経過','已运行','已執行','Elapsed')}：{seconds(p.startedAt)} s</span>}
    {p.lastResponseAt&&<span>{text('直近の正常応答','最近成功响应','最近成功回應','Last successful response')}：{seconds(p.lastResponseAt)} s · {p.requestsCompleted??0} {text('回','次','次','responses')}</span>}
    {p.requestState==='waiting'&&<span>{text('プラットフォームの応答待ち','等待平台响应','等待平台回應','Waiting for platform response')}</span>}
    {!!p.retry&&<span>{text('再試行','重试','重試','Retry')}：{p.retry} / 2</span>}
    {stale&&<p>{text('停止とは限りません。接続と直近の応答を確認してください。','不一定已停止，请检查连接和最近响应。','不一定已停止，請檢查連線和最近回應。','This does not prove a stall. Check connectivity and the last response.')}</p>}
    {!!p.recent?.length&&<details><summary>{text('最近の応答記録','最近响应记录','最近回應記錄','Recent responses')}</summary><ol>{p.recent.map((row,i)=><li key={`${row.at}-${i}`}><time>{new Date(row.at).toLocaleTimeString(language)}</time> · {action(row.action)} ✓{row.targetName&&<p>{row.targetName}</p>}</li>)}</ol></details>}
  </div>;
}
