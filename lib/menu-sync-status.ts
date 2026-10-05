type MenuIssueDetails={name?:string;targetName?:string;sourceName?:string;code?:string;platform?:string;sourceKey?:string;adaptedName?:string;stage?:string};
type MenuIssueContext={targetName?:string;issues?:MenuIssueDetails[]};

// Error strings from older Bridges may wrap a JSON object in additional API
// errors. Read only complete JSON values; never use an ID or error code as a
// customer-facing product name.
function menuIssueDetails(error:string):MenuIssueDetails[] {
  const details:MenuIssueDetails[]=[];
  let start=-1,depth=0,quoted=false,escaped=false;
  for(let index=0;index<error.length;index++) {
    const character=error[index];
    if(start<0) {
      if(character==='{'||character==='['){start=index;depth=1;}
      continue;
    }
    if(quoted) {
      if(escaped)escaped=false;
      else if(character==='\\')escaped=true;
      else if(character==='"')quoted=false;
      continue;
    }
    if(character==='"')quoted=true;
    else if(character==='{'||character==='[')depth++;
    else if(character==='}'||character===']')depth--;
    if(depth===0) {
      try {
        const value=JSON.parse(error.slice(start,index+1));
        const rows=Array.isArray(value)?value:[value];
        for(const row of rows)if(row&&typeof row==='object')details.push(row as MenuIssueDetails);
      }catch {}
      start=-1;
    }
  }
  return details;
}

// Return only the small diagnostic projection used by the menu status UI.
// Exact saved source identities may supply a missing or stale display name.
export function menuSyncIssueContext(error='',targetNames:Record<string,string>={}) {
  const issues:MenuIssueDetails[]=[];
  for(const detail of menuIssueDetails(error)) {
    const sourceKey=typeof detail.sourceKey==='string'&&detail.sourceKey.trim()?detail.sourceKey:undefined;
    const code=typeof detail.code==='string'&&detail.code.trim()?detail.code:undefined;
    const displayName=(value:unknown)=>typeof value==='string'&&value.trim()
      &&value!==sourceKey&&value!==code
      &&!/^(?:(?:item|option|option_group|category):|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)/i.test(value.trim())
        ?value.trim():undefined;
    const mapped=sourceKey&&Object.prototype.hasOwnProperty.call(targetNames,sourceKey)?targetNames[sourceKey]:undefined;
    const name=displayName(mapped)
      ??[detail.sourceName,detail.name,detail.targetName].map(displayName).find(value=>value!==undefined);
    const stage=typeof detail.stage==='string'&&/^(input_validation|configuration|http|response_json|response_status|output_incomplete|output_refusal|output_json|output_schema|candidate_name|candidate_unchanged|candidate_repeated|candidate_quantities|candidate_identity|candidate_unsafe|request|deadline|candidate_limit)$/.test(detail.stage)?detail.stage:undefined;
    if(sourceKey||code||name||stage)issues.push({...(sourceKey?{sourceKey}:{}),...(code?{code}:{}),...(name?{name}:{}),...(stage?{stage}:{})});
  }
  return {issues};
}

