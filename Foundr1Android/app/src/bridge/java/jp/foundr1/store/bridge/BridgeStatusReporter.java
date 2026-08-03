package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeStatusReporter {
    private static final String TAG = "Foundr1BridgeStatus";
    private static final long MAX_SILENCE_MS = 5 * 60 * 1000L;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static String lastSignature = "";
    private static long lastSentAt = 0L;

    private BridgeStatusReporter() {}

    static synchronized void reportIfNeeded(Context context, boolean force) {
        Context appContext = context.getApplicationContext();
        if (BridgeConfig.storeId(appContext).isEmpty() || BridgeConfig.token(appContext).isEmpty()) return;
        BridgeHealthState.Snapshot health = BridgeHealthState.snapshot(appContext);
        String level = healthLevel(health);
        String problem = problem(health);
        String signature = level + "|" + problem + "|" + health.pendingCount + "|"
            + health.lastOrderCode + "|" + health.realtimeConnected + "|"
            + health.accessibilityConnected + "|" + health.notificationConnected;
        long now = System.currentTimeMillis();
        if (!force && signature.equals(lastSignature) && now - lastSentAt < MAX_SILENCE_MS) return;
        boolean changed = force || !signature.equals(lastSignature);
        lastSignature = signature;
        lastSentAt = now;
        EXECUTOR.execute(() -> send(appContext, health, level, problem, changed));
    }

    static String healthLevel(BridgeHealthState.Snapshot health) {
        if (!health.accessibilityConnected || !health.notificationConnected) return "error";
        if (!health.realtimeConnected || health.pendingCount > 0 || !health.lastUploadError.isEmpty()) {
            return "attention";
        }
        return "healthy";
    }

    static String problem(BridgeHealthState.Snapshot health) {
        if (!health.accessibilityConnected) return "Uber Eats の画面読み取りが接続されていません";
        if (!health.notificationConnected) return "Uber Eats の通知読み取りが接続されていません";
        if (!health.realtimeConnected) return "Foundr1 OS のリアルタイム接続を確認中です";
        if (health.pendingCount > 0) return "未送信データが " + health.pendingCount + " 件あります";
        if (!health.lastUploadError.isEmpty()) return health.lastUploadError;
        return "";
    }

    private static void send(
        Context context,
        BridgeHealthState.Snapshot health,
        String level,
        String problem,
        boolean changed
    ) {
        HttpURLConnection connection = null;
        try {
            JSONObject body = new JSONObject();
            body.put("storeId", BridgeConfig.storeId(context));
            body.put("level", level);
            body.put("problem", problem);
            body.put("pendingCount", health.pendingCount);
            body.put("lastOrderCode", health.lastOrderCode);
            body.put("lastOrderAt", health.lastOrderAt > 0 ? Instant.ofEpochMilli(health.lastOrderAt).toString() : "");
            body.put("versionName", versionName(context));
            body.put("realtimeConnected", health.realtimeConnected);
            body.put("accessibilityConnected", health.accessibilityConnected);
            body.put("notificationConnected", health.notificationConnected);
            body.put("changed", changed);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(
                BridgeRealtimeClient.endpoint(context, "status")
            ).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + BridgeConfig.token(context));
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) Log.w(TAG, "Status update failed with HTTP " + status);
        } catch (Exception error) {
            Log.w(TAG, "Status update failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String versionName(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (Exception ignored) {
            return "";
        }
    }
}
