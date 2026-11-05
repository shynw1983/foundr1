'use client';
import { useEffect, useRef } from 'react';
import { bindStoreRealtimeChannels } from '../../../lib/store-realtime-refresh';
export type HqAlertRealtime = { key: string; cluster: string; channel: string };
export function useHqAlertRealtime(config: HqAlertRealtime | undefined, refresh: () => void, onHealthChange?: (healthy: boolean) => void, onUnauthorized?: (status: number) => void) {
  const callback = useRef(refresh), health = useRef(onHealthChange), denied = useRef(onUnauthorized);
  callback.current = refresh; health.current = onHealthChange; denied.current = onUnauthorized;
  const key = config?.key, cluster = config?.cluster, channel = config?.channel;
  useEffect(() => {
    health.current?.(false);
    if (!key || !cluster || !channel) return;
    let disposed = false, cleanup: (() => void) | undefined;
    void import('pusher-js').then(({ default: Pusher }) => {
      if (disposed) return;
      const client = new Pusher(key, { cluster, channelAuthorization: { endpoint: '/api/store/hq-alerts/realtime', transport: 'ajax' } });
      let unbind: (() => void) | undefined;
      unbind = bindStoreRealtimeChannels(client, {
        channels: [channel], events: ['hq-alert.updated'],
        onEvent: () => callback.current(),
        onUnauthorized: status => {
          if (disposed) return;
          disposed = true; health.current?.(false); unbind?.(); client.disconnect(); denied.current?.(status);
        },
        onHealthChange: healthy => {
          if (disposed) return;
          health.current?.(healthy);
          if (healthy && !health.current) callback.current();
        }
      });
      cleanup = () => { unbind?.(); client.disconnect(); };
    }).catch(() => { if (!disposed) health.current?.(false); });
    return () => { disposed = true; cleanup?.(); };
  }, [key, cluster, channel]);
}
