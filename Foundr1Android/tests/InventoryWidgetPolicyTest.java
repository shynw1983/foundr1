package jp.foundr1.store;

import java.util.HashMap;
import java.util.Map;

public class InventoryWidgetPolicyTest {
    private static int assertions;
    private static void check(boolean value, String message) {
        assertions++;
        if (!value) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        String id = "e94830d7-605a-4cbd-9a12-0a645a93e9d8";
        String otherId = "bcf6c6d0-5e10-47cc-b009-b3d54c7bc421";
        check(InventoryWidgetPolicy.canPreselect(id, "option", "brand-a", id, "option", "brand-a", false, true),
            "a still-unavailable exact identity can be selected for restoration");
        check(!InventoryWidgetPolicy.canPreselect(id, "option", "brand-a", id, "option", "brand-a", true, true),
            "an old widget tap must not restore an already available item");
        check(!InventoryWidgetPolicy.canPreselect(id, "option", "brand-a", id, "option", "brand-b", false, true),
            "brand scopes must not cross");
        check(!InventoryWidgetPolicy.canPreselect(id, "option", "brand-a", otherId, "option", "brand-a", false, true),
            "same-name options with different IDs must not be selected");
        check(!InventoryWidgetPolicy.canPreselect(id, "option", "brand-a", id, "item", "brand-a", false, true),
            "item and option identities must remain distinct");
        check(!InventoryWidgetPolicy.canPreselect("beef", "option", "brand-a", "beef", "option", "brand-a", false, true),
            "labels are not IDs");
        check(!InventoryWidgetPolicy.canPreselect(id, "option", "", id, "option", "", false, true),
            "a widget shortcut needs a resolved target brand even in the all-brand view");
        check(InventoryWidgetPolicy.matchesBrand("", "brand-a"), "all-brand widgets include known brands");
        check(!InventoryWidgetPolicy.matchesBrand("brand-a", ""), "unknown history identities do not leak into a scoped widget");

        check("succeeded".equals(InventoryWidgetPolicy.platformStatus(2, 2, 0, 0, 0, 0)), "all platform commands completed");
        check("queued".equals(InventoryWidgetPolicy.platformStatus(2, 1, 0, 0, 0, 1)), "one successful command is not platform completion");
        check("failed".equals(InventoryWidgetPolicy.platformStatus(3, 1, 1, 0, 1, 0)), "failure remains visible during another command");
        check("timed_out".equals(InventoryWidgetPolicy.platformStatus(2, 1, 0, 1, 0, 0)), "timeouts stay distinct");
        check("unknown".equals(InventoryWidgetPolicy.platformStatus(0, 0, 0, 0, 0, 0)), "missing data is not success");
        check("unknown".equals(InventoryWidgetPolicy.platformStatus(2, 1, 0, 0, 0, 0)), "incomplete counts are not success");
        check(!InventoryWidgetPolicy.pending("unknown"), "unrecognized states cannot cause indefinite retries");
        check(InventoryWidgetPolicy.pending("retrying"), "retrying platforms need follow-up reads");

        Map<String, String> names = new HashMap<>();
        names.put("zh", "牛肉"); names.put("en", "Beef");
        check("牛肉".equals(InventoryWidgetPolicy.label(names, "牛肉（50g）", "zh")), "Chinese comes from menu master");
        check("牛肉（50g）".equals(InventoryWidgetPolicy.label(names, "牛肉（50g）", "ja")), "Japanese preserves source name");
        names.put("zh", " ");
        check("Beef".equals(InventoryWidgetPolicy.label(names, "牛肉（50g）", "zh")), "missing translation falls back to English");
        names.clear();
        check("牛肉（50g）".equals(InventoryWidgetPolicy.label(names, "牛肉（50g）", "zh")), "final fallback is source");
        check(!InventoryWidgetPolicy.fresh(0, 100), "unknown read times are not fresh");
        check(!InventoryWidgetPolicy.fresh(100, 99), "future timestamps are not fresh");
        check(!InventoryWidgetPolicy.fresh(100, 100 + InventoryWidgetPolicy.FRESH_MILLIS + 1), "old inventory gets fetched on follow-up");
        check(InventoryWidgetPolicy.layout(110, 56) == InventoryWidgetPolicy.COMPACT, "2x1 entry uses compact layout");
        check(InventoryWidgetPolicy.layout(330, 156) == InventoryWidgetPolicy.SUMMARY, "4x2 entry shows summary");
        check(InventoryWidgetPolicy.layout(250, 110) == InventoryWidgetPolicy.DENSE, "short 4x2 launchers still show status, not just two buttons");
        check(InventoryWidgetPolicy.layout(330, 236) == InventoryWidgetPolicy.EXPANDED, "taller widgets show more shortages");
        check(InventoryWidgetPolicy.layout(180, 300) == InventoryWidgetPolicy.COMPACT, "narrow tall widgets do not clip wide rows");
        System.out.println("Inventory widget policy: " + assertions + " checks passed");
    }
}
