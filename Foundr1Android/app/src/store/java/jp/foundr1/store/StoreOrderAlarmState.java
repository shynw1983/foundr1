package jp.foundr1.store;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable queue: duplicate deliveries never create another player or undo acknowledgement. */
final class StoreOrderAlarmState {
    // A preview is transient and uses a monotonic clock; clock changes/process restart
    // must never turn a ten-second audition into an unattended, long-running alarm.
    private static volatile long previewDeadline;
    private StoreOrderAlarmState() {}
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("foundr1_order_alarm", Context.MODE_PRIVATE); }
    static JSONArray read(Context context, String key) {
        try { return new JSONArray(prefs(context).getString(key, "[]")); } catch (Exception ignored) { return new JSONArray(); }
    }
    static synchronized JSONArray events(Context context) { return read(context, "events"); }
    static Set<String> ids(JSONArray values) {
        Set<String> result = new HashSet<>();
        for (int i = 0; i < values.length(); i++) { JSONObject item = values.optJSONObject(i); result.add(item == null ? values.optString(i) : item.optString("eventId")); }
        result.remove(""); return result;
    }
    static JSONArray eventIds(Context context) { return new JSONArray(ids(events(context))); }
    static synchronized boolean wasAcknowledged(Context context, String id) { return ids(read(context, "acknowledged")).contains(id); }
    static synchronized void add(Context context, JSONObject event) {
        String id = event.optString("eventId");
        if (id.isEmpty() || wasAcknowledged(context, id)) return;
        JSONArray current = events(context);
        if (ids(current).contains(id)) return;
        // Ring one shared alarm regardless of order count. Keep the oldest unconfirmed orders.
        if (current.length() >= 50) return;
        current.put(event); prefs(context).edit().putString("events", current.toString()).commit();
    }
    static synchronized void acknowledge(Context context, JSONArray ids) {
        Set<String> requested = ids(ids);
        JSONArray muted = read(context, "acknowledged");
        Set<String> previous = ids(muted);
        for (String id : requested) if (!previous.contains(id)) muted.put(id);
        JSONArray bounded = new JSONArray();
        for (int i = Math.max(0, muted.length() - 511); i < muted.length(); i++) bounded.put(muted.optString(i));
        prefs(context).edit().putString("acknowledged", bounded.toString()).commit();
        remove(context, requested);
    }
    private static void remove(Context context, Set<String> removed) {
        JSONArray next = new JSONArray(), current = events(context);
        for (int i = 0; i < current.length(); i++) {
            JSONObject event = current.optJSONObject(i);
            if (event != null && !removed.contains(event.optString("eventId"))) next.put(event);
        }
        prefs(context).edit().putString("events", next.toString()).commit();
    }
    static synchronized void reconcile(Context context, JSONArray checked, JSONArray active) {
        Set<String> removed = ids(checked); removed.removeAll(ids(active));
        // Preserve orders received while a status request was in flight.
        remove(context, removed);
    }
    static synchronized void applyServerState(Context context, JSONArray checked, JSONArray active) {
        Set<String> finished = ids(checked); finished.removeAll(ids(active));
        // Late FCM messages must not restart an order already confirmed/cancelled elsewhere.
        acknowledge(context, new JSONArray(finished));
    }
    static synchronized void pruneLocal(Context context) {
        JSONArray current = events(context); Set<String> removed = new HashSet<>();
        String session = StoreOrderPush.prefs(context).getString("sessionId", "");
        boolean permissions = StoreOrderPush.hasLocationPermission(context) && StoreOrderPush.locationEnabled(context);
        JSONArray rules;
        try { rules = new JSONArray(StoreOrderPush.prefs(context).getString("rules", "[]")); } catch (Exception ignored) { rules = new JSONArray(); }
        for (int i = 0; i < current.length(); i++) {
            JSONObject event = current.optJSONObject(i); if (event == null) continue;
            boolean ruleMatches = false;
            for (int j = 0; j < rules.length(); j++) {
                JSONObject rule = rules.optJSONObject(j);
                if (rule != null && rule.optString("key").equals(event.optString("ruleKey")) && rule.optString("storeId").equals(event.optString("storeId"))) ruleMatches = true;
            }
            if (!permissions || !ruleMatches || session.isEmpty() || !session.equals(event.optString("sessionId"))
                || !"outside".equals(StoreOrderPush.prefs(context).getString("state:" + event.optString("ruleKey"), "unknown"))) removed.add(event.optString("eventId"));
        }
        if (!removed.isEmpty()) remove(context, removed);
    }
    static long previewUntil(Context context) { return previewDeadline; }
    static void preview(Context context, long until) { previewDeadline = until; }
    static void error(Context context, String error) { prefs(context).edit().putString("error", error).apply(); }
    static String error(Context context) { return prefs(context).getString("error", ""); }
    static synchronized void clear(Context context) { previewDeadline = 0; prefs(context).edit().clear().commit(); }
    static synchronized void clearEvents(Context context) { previewDeadline = 0; prefs(context).edit().remove("events").commit(); }
}
