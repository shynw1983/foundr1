package jp.foundr1.store;

/** Pure policy: uncertainty near either boundary keeps the last confirmed state. */
public final class StorePresencePolicy {
    public static String nextState(String previous, double distance, double accuracy, double enterRadius, double exitRadius) {
        if (!Double.isFinite(distance) || !Double.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return "unknown";
        if (distance - accuracy > exitRadius) return "outside";
        if (distance + accuracy < enterRadius) return "inside";
        return previous;
    }
}
