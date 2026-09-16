export type NativeOrderPushStatus = {
  ok: boolean; googlePlayAvailable: boolean; notificationsAllowed: boolean; soundEnabled: boolean;
  locationAllowed: boolean; locationEnabled: boolean; token: string; deviceId: string; bound: boolean;
  error: string; geoError: string; syncError: string; lastSyncAt: number; lastReceivedAt: number;
  presence: Array<{ storeId: string; ruleKey: string; state: "inside" | "outside" | "unknown"; observedAt: number }>;
};
declare global {
  interface Window { Foundr1OrderPush?: { postMessage: (message: string) => void; onmessage: ((event: MessageEvent) => void) | null }; }
}
const pending = new Map<string, { resolve: (value: NativeOrderPushStatus) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function nativeOrderPush(action: string, data: Record<string, unknown> = {}) {
  return new Promise<NativeOrderPushStatus>((resolve, reject) => {
    const bridge = window.Foundr1OrderPush;
    if (!bridge) { reject(new Error("STORE Android アプリで開いてください。")); return; }
    bridge.onmessage = (event) => {
      try {
        const result = JSON.parse(String(event.data)), entry = pending.get(result.id);
        if (!entry) return;
        clearTimeout(entry.timer); pending.delete(result.id);
        if (result.ok) entry.resolve(result); else entry.reject(new Error("端末の通知設定を確認してください。"));
      } catch { /* Ignore unrelated messages. */ }
    };
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("端末が応答しませんでした。")); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    bridge.postMessage(JSON.stringify({ ...data, id, action }));
  });
}
