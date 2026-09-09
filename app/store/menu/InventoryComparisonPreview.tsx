"use client";
import {useState} from 'react';
import type {buildInventoryComparison, ComparisonCell, ComparisonRow} from '../../../lib/inventory-comparison';
export type InventoryComparison=ReturnType<typeof buildInventoryComparison>;
export function InventoryComparisonPreview({comparison,language}:{comparison:InventoryComparison;language:string}) {
 const [filter,setFilter]=useState('differences');
 const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
 const names:Record<string,string>={uber_eats:'Uber',foundr1:'OS',rocket_now:'Rocket Now',demae_can:'出前館'};
 const cellLabel=(cell:ComparisonCell)=>cell.state==='staged'?label('同期済み・未公開','已同步・未上架','已同步・未上架'):cell.state==='excluded'?label('対象外','不参与同步','不參與同步'):cell.state==='unknown'?({mapping_missing:label('対応未登録','缺少对应关系','缺少對應關係'),read_failed:label('読取失敗','读取失败','讀取失敗'),reading:label('読取中','读取中','讀取中'),not_found:label('状態不明','状态未知','狀態未知')}[cell.reason??'']??label('不明','未知')):cell.state==='available'?label('販売中','可售'):label('売切','缺货','缺貨');
 const unknown=(r:ComparisonRow)=>Object.values(r.cells).some(c=>c.state==='unknown');
 const excluded=(r:ComparisonRow)=>Object.values(r.cells).some(c=>c.state==='excluded');
 const staged=(r:ComparisonRow)=>Object.values(r.cells).some(c=>c.state==='staged');
 const releaseBlocked=(r:ComparisonRow)=>r.isAvailable&&Object.values(r.cells).some(c=>c.state==='staged'&&!c.releaseReady);
 const columns=['uber_eats','foundr1',...comparison.platforms];
 const unchanged=comparison.rows.filter(r=>!r.changes.length&&!unknown(r)&&!excluded(r)&&!staged(r));
 const rows=comparison.rows.filter(r=>filter==='release-blocked'?releaseBlocked(r):filter==='release'?r.changes.some(p=>r.cells[p].state==='staged'):filter==='staged'?staged(r):filter==='unknown'?unknown(r):filter==='excluded'?excluded(r):filter==='differences'?r.changes.length>0:r.changes.includes(filter));
 const render=(data:ComparisonRow[])=><div className="inventory-comparison-list">{data.map(r=><article key={`${r.kind}:${r.targetId}`} className="inventory-comparison-row">
  <div className="inventory-comparison-name">{r.label}<small>{r.kind==='option'?label('オプション','选项','選項'):label('商品','商品')}</small></div>
  {columns.map(p=><div key={p} className={r.changes.includes(p)?'inventory-comparison-cell has-change':'inventory-comparison-cell'}><small>{names[p]}{p==='uber_eats'?label('（基準）','（基准）','（基準）'):''}</small><span className={`inventory-state-tag is-${r.cells[p].state==='available'?'success':r.cells[p].state==='sold_out'?'error':['excluded','staged'].includes(r.cells[p].state)?'neutral':r.cells[p].reason==='reading'?'info':'warning'}`}>{r.cells[p].state==='available'?'✓':r.cells[p].state==='sold_out'?'−':r.cells[p].reason==='reading'?'◌':['excluded','staged'].includes(r.cells[p].state)?'—':'?'} {cellLabel(r.cells[p])}</span>{r.changes.includes(p)&&<span className="inventory-state-tag is-warning"> → {r.cells[p].state==='staged'?label('新品を公開','新品上架','新品上架'):r.isAvailable?label('販売再開','恢复销售','恢復銷售'):label('無期限の売切','永久缺货','永久缺貨')}</span>}<small>{r.cells[p].state==='staged'&&!r.cells[p].releaseReady&&r.isAvailable&&(r.cells[p].releaseError||label('上架先を再確認してください','请重新读取并核验上架位置','請重新讀取並核驗上架位置'))}</small><small>{r.cells[p].readAt?new Date(r.cells[p].readAt!).toLocaleTimeString(language,{timeZone:'Asia/Tokyo'}):'—'}</small></div>)}
 </article>)}</div>;
 return <div>
  <h4>{label('全プラットフォームの比較','全平台状态对照','全平台狀態對照')}</h4>
  <p>{label('Uber を基準に差分のみ変更します。各欄は読取時点の状態です。','以 Uber 为基准，仅修改差异项。各栏显示读取时的状态。','以 Uber 為基準，僅修改差異項。各欄顯示讀取時的狀態。')}</p>
  <p>{Object.entries(comparison.counts).map(([p,n])=>`${names[p]}: ${n}`).join(' · ')} {label('件を変更予定','项待修改','項待修改')}</p>
  <p>{label('新品の公開','新品上架','新品上架')}: {comparison.rows.reduce((n,r)=>n+r.changes.filter(p=>r.cells[p].state==='staged').length,0)} · {label('販売再開','恢复销售','恢復銷售')}: {comparison.rows.reduce((n,r)=>n+r.changes.filter(p=>r.cells[p].state==='sold_out'&&r.isAvailable).length,0)} · {label('売切に設定','设置缺货','設定缺貨')}: {comparison.rows.reduce((n,r)=>n+r.changes.filter(p=>!r.isAvailable).length,0)}</p>
  <label>{label('表示','显示','顯示')} <select value={filter} onChange={e=>setFilter(e.target.value)}>
   <option value="differences">{label('差分のみ','只看差异','只看差異')}</option>
   {['foundr1',...comparison.platforms].map(p=><option key={p} value={p}>{names[p]} · {comparison.counts[p]}</option>)}
   <option value="release">{label('新品の公開','新品上架','新品上架')} · {comparison.rows.filter(r=>r.changes.some(p=>r.cells[p].state==='staged')).length}</option>
   <option value="release-blocked">{label('公開前の確認が必要','暂不能上架','暫不能上架')} · {comparison.rows.filter(releaseBlocked).length}</option>
   <option value="unknown">{label('不明・読取失敗','未知／读取失败','未知／讀取失敗')} · {comparison.unknown}</option>
   <option value="staged">{label('同期済み・未公開','已同步・未上架','已同步・未上架')} · {comparison.rows.filter(staged).length}</option>
   <option value="excluded">{label('対象外・隔離','隔离／不参与同步','隔離／不參與同步')} · {comparison.rows.filter(excluded).length}</option>
  </select></label>
  {comparison.rows.some(staged)&&<p className="inventory-state-tag is-neutral">{label('Uber で販売中の新品は、確認後に公開します。Uber で売切の新品と上架先が未確認の項目は非公開のままです。','Uber 可售且上架位置已核验的新品，将在确认后上架。Uber 缺货或上架位置未确认的新品继续隐藏，不影响其他已确认项目。','Uber 可售且上架位置已核驗的新品，將在確認後上架。Uber 缺貨或上架位置未確認的新品繼續隱藏，不影響其他已確認項目。')}</p>}
  {comparison.pending&&<p role="status" className="inventory-state-tag is-info">◌ {label('他社の状態を読み取っています。まだ変更していません。','正在读取其他平台，尚未修改任何状态。','正在讀取其他平台，尚未修改任何狀態。')}</p>}
  {!comparison.pending&&comparison.unknown>0&&<p role="alert" className="inventory-state-tag is-warning">? {label('不明な状態があります。実行前に対応関係・接続を確認し、再読み取りしてください。','存在未知状态，执行前请检查对应关系或平台连接，并重新读取。','存在未知狀態，執行前請檢查對應關係或平台連線，並重新讀取。')}</p>}
  {rows.length?render(rows):<p>{label('この条件に該当する項目はありません。','没有符合此筛选条件的项目。','沒有符合此篩選條件的項目。')}</p>}
  <details><summary>{label('全対象プラットフォームで一致','所有参与平台均一致','所有參與平台均一致')} · {unchanged.length}</summary>{render(unchanged)}</details>
 </div>;
}
