package jp.foundr1.store;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Store-scoped snapshots. A failed read never turns into an empty/healthy state. */
final class InventoryWidgetData {
    private static final String PREFS = "inventory_widget_snapshots";
    final List<JSONObject> shortages = new ArrayList<>();
    JSONObject latestRun;
    long inventoryCheckedAt;
    long syncCheckedAt;
    String inventoryError = "";
    String syncError = "";
    boolean hasInventory;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static InventoryWidgetData read(Context context, int widgetId) {
        String storeId = InventoryWidgetProvider.storeId(context, widgetId);
        String brandId = InventoryWidgetProvider.brandId(context, widgetId);
        SharedPreferences prefs = prefs(context);
        InventoryWidgetData data = new InventoryWidgetData();
        data.inventoryError = prefs.getString(storeId + ":inventory_error", "");
        data.syncError = prefs.getString(storeId + ":sync_error", "");
        data.inventoryCheckedAt = InventoryApiClient.cacheCheckedAt(context, storeId);
        data.syncCheckedAt = prefs.getLong(storeId + ":sync_checked_at", 0);
        if (denied(data.inventoryError) || denied(data.syncError)) return data;
        JSONObject catalog = InventoryApiClient.readCache(context, storeId);
        data.hasInventory = catalog != null && storeId.equals(catalog.optString("storeId"));
        Map<String, JSONObject> items = new HashMap<>();
        JSONArray rows = data.hasInventory ? catalog.optJSONArray("items") : null;
        for (int i = 0; rows != null && i < rows.length(); i++) {
            JSONObject item = rows.optJSONObject(i);
            if (item == null || !InventoryTargetIdentity.valid(item.optString("targetId"))) continue;
            items.put(item.optString("targetKind") + ":" + item.optString("targetId"), item);
            if (!item.optBoolean("isAvailable", true)
                && InventoryWidgetPolicy.matchesBrand(brandId, item.optString("brandId"))) data.shortages.add(item);
        }
        JSONObject history = json(prefs.getString(storeId + ":history", ""));
        JSONArray reports = history.optJSONArray("reports");
        JSONArray localRuns = json(prefs.getString(storeId + ":local", "")).optJSONArray("reports");
        Map<String, JSONObject> localById = new HashMap<>();
        for (int i = 0; localRuns != null && i < localRuns.length(); i++) {
            JSONObject run = localRuns.optJSONObject(i);
            if (run != null) localById.put(run.optString("id"), run);
        }
        Map<String, JSONObject> combined = new HashMap<>(localById);
        for (int i = 0; reports != null && i < reports.length(); i++) {
            JSONObject report = reports.optJSONObject(i);
            if (report != null) combined.put(report.optString("id"), report);
        }
        long cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L;
        for (JSONObject report : combined.values()) {
            if (!"availability_change".equals(report.optString("runType"))) continue;
            String action = report.optString("action");
            if (!"available".equals(action) && !"unavailable".equals(action)) continue;
            if (epoch(report.optString("createdAt")) < cutoff) continue;
            JSONObject item = items.get(report.optString("inventoryKey"));
            JSONObject local = localById.get(report.optString("id"));
            if (report.optString("itemName").isEmpty() && (item != null || local != null)) {
                try {
                    report.put("itemName", item != null ? item.optString("ingredientLabel") : local.optString("itemName"));
                    report.put("itemDisplayNames", item != null ? item.optJSONObject("displayNames") : local.optJSONObject("itemDisplayNames"));
                } catch (org.json.JSONException ignored) { /* Retain the server's recorded label. */ }
            }
            String runBrand = local != null ? local.optString("brandId") : item != null ? item.optString("brandId") : "";
            // Unknown identities may appear in the all-brand view, never another brand's view.
            if (!InventoryWidgetPolicy.matchesBrand(brandId, runBrand)) continue;
            if (data.latestRun == null || epoch(report.optString("createdAt")) > epoch(data.latestRun.optString("createdAt"))) {
                data.latestRun = report;
            }
        }
        return data;
    }

