export function menuSyncIssue(error = '') {
  if (!error) return null;
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
