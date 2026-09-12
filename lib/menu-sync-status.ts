export function menuSyncIssue(error = '',language='ja') {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  if (!error) return null;
  if(error.startsWith('uber_source_pending_removal:')) {
    let names='';
    try { names=JSON.parse(error.slice('uber_source_pending_removal:'.length)).map((row:{name?:string;sourceKey:string})=>row.name||row.sourceKey).join('、'); } catch {}
    return {kind:'verify',title:label('Uber の欠落項目を再確認してください','等待确认 Uber 中缺失的项目','等待確認 Uber 中缺失的項目'),action:label(
      `対象：${names||'技術情報を確認してください'}。誤削除を防ぐため今回の反映は保留しました。既存の状態は変更していません。1分以上あけて Uber の最新メニューを再読み取りしてください。`,
      `对象：${names||'请查看技术信息'}。为防止误删，本次菜单写入已暂停，未改变现有状态。请间隔至少 1 分钟重新读取 Uber 最新菜单，不要重试旧任务。`,
      `對象：${names||'請查看技術資訊'}。為防止誤刪，本次菜單寫入已暫停，未改變現有狀態。請間隔至少 1 分鐘重新讀取 Uber 最新菜單，不要重試舊工作。`),retry:false};
  }
  if(error.includes('item_group_migration_required'))return {kind:'verify',title:label('商品の選択グループの関連付けを確認する必要があります','商品的选择组关联需要核对','商品的選擇組關聯需要核對'),action:label('同期履歴と現在の関連付けが一致せず、書き込み前に停止しました。内部の一時保管グループを含めて確認が必要です。Uber の設定を推測で変更しないでください。','同步记录与现有分组关联不一致，已在写入前停止。需要核对历史身份和内部暂存组，请勿猜测并修改 Uber 设置。','同步紀錄與現有分組關聯不一致，已在寫入前停止。需要核對歷史身分及內部暫存組，請勿猜測並修改 Uber 設定。'),retry:false};
  if(error.startsWith('demae_menu_item_retirement_failed:')) {
    let name='';
    try {name=String(JSON.parse(error.match(/^demae_menu_item_retirement_failed:(\{.*\}):merchant_menu_operation_failed:/)?.[1]??'{}').name??'');} catch {}
    return {kind:'content',title:label('旧商品の非公開分類への移動に失敗しました','旧商品移入非公开分类失败','舊商品移入非公開分類失敗'),action:label(`対象：${name||'技術情報の商品 ID を確認してください'}。営業メニューから外すための保存が拒否されました。保存結果を確認してから再試行してください。`,`对象：${name||'请查看技术信息中的商品 ID'}。从营业菜单移出的保存请求被拒绝，请核对保存结果后重试。`,`對象：${name||'請查看技術資訊中的商品 ID'}。從營業菜單移出的儲存請求被拒絕，請核對結果後重試。`),retry:true};
  }
  if(error.includes('MWA0012'))return {kind:'content',title:label('出前館が保存内容の入力チェックで拒否しました','出前馆拒绝保存：输入校验未通过','出前館拒絕儲存：輸入驗證未通過'),action:label('送信項目・分類の関連付けを確認する必要があります。ログインエラーではありません。','需要检查提交字段及分类关联，不是登录错误。','需要檢查提交欄位及分類關聯，不是登入錯誤。'),retry:false};
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
