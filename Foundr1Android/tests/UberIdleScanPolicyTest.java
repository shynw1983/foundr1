package jp.foundr1.store.bridge;

public final class UberIdleScanPolicyTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        UberIdleScanPolicy policy = new UberIdleScanPolicy();
        policy.noteInteraction(1000);
        check(!policy.isDue(45999), "Do not interrupt before 45 seconds");
        check(policy.allowBack(46000), "Quiet pages must trigger without new events");
        check(!policy.allowBack(47000), "Allow time for navigation");
        check(policy.allowBack(51000), "Second navigation step");
        check(policy.allowBack(56000), "Third navigation step");
        check(policy.allowBack(61000), "Fourth navigation step");
        check(!policy.allowBack(120000), "Stop on unknown pages after four steps");
        policy.noteInteraction(121000);
        check(policy.recentInteraction(122000), "Notification recovery defers for interaction");
        check(!policy.isDue(165999), "User interaction restarts idle delay");
        check(policy.allowBack(166000), "New idle session can navigate again");
        policy.reachedOverview();
        check(policy.allowBack(171000), "Reaching overview resets navigation budget");
        System.out.println("UberIdleScanPolicy tests passed");
    }
}
