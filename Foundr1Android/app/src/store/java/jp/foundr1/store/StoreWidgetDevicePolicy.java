package jp.foundr1.store;

import org.json.JSONArray;
import org.json.JSONObject;

/** Display/intent only. The existing Store API owns authorization, preflight and device locks. */
final class StoreWidgetDevicePolicy {
    static boolean validKey(String key) { return key != null && key.matches("[a-f0-9]{24}"); }
    static boolean hasAction(JSONObject device, String action) {
        JSONArray actions = device == null ? null : device.optJSONArray("actions");
        if (actions != null) for (int i = 0; i < actions.length(); i++) if (action.equals(actions.optString(i))) return true;
        return false;
    }
    static boolean selectable(JSONObject device) {
        return device != null && validKey(device.optString("key")) && (hasAction(device, "press")
            || hasAction(device, "turnOn") || hasAction(device, "turnOff") || hasAction(device, "lock")
            || hasAction(device, "unlock") || hasAction(device, "setPosition"));
    }
    static long time(String iso) {
        try { return java.time.Instant.parse(iso).toEpochMilli(); } catch (Exception ignored) { return 0; }
    }
    static boolean fresh(JSONObject device, long now) {
        return device != null && !device.optBoolean("readError") && device.optJSONObject("sample") != null
            && now >= time(device.optString("fetchedAt")) && now - time(device.optString("fetchedAt")) <= 120_000;
    }
    static String state(JSONObject device, boolean zh) {
        JSONObject sample = device == null ? null : device.optJSONObject("sample");
        if (sample == null || device.optBoolean("readError")) return zh ? "状态未知" : "状態不明";
        String kind = device.optString("kind");
        if ("indoorLight".equals(kind) && "pressMode".equals(sample.optString("botMode"))) {
            int level = sample.optInt("lightLevel", -1);
            return level >= 10 && level <= 20 ? (zh ? "亮（推测）" : "点灯（推定）")
                : level >= 1 && level <= 3 ? (zh ? "灭（推测）" : "消灯（推定）") : (zh ? "状态未知" : "状態不明");
        }
        if ("on".equals(sample.optString("power"))) return zh ? "已开启" : "オン";
        if ("off".equals(sample.optString("power"))) return zh ? "已关闭" : "オフ";
        if ("lock".equals(kind)) return "locked".equals(sample.optString("lockState")) ? (zh ? "已上锁" : "施錠中")
            : "unlocked".equals(sample.optString("lockState")) ? (zh ? "已解锁" : "解錠中") : (zh ? "状态未知" : "状態不明");
        if ("shade".equals(kind) && !sample.isNull("position") && sample.has("position")) return sample.optBoolean("moving") ? (zh ? "移动中" : "移動中")
            : (zh ? "关闭 " : "閉じる ") + sample.optInt("position") + "%";
        return hasAction(device, "press") ? (zh ? "状态不可读" : "状態取得なし") : (zh ? "状态未知" : "状態不明");
    }
    static String actionLabel(String action, Integer position, boolean zh) {
        switch (action) {
            case "turnOn": return zh ? "确认开启" : "オンにする";
            case "turnOff": return zh ? "确认关闭" : "オフにする";
            case "lock": return zh ? "确认上锁" : "施錠する";
            case "unlock": return zh ? "确认解锁" : "解錠する";
            case "setPosition": return Integer.valueOf(0).equals(position) ? (zh ? "确认全开" : "全開にする") : (zh ? "确认全闭" : "全閉にする");
            default: return zh ? "确认按一下" : "スイッチを押す";
        }
    }
    static String error(Exception error, boolean zh) {
        int status = error instanceof InventoryApiClient.ApiException ? ((InventoryApiClient.ApiException) error).status : 0;
        if (status == 401) return zh ? "请先打开 Store 登录" : "Storeでログインしてください";
        if (status == 403) return zh ? "当前账号无此门店的设备权限" : "この店舗の機器を操作する権限がありません";
        if (status == 409) return zh ? "操作或登录状态已变化，请重新读取" : "操作・ログイン状態が変わりました。再読込してください";
        if (status == 404) return zh ? "设备已移除，请重新选择" : "機器が見つかりません。選び直してください";
        return zh ? "未能确认状态，请重新读取" : "状態を確認できません。再読込してください";
    }
}
