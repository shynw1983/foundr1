package jp.foundr1.store.bridge;

public final class RocketAcceptPolicyTest {
    static void check(int recommended, int current, boolean limit, boolean five, boolean one,
                      RocketAcceptPolicy.Action expected) {
        if (RocketAcceptPolicy.decide(recommended, current, limit, five, one) != expected)
            throw new AssertionError("Unexpected decision for " + recommended + "/" + current);
    }
    public static void main(String[] args) {
        String merged = "予想調理時間の変更\n予想調理時間を入力してください。\n13分\n推奨時間 13分";
        if (!RocketAcceptPolicy.hasLine(merged, "予想調理時間の変更")) throw new AssertionError("Merged Flutter dialog");
        if (RocketAcceptPolicy.hasLine(merged, "調理時間変更")) throw new AssertionError("Do not match partial labels");
        check(13, 13, false, true, true, RocketAcceptPolicy.Action.PLUS_FIVE);
        check(13, 18, false, true, true, RocketAcceptPolicy.Action.PLUS_FIVE);
        check(13, 23, true, false, false, RocketAcceptPolicy.Action.ACCEPT);
        check(13, 23, false, true, true, RocketAcceptPolicy.Action.ACCEPT);
        check(13, 20, false, true, true, RocketAcceptPolicy.Action.PLUS_ONE);
        check(13, 18, true, false, false, RocketAcceptPolicy.Action.ACCEPT);
        check(-1, 23, true, false, false, RocketAcceptPolicy.Action.WAIT);
        check(13, -1, true, false, false, RocketAcceptPolicy.Action.WAIT);
        check(13, 10, false, true, true, RocketAcceptPolicy.Action.WAIT);
        check(13, 18, false, false, false, RocketAcceptPolicy.Action.WAIT);
        System.out.println("RocketAcceptPolicy tests passed");
    }
}
