"use client";

import { useEffect, useState } from "react";
import { useOsTranslation } from "./OsTranslationProvider";

type ExecutionState = {
  devices: { id: string; platform: string; device_name: string; last_seen_at: string | null }[];
  route: {
    device_id: string;
    status: string;
    claimed_by: string | null;
    result: { itemCount?: number; optionCount?: number } | null;
  } | null;
};

export function BridgeExecutionSwitch({ storeId }: { storeId: string }) {
  return <BridgeExecutionControl key={storeId} storeId={storeId} />;
}

function BridgeExecutionControl({ storeId }: { storeId: string }) {
  const { language } = useOsTranslation();
  const ja = language === "ja";
  const tw = language === "zh-Hant";
  const label = (japanese: string, simplified: string, traditional: string) =>
    ja ? japanese : tw ? traditional : simplified;
  const [data, setData] = useState<ExecutionState | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const endpoint = "/api/bridge/execution";

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${endpoint}?storeId=${encodeURIComponent(storeId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (response.status === 403) return;
        if (!response.ok) throw new Error("bridge_execution_read_failed");
        setData(await response.json());
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [storeId, revision]);

  async function select(deviceId: string) {
    if (!window.confirm(label(
      "実行端末を切り替えて、読み取りテストを開始しますか？ VPS 選択中は Rocket Now の書き込みが待機します。",
      "切换执行端并发起只读测试？选中 VPS 时，Rocket Now 的写入任务会等待。",
      "切換執行端並發起唯讀測試？選中 VPS 時，Rocket Now 的寫入任務會等待。"
    ))) return;
    setSending(true);
    setError(false);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, deviceId })
      });
      if (!response.ok) throw new Error("bridge_execution_switch_failed");
    } catch {
      setError(true);
    } finally {
      setRevision(value => value + 1);
      setSending(false);
    }
  }

  if (!data?.devices.some(device => device.platform === "desktop_vps")) return null;
  const host = (platform?: string) => platform === "desktop_vps" ? "東京 VPS" : "Mac";
  const selected = data.devices.find(device => device.id === data.route?.device_id);
  const claimed = data.devices.find(device => device.id === data.route?.claimed_by);
  const activeHost = data.route && !selected ? label("利用不可", "不可用", "無法使用") : host(selected?.platform);
  const status = data.route?.status;
  const statusLabel = status === "succeeded" ? label("読取成功", "只读成功", "唯讀成功")
    : status === "failed" ? label("読取失敗", "只读失败", "唯讀失敗")
    : status === "processing" ? label("実行中", "执行中", "執行中")
    : label("待機中", "排队中", "排隊中");
  return <div data-i18n-ignore>
    <small role="status" style={{ display: "block" }}>
      {label("実行端末", "执行端", "執行端")} {activeHost}
      {status && <> · {statusLabel}{claimed && ` · ${host(claimed.platform)}`}</>}
      {status === "succeeded" && data.route?.result && <>
        {" · "}{label("商品", "商品", "商品")} {data.route.result.itemCount}
        {" / "}{label("オプション", "选项", "選項")} {data.route.result.optionCount}
      </>}
    </small>
    {data.devices.map(device => <button key={device.id} type="button" className="secondary-button compact-button"
      disabled={sending || !device.last_seen_at || Date.now() - Date.parse(device.last_seen_at) > 360000}
      onClick={() => void select(device.id)}>{host(device.platform)} · {device.device_name}</button>)}
    <button type="button" className="secondary-button compact-button" disabled={sending}
      onClick={() => { setError(false); setRevision(value => value + 1); }}>
      {label("状態を確認", "刷新状态", "重新整理狀態")}
    </button>
    {error && <small role="alert" style={{ display: "block" }}>{label(
      "実行中のタスクと端末の接続を確認してから、再試行してください。",
      "请检查是否有执行中的任务，以及设备是否在线，再重试。",
      "請確認是否有執行中的任務，以及裝置是否在線，再重試。"
    )}</small>}
  </div>;
}
