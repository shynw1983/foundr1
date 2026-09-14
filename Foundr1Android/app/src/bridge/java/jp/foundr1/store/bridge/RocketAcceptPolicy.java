package jp.foundr1.store.bridge;

/** Decisions use observed minutes, never a count of dispatched taps. */
final class RocketAcceptPolicy {
    static boolean hasLine(String label, String expected) {
        for (String line : label.split("\\R")) if (line.trim().equals(expected)) return true;
        return false;
    }

    enum Action { WAIT, PLUS_FIVE, PLUS_ONE, ACCEPT }

    static Action decide(int recommended, int current, boolean atLimit, boolean plusFive, boolean plusOne) {
        if (recommended <= 0 || current <= 0 || current < recommended) return Action.WAIT;
        int remaining = recommended + 10 - current;
        if (remaining <= 0 || atLimit) return Action.ACCEPT;
        if (remaining >= 5 && plusFive) return Action.PLUS_FIVE;
        if (plusOne) return Action.PLUS_ONE;
        return Action.WAIT;
    }
}
