package jp.foundr1.store;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Per-widget bindings and per-account snapshots. No timer or background device polling. */
final class StoreWidgetDevicesData {
    static final int SLOT_COUNT = 4;
    static boolean validSlot(int slot) { return slot >= 0 && slot < SLOT_COUNT; }
    private static final java.util.Map<String, Long> generations = new java.util.HashMap<>();
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("store_widget_devices", Context.MODE_PRIVATE); }
    static JSONObject slot(Context context, int id, int slot) {
        if (!validSlot(slot)) return new JSONObject();
        JSONObject saved = StoreWidgetControlsData.object(prefs(context).getString("slot:" + id + ":" + slot, ""));
        if (saved == null || !saved.optString("store").equals(InventoryWidgetProvider.storeId(context, id))) return new JSONObject();
        // Upgrade existing bindings from the local snapshot, without waking the device API.
        if (!StoreWidgetScenePolicy.isScene(saved) && saved.optString("kind").isEmpty()) {
            JSONObject snapshot = read(context, saved.optString("store"), saved.optString("key"));
            if (snapshot != null && !snapshot.optString("kind").isEmpty()) try {
                saved.put("kind", snapshot.optString("kind"));
                prefs(context).edit().putString("slot:" + id + ":" + slot, saved.toString()).apply();
            } catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
        }
        return saved;
    }
    static synchronized void saveSlots(Context context, int id, JSONObject... devices) {
        if (devices.length > SLOT_COUNT) throw new IllegalArgumentException("Too many widget shortcuts");
        SharedPreferences.Editor edit = prefs(context).edit();
        String store = InventoryWidgetProvider.storeId(context, id);
        for (int i = 0; i < SLOT_COUNT; i++) {
            String key = "slot:" + id + ":" + i;
            JSONObject d = i < devices.length ? devices[i] : null;
            if (!StoreWidgetScenePolicy.validBinding(d)) edit.remove(key);
            else try { edit.putString(key, new JSONObject().put("store", store).put("key", d.getString("key"))
                .put("name", d.optString("name")).put("kind", d.optString("kind"))
                .put("icon", StoreWidgetScenePolicy.isScene(d) ? StoreWidgetScenePolicy.icon(d) : "")
                .put("targetType", StoreWidgetScenePolicy.isScene(d) ? "scene" : "device").toString()); }
                catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
        }
        edit.apply();
    }
    static synchronized void delete(Context context, int id) {
        SharedPreferences.Editor edit = prefs(context).edit();
        for (int slot = 0; slot < SLOT_COUNT; slot++) edit.remove("slot:" + id + ":" + slot);
        edit.apply();
    }
    private static String prefix(String session, String store, String key) { return "read:" + session + ":" + store + ":" + key; }
    static synchronized long beginRead(String session, String store, String key) {
        String id = prefix(session, store, key);
        long generation = generations.getOrDefault(id, 0L) + 1;
        generations.put(id, generation);
        return generation;
    }
    static synchronized void save(Context context, String session, String store, String key, long generation, JSONObject device) {
        String id = prefix(session, store, key);
        if (!session.equals(InventoryApiClient.sessionKey()) || session.isEmpty() || generations.getOrDefault(id, 0L) != generation
            || !key.equals(device.optString("key"))) return;
        prefs(context).edit().putString(id, device.toString()).apply();
    }
    static JSONObject read(Context context, String store, String key) {
        String session = InventoryApiClient.sessionKey();
        if (session.isEmpty()) return null;
        return StoreWidgetControlsData.object(prefs(context).getString(prefix(session, store, key), ""));
    }
    static synchronized void invalidate(Context context, String session, String store, String key) {
        beginRead(session, store, key);
        prefs(context).edit().remove(prefix(session, store, key)).apply();
    }
    static synchronized void failedRead(Context context, String session, String store, String key, long generation) {
        if (generations.getOrDefault(prefix(session, store, key), 0L) == generation) invalidate(context, session, store, key);
    }
    static JSONObject find(JSONObject body, String key) {
        JSONArray devices = body.optJSONArray("devices");
        if (devices != null) for (int i = 0; i < devices.length(); i++) {
            JSONObject device = devices.optJSONObject(i);
            if (device != null && key.equals(device.optString("key"))) return device;
        }
        return null;
    }
    /** Only refresh metadata for existing bindings; never change targets or execute scenes. */
    static synchronized void updateScenes(Context context, String session, String store, JSONObject catalog) {
        if (session.isEmpty() || !session.equals(InventoryApiClient.sessionKey()) || catalog == null
            || !store.equals(catalog.optString("storeId")) || catalog.optJSONArray("scenes") == null) return;
        SharedPreferences.Editor edit = prefs(context).edit();
        for (int id : InventoryWidgetProvider.widgetIds(context)) for (int slot = 0; slot < SLOT_COUNT; slot++) {
            JSONObject binding = slot(context, id, slot);
            if (!store.equals(binding.optString("store")) || !StoreWidgetScenePolicy.isScene(binding)) continue;
            JSONObject scene = StoreWidgetScenePolicy.find(catalog, binding.optString("key"));
            if (!StoreWidgetScenePolicy.validScene(scene)) continue;
            try {
                binding.put("name", scene.getString("name")).put("icon", StoreWidgetScenePolicy.icon(scene));
                edit.putString("slot:" + id + ":" + slot, binding.toString());
            } catch (org.json.JSONException impossible) { throw new IllegalArgumentException(impossible); }
        }
        edit.apply();
    }
    static void refreshScenes(Context context, String store, java.util.function.BooleanSupplier stopped) {
        String session = InventoryApiClient.sessionKey();
        if (session.isEmpty() || stopped.getAsBoolean()) return;
        boolean selected = false;
        for (int id : InventoryWidgetProvider.widgetIds(context)) for (int slot = 0; slot < SLOT_COUNT; slot++) {
            JSONObject binding = slot(context, id, slot);
            selected |= store.equals(binding.optString("store")) && StoreWidgetScenePolicy.isScene(binding);
        }
        if (!selected) return;
        try {
            JSONObject catalog = InventoryApiClient.loadScenes(store, session);
            if (!stopped.getAsBoolean()) updateScenes(context, session, store, catalog);
        } catch (Exception ignored) { /* Preserve saved icons on a failed read. */ }
    }
    static void refreshSelected(Context context, java.util.function.BooleanSupplier stopped) {
        String session = InventoryApiClient.sessionKey();
        if (session.isEmpty()) return;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int id : InventoryWidgetProvider.widgetIds(context)) for (int slot = 0; slot < SLOT_COUNT; slot++) {
            if (stopped.getAsBoolean() || !session.equals(InventoryApiClient.sessionKey())) return;
            JSONObject binding = slot(context, id, slot);
            String store = binding.optString("store"), key = binding.optString("key");
            if (StoreWidgetScenePolicy.isScene(binding) || !StoreWidgetDevicePolicy.validKey(key) || !seen.add(store + ":" + key)) continue;
            long generation = beginRead(session, store, key);
            try {
                JSONObject device = find(InventoryApiClient.loadDevices(store, key, session), key);
                if (!stopped.getAsBoolean() && device != null) save(context, session, store, key, generation, device);
                else if (device == null) failedRead(context, session, store, key, generation);
            } catch (Exception error) { failedRead(context, session, store, key, generation); }
        }
    }
}
