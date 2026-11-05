/** Scoped subscription health. A connected socket is not proof every required channel is ready. */
type RealtimeChannel = {
  subscribed?: boolean;
  bind(event: string, callback: (...args: any[]) => void): unknown;
  unbind(event: string, callback: (...args: any[]) => void): unknown;
};
type RealtimeClient = {
  subscribe(name: string): RealtimeChannel;
  connection: {
    state?: string;
    bind(event: string, callback: (...args: any[]) => void): unknown;
    unbind(event: string, callback: (...args: any[]) => void): unknown;
  };
};

export function bindStoreRealtimeChannels(client: RealtimeClient, options: {
  channels: string[];
  events: string[];
  onEvent: (...args: any[]) => void;
  onHealthChange: (healthy: boolean) => void;
  onUnauthorized?: (status: number) => void;
  subscriptionTimeoutMs?: number;
}) {
  let active = true;
  let healthy = false;
  let timedOut = false;
  const channels = [...new Set(options.channels.filter(Boolean))].map(name => client.subscribe(name));
  const ready = new Set<RealtimeChannel>();
  const unbind: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const report = (value: boolean, force = false) => {
    if (!active || (!force && healthy === value)) return;
    healthy = value;
    options.onHealthChange(value);
  };
  const verify = () => {
    const value = channels.length > 0 && ready.size === channels.length && client.connection.state === "connected";
    if (value) { clearTimeout(timer); timedOut = false; }
    report(value);
  };
  const deadline = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; report(false, true); }, options.subscriptionTimeoutMs ?? 15_000);
  };
  options.onHealthChange(false);
  for (const channel of channels) {
    const succeeded = () => { ready.add(channel); verify(); };
    const failed = (error?: { status?: number; statusCode?: number; error?: { status?: number; statusCode?: number } }) => {
      const status = Number(error?.status ?? error?.statusCode ?? error?.error?.status ?? error?.error?.statusCode);
      ready.delete(channel);
      if (status === 401 || status === 403) {
        // Explicit authorization denial is not an outage. Stop this binding before
        // notifying the owner, including already-authorized sibling event callbacks.
        report(false, true);
        active = false;
        ready.clear();
        clearTimeout(timer);
        unbind.forEach(dispose => dispose());
        options.onUnauthorized?.(status);
        return;
      }
      report(false, timedOut);
    };
    channel.bind("pusher:subscription_succeeded", succeeded);
    channel.bind("pusher:subscription_error", failed);
    const event = (...args: any[]) => { if (active) options.onEvent(...args); };
    for (const name of options.events) channel.bind(name, event);
    unbind.push(() => {
      channel.unbind("pusher:subscription_succeeded", succeeded);
      channel.unbind("pusher:subscription_error", failed);
      for (const name of options.events) channel.unbind(name, event);
    });
    if (channel.subscribed) ready.add(channel);
  }
  const stateChanged = (state: { current?: string }) => {
    if (state.current !== "connected") {
      ready.clear();
      report(false);
      deadline();
    } else {
      // Pusher may already have resubscribed shared channels before this listener.
      for (const channel of channels) if (channel.subscribed) ready.add(channel);
      deadline();
      verify();
    }
  };
  const error = () => { ready.clear(); report(false); deadline(); };
  client.connection.bind("state_change", stateChanged);
  client.connection.bind("error", error);
  unbind.push(() => client.connection.unbind("state_change", stateChanged), () => client.connection.unbind("error", error));
  deadline();
  verify();
  return () => {
    active = false;
    clearTimeout(timer);
    unbind.forEach(dispose => dispose());
    // Subscription ownership/ref-counting remains with the caller's shared client.
  };
}
