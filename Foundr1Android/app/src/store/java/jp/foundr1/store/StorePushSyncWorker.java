package jp.foundr1.store;

import android.content.Context;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class StorePushSyncWorker extends Worker {
    public StorePushSyncWorker(Context context, WorkerParameters parameters) { super(context, parameters); }
    @Override public Result doWork() {
        Context context = getApplicationContext();
        String secret = StoreOrderPush.prefs(context).getString("presenceToken", "");
        if (secret.isEmpty()) return Result.success();
        long rulesGeneration = StoreWidgetControlsData.rulesGeneration();
        HttpURLConnection connection = null;
        try {
            android.app.NotificationManager manager = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (!StoreOrderPush.hasLocationPermission(context) || !StoreOrderPush.locationEnabled(context) || manager == null || !manager.areNotificationsEnabled()) StoreOrderPush.markUnknown(context);
            JSONObject body = new JSONObject();
            body.put("token", StoreOrderPush.prefs(context).getString("fcmToken", ""));
            body.put("presence", StoreOrderPush.presenceArray(context));
            connection = (HttpURLConnection) new URL("https://www.foundr1.jp/api/store/order-notifications/presence").openConnection();
            connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + secret);
            connection.setRequestProperty("Content-Type", "application/json");
            try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = connection.getResponseCode();
            if (!secret.equals(StoreOrderPush.prefs(context).getString("presenceToken", ""))) return Result.success();
            if (code == 401) { StoreOrderPush.clearBinding(context); return Result.success(); }
            if (code != 200) return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
            StringBuilder text = new StringBuilder();
            try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = reader.readLine()) != null) text.append(line);
            }
            JSONObject response = new JSONObject(text.toString());
            if (!secret.equals(StoreOrderPush.prefs(context).getString("presenceToken", ""))) return Result.success();
            if (!StoreWidgetControlsData.acceptPresenceRules(context, rulesGeneration, response.getJSONArray("rules"))) return Result.retry();
            StoreOrderPush.prefs(context).edit().putLong("lastSyncAt", System.currentTimeMillis()).putString("syncError", "").apply();
            return Result.success();
        } catch (Exception error) {
            StoreOrderPush.prefs(context).edit().putString("syncError", "PRESENCE_SYNC_FAILED").apply();
            return getRunAttemptCount() < 5 ? Result.retry() : Result.failure();
        } finally { if (connection != null) connection.disconnect(); }
    }
}
