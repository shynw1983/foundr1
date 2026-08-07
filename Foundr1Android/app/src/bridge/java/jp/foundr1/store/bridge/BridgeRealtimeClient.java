package jp.foundr1.store.bridge;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.pusher.client.Pusher;
import com.pusher.client.PusherOptions;
import com.pusher.client.channel.PresenceChannelEventListener;
import com.pusher.client.channel.PusherEvent;
import com.pusher.client.channel.User;
import com.pusher.client.connection.ConnectionEventListener;
import com.pusher.client.connection.ConnectionState;
import com.pusher.client.connection.ConnectionStateChange;
import com.pusher.client.util.HttpAuthorizer;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class BridgeRealtimeClient {
    private static final String TAG = "Foundr1BridgeRealtime";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static Pusher pusher;
    private static String activeConfigKey = "";

    private BridgeRealtimeClient() {}

    static synchronized void start(Context context) {
        Context appContext = context.getApplicationContext();
        String storeId = BridgeConfig.storeId(appContext);
        String token = BridgeConfig.token(appContext);
        if (storeId.isEmpty() || token.isEmpty()) {
            BridgeHealthState.setRealtimeConnected(appContext, false);
            return;
        }
        String configKey = BridgeConfig.endpoint(appContext) + "|" + storeId + "|" + token.hashCode();
        if (pusher != null && configKey.equals(activeConfigKey)) return;
        disconnect(appContext);
        activeConfigKey = configKey;
        EXECUTOR.execute(() -> connect(appContext, storeId, token, configKey));
    }

    static synchronized void disconnect(Context context) {
        if (pusher != null) {
            try { pusher.disconnect(); } catch (Exception ignored) {}
            pusher = null;
        }
        activeConfigKey = "";
        BridgeHealthState.setRealtimeConnected(context, false);
    }

    private static void connect(Context context, String storeId, String token, String configKey) {
        try {
            String realtimeEndpoint = endpoint(context, "realtime")
                + "?storeId=" + URLEncoder.encode(storeId, StandardCharsets.UTF_8.name())
                + "&deviceName=" + URLEncoder.encode(resolveDeviceName(context), StandardCharsets.UTF_8.name());
            JSONObject config = requestConfig(realtimeEndpoint, token);
            HttpAuthorizer authorizer = new HttpAuthorizer(realtimeEndpoint);
            HashMap<String, String> headers = new HashMap<>();
            headers.put("Authorization", "Bearer " + token);
            authorizer.setHeaders(headers);
            PusherOptions options = new PusherOptions()
                .setCluster(config.optString("cluster"))
                .setAuthorizer(authorizer);
            Pusher next = new Pusher(config.optString("key"), options);
            synchronized (BridgeRealtimeClient.class) {
                if (!configKey.equals(activeConfigKey)) return;
                pusher = next;
            }
            PresenceChannelEventListener channelListener = new PresenceChannelEventListener() {
                @Override
                public void onSubscriptionSucceeded(String channelName) {
                    BridgeHealthState.setRealtimeConnected(context, true);
                    BridgeStatusReporter.reportIfNeeded(context, true);
                    BridgeCommandClient.poll(context);
                }

                @Override
                public void onAuthenticationFailure(String message, Exception error) {
                    Log.w(TAG, "Realtime authentication failed: " + message, error);
                    BridgeHealthState.setRealtimeConnected(context, false);
                }

                @Override
                public void onEvent(PusherEvent event) {
                    if ("bridge.command.available".equals(event.getEventName())) {
                        BridgeCommandClient.poll(context);
                    }
                }

                @Override
                public void onUsersInformationReceived(String channelName, Set<User> users) {
                }

                @Override
                public void userSubscribed(String channelName, User user) {
                }

                @Override
                public void userUnsubscribed(String channelName, User user) {
                }
            };
            next.subscribePresence(
                config.optString("channel"),
                channelListener,
                "bridge.command.available"
            );
            next.connect(new ConnectionEventListener() {
                @Override
                public void onConnectionStateChange(ConnectionStateChange change) {
                    boolean connected = change.getCurrentState() == ConnectionState.CONNECTED;
                    // A socket connection is not enough: commands are safe to stop polling
                    // only after the private presence-channel subscription succeeds.
                    if (!connected) {
                        BridgeHealthState.setRealtimeConnected(context, false);
                        BridgeStatusReporter.reportIfNeeded(context, false);
                    }
                }

                @Override
                public void onError(String message, String code, Exception error) {
                    Log.w(TAG, "Realtime connection error " + code + ": " + message, error);
                    BridgeHealthState.setRealtimeConnected(context, false);
                }
            }, ConnectionState.ALL);
        } catch (Exception error) {
            Log.w(TAG, "Unable to start realtime connection", error);
            BridgeHealthState.setRealtimeConnected(context, false);
        }
    }

    private static JSONObject requestConfig(String endpoint, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            String response = read(stream);
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status + ": " + response);
            return new JSONObject(response);
        } finally {
            connection.disconnect();
        }
    }

    static String endpoint(Context context, String suffix) {
        return BridgeConfig.endpoint(context).replaceAll("/events/?$", "/" + suffix);
    }

    private static String resolveDeviceName(Context context) {
        String configured = BridgeConfig.deviceName(context);
        return configured.isEmpty() ? android.os.Build.MODEL : configured;
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
