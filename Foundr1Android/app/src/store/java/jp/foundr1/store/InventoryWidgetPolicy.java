package jp.foundr1.store;

import java.util.Map;

/** Presentation rules shared by the widget and its operation detail sheet. */
final class InventoryWidgetPolicy {
    static final int COMPACT = 0;
    static final int SUMMARY = 1;
    static final int EXPANDED = 2;
    static final int DENSE = 3;
    static final int MINIMAL = 4;
    static final int SUMMARY_WIDTH = 250;
    static final int SUMMARY_HEIGHT = 164;
    static final int EXPANDED_HEIGHT = 208;
    static final long FRESH_MILLIS = 5 * 60 * 1000L;

    private InventoryWidgetPolicy() {}

    static int layout(int width, int height) {
        if (width < SUMMARY_WIDTH || height < 110) return width >= 160 && height >= 88 ? COMPACT : MINIMAL;
        if (height < SUMMARY_HEIGHT) return DENSE;
        return height >= EXPANDED_HEIGHT ? EXPANDED : SUMMARY;
    }

    static String label(Map<String, String> names, String source, String language) {
        if (!"zh".equals(language)) return clean(source);
        for (String key : new String[] { "zh", "zh-Hans", "en" }) {
            String value = names == null ? "" : clean(names.get(key));
            if (!value.isEmpty()) return value;
        }
        return clean(source);
    }

    static boolean matchesBrand(String selectedBrand, String itemBrand) {
        return clean(selectedBrand).isEmpty() || clean(selectedBrand).equals(clean(itemBrand));
    }

    static boolean fresh(long checkedAt, long now) {
        return checkedAt > 0 && now >= checkedAt && now - checkedAt <= FRESH_MILLIS;
    }

    static String platformStatus(int total, int succeeded, int failed, int timedOut, int processing, int queued) {
        if (failed > 0) return "failed";
        if (timedOut > 0) return "timed_out";
        if (processing > 0) return "processing";
        if (queued > 0) return "queued";
        return total > 0 && succeeded == total ? "succeeded" : "unknown";
    }

    static boolean pending(String status) {
        return "queued".equals(status) || "pending".equals(status)
            || "processing".equals(status) || "retrying".equals(status);
    }

    static String statusText(String status, boolean chinese) {
        switch (status) {
            case "succeeded": return chinese ? "完成" : "完了";
            case "failed": return chinese ? "失败" : "失敗";
            case "timed_out": return chinese ? "超时" : "タイムアウト";
            case "processing": return chinese ? "执行中" : "実行中";
            case "retrying": return chinese ? "重试中" : "再試行中";
            case "queued": case "pending": return chinese ? "等待" : "待機中";
            default: return chinese ? "待确认" : "未確認";
        }
    }

    static String platformName(String platform, boolean chinese) {
        switch (platform) {
            case "foundr1": return chinese ? "网站预约" : "Web予約";
            case "uber_eats": return "Uber";
            case "rocket_now": return chinese ? "火箭" : "Rocket";
            case "demae_can": return chinese ? "出前馆" : "出前館";
            default: return platform;
        }
    }

    static int platformOrder(String platform) {
        switch (platform) {
            case "foundr1": return 0;
            case "uber_eats": return 1;
            case "rocket_now": return 2;
            case "demae_can": return 3;
            default: return 4;
        }
    }

    // The identity includes brand and kind: identical names are never a target.
    static boolean canPreselect(String targetId, String kind, String brandId,
        String candidateId, String candidateKind, String candidateBrand, boolean available, boolean restoring) {
        return InventoryTargetIdentity.valid(targetId)
            && targetId.equals(candidateId) && clean(kind).equals(candidateKind)
            && !clean(brandId).isEmpty() && brandId.equals(candidateBrand)
            && available != restoring;
    }

    static String clean(String value) { return value == null ? "" : value.trim(); }
}
