package jp.foundr1.store;

final class InventoryTargetIdentity {
    private InventoryTargetIdentity() {}

    static boolean valid(String id) {
        return id != null && id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }
}
