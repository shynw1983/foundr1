"use client";

import {useEffect, useState} from 'react';
import type {MenuSyncProgress, MenuSyncProgressResponse} from '../../../lib/menu-sync-progress';
import styles from './UberSourcePanel.module.css';

export type MenuProgress = MenuSyncProgress;
const actions: Record<string, string[]> = {
  read_menu: ['メニュー一覧を読み取り', '读取菜单列表', '讀取菜單列表', 'Reading menu'],
  read_item: ['商品詳細を読み取り', '读取商品详情', '讀取商品詳情', 'Reading product details'],
  read_category: ['分類を読み取り', '读取分类', '讀取分類', 'Reading categories'],
  read_options: ['選択グループ・選択肢を読み取り', '读取选项组和选项', '讀取選項組和選項', 'Reading option groups and options'],
  read_availability: ['販売状態を確認（変更なし）', '核对销售状态（不修改）', '核對銷售狀態（不修改）', 'Checking availability (read only)'],
  save: ['メニューを保存', '保存菜单', '儲存菜單', 'Saving menu']
};
const kinds: Record<string, string[]> = {
  item: ['商品', '商品', '商品', 'Product'],
  option: ['選択肢', '选项', '選項', 'Option'],
  option_group: ['選択グループ', '选项组', '選項組', 'Option group'],
  category: ['分類', '分类', '分類', 'Category']
};
const phases: Record<string, string[]> = {
  planning: ['差分計画', '计算待修改差异', '計算待修改差異', 'Planning changes'],
  preflight: ['差分確認', '核对差异', '核對差異', 'Checking differences'],
  content: ['商品名・価格', '名称和价格', '名稱和價格', 'Names and prices'],
  creating: ['非公開で作成', '创建为非公开', '建立為非公開', 'Creating hidden record'],
  relationships: ['分類・グループ', '分类和选项组', '分類和選項組', 'Categories and groups'],
  migrating: ['選択グループ移行', '迁移选项组', '遷移選項組', 'Moving option groups'],
  retiring: ['削除・非公開', '删除和非公开', '刪除和非公開', 'Removing or hiding'],
  verifying: ['回読確認', '回读确认', '回讀確認', 'Verifying saved results']
};

