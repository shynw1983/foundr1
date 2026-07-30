package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

final class BridgeInventoryState {
    private static final String PREFS = "foundr1_bridge_inventory";
    private static final String KEY_STATES = "states";
    private static final int MAX_STATES = 500;

    private BridgeInventoryState() {}

    static synchronized boolean shouldUpload(Context context, String itemName, String status) {
        String name = itemName == null ? "" : itemName.trim();
        String nextStatus = status == null ? "" : status.trim();
        if (name.isEmpty() || nextStatus.isEmpty()) return false;
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject states;
        try {
            states = new JSONObject(preferences.getString(KEY_STATES, "{}"));
        } catch (Exception ignored) {
            states = new JSONObject();
        }
        if (nextStatus.equals(states.optString(name))) return false;
        if (states.length() >= MAX_STATES) states = new JSONObject();
        try {
            states.put(name, nextStatus);
            preferences.edit().putString(KEY_STATES, states.toString()).apply();
        } catch (Exception ignored) {
        }
        return true;
    }
}
