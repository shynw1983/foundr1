export function menuSyncIssue(error = '',language='ja') {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  if (!error) return null;
  if(error.includes('rocket_menu_group_quantity_invalid'))return {kind:'content',title:label('Rocket Now のグループ数量設定を送信できません','火箭分组的可选数量设置无法提交','火箭分組的可選數量設定無法提交'),action:label('最小・最大選択数が送信条件に合っていません。連携側の数量変換を確認する必要があります。この記録には対象グループが保存されていないため、Uber の設定を推測で変更しないでください。','最少／最多可选数量不符合提交条件，需要检查同步程序的数量转换。这条旧记录没有保存具体分组，请勿猜测并修改 Uber 设置。','最少／最多可選數量不符合提交條件，需要檢查同步程式的數量轉換。這條舊記錄沒有保存具體分組，請勿猜測並修改 Uber 設定。'),retry:false};
  if(/401|MWA0007/.test(error))return {kind:'login',title:label('メニュー管理 API の認証が拒否されました','菜单管理接口拒绝了登录认证','菜單管理介面拒絕了登入認證'),action:label('メニュー一覧の取得で停止しました。Bridge 専用画面のログイン・メニュー管理権限を確認してください。在庫の読み取り成功とは別の確認です。','任务在读取菜单列表时停止。请检查 Bridge 专用窗口的登录和菜单管理权限；库存读取成功不代表菜单接口认证成功。','工作在讀取菜單列表時停止。請檢查 Bridge 專用視窗的登入和菜單管理權限；庫存讀取成功不代表菜單介面認證成功。'),retry:true};
  if (/401|MWA0007|login|unauthori[sz]ed|session.*expir/i.test(error)) return {kind:'login',title:'ログインの確認が必要です',action:'Bridge の専用画面でログインしてから再試行してください。',retry:true};
  if (/403|access.denied|forbidden/i.test(error)) return {kind:'access',title:'管理画面へのアクセスが拒否されました',action:'Bridge の専用画面で接続先と権限を確認してください。',retry:true};
  if (/uncertain|not_isolated|identity|ambiguous|unverified|draft_exposed/i.test(error)) return {kind:'verify',title:'保存結果・非公開状態の確認が必要です',action:'再試行は既存の作成記録を使って回読確認します。確認できない場合は書き込みを停止します。',retry:true};
  if (/preflight_blocked|projected_name|price_invalid|quantity|unique.constraint/i.test(error)) return {kind:'content',title:'メニュー内容の修正が必要です',action:'診断詳細の対象を Uber で修正し、最新メニューを確認してください。',retry:false};
  if (/timeout|timed.out|network|fetch.failed|request_failed:5|ECONN|ETIMEDOUT/i.test(error)) return {kind:'network',title:'通信が一時的に失敗しました',action:'自動再試行は最大3回です。上限に達した場合は手動で再試行できます。',retry:true};
  return {kind:'other',title:'同期を完了できませんでした',action:'診断詳細を確認してください。再試行時は保存済みの状態から安全に確認します。',retry:true};
}

export function nextMenuCheck(now = new Date()) {
  const day = new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const noon = new Date(`${day}T12:00:00+09:00`);
  return new Date(noon.getTime()+(noon<=now?86400000:0)).toISOString();
}

export function canRetryMenuJob(job:{id:string;status:string;platform:string;revision:string|null}, latestId:string|undefined, revision:number) {
  return job.status==='failed' && ['rocket_now','demae_can'].includes(job.platform) && latestId===job.id && job.revision===String(revision);
}
