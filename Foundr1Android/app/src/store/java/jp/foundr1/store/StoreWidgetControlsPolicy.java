package jp.foundr1.store;

/** Persist stable keys, never translated labels or menu positions. */
final class StoreWidgetControlsPolicy {
    static final String RECEPTION = "reception", AWAY = "away", ORDERS = "orders", SYNC = "sync";
    static final String[] CHOICES = { RECEPTION, AWAY, ORDERS, SYNC };
    static boolean valid(String value) {
        for (String choice : CHOICES) if (choice.equals(value)) return true;
        return false;
    }
    static String[] normalize(String left, String right) {
        String first = valid(left) ? left : RECEPTION;
        String second = valid(right) && !first.equals(right) ? right : (AWAY.equals(first) ? RECEPTION : AWAY);
        return new String[]{first, second};
    }
    static boolean validMode(String mode) { return "auto".equals(mode) || "force_open".equals(mode) || "force_closed".equals(mode); }
    static String title(String key, boolean zh) {
        switch (key) {
            case AWAY: return zh ? "离店提醒" : "離店通知";
            case ORDERS: return zh ? "订单列表" : "注文一覧";
            case SYNC: return zh ? "同步详情" : "同期状況";
            default: return zh ? "网络预约" : "Web予約";
        }
    }
    static String mode(String value, boolean zh) {
        switch (value) {
            case "force_open": return zh ? "强制开启" : "手動受付";
            case "force_closed": return zh ? "强制关闭" : "手動停止";
            case "auto": return zh ? "自动" : "自動";
            default: return zh ? "待确认" : "未確認";
        }
    }
}
