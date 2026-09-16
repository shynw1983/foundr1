package jp.foundr1.store;

public class StorePresencePolicyTest {
    private static void check(String expected, String actual) { if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual); }
    public static void main(String[] args) {
        check("outside", StorePresencePolicy.nextState("unknown", 700, 30, 300, 500));
        check("inside", StorePresencePolicy.nextState("outside", 150, 30, 300, 500));
        check("outside", StorePresencePolicy.nextState("outside", 400, 20, 300, 500));
        check("inside", StorePresencePolicy.nextState("inside", 520, 80, 300, 500));
        check("unknown", StorePresencePolicy.nextState("outside", 700, 200, 300, 500));
        check("unknown", StorePresencePolicy.nextState("unknown", Double.NaN, 10, 300, 500));
        System.out.println("Store geofence policy tests passed");
    }
}