    static void rememberOperation(Context context, QuickInventoryActivity.InventoryItem item, JSONObject response) {
        JSONObject run = response.optJSONObject("syncRun");
        if (run == null || run.optString("id").isEmpty()) return;
        try {
            JSONObject report = new JSONObject();
            report.put("id", run.optString("id"));
            report.put("runType", "availability_change");
            report.put("action", run.optBoolean("isAvailable") ? "available" : "unavailable");
            report.put("brandId", item.brandId);
            report.put("inventoryKey", item.kind + ":" + item.targetId);
            report.put("itemName", item.actionLabel);
            report.put("itemLabel", item.label);
            JSONObject cached = InventoryApiClient.readCache(context, item.storeId);
            JSONArray items = cached == null ? null : cached.optJSONArray("items");
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject row = items.optJSONObject(i);
                if (row != null && item.targetId.equals(row.optString("targetId")) && item.kind.equals(row.optString("targetKind"))) {
                    report.put("itemDisplayNames", row.optJSONObject("displayNames"));
                    break;
                }
            }
            report.put("createdAt", run.optString("createdAt"));
            JSONArray rawPlatforms = run.optJSONArray("platforms");
            Map<String, JSONObject> grouped = new HashMap<>();
            for (int i = 0; rawPlatforms != null && i < rawPlatforms.length(); i++) {
                JSONObject command = rawPlatforms.optJSONObject(i);
                if (command == null) continue;
                String platform = command.optString("platform");
                JSONObject counts = grouped.get(platform);
                if (counts == null) { counts = new JSONObject().put("platform", platform); grouped.put(platform, counts); }
                counts.put("total", counts.optInt("total") + 1);
                String status = command.optString("status");
                String bucket = "succeeded".equals(status) ? "succeeded" : "failed".equals(status) ? "failed" : "queued";
                counts.put(bucket, counts.optInt(bucket) + 1);
            }
            report.put("platforms", new JSONArray(grouped.values()));
            SharedPreferences prefs = prefs(context);
            JSONArray previous = json(prefs.getString(item.storeId + ":local", "")).optJSONArray("reports");
            JSONArray next = new JSONArray().put(report);
            for (int i = 0; previous != null && i < previous.length() && next.length() < 24; i++) {
                JSONObject old = previous.optJSONObject(i);
                if (old != null && !report.optString("id").equals(old.optString("id"))) next.put(old);
            }
            prefs.edit().putString(item.storeId + ":local", new JSONObject().put("reports", next).toString())
                .remove(item.storeId + ":sync_checked_at").apply();
        } catch (Exception ignored) {
            // A display cache must never interrupt an already committed inventory operation.
        }
    }

    static void refreshStore(Context context, String storeId, boolean refreshInventory, java.util.function.BooleanSupplier stopped) {
        SharedPreferences prefs = prefs(context);
        if (refreshInventory) {
            try {
                JSONObject catalog = InventoryApiClient.loadAll(storeId);
                if (stopped.getAsBoolean()) return;
                InventoryApiClient.saveCache(context, storeId, catalog);
                prefs.edit().remove(storeId + ":inventory_error").apply();
            } catch (Exception error) {
                if (stopped.getAsBoolean()) return;
                recordError(context, storeId, "inventory", error);
                if (error instanceof InventoryApiClient.ApiException && ((InventoryApiClient.ApiException) error).accessDenied()) return;
            }
        }
        try {
            JSONObject history = InventoryApiClient.loadHistory(storeId);
            if (stopped.getAsBoolean()) return;
            if (history.optJSONArray("reports") == null) throw new java.io.IOException("Invalid history response");
            prefs.edit().putString(storeId + ":history", history.toString())
                .putLong(storeId + ":sync_checked_at", System.currentTimeMillis()).remove(storeId + ":sync_error").apply();
        } catch (Exception error) {
            if (stopped.getAsBoolean()) return;
            recordError(context, storeId, "sync", error);
        }
    }

    private static void recordError(Context context, String storeId, String section, Exception error) {
        String code = "network";
        if (error instanceof InventoryApiClient.ApiException) {
            int status = ((InventoryApiClient.ApiException) error).status;
            if (status == 401) code = "auth";
            if (status == 403) code = "forbidden";
        }
        SharedPreferences.Editor edit = prefs(context).edit().putString(storeId + ":" + section + "_error", code);
        if (denied(code)) {
            InventoryApiClient.clearCache(context, storeId);
            edit.remove(storeId + ":history").remove(storeId + ":local").remove(storeId + ":sync_checked_at");
        }
        edit.apply();
    }

    boolean pending() {
        for (JSONObject platform : platforms(latestRun)) {
            // A visible failure must not stop following the other commands on that platform.
            if (platform.optInt("processing") > 0 || platform.optInt("queued") > 0) return true;
        }
        return false;
    }

    boolean failed() {
        for (JSONObject platform : platforms(latestRun)) {
            String status = status(platform);
            if ("failed".equals(status) || "timed_out".equals(status)) return true;
        }
        return false;
    }

    static List<JSONObject> platforms(JSONObject report) {
        List<JSONObject> rows = new ArrayList<>();
        JSONArray platforms = report == null ? null : report.optJSONArray("platforms");
        for (int i = 0; platforms != null && i < platforms.length(); i++) {
            JSONObject row = platforms.optJSONObject(i);
            if (row != null) rows.add(row);
        }
        rows.sort(Comparator.comparingInt(row -> InventoryWidgetPolicy.platformOrder(row.optString("platform"))));
        return rows;
    }

    static String status(JSONObject platform) {
        return InventoryWidgetPolicy.platformStatus(platform.optInt("total"), platform.optInt("succeeded"),
            platform.optInt("failed"), platform.optInt("timedOut"), platform.optInt("processing"), platform.optInt("queued"));
    }

    static String itemLabel(JSONObject item, String language) {
        return localized(item.optJSONObject("displayNames"), item.optString("ingredientLabel"), language);
    }

    static String runLabel(JSONObject run, String language) {
        String name = run.optString("itemName");
        return localized(run.optJSONObject("itemDisplayNames"), name.isEmpty() ? run.optString("itemLabel") : name, language);
    }

    static String localized(JSONObject names, String source, String language) {
        Map<String, String> values = new HashMap<>();
        if (names != null) for (String key : new String[] { "zh", "zh-Hans", "en" }) values.put(key, names.optString(key));
        return InventoryWidgetPolicy.label(values, source, language);
    }

    static boolean denied(String error) { return "auth".equals(error) || "forbidden".equals(error); }

    static JSONObject json(String value) {
        try { return new JSONObject(value); } catch (Exception ignored) { return new JSONObject(); }
    }

    static long epoch(String value) {
        try { return OffsetDateTime.parse(value.replace(' ', 'T').replaceAll("([+-]\\d{2})$", "$1:00")).toInstant().toEpochMilli(); }
        catch (Exception ignored) { return 0; }
    }
}
