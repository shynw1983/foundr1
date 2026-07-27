package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeUploader {
    private static final String TAG = "Foundr1Bridge";
    private static final String KEY_PENDING_UPLOADS = "pending_uploads";
    private static final int MAX_PENDING_UPLOADS = 100;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Object QUEUE_LOCK = new Object();

    private BridgeUploader() {}

    static void upload(Context context, String kind, String packageName, JSONObject payload) {
        Context appContext = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                flushPending(appContext);
                JSONObject body = buildBody(appContext, kind, packageName, payload);
                if (!send(appContext, body) && shouldQueue(kind)) enqueue(appContext, body);
            } catch (Exception error) {
                Log.w(TAG, "Upload failed", error);
            }
        });
    }

    private static JSONObject buildBody(Context context, String kind, String packageName, JSONObject payload) throws Exception {
        JSONObject body = new JSONObject();
        body.put("platform", "uber_eats");
        body.put("kind", kind);
        body.put("packageName", packageName == null ? "" : packageName);
        body.put("storeId", BridgeConfig.storeId(context));
        body.put("deviceName", resolveDeviceName(context));
        body.put("capturedAt", System.currentTimeMillis());
        body.put("payload", payload == null ? new JSONObject() : payload);
        return body;
    }

    private static boolean send(Context context, JSONObject body) {
        HttpURLConnection connection = null;
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            URL url = new URL(BridgeConfig.endpoint(context));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            String token = BridgeConfig.token(context);
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(bytes);
            }
            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) return true;
            Log.w(TAG, "Upload failed with HTTP " + status);
            return false;
        } catch (Exception error) {
            Log.w(TAG, "Upload failed", error);
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean shouldQueue(String kind) {
        return !"heartbeat".equals(kind) && !"test".equals(kind);
    }

    private static void enqueue(Context context, JSONObject body) {
        synchronized (QUEUE_LOCK) {
            SharedPreferences preferences = BridgeConfig.prefs(context);
            JSONArray pending;
            try {
                pending = new JSONArray(preferences.getString(KEY_PENDING_UPLOADS, "[]"));
            } catch (Exception ignored) {
                pending = new JSONArray();
            }
            JSONArray next = new JSONArray();
            int start = Math.max(0, pending.length() - MAX_PENDING_UPLOADS + 1);
            for (int index = start; index < pending.length(); index += 1) {
                JSONObject item = pending.optJSONObject(index);
                if (item != null) next.put(item);
            }
            next.put(body);
            preferences.edit().putString(KEY_PENDING_UPLOADS, next.toString()).apply();
        }
    }

    private static void flushPending(Context context) {
        synchronized (QUEUE_LOCK) {
            SharedPreferences preferences = BridgeConfig.prefs(context);
            JSONArray pending;
            try {
                pending = new JSONArray(preferences.getString(KEY_PENDING_UPLOADS, "[]"));
            } catch (Exception ignored) {
                pending = new JSONArray();
            }
            if (pending.length() == 0) return;
            JSONArray remaining = new JSONArray();
            boolean networkFailed = false;
            for (int index = 0; index < pending.length(); index += 1) {
                JSONObject item = pending.optJSONObject(index);
                if (item == null) continue;
                if (networkFailed || !send(context, item)) {
                    networkFailed = true;
                    remaining.put(item);
                }
            }
            preferences.edit().putString(KEY_PENDING_UPLOADS, remaining.toString()).apply();
        }
    }

    private static String resolveDeviceName(Context context) {
        String configured = BridgeConfig.deviceName(context);
        if (!configured.isEmpty()) return configured;
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        String model = String.format(Locale.US, "%s %s", Build.MANUFACTURER, Build.MODEL).trim();
        return model + (androidId == null || androidId.isEmpty() ? "" : " / " + androidId);
    }
}
