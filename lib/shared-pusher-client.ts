import Pusher from "pusher-js";

type RealtimeConfig = {
  key: string;
  cluster: string;
  authorizationEndpoint?: string;
};

type ConnectionHandler = (...args: any[]) => void;

type SharedState = {
  client: Pusher;
  key: string;
  cluster: string;
  leases: number;
  channelRefs: Map<string, number>;
  disconnectTimer: number;
};

let sharedState: SharedState | null = null;

function getState(config: RealtimeConfig) {
  if (sharedState?.disconnectTimer) {
    window.clearTimeout(sharedState.disconnectTimer);
    sharedState.disconnectTimer = 0;
  }
  if (sharedState && sharedState.key === config.key && sharedState.cluster === config.cluster) return sharedState;
  if (sharedState) sharedState.client.disconnect();

  const client = new Pusher(config.key, {
    cluster: config.cluster,
    channelAuthorization: {
      endpoint: config.authorizationEndpoint ?? "/api/store/realtime-auth",
      transport: "ajax"
    }
  });
  sharedState = {
    client,
    key: config.key,
    cluster: config.cluster,
    leases: 0,
    channelRefs: new Map(),
    disconnectTimer: 0
  };
  return sharedState;
}

export function acquireSharedPusher(config: RealtimeConfig) {
  const state = getState(config);
  state.leases += 1;
  const heldChannels = new Set<string>();
  const connectionHandlers: Array<{ eventName: string; handler: ConnectionHandler }> = [];
  const channelHandlers = new Map<string, Array<{
    eventName: string;
    originalHandler: ConnectionHandler;
    boundHandler: ConnectionHandler;
  }>>();
  let released = false;

  const releaseChannel = (channelName: string) => {
    if (!heldChannels.delete(channelName)) return;
    const channel = state.client.channel(channelName);
    channelHandlers.get(channelName)?.forEach(({ eventName, boundHandler }) => {
      channel?.unbind(eventName, boundHandler);
    });
    channelHandlers.delete(channelName);
    const remaining = (state.channelRefs.get(channelName) ?? 1) - 1;
    if (remaining > 0) {
      state.channelRefs.set(channelName, remaining);
    } else {
      state.channelRefs.delete(channelName);
      state.client.unsubscribe(channelName);
    }
  };

  const release = () => {
    if (released) return;
    released = true;
    connectionHandlers.forEach(({ eventName, handler }) => state.client.connection.unbind(eventName, handler));
    Array.from(heldChannels).forEach(releaseChannel);
    state.leases = Math.max(0, state.leases - 1);
    if (state.leases > 0) return;
    state.disconnectTimer = window.setTimeout(() => {
      if (sharedState !== state || state.leases > 0) return;
      state.client.disconnect();
      sharedState = null;
    }, 5000);
  };

  return {
    connection: {
      bind(eventName: string, handler: ConnectionHandler) {
        connectionHandlers.push({ eventName, handler });
        state.client.connection.bind(eventName, handler);
      }
    },
    subscribe(channelName: string) {
      if (!heldChannels.has(channelName)) {
        heldChannels.add(channelName);
        state.channelRefs.set(channelName, (state.channelRefs.get(channelName) ?? 0) + 1);
      }
      const channel = state.client.subscribe(channelName);
      const bindings = channelHandlers.get(channelName) ?? [];
      channelHandlers.set(channelName, bindings);
      return {
        get name() {
          return channel.name;
        },
        bind(eventName: string, handler: ConnectionHandler) {
          const boundHandler: ConnectionHandler = (...args) => {
            if (!released) handler(...args);
          };
          bindings.push({ eventName, originalHandler: handler, boundHandler });
          channel.bind(eventName, boundHandler);
          if (eventName === "pusher:subscription_succeeded" && channel.subscribed) {
            window.queueMicrotask(() => {
              if (!released) handler();
            });
          }
        },
        unbind(eventName: string, handler?: ConnectionHandler) {
          const matching = bindings.filter((binding) => (
            binding.eventName === eventName
            && (!handler || binding.originalHandler === handler)
          ));
          matching.forEach((binding) => channel.unbind(eventName, binding.boundHandler));
          matching.forEach((binding) => bindings.splice(bindings.indexOf(binding), 1));
        }
      };
    },
    unsubscribe: releaseChannel,
    disconnect: release
  };
}
