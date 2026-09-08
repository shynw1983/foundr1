package jp.foundr1.store.bridge;

/** Monotonic-time policy, independent of Android for deterministic verification. */
final class UberIdleScanPolicy {
    private long lastInteractionAt;
    private long nextBackAt;
    private int backAttempts;

    void noteInteraction(long now) {
        lastInteractionAt = now;
        backAttempts = 0;
        nextBackAt = now + 45_000L;
    }

    boolean recentInteraction(long now) {
        return now - lastInteractionAt < 5000L;
    }

    boolean isDue(long now) {
        return now - lastInteractionAt >= 45_000L && now >= nextBackAt;
    }

    void reachedOverview() {
        backAttempts = 0;
    }

    boolean allowBack(long now) {
        if (!isDue(now) || backAttempts >= 4) return false;
        backAttempts++;
        nextBackAt = now + 5000L;
        return true;
    }
}
