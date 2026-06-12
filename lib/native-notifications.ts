type NativeNotificationPayload = {
  title: string;
  body: string;
  href?: string;
  tag?: string;
};

type NativeNotificationResult = {
  ok?: boolean;
  error?: string;
};

declare global {
  interface Window {
    Foundr1NativeNotifications?: {
      isAvailable?: () => boolean;
      canShow?: () => boolean;
      show?: (payloadJson: string) => NativeNotificationResult | Promise<NativeNotificationResult> | string | void;
    };
  }
}

function parseBridgeResult(result: NativeNotificationResult | string | void) {
  if (!result) return { ok: true };
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as NativeNotificationResult;
    } catch {
      return { ok: true };
    }
  }
  return result;
}

export function hasNativeNotificationBridge() {
  if (typeof window === "undefined") return false;
  return Boolean(window.Foundr1NativeNotifications?.show);
}

export async function showNativeNotification(payload: NativeNotificationPayload) {
  if (!hasNativeNotificationBridge()) return { ok: false, skipped: true };
  const bridge = window.Foundr1NativeNotifications;
  if (bridge?.isAvailable && !bridge.isAvailable()) return { ok: false, skipped: true };
  if (bridge?.canShow && !bridge.canShow()) return { ok: false, permissionDenied: true };
  try {
    const result = await bridge?.show?.(JSON.stringify(payload));
    const parsed = parseBridgeResult(result);
    return { ok: parsed.ok !== false, error: parsed.error };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Native notification failed"
    };
  }
}

