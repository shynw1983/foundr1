package jp.foundr1.store;

import android.content.Context;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

final class InventoryApiClient {
    static final String BASE_URL = "https://www.foundr1.jp";
    static final String INVENTORY_URL = BASE_URL + "/api/store/display/kitchen/inventory";
    static final String CACHE_NAME = "quick_inventory_cache";
    static final String CACHE_KEY = "all_items_json";

    private InventoryApiClient() {}

    static JSONObject loadAll(String storeId) throws Exception {
        // Use the same ID-addressed catalog as the Store sales-status page.
        // Kitchen inventory rows can aggregate several options by ingredient.
        return normalizeMenuSettings(loadConfiguration(storeId));
    }

    static JSONObject loadConfiguration(String storeId) throws Exception {
        String query = storeId == null || storeId.trim().isEmpty()
            ? ""
            : "?storeId=" + URLEncoder.encode(storeId.trim(), "UTF-8");
        return request("GET", BASE_URL + "/api/store/menu-settings" + query, null);
    }

    static JSONObject apply(QuickInventoryActivity.InventoryItem item, boolean available) throws Exception {
        if (!InventoryTargetIdentity.valid(item.targetId)) {
            throw new IllegalArgumentException("商品IDを取得できませんでした。再読み込みしてください。 / 无法获取商品 ID，请重新加载。");
        }
        JSONObject body = new JSONObject();
        body.put("action", "apply");
        body.put("storeId", item.storeId);
        body.put("brandId", item.brandId);
        body.put("ingredientLabel", item.actionLabel);
        body.put("feedbackLabel", item.label);
        body.put("targetKind", item.kind);
        body.put("targetId", item.targetId);
        body.put("isAvailable", available);
        body.put("stockStatus", available ? "available" : "unavailable");
        body.put("source", "sales_status");
        return request("POST", INVENTORY_URL, body.toString());
    }

    static void saveCache(Context context, String storeId, JSONObject body) {
        context.getSharedPreferences(CACHE_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(cacheKey(storeId), body.toString())
            .apply();
    }

    static JSONObject readCache(Context context, String storeId) {
        String value = context.getSharedPreferences(CACHE_NAME, Context.MODE_PRIVATE)
            .getString(cacheKey(storeId), "");
        if (value == null || value.isEmpty()) return null;
        try {
            JSONObject cached = new JSONObject(value);
            JSONArray items = cached.optJSONArray("items");
            if (items == null) return null;
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item == null || !InventoryTargetIdentity.valid(item.optString("targetId"))) return null;
            }
            return cached;
        } catch (Exception ignored) {
            return null;
        }
    }

    static int unavailableCount(JSONObject body, String brandId) {
        JSONArray items = body == null ? null : body.optJSONArray("items");
        if (items == null) return 0;
        int count = 0;
        for (int index = 0; index < items.length(); index += 1) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            boolean matchesBrand = brandId == null || brandId.trim().isEmpty()
                || brandId.equals(item.optString("brandId"));
            if (matchesBrand && !item.optBoolean("isAvailable", true)) count += 1;
        }
        return count;
    }

    private static String cacheKey(String storeId) {
        String value = storeId == null ? "" : storeId.trim();
        return CACHE_KEY + "_" + (value.isEmpty() ? "default" : value);
    }

    private static JSONObject normalizeMenuSettings(JSONObject source) throws Exception {
        JSONObject result = new JSONObject();
        result.put("scope", "all");
        String storeId = source.optString("selectedStoreId");
        result.put("storeId", storeId);
        JSONArray normalized = new JSONArray();
        appendMenuRows(normalized, source.optJSONArray("items"), "item", storeId);
        appendMenuRows(normalized, source.optJSONArray("options"), "option", storeId);
        result.put("items", normalized);
        return result;
    }

    private static void appendMenuRows(
        JSONArray output,
        JSONArray rows,
        String kind,
        String storeId
    ) throws Exception {
        if (rows == null) return;
        for (int index = 0; index < rows.length(); index += 1) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            String id = row.optString("id");
            String name = row.optString("name").trim();
            if (!InventoryTargetIdentity.valid(id) || name.isEmpty()) continue;
            JSONObject item = new JSONObject();
            item.put("targetId", id);
            item.put("inventoryKey", kind + ":" + id);
            item.put("ingredientLabel", name);
            item.put("targetKind", kind);
            item.put("brandId", row.optString("brandId"));
            item.put("brandName", row.optString("brandName"));
            item.put("storeId", storeId);
            item.put("isAvailable", row.optBoolean("isAvailable", true));
            String category = "item".equals(kind) ? row.optString("category", "未分類") : "";
            String groupName = "option".equals(kind) ? row.optString("groupName", "その他") : category;
            item.put("category", category);
            item.put("groupName", groupName);
            item.put("groupDisplayNames", row.optJSONObject("groupDisplayNames") == null
                ? new JSONObject()
                : row.optJSONObject("groupDisplayNames"));
            item.put("impactCount", 1);
            item.put("displayNames", row.optJSONObject("displayNames") == null
                ? new JSONObject()
                : row.optJSONObject("displayNames"));
            JSONArray labels = new JSONArray();
            labels.put(name);
            labels.put(row.optString("brandName"));
            labels.put(row.optString("category"));
            labels.put(row.optString("groupName"));
            appendObjectValues(labels, row.optJSONObject("displayNames"));
            appendObjectValues(labels, row.optJSONObject("groupDisplayNames"));
            item.put("searchLabels", labels);
            output.put(item);
        }
    }

    private static void appendObjectValues(JSONArray output, JSONObject object) {
        if (object == null) return;
        java.util.Iterator<String> keys = object.keys();
        while (keys.hasNext()) output.put(object.optString(keys.next()));
    }

    private static JSONObject request(String method, String endpoint, String payload) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setConnectTimeout(10000);
        connection.setReadTimeout(20000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Foundr1-Native-Surface", "store-widget");
        String cookies = CookieManager.getInstance().getCookie(BASE_URL);
        if (cookies != null && !cookies.trim().isEmpty()) {
            connection.setRequestProperty("Cookie", cookies);
        }
        if (payload != null) {
            byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
            ? connection.getInputStream()
            : connection.getErrorStream();
        StringBuilder text = new StringBuilder();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line);
            }
        }
        connection.disconnect();

        JSONObject body = text.length() == 0 ? new JSONObject() : new JSONObject(text.toString());
        if (status < 200 || status >= 300) {
            String message = status == 401
                ? "ログインの有効期限が切れています。Foundr1 Storeを開いてログインしてください。"
                : body.optString("error", "在庫状態を更新できませんでした。");
            throw new IllegalStateException(message);
        }
        return body;
    }
}
