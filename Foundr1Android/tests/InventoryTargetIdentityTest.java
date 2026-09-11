package jp.foundr1.store;

public class InventoryTargetIdentityTest {
    public static void main(String[] args) {
        if (!InventoryTargetIdentity.valid("e94830d7-605a-4cbd-9a12-0a645a93e9d8")) throw new AssertionError("valid ID rejected");
        for (String invalid : new String[]{null,"","pork","item:pork","sub_checkbox_1_2","e94830d7-605a-4cbd-9a12-0a645a93e9d8-extra"}) {
            if (InventoryTargetIdentity.valid(invalid)) throw new AssertionError("unsafe identity accepted: " + invalid);
        }
        System.out.println("Inventory identity checks passed");
    }
}
