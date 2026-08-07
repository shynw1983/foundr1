package jp.foundr1.store.bridge;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class BridgeCommandClient {
    private static final String TAG = "Foundr1BridgeCommand";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean POLLING = new AtomicBoolean(false);

    private BridgeCommandClient() {}

    static void poll(Context context) {
        Context appContext = context.getApplicationContext();
        if (!BridgeConfig.supportsPlatform(appContext, BridgeConfig.PLATFORM_UBER_EATS)) return;
        if (!POLLING.compareAndSet(false, true)) return;
        EXECUTOR.execute(() -> {
            try {
                JSONObject response = request(appContext, "GET", null);
                JSONObject command = response == null ? null : response.optJSONObject("command");
                if (command != null) {
                    Log.i(
                        TAG,
                        "Command received id=" + command.optString("id")
                            + " type=" + command.optString("type")
                    );
                    BridgeCommandState.receive(appContext, command);
                }
            } catch (Exception error) {
                Log.w(TAG, "Command poll failed", error);
            } finally {
                POLLING.set(false);
            }
        });
    }

    static void acknowledge(
        Context context,
        String commandId,
        String status,
        String error,
        JSONObject result
    ) {
        Context appContext = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("commandId", commandId);
                body.put("status", status);
                body.put("error", error == null ? "" : error);
                body.put("result", result == null ? new JSONObject() : result);
                request(appContext, "POST", body);
            } catch (Exception requestError) {
                Log.w(TAG, "Command acknowledgement failed", requestError);
            }
        });
    }

    private static JSONObject request(Context context, String method, JSONObject body) throws Exception {
        String storeId = BridgeConfig.storeId(context);
        if (storeId.isEmpty()) return null;
        String endpoint = BridgeConfig.endpoint(context)
            .replaceAll("/events/?$", "/commands");
        String urlValue = endpoint + "?storeId="
            + URLEncoder.encode(storeId, StandardCharsets.UTF_8.name());
        HttpURLConnection connection = (HttpURLConnection) new URL(urlValue).openConnection();
        try {
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            String token = BridgeConfig.token(context);
            if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            String response = read(stream);
            if (status < 200 || status >= 300) {
                throw new IllegalStateException("HTTP " + status + ": " + response);
            }
            return response.isEmpty() ? new JSONObject() : new JSONObject(response);
        } finally {
            connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
