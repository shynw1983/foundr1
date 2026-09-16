package jp.foundr1.store;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

/** Independent snapshots: offline/expired/other-account state is never an actionable switch. */
final class StoreWidgetControlsData {
    private static final java.util.Map<String, Long> generations = new java.util.HashMap<>();
    private static final java.util.Set<String> writing = new java.util.HashSet<>();
    private static long rulesGeneration;
    static synchronized long rulesGeneration() { return rulesGeneration; }
    static synchronized boolean acceptPresenceRules(Context context, long generation, org.json.JSONArray rules) {
        if (generation != rulesGeneration || !writing.isEmpty()) return false;
        StoreOrderPush.updateRules(context, rules);
        return true;
    }
    JSONObject operation, notification;
    String receptionError = "", notificationError = "";
    long receptionAt, notificationAt;

    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("store_widget_controls", Context.MODE_PRIVATE); }
    private static String prefix(String storeId, String session) { return session + ":" + storeId + ":"; }
    static synchronized boolean beginMutation(String storeId, String session) {
        String key = prefix(storeId, session);
        if (!writing.add(key)) return false;
        rulesGeneration++;
        generations.put(key, generations.getOrDefault(key, 0L) + 1);
        return true;
    }
    static synchronized void endMutation(String storeId, String session) {
        String key = prefix(storeId, session);
        writing.remove(key);
        rulesGeneration++;
        generations.put(key, generations.getOrDefault(key, 0L) + 1);
    }
    static synchronized long beginRead(String storeId, String session) {
        String key = prefix(storeId, session);
        if (writing.contains(key)) return -1;
        long next = generations.getOrDefault(key, 0L) + 1;
        generations.put(key, next);
        return next;
    }
    static synchronized void acceptRead(Context context, String storeId, String session, long generation, long ruleGeneration, String section, JSONObject body, Exception error) {
        String key = prefix(storeId, session);
        if (generation < 0 || writing.contains(key) || generations.getOrDefault(key, 0L) != generation) return;
        if (error != null) error(context, storeId, session, section, error);
        else {
            save(context, storeId, session, section, body);
            if ("away".equals(section) && ruleGeneration == rulesGeneration && writing.isEmpty()) applyRules(context, session, body);
        }
    }
    static StoreWidgetControlsData read(Context context, String storeId) {
        StoreWidgetControlsData data = new StoreWidgetControlsData();
        String session = InventoryApiClient.sessionKey();
        if (session.isEmpty()) { data.receptionError = data.notificationError = "auth"; return data; }
        String key = prefix(storeId, session);
        SharedPreferences p = prefs(context);
        data.operation = object(p.getString(key + "reception", ""));
        data.notification = object(p.getString(key + "away", ""));
        data.receptionAt = p.getLong(key + "reception_at", 0);
        data.notificationAt = p.getLong(key + "away_at", 0);
        data.receptionError = p.getString(key + "reception_error", "");
        data.notificationError = p.getString(key + "away_error", "");
        return data;
    }
    static JSONObject object(String value) { try { return new JSONObject(value); } catch (Exception ignored) { return null; } }
    boolean receptionFresh() { return operation != null && receptionError.isEmpty() && InventoryWidgetPolicy.fresh(receptionAt, System.currentTimeMillis()); }
    boolean notificationFresh() { return notification != null && notificationError.isEmpty() && InventoryWidgetPolicy.fresh(notificationAt, System.currentTimeMillis()); }
    JSONObject preference() { return notification == null ? null : notification.optJSONObject("preference"); }
    boolean canToggle() { return notificationFresh() && notification.optBoolean("ready") && notification.optBoolean("canManage")
        && preference() != null && !preference().optString("version").isEmpty(); }

    static void save(Context context, String storeId, String session, String section, JSONObject body) {
        if (session.isEmpty() || !session.equals(InventoryApiClient.sessionKey())) return;
        String key = prefix(storeId, session) + section;
        prefs(context).edit().putString(key, body.toString()).putLong(key + "_at", System.currentTimeMillis()).remove(key + "_error").apply();
    }
    static void error(Context context, String storeId, String session, String section, Exception error) {
        String code = "network";
        if (error instanceof InventoryApiClient.ApiException) {
            int status = ((InventoryApiClient.ApiException) error).status;
            if (status == 401) code = "auth";
            else if (status == 403) code = "forbidden";
            else if (status == 409) code = "changed";
        }
        String key = prefix(storeId, session) + section;
        SharedPreferences.Editor edit = prefs(context).edit().putString(key + "_error", code);
        if (InventoryWidgetData.denied(code)) edit.remove(key).remove(key + "_at");
        edit.apply();
    }
    static void refresh(Context context, String storeId, java.util.function.BooleanSupplier stopped) {
        String session = InventoryApiClient.sessionKey();
        if (session.isEmpty()) return;
        long generation = beginRead(storeId, session);
        long ruleGeneration = rulesGeneration();
        if (generation < 0) return;
        try {
            JSONObject operation = InventoryApiClient.loadOperation(storeId);
            if (stopped.getAsBoolean()) return;
            acceptRead(context, storeId, session, generation, ruleGeneration, "reception", operation, null);
        } catch (Exception error) { if (!stopped.getAsBoolean()) acceptRead(context, storeId, session, generation, ruleGeneration, "reception", null, error); }
        if (stopped.getAsBoolean() || !session.equals(InventoryApiClient.sessionKey())) return;
        try {
            JSONObject body = InventoryApiClient.loadNotificationPreference(storeId);
            if (stopped.getAsBoolean()) return;
            if (!storeId.equals(body.optString("storeId")) || !body.has("ready")) throw new java.io.IOException("Invalid notification preference");
            acceptRead(context, storeId, session, generation, ruleGeneration, "away", body, null);
        } catch (Exception error) { if (!stopped.getAsBoolean()) acceptRead(context, storeId, session, generation, ruleGeneration, "away", null, error); }
    }
    static void applyRules(Context context, String session, JSONObject body) {
        if (!session.equals(InventoryApiClient.sessionKey()) || body.optString("sessionId").isEmpty()
            || !body.optString("sessionId").equals(StoreOrderPush.prefs(context).getString("sessionId", ""))
            || body.optJSONArray("rules") == null) return;
        StoreOrderPush.updateRules(context, body.optJSONArray("rules"));
        StoreOrderAlarmState.pruneLocal(context);
        StoreOrderAlarmService.signal();
    }
    static String unavailable(String error, boolean zh) {
        if ("auth".equals(error)) return zh ? "请先登录" : "要ログイン";
        if ("forbidden".equals(error)) return zh ? "无操作权限" : "権限なし";
        return zh ? "待确认" : "未確認";
    }
}
