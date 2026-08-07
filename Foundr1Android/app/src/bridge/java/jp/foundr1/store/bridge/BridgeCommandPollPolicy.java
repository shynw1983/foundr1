package jp.foundr1.store.bridge;

final class BridgeCommandPollPolicy {
    static final long STOP_POLLING = -1L;
    private static final long ONE_MINUTE_MS = 60_000L;
    private static final long FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
    private static final long FIFTEEN_MINUTES_MS = 15 * ONE_MINUTE_MS;

    private BridgeCommandPollPolicy() {}

    static long nextDelayMs(boolean realtimeConnected, long disconnectedForMs) {
        if (realtimeConnected) return STOP_POLLING;
        long duration = Math.max(0L, disconnectedForMs);
        if (duration < ONE_MINUTE_MS) return 5_000L;
        if (duration < FIVE_MINUTES_MS) return 15_000L;
        if (duration < FIFTEEN_MINUTES_MS) return ONE_MINUTE_MS;
        return 10 * ONE_MINUTE_MS;
    }
}
