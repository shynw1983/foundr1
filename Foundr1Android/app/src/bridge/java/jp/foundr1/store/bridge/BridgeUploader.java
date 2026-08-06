package jp.foundr1.store.bridge;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeUploader {
    private static final String TAG = "Foundr1Bridge";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private BridgeUploader() {}

    interface UploadCallback {
        void onComplete(boolean success);
    }

    static void upload(Context context, String kind, String packageName, JSONObject payload) {
        upload(context, "uber_eats", kind, packageName, payload, null);
    }

    static void upload(
        Context context,
        String kind,
        String packageName,
        JSONObject payload,
        UploadCallback callback
    ) {
        upload(context, "uber_eats", kind, packageName, payload, callback);
    }

    static void upload(
        Context context,
        String platform,
        String kind,
        String packageName,
        JSONObject payload
    ) {
        upload(context, platform, kind, packageName, payload, null);
    }

    static void upload(
        Context context,
        String platform,
        String kind,
        String packageName,
        JSONObject payload,
        UploadCallback callback
    ) {
        Context appContext = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            boolean success = false;
            try {
                flushPending(appContext);
                JSONObject body = buildBody(appContext, platform, kind, packageName, payload);
                SendResult result = send(appContext, platform, body);
                success = result == SendResult.SUCCESS;
                if (result == SendResult.RETRY && shouldQueue(kind)) {
                    BridgeUploadQueue.get(appContext).enqueue(body);
                } else if (result == SendResult.PERMANENT_FAILURE) {
                    BridgeHealthState.recordUploadError(appContext, "送信内容が拒否されました");
                }
                if (success) {
                    BridgeHealthState.recordUploadSuccess(appContext);
                    if ("accessibility_order".equals(kind)) {
                        BridgeHealthState.recordOrderUpload(
                            appContext,
                            payload == null ? "" : payload.optString("orderCode")
                        );
                    }
                }
                refreshPendingCount(appContext);
            } catch (Exception error) {
                Log.w(TAG, "Upload failed", error);
                BridgeHealthState.recordUploadError(appContext, "ネットワーク送信に失敗しました");
                refreshPendingCount(appContext);
            } finally {
                if (callback != null) callback.onComplete(success);
            }
        });
    }

    private static JSONObject buildBody(
        Context context,
        String platform,
        String kind,
        String packageName,
        JSONObject payload
    ) throws Exception {
        JSONObject body = new JSONObject();
        body.put("clientEventId", UUID.randomUUID().toString());
        body.put("platform", platform);
        body.put("kind", kind);
        body.put("packageName", packageName == null ? "" : packageName);
        body.put("storeId", BridgeConfig.storeId(context));
        body.put("deviceName", resolveDeviceName(context));
        body.put("capturedAt", System.currentTimeMillis());
        body.put("payload", payload == null ? new JSONObject() : payload);
        return body;
    }

    private static SendResult send(Context context, String platform, JSONObject body) {
        HttpURLConnection connection = null;
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            URL url = new URL(BridgeConfig.endpoint(context, platform));
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
            if (status >= 200 && status < 300) return SendResult.SUCCESS;
            Log.w(TAG, "Upload failed with HTTP " + status);
            if (status == 408 || status == 425 || status == 429 || status >= 500) {
                return SendResult.RETRY;
            }
            return SendResult.PERMANENT_FAILURE;
        } catch (Exception error) {
            Log.w(TAG, "Upload failed", error);
            return SendResult.RETRY;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static boolean shouldQueue(String kind) {
        return !"heartbeat".equals(kind)
            && !"test".equals(kind)
            && !"bridge_crash".equals(kind)
            && !"bridge_exit".equals(kind);
    }

    private static void flushPending(Context context) {
        BridgeUploadQueue queue = BridgeUploadQueue.get(context);
        for (BridgeUploadQueue.Item item : queue.items()) {
            queue.noteAttempt(item.id);
            SendResult result = send(context, item.body.optString("platform", "uber_eats"), item.body);
            if (result == SendResult.SUCCESS) {
                queue.delete(item.id);
                BridgeHealthState.recordUploadSuccess(context);
                continue;
            }
            if (result == SendResult.PERMANENT_FAILURE) {
                queue.delete(item.id);
                BridgeHealthState.recordUploadError(context, "保留中の送信内容が拒否されました");
                continue;
            }
            break;
        }
        refreshPendingCount(context);
    }

    private static void refreshPendingCount(Context context) {
        BridgeHealthState.setPendingCount(context, BridgeUploadQueue.get(context).count());
    }

    private static String resolveDeviceName(Context context) {
        String configured = BridgeConfig.deviceName(context);
        if (!configured.isEmpty()) return configured;
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        String model = String.format(Locale.US, "%s %s", Build.MANUFACTURER, Build.MODEL).trim();
        return model + (androidId == null || androidId.isEmpty() ? "" : " / " + androidId);
    }

    private enum SendResult {
        SUCCESS,
        RETRY,
        PERMANENT_FAILURE
    }
}
