package jp.foundr1.store;

import org.json.JSONArray;
import org.json.JSONObject;

/** Shortcut identity and presentation only. The shared server owns device decisions and execution. */
final class StoreWidgetScenePolicy {
    static boolean uuid(String id) { return id != null && id.matches("(?i)[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"); }
    static boolean isScene(JSONObject binding) { return binding != null && "scene".equals(binding.optString("targetType")); }
    static boolean validBinding(JSONObject binding) {
        if (binding == null) return false;
        String type = binding.optString("targetType");
        return isScene(binding) ? uuid(binding.optString("key"))
            : (type.isEmpty() || type.equals("device")) && StoreWidgetDevicePolicy.validKey(binding.optString("key"));
    }
    static JSONObject binding(JSONObject scene) throws org.json.JSONException {
        return new JSONObject().put("targetType", "scene").put("kind", "scene")
            .put("key", scene.getString("id")).put("name", scene.getString("name")).put("icon", icon(scene));
    }
    static String icon(JSONObject scene) {
        String icon = scene.optString("icon");
        if (java.util.Arrays.asList("bed", "moon", "sun", "lightbulb", "lamp", "coffee", "utensils", "door-open", "lock", "music", "sparkles", "power").contains(icon)) return icon;
        String name = scene.optString("name").trim();
        return name.equals("休憩モード") || name.equals("休息模式") ? "bed" : "moon";
    }
    static int iconResource(JSONObject scene) {
        switch (icon(scene)) {
            case "bed": return R.drawable.inventory_widget_scene_bed;
            case "sun": return R.drawable.inventory_widget_scene_sun;
            case "lightbulb": return R.drawable.inventory_widget_scene_lightbulb;
            case "lamp": return R.drawable.inventory_widget_scene_lamp;
            case "coffee": return R.drawable.inventory_widget_scene_coffee;
            case "utensils": return R.drawable.inventory_widget_scene_utensils;
            case "door-open": return R.drawable.inventory_widget_scene_door_open;
            case "lock": return R.drawable.inventory_widget_scene_lock;
            case "music": return R.drawable.inventory_widget_scene_music;
            case "sparkles": return R.drawable.inventory_widget_scene_sparkles;
            case "power": return R.drawable.inventory_widget_scene_power;
            default: return R.drawable.inventory_widget_scene;
        }
    }
    static JSONObject find(JSONObject body, String id) {
        JSONArray scenes = body == null ? null : body.optJSONArray("scenes");
        for (int i = 0; scenes != null && i < scenes.length(); i++) {
            JSONObject scene = scenes.optJSONObject(i);
            if (scene != null && id.equals(scene.optString("id"))) return scene;
        }
        return null;
    }
    static boolean validScene(JSONObject scene) {
        if (scene == null || !uuid(scene.optString("id")) || scene.optString("name").trim().isEmpty()) return false;
        JSONArray steps = scene.optJSONArray("steps");
        if (steps == null || steps.length() < 1 || steps.length() > 8) return false;
        java.util.Set<String> devices = new java.util.HashSet<>();
        for (int i = 0; i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            if (step == null || !StoreWidgetDevicePolicy.validKey(step.optString("device")) || !devices.add(step.optString("device"))) return false;
            String action = step.optString("action");
            if (!java.util.Arrays.asList("turnOn", "turnOff", "press", "setPosition", "lock", "unlock").contains(action)) return false;
            if (action.equals("setPosition")) {
                Object position = step.opt("position");
                if (!(position instanceof Number) || ((Number)position).doubleValue() != step.optInt("position", -1)
                    || step.optInt("position", -1) < 0 || step.optInt("position", -1) > 100) return false;
            }
        }
        return true;
    }
    static boolean needsUnlock(JSONObject scene) {
        JSONArray steps = scene == null ? null : scene.optJSONArray("steps");
        for (int i = 0; steps != null && i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            if (step != null && "unlock".equals(step.optString("action"))) return true;
        }
        return false;
    }
    static String name(String name, boolean zh) { return zh && "休憩モード".equals(name) ? "休息模式" : name; }
    static String deviceName(JSONObject step, JSONArray devices, boolean zh) {
        String label = step.optString("name");
        for (int i = 0; label.isEmpty() && devices != null && i < devices.length(); i++) {
            JSONObject device = devices.optJSONObject(i);
            if (device != null && step.optString("device").equals(device.optString("key"))) label = device.optString("name");
        }
        if (label.isEmpty()) return zh ? "设备未找到" : "機器が見つかりません";
        if (!zh) return label;
        switch (label) { case "室内照明": return "室内灯"; case "間接照明": return "氛围灯"; case "ロールスクリーン": return "卷帘"; case "会社ロックPro": return "公司门锁 Pro"; default: return label; }
    }
    static boolean indoorOff(JSONObject scene, JSONArray devices) {
        JSONArray steps = scene.optJSONArray("steps");
        for (int i = 0; steps != null && i < steps.length(); i++) {
            JSONObject step = steps.optJSONObject(i);
            if (step == null || !"turnOff".equals(step.optString("action"))) continue;
            for (int j = 0; devices != null && j < devices.length(); j++) {
                JSONObject device = devices.optJSONObject(j);
                if (device != null && step.optString("device").equals(device.optString("key")) && "indoorLight".equals(device.optString("kind"))) return true;
            }
        }
        return false;
    }
    static String action(JSONObject step, boolean zh) {
        switch (step.optString("action")) {
            case "turnOn": return zh ? "开启" : "オンにする";
            case "turnOff": return zh ? "关闭" : "オフにする";
            case "lock": return zh ? "上锁" : "施錠する";
            case "unlock": return zh ? "解锁" : "解錠する";
            case "setPosition": return step.optInt("position", -1) == 0 ? (zh ? "完全打开" : "全開にする") : step.optInt("position", -1) == 100 ? (zh ? "完全关闭" : "全閉にする") : (zh ? "关闭 " : "閉じる ") + step.optInt("position") + "%";
            default: return zh ? "按一次开关" : "スイッチを押す";
        }
    }
    static String status(String status, boolean zh) {
        switch (status) {
            case "running": return zh ? "执行中" : "実行中";
            case "sent": return zh ? "已发送" : "送信済み";
            case "skipped": return zh ? "已跳过" : "スキップ";
            case "failed": case "not_run": return zh ? "未执行" : "未実行";
            case "unknown": return zh ? "结果未确认" : "結果未確認";
            default: return zh ? "等待中" : "待機中";
        }
    }
    static String reason(String reason, boolean zh) {
        switch (reason) {
            case "already_in_state": return zh ? "已是目标状态，没有按压。" : "すでに指定状態のため、押していません。";
            case "light_below_on_range": return zh ? "照度低于10，没有按压。" : "明るさが10未満のため、押していません。";
            case "light_ambiguous": return zh ? "照度暂时无法判断，没有按压。" : "明るさが判定保留のため、押していません。";
            case "invalid_light_level": return zh ? "无法确认照度，没有按压。" : "明るさを確認できないため、押していません。";
            case "door_not_closed": return zh ? "请先关门再上锁。" : "ドアを閉めてから施錠してください。";
            case "not_calibrated": return zh ? "请在 SwitchBot 中校准位置。" : "SwitchBotで位置を校正してください。";
            case "device_busy": return zh ? "上一操作仍在处理，请先确认状态。" : "直前の操作を処理中です。状態を確認してください。";
            case "interrupted": case "not_run": return zh ? "本步未完成，请先确认设备状态。" : "この操作は未完了です。状態を確認してください。";
            default: return zh ? "请检查设备连接和状态。" : "機器の接続と状態を確認してください。";
        }
    }
}