export function MenuJobProgress({progress: p = {}, updatedAt, language}: {progress?: MenuProgress; updatedAt: string; language: string}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const index = language === 'ja' ? 0 : language === 'zh-Hans' ? 1 : language === 'zh-Hant' ? 2 : 3;
  const text = (ja: string, cn: string, tw: string, en: string) => [ja, cn, tw, en][index];
  const action = (key = '') => actions[key]?.[index] ?? text('処理中', '处理中', '處理中', 'Processing');
  const kind = (key = '') => kinds[key]?.[index];
  const seconds = (at: number) => Math.max(0, Math.floor((now - at) / 1000));
  const stale = seconds(p.updatedAt ?? Date.parse(updatedAt)) > 60;
  const version2 = p.telemetryVersion === 2;
  const count = typeof p.completed === 'number' && typeof p.total === 'number' && (p.total > 0 || version2);
  const checked = version2 && typeof p.checkedTargets === 'number' && typeof p.totalTargets === 'number';
  const content = version2 && typeof p.contentChanges === 'number' && typeof p.contentCompleted === 'number';
  const stageLabel = version2 && p.phase === 'content'
    ? text('内容差分の処理済み対象', '差异对象已处理', '差異對象已處理', 'Content difference objects processed')
    : p.phase === 'preflight' || p.phase === 'planning'
      ? text('この段階の確認済み対象', '本阶段已核对对象', '本階段已核對對象', 'Objects checked in this stage')
      : text('この段階の確認・処理済み対象', '本阶段已核对／处理对象', '本階段已核對／處理對象', 'Objects checked or processed in this stage');
  const recent = p.recent ?? [];
  const wholeMenu = text('プラットフォームのメニュー全体', '平台菜单（整体处理）', '平台菜單（整體處理）', 'Platform menu (overall processing)');
  const responses = (rows: MenuSyncProgressResponse[], start = 1) => <ol start={start}>{rows.map((row, i) => <li key={`${row.at}-${start + i}`}>
    <div className={styles.progressResponseMeta}><time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleTimeString(language, {timeZone: 'Asia/Tokyo'})}</time><span>{action(row.action)}</span></div>
    <p className={styles.progressResponseTarget}>{kind(row.targetKind) && <span>{kind(row.targetKind)} · </span>}{row.targetName || wholeMenu}</p>
    {row.parentName && <p className={styles.progressCaption}>{text('所属', '所属', '所屬', 'Within')}：{row.parentName}</p>}
    <small>{[phases[row.phase ?? '']?.[index], text('応答受信', '收到响应', '收到回應', 'Response received')].filter(Boolean).join(' · ')}{(row.occurrences ?? 1) > 1 && ` × ${row.occurrences}`}</small>
  </li>)}</ol>;

  return <div className={styles.liveProgress} data-warning={stale || p.requestState === 'retrying'}>
    <strong>{stale ? text('進捗更新が途絶えています', '进度暂未更新', '進度暫未更新', 'Progress update overdue') : p.requestState === 'retrying' ? text('読み取りを再試行中', '正在重试读取', '正在重試讀取', 'Retrying read') : action(p.action)}</strong>
    <div className={styles.progressTarget} data-menu-progress-target>
      <span className={styles.progressCaption}>{text('現在の処理対象', '当前处理对象', '目前處理對象', 'Current object')}{kind(p.targetKind) && ` · ${kind(p.targetKind)}`}</span>
      <p className={styles.progressTargetName}>{p.targetName || (p.startedAt ? wholeMenu : text('Bridge からの詳細を待っています', '等待 Bridge 上报具体对象', '等待 Bridge 回報具體對象', 'Waiting for object details from Bridge'))}</p>
      {p.parentName && <p className={styles.progressCaption}>{text('所属', '所属', '所屬', 'Within')}：{p.parentName}</p>}
    </div>
    {p.requestState === 'waiting' && <span>{text('プラットフォームの応答待ち', '等待平台响应', '等待平台回應', 'Waiting for platform response')}</span>}
    {checked && <span data-menu-progress-checked>{text('差分確認済み', '已核对差异', '已核對差異', 'Checked for differences')}：{p.checkedTargets} / {p.totalTargets}</span>}
    {version2 && typeof p.skippedTargets === 'number' && <span>{text('内容変更不要・スキップ', '内容无变化跳过', '內容無變化跳過', 'Unchanged content skipped')}：{p.skippedTargets}</span>}
    {content && <span data-menu-progress-content>{text('内容差分の処理', '内容差异处理', '內容差異處理', 'Content differences processed')}：{p.contentCompleted} / {p.contentChanges} · {text('残り', '待处理', '待處理', 'Remaining')} {Math.max(0, p.contentChanges! - p.contentCompleted!)}</span>}
    {count && <>{(!content || p.phase !== 'content') && <span>{stageLabel}：{p.completed} / {p.total}</span>}{p.total! > 0 && <progress aria-label={text('この段階の進捗', '本阶段进度', '本階段進度', 'Stage progress')} value={p.completed} max={p.total}/>}</>}
    {version2 && (typeof p.readRequestsCompleted === 'number' || typeof p.writeRequestsCompleted === 'number') && <span data-menu-progress-requests>{text('読み取り応答', '读取响应', '讀取回應', 'Read responses')}：{p.readRequestsCompleted ?? 0} · {text('保存応答', '保存响应', '儲存回應', 'Save responses')}：{p.writeRequestsCompleted ?? 0}</span>}
    {p.startedAt && <span>{text('経過', '已运行', '已執行', 'Elapsed')}：{seconds(p.startedAt)} s</span>}
    {p.lastResponseAt && <span>{text('直近の応答', '最近响应', '最近回應', 'Last response')}：{seconds(p.lastResponseAt)} s{!version2 && <> · {p.requestsCompleted ?? 0} {text('応答', '次请求响应', '次請求回應', 'request responses')}</>}</span>}
    {!!p.retry && <span>{text('再試行', '重试', '重試', 'Retry')}：{p.retry} / 2</span>}
    {stale && <p>{text('停止とは限りません。接続と直近の応答を確認してください。', '不一定已停止，请检查连接和最近响应。', '不一定已停止，請檢查連線和最近回應。', 'This does not prove a stall. Check connectivity and the last response.')}</p>}
    {recent.length > 0 && <div className={styles.progressRecent}>
      <span className={styles.progressCaption}>{text('最近応答した対象', '最近响应对象', '最近回應對象', 'Recent response objects')}</span>
      {responses(recent.slice(0, 3))}
      {recent.length > 3 && <details><summary>{text('以前の応答を表示', '展开更早记录', '展開更早記錄', 'Show earlier responses')} ({recent.length - 3})</summary>{responses(recent.slice(3), 4)}</details>}
    </div>}
  </div>;
}