export function menuSyncIssue(error = '',language='ja',context:MenuIssueContext={}) {
  const label=(ja:string,cn:string,tw=cn)=>language==='ja'?ja:language==='zh-Hant'?tw:cn;
  if (!error) return null;
  const contextualIssues=context.issues??[];
  const contextualKeys=new Set(contextualIssues.map(row=>row.sourceKey).filter((key):key is string=>typeof key==='string'&&!!key));
  const details=[...menuIssueDetails(error).filter(row=>!row.sourceKey||!contextualKeys.has(row.sourceKey)),...contextualIssues];
  const content=error.match(/^uber_authority_content_failed:(option:[^:]+:[^:]+|(?:item|option_group|category):[^:]+):(.+?):(?:merchant_menu_operation_failed|[a-z][a-z0-9_]*(?:[:\s]|$))/);
  const contentName=content&&!contextualKeys.has(content[1])?content[2]:undefined;
  const names=[...new Set([...details.map(row=>row.sourceName||row.name||row.targetName),context.targetName,contentName].filter((name):name is string=>typeof name==='string'&&!!name.trim()))];
  const target=names.length?label(`対象：${names.join('、')}。`,`对象：${names.join('、')}。`,`對象：${names.join('、')}。`):'';
  const action=(ja:string,cn:string,tw=cn)=>target+label(ja,cn,tw);
  if(error.includes('uber_publication_reconcile_active'))return {kind:'verify',title:label('メニューの確認・同期を実行中です','正在核对或同步菜单','正在核對或同步菜單'),action:action('現在の処理が終わるまでお待ちください。状態を更新すると各プラットフォームの進捗を確認できます。','请等待当前任务完成，刷新状态可查看各平台进度。','請等待目前工作完成，重新整理狀態可查看各平台進度。'),retry:false};
  if(error.includes('uber_publication_reconcile_disabled'))return {kind:'verify',title:label('この店舗のメニュー自動反映は無効です','此门店尚未启用菜单自动同步','此門店尚未啟用菜單自動同步'),action:action('対象店舗と連携設定を確認してください。無効な連携への書き込みは行いません。','请核对目标门店和菜单同步设置，系统不会写入已停用的关联。','請核對目標門店及菜單同步設定，系統不會寫入已停用的關聯。'),retry:false};
  if(error.includes('uber_publication_reconcile_scheduled_limit'))return {kind:'verify',title:label('自動再試行を一時停止しています','自动重试已暂停','自動重試已暫停'),action:action('繰り返す失敗を避けるため自動再試行を制限しました。失敗理由を確認し、Uber の最新メニューを手動で確認してください。','为避免重复失败，已暂停继续自动重试。请查看失败原因，再手动检查 Uber 最新菜单。','為避免重複失敗，已暫停繼續自動重試。請查看失敗原因，再手動檢查 Uber 最新菜單。'),retry:true};
  if(error.includes('uber_publication_reconcile_pending_removal'))return {kind:'verify',title:label('Uber の欠落項目を再確認してください','等待确认 Uber 中缺失的项目','等待確認 Uber 中缺失的項目'),action:action('誤削除を防ぐため反映を保留しました。1分以上あけて Uber の最新メニューを再読み取りしてください。','为防止误删，菜单写入已暂停。请间隔至少 1 分钟重新读取 Uber 最新菜单。','為防止誤刪，菜單寫入已暫停。請間隔至少 1 分鐘重新讀取 Uber 最新菜單。'),retry:false};
  if(error.includes('uber_publication_reconcile_not_configured'))return {kind:'verify',title:label('プラットフォームの連携設定が不足しています','平台菜单关联尚未配置完整','平台菜單關聯尚未設定完整'),action:action('対象店舗の管理画面とメニュー連携先を設定してから、最新メニューを確認してください。','请先配置目标门店的平台后台和菜单关联，再检查最新菜单。','請先設定目標門店的平台後台及菜單關聯，再檢查最新菜單。'),retry:false};
  if(error.includes('uber_publication_reconcile_catalog_missing'))return {kind:'verify',title:label('最新の Uber メニューを読み取る必要があります','需要重新读取 Uber 最新菜单','需要重新讀取 Uber 最新菜單'),action:action('安全に同期するためのメニュー記録がありません。Uber の最新メニューを確認し、読み取り完了後に同期してください。','缺少可用于安全同步的菜单记录，请检查 Uber 最新菜单，读取完成后再同步。','缺少可用於安全同步的菜單紀錄，請檢查 Uber 最新菜單，讀取完成後再同步。'),retry:false};
  if(error.includes('uber_publication_reconcile_manual_required'))return {kind:'verify',title:label('手動で同期結果の確認が必要です','需要手动核对同步结果','需要手動核對同步結果'),action:action('前回の失敗は通信以外の問題のため、自動再試行は行いません。失敗理由を確認し、最新メニューを手動で確認してください。','上次失败并非临时连接问题，不会自动重复执行。请查看失败原因，再手动检查最新菜单。','上次失敗並非臨時連線問題，不會自動重複執行。請查看失敗原因，再手動檢查最新菜單。'),retry:false};
  if(/uber_publication_reconcile_(?:conflict|identity_changed|candidate_changed)/.test(error))return {kind:'verify',title:label('メニューの対応関係が変更されています','菜单版本或对应关系已变化','菜單版本或對應關係已變化'),action:action('古い記録の再実行は停止しました。状態を更新し、Uber の最新メニューを確認してから同期をやり直してください。','已阻止执行旧记录。请刷新状态，再检查 Uber 最新菜单后重新同步。','已阻止執行舊紀錄。請重新整理狀態，再檢查 Uber 最新菜單後重新同步。'),retry:false};
  if(error.includes('menu_name_ai_recovery_unavailable'))return {kind:'verify',title:label('旧記録から安全に名称を調整できません','旧记录不足以安全调整名称','舊紀錄不足以安全調整名稱'),action:action('旧記録には元のプラットフォーム拒否内容が保存されておらず、正しい調整対象を特定できません。Uber の最新メニューを読み取り、新しい同期を開始してください。Uber の原名を変更する必要はありません。','旧记录未保存原始平台拒绝，无法确定安全改名对象。请重新读取 Uber 最新菜单，创建新的同步任务；无需修改 Uber 原名。','舊紀錄未儲存原始平台拒絕，無法確定安全改名對象。請重新讀取 Uber 最新菜單，建立新的同步工作；無需修改 Uber 原名。'),retry:false};
  const aiStage=details.find(row=>row.stage)?.stage;
  const aiStageReason=aiStage==='output_incomplete'?label('AI の応答が完成する前に終了しました。','AI 响应在完成前停止了。','AI 回應在完成前停止了。')
    :['response_json','output_json','output_schema'].includes(aiStage??'')?label('AI の応答から有効な名称候補を読み取れませんでした。','无法从 AI 响应中读取有效的名称候选。','無法從 AI 回應中讀取有效的名稱候選。')
    :aiStage==='response_status'?label('AI の処理が正常に完了しませんでした。','AI 服务未正常完成这次请求。','AI 服務未正常完成這次請求。')
    :aiStage==='output_refusal'?label('AI が名称候補の作成を見送りました。','AI 未提供可使用的名称候选。','AI 未提供可使用的名稱候選。')
    :aiStage==='candidate_quantities'?label('候補の数量・単位・価格条件が元の名称と一致しませんでした。','候选中的数量、单位或价格条件与原名不一致。','候選中的數量、單位或價格條件與原名不一致。')
    :aiStage==='candidate_identity'?label('候補の商品種類・識別情報が元の対象と一致しませんでした。','候选的商品种类或身份信息与原项目不一致。','候選的商品種類或身分資訊與原項目不一致。')
    :['candidate_unchanged','candidate_repeated'].includes(aiStage??'')?label('元の名称と同じ、またはすでに試した候補でした。','候选仍与原名相同，或重复了已经尝试的名称。','候選仍與原名相同，或重複了已經嘗試的名稱。')
    :aiStage==='candidate_name'?label('候補がプラットフォームの名称条件を満たしていませんでした。','候选未满足平台的名称格式或长度要求。','候選未滿足平台的名稱格式或長度要求。')
    :aiStage==='configuration'?label('AI サービスの設定を確認する必要があります。','需要检查 AI 服务配置。','需要檢查 AI 服務設定。'):'';
  if(error.includes('menu_name_ai_retry_prepared'))return {kind:'verify',title:label('AI がこのプラットフォーム向けの名称を用意しました','AI 已生成适合该平台的名称','AI 已產生適合該平台的名稱'),action:action('再試行を予約しました。保存・読み取り確認が完了すると同期結果に表示されます。','已安排重试，正在等待平台保存并回读确认；完成后会更新同步结果。','已安排重試，正在等待平台儲存及回讀確認；完成後會更新同步結果。'),retry:true};
  if(error.includes('menu_name_ai_candidate_prepared'))return {kind:'verify',title:label('AI の名称候補を保存しました','AI 名称候选已保存','AI 名稱候選已儲存'),action:action('まだ実行していません。他の処理が完了したら、このプラットフォームを再試行して保存・読み取り確認を行ってください。','尚未执行同步。其他任务完成后，请重试此平台，保存并回读确认候选。','尚未執行同步。其他工作完成後，請重試此平台，儲存並回讀確認候選。'),retry:true};
  if(error.includes('menu_name_ai_unavailable'))return {kind:'network',title:label('AI の名称調整を利用できませんでした','暂时无法使用 AI 调整名称','暫時無法使用 AI 調整名稱'),action:action(aiStageReason+'AI への接続を確認し、同期を再試行してください。Uber の名称変更は不要です。',aiStageReason+'请检查 AI 服务连接后重试同步，无需修改 Uber 原名。',aiStageReason+'請檢查 AI 服務連線後重試同步，無需修改 Uber 原名。'),retry:true};
  if(error.includes('menu_name_ai_timeout'))return {kind:'network',title:label('AI の名称調整に時間がかかっています','AI 调整名称超时','AI 調整名稱逾時'),action:action('時間をあけて同期を再試行してください。再試行では名称を改めて確認します。','请稍后重试同步，重试时会重新核对名称。','請稍後重試同步，重試時會重新核對名稱。'),retry:true};
  if(error.includes('menu_name_ai_invalid'))return {kind:'verify',title:label('AI の名称候補を確認できませんでした','AI 生成的名称未通过检查','AI 產生的名稱未通過檢查'),action:action(aiStageReason+'この候補は送信していません。再試行すると保存済みの対象から別の名称を作成します。繰り返す場合は対象名とプラットフォームの入力条件を確認してください。',aiStageReason+'这次候选没有提交给平台。重试会直接为已确认的对象重新生成名称；若反复失败，请核对这项名称及平台的输入要求。',aiStageReason+'這次候選沒有提交給平台。重試會直接為已確認的對象重新產生名稱；若反覆失敗，請核對這項名稱及平台的輸入要求。'),retry:true};
  if(error.includes('menu_name_ai_unsafe'))return {kind:'content',title:label('AI の候補で元の意味を保てるか確認が必要です','AI 候选可能改变原名含义，需要确认','AI 候選可能改變原名含義，需要確認'),action:action(aiStageReason+'この候補は送信していません。商品の種類・量・価格条件を保つ名称を確認してから、このプラットフォームの同期を再開してください。',aiStageReason+'已阻止提交这次候选。请确认能保留商品种类、份量和价格条件的名称，再继续同步此平台。',aiStageReason+'已阻止提交這次候選。請確認能保留商品種類、份量及價格條件的名稱，再繼續同步此平台。'),retry:false};
  if(error.includes('menu_name_ai_exhausted'))return {kind:'content',title:label('プラットフォームに受け付けられる名称を作成できませんでした','暂未生成平台能接受的名称','暫未產生平台能接受的名稱'),action:action('複数の候補を試しました。対象名とプラットフォームの文字・長さ制限を確認し、送信する名称を調整してください。Uber 原本を変更する必要はありません。','已尝试多个候选。请核对这项名称及平台的字符、长度限制，调整此平台的展示名称；无需修改 Uber 原始菜单。','已嘗試多個候選。請核對這項名稱及平台的字元、長度限制，調整此平台的展示名稱；無需修改 Uber 原始菜單。'),retry:false};
  if(error.includes('demae_internal_carrier_'))return {kind:'verify',title:label('出前館の内部保管グループを確認する必要があります','需要核对出前馆内部暂存组','需要核對出前館內部暫存組'),action:action('内部保管グループの作成記録と、実際のメンバー・利用先が一致しません。別の商品を選ばないよう書き込みを停止しました。出前館の保管グループと商品・選択肢の ID を確認し、正しい関連付けを修正してください。Uber の原名を変更する必要はありません。','内部暂存组的创建记录与实际成员或引用它的商品不一致。为避免选错商品，已暂停写入。请核对出前馆暂存组及商品、选项的 ID，修正正确的对应关系；无需修改 Uber 原名。','內部暫存組的建立紀錄與實際成員或引用它的商品不一致。為避免選錯商品，已暫停寫入。請核對出前館暫存組及商品、選項的 ID，修正正確的對應關係；無需修改 Uber 原名。'),retry:false};
  if(error.startsWith('uber_source_pending_removal:')) {
    let names='';
    try { names=JSON.parse(error.slice('uber_source_pending_removal:'.length)).map((row:{name?:string})=>row.name).filter(Boolean).join('、'); } catch {}
    return {kind:'verify',title:label('Uber の欠落項目を再確認してください','等待确认 Uber 中缺失的项目','等待確認 Uber 中缺失的項目'),action:label(
      `対象：${names||'技術情報を確認してください'}。誤削除を防ぐため今回の反映は保留しました。既存の状態は変更していません。1分以上あけて Uber の最新メニューを再読み取りしてください。`,
      `对象：${names||'请查看技术信息'}。为防止误删，本次菜单写入已暂停，未改变现有状态。请间隔至少 1 分钟重新读取 Uber 最新菜单，不要重试旧任务。`,
      `對象：${names||'請查看技術資訊'}。為防止誤刪，本次菜單寫入已暫停，未改變現有狀態。請間隔至少 1 分鐘重新讀取 Uber 最新菜單，不要重試舊工作。`),retry:false};
  }
  if(/category_order_unsupported/.test(error))return {kind:'verify',title:label('分類の並び順を反映できませんでした','分类顺序尚未同步','分類順序尚未同步'),action:action('Uber と現在の分類順が異なります。対応するプラットフォームの並べ替え操作を確認してから再開してください。順序を確認できるまでは同期完了と表示しません。','平台当前分类顺序与 Uber 不一致。需要核对该平台的分类排序操作后继续；顺序未通过回读检查前不会显示同步完成。','平台目前分類順序與 Uber 不一致。需要核對該平台的分類排序操作後繼續；順序未通過回讀檢查前不會顯示同步完成。'),retry:false};
  if(/category_order_identity_mismatch|category_order_metadata_missing|order_scope_invalid/.test(error))return {kind:'verify',title:label('並べ替える分類の対応関係を確認してください','需要核对排序分类的对应关系','需要核對排序分類的對應關係'),action:action('保存済みの分類 ID とプラットフォームの分類一覧が一致しないため、別の分類を変更しないよう停止しました。分類の対応関係を確認してください。Uber の変更は不要です。','保存的分类 ID 与平台分类列表不一致，已暂停排序以避免改错分类。请核对分类对应关系，无需修改 Uber。','儲存的分類 ID 與平台分類列表不一致，已暫停排序以避免改錯分類。請核對分類對應關係，無需修改 Uber。'),retry:false};
  if(/category_order_availability_changed/.test(error))return {kind:'verify',title:label('並べ替え後の販売状態を確認する必要があります','排序后销售状态未通过核对','排序後銷售狀態未通過核對'),action:action('並べ替え前後の販売状態が一致しません。追加の変更を停止しました。プラットフォームの実際の販売状態と同時操作の有無を確認してください。','排序前后的销售状态不一致，已停止后续修改。请核对平台实际销售状态及是否有同时操作；不会直接重试上下架。','排序前後的銷售狀態不一致，已停止後續修改。請核對平台實際銷售狀態及是否有同時操作；不會直接重試上下架。'),retry:false};
  if(/order_verification_failed|category_order_migration_required/.test(error))return {kind:'verify',title:label('保存後の並び順を確認できませんでした','保存后的顺序未通过核对','儲存後的順序未通過核對'),action:action('プラットフォームから読み取った実際の順序が Uber と一致しません。保存結果を確認してから再試行してください。同期完了とは扱いません。','从平台回读的实际顺序仍与 Uber 不一致。请确认保存结果后重试；本次不会标记为同步完成。','從平台回讀的實際順序仍與 Uber 不一致。請確認儲存結果後重試；本次不會標記為同步完成。'),retry:true};
  if(/(?:item_group|group_membership|category_membership|item_category|option_group)_migration_required/.test(error))return {kind:'verify',title:label('商品・選択グループの関連付けを確認する必要があります','商品或选择组的关联需要核对','商品或選擇組的關聯需要核對'),action:action('同期履歴と現在の関連付けが一致せず、書き込み前に停止しました。既存の商品 ID とグループを確認し、同じ商品の対応関係を修正してから再試行してください。内部の一時保管グループも確認が必要です。','同步记录与现有分组关联不一致，已在写入前停止。请核对现有商品 ID 和分组，修正同一商品的对应关系后重试；内部暂存组也需要一并核对。','同步紀錄與現有分組關聯不一致，已在寫入前停止。請核對現有商品 ID 及分組，修正同一商品的對應關係後重試；內部暫存組也需要一併核對。'),retry:false};
  if(/existing_unmapped_candidate|creation_existing_candidate|conflicting_physical_object|mapped_object_missing/.test(error))return {kind:'verify',title:label('プラットフォームにある商品との対応関係を確認してください','需要确认与平台现有商品的对应关系','需要確認與平台現有商品的對應關係'),action:action('同名の商品があるか、保存済みの対応先を見つけられませんでした。商品・選択肢の ID を確認し、既存の正しい対象に関連付けてから再試行してください。名前だけで新規作成・統合は行いません。','发现同名候选，或原先关联的项目已找不到。请核对平台商品、选项的 ID，关联到已有的正确项目后重试。系统会保留现有项目，不会仅凭同名重复创建或合并。','發現同名候選，或原先關聯的項目已找不到。請核對平台商品、選項的 ID，關聯到已有的正確項目後重試。系統會保留現有項目，不會僅憑同名重複建立或合併。'),retry:false};
  if(error.startsWith('demae_menu_item_retirement_failed:')) {
    let name='';
    try {name=String(JSON.parse(error.match(/^demae_menu_item_retirement_failed:(\{.*\}):merchant_menu_operation_failed:/)?.[1]??'{}').name??'');} catch {}
    return {kind:'content',title:label('旧商品の非公開分類への移動に失敗しました','旧商品移入非公开分类失败','舊商品移入非公開分類失敗'),action:label(`対象：${name||'技術情報の商品 ID を確認してください'}。営業メニューから外すための保存が拒否されました。保存結果を確認してから再試行してください。`,`对象：${name||'请查看技术信息中的商品 ID'}。从营业菜单移出的保存请求被拒绝，请核对保存结果后重试。`,`對象：${name||'請查看技術資訊中的商品 ID'}。從營業菜單移出的儲存請求被拒絕，請核對結果後重試。`),retry:true};
  }
  if(error.includes('MWA0012'))return {kind:'content',title:label('出前館が保存内容の入力チェックで拒否しました','出前馆拒绝保存：输入校验未通过','出前館拒絕儲存：輸入驗證未通過'),action:action('送信項目・分類の関連付けを確認し、入力条件を満たす内容に調整してから再試行してください。','请检查提交字段及分类关联，调整为符合平台输入要求的内容后重试，不是登录错误。','請檢查提交欄位及分類關聯，調整為符合平台輸入要求的內容後重試，不是登入錯誤。'),retry:false};
  if(error.includes('rocket_menu_group_quantity_invalid'))return {kind:'content',title:label('Rocket Now のグループ数量設定を送信できません','火箭分组的可选数量设置无法提交','火箭分組的可選數量設定無法提交'),action:action('最小・最大選択数が送信条件に合っていません。連携側の数量変換を確認する必要があります。','最少／最多可选数量不符合提交条件，需要检查同步程序的数量转换。','最少／最多可選數量不符合提交條件，需要檢查同步程式的數量轉換。')+(names.length?'':label('この旧記録には対象グループが保存されていないため、最新メニューを再読み取りして対象を確認してください。','这条旧记录没有保存具体分组，请重新读取最新菜单以确定对象。','這條舊紀錄沒有保存具體分組，請重新讀取最新菜單以確定對象。')),retry:false};
  if(/401|MWA0007/.test(error))return {kind:'login',title:label('メニュー管理 API の認証が拒否されました','菜单管理接口拒绝了登录认证','菜單管理介面拒絕了登入認證'),action:label('メニュー一覧の取得で停止しました。Bridge 専用画面のログイン・メニュー管理権限を確認してください。在庫の読み取り成功とは別の確認です。','任务在读取菜单列表时停止。请检查 Bridge 专用窗口的登录和菜单管理权限；库存读取成功不代表菜单接口认证成功。','工作在讀取菜單列表時停止。請檢查 Bridge 專用視窗的登入和菜單管理權限；庫存讀取成功不代表菜單介面認證成功。'),retry:true};
  if (/login|unauthori[sz]ed|session.*expir/i.test(error)) return {kind:'login',title:label('ログインの確認が必要です','需要确认登录状态','需要確認登入狀態'),action:action('Bridge の専用画面でログインしてから再試行してください。','请在 Bridge 专用窗口登录后重试同步。','請在 Bridge 專用視窗登入後重試同步。'),retry:true};
  if (/403|access.denied|forbidden/i.test(error)) return {kind:'access',title:label('管理画面へのアクセスが拒否されました','平台拒绝访问管理页面','平台拒絕存取管理頁面'),action:action('Bridge の専用画面で店舗とメニュー編集権限を確認してから再試行してください。','请在 Bridge 专用窗口核对门店及菜单编辑权限后重试。','請在 Bridge 專用視窗核對門店及菜單編輯權限後重試。'),retry:true};
  if (/uncertain|not_isolated|identity|ambiguous|unverified|draft_exposed/i.test(error)) return {kind:'verify',title:label('保存結果・非公開状態の確認が必要です','需要核对保存结果及隐藏状态','需要核對儲存結果及隱藏狀態'),action:action('接続・保存結果を確認して再試行してください。既存の作成記録を使って読み取り確認し、確認できない場合は書き込みを停止します。','请确认连接与保存结果后重试。重试会依据现有创建记录重新读取，确认不了时会暂停写入。','請確認連線與儲存結果後重試。重試會依據現有建立紀錄重新讀取，無法確認時會暫停寫入。'),retry:true};
  if (/特殊文字|special.character|(?:native_group_)?name_too_long|projected_name/i.test(error)) return {kind:'content',title:label('このプラットフォームでは現在の名称を保存できません','此平台无法保存当前名称','此平台無法儲存目前名稱'),action:action('文字・長さ制限に合わせた名称が必要です。AI の名称調整を含めて同期をやり直してください。Uber の原名を変更する必要はありません。','需要符合该平台字符、长度限制的名称。请重新同步以使用 AI 名称调整；无需修改 Uber 原名。','需要符合該平台字元、長度限制的名稱。請重新同步以使用 AI 名稱調整；無需修改 Uber 原名。'),retry:!/empty_projected_name/i.test(error)};
  if (/price_invalid|quantity|selection_policy_requires_confirmation/i.test(error)) return {kind:'content',title:label('価格・選択数の送信内容を確認する必要があります','需要核对提交的价格或可选数量','需要核對提交的價格或可選數量'),action:action('Uber の価格・選択条件と送信内容を照合してください。プラットフォームに合う変換を確認し、最新メニューから同期をやり直してください。','请核对 Uber 价格、选择条件与实际提交内容，确认平台转换正确后，从最新菜单重新同步。','請核對 Uber 價格、選擇條件及實際提交內容，確認平台轉換正確後，從最新菜單重新同步。'),retry:false};
  if (/preflight_blocked|unique.constraint/i.test(error)) return {kind:'content',title:label('同期前の確認で解決が必要な項目が見つかりました','同步前发现需要处理的项目','同步前發現需要處理的項目'),action:action('現在のメニューを再読み取りし、商品・グループの対応関係と送信内容を確認してください。問題の項目を解決してから同期を再開してください。','请重新读取当前菜单，核对商品、分组的对应关系和提交内容，处理这些项目后继续同步。','請重新讀取目前菜單，核對商品、分組的對應關係及提交內容，處理這些項目後繼續同步。'),retry:false};
  if (/timeout|timed.out|network|fetch.failed|request_failed:5|ECONN|ETIMEDOUT/i.test(error)) return {kind:'network',title:label('通信が一時的に失敗しました','平台连接暂时失败','平台連線暫時失敗'),action:action('自動再試行は最大3回です。上限に達した場合は Bridge の接続を確認して手動で再試行してください。','系统最多自动重试 3 次；若仍失败，请检查 Bridge 连接后手动重试。','系統最多自動重試 3 次；若仍失敗，請檢查 Bridge 連線後手動重試。'),retry:true};
  return {kind:'other',title:label('同期を完了できませんでした','同步尚未完成','同步尚未完成'),action:action('状態を更新して接続・保存結果を確認し、このプラットフォームだけ再試行してください。再発する場合は対象の名前と失敗した段階を確認してください。','请刷新状态，确认连接和保存结果后，仅重试这个平台；若再次失败，请核对具体项目和失败阶段。','請重新整理狀態，確認連線及儲存結果後，僅重試這個平台；若再次失敗，請核對具體項目及失敗階段。'),retry:true};
}

export function nextMenuCheck(now = new Date()) {
  const day = new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const noon = new Date(`${day}T12:00:00+09:00`);
  return new Date(noon.getTime()+(noon<=now?86400000:0)).toISOString();
}

export function canRetryMenuJob(job:{id:string;status:string;platform:string;revision:string|null}, latestId:string|undefined, revision:number) {
  return job.status==='failed' && ['rocket_now','demae_can'].includes(job.platform) && latestId===job.id && job.revision===String(revision);
}
