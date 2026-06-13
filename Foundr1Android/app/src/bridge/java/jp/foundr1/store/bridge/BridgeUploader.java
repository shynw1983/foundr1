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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeUploader {
    private static final String TAG = "Foundr1Bridge";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private BridgeUploader() {}

    static void upload(Context context, String kind, String packageName, JSONObject payload) {
        Context appContext = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("platform", "uber_eats");
                body.put("kind", kind);
                body.put("packageName", packageName == null ? "" : packageName);
                body.put("storeId", BridgeConfig.storeId(appContext));
                body.put("deviceName", resolveDeviceName(appContext));
                body.put("capturedAt", System.currentTimeMillis());
                body.put("payload", payload == null ? new JSONObject() : payload);

                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                URL url = new URL(BridgeConfig.endpoint(appContext));
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(15000);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                String token = BridgeConfig.token(appContext);
                if (!token.isEmpty()) {
                    connection.setRequestProperty("Authorization", "Bearer " + token);
                }
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(bytes);
                }
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    Log.w(TAG, "Upload failed with HTTP " + status);
                }
                connection.disconnect();
            } catch (Exception error) {
                Log.w(TAG, "Upload failed", error);
            }
        });
    }

    private static String resolveDeviceName(Context context) {
        String configured = BridgeConfig.deviceName(context);
        if (!configured.isEmpty()) return configured;
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        String model = String.format(Locale.US, "%s %s", Build.MANUFACTURER, Build.MODEL).trim();
        return model + (androidId == null || androidId.isEmpty() ? "" : " / " + androidId);
    }
}
