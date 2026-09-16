package jp.foundr1.store;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.google.android.gms.common.GoogleApiAvailabilityLight;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class StoreOrderPush {
    private static volatile boolean installing = false;
    private StoreOrderPush() {}
    static SharedPreferences prefs(Context context) { return context.getSharedPreferences("foundr1_order_push", Context.MODE_PRIVATE); }
    private static JSONArray rules(Context context) {
        try { return new JSONArray(prefs(context).getString("rules", "[]")); } catch (Exception error) { return new JSONArray(); }
    }
    public static void initialize(Context context) {
        StorePushNotifications.channel(context);
        try {
            String saved = prefs(context).getString("firebase", "");
            if (!saved.isEmpty() && FirebaseApp.getApps(context).isEmpty()) {
                JSONObject config = new JSONObject(saved);
                FirebaseApp.initializeApp(context, new FirebaseOptions.Builder()
                    .setApplicationId(config.getString("applicationId")).setApiKey(config.getString("apiKey"))
                    .setProjectId(config.getString("projectId")).setGcmSenderId(config.getString("senderId")).build());
            }
        } catch (Exception error) { prefs(context).edit().putString("error", "FIREBASE_CONFIG_INVALID").apply(); }
    }
    public static void attach(Activity activity, WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(webView, "Foundr1OrderPush", new HashSet<>(Arrays.asList("https://www.foundr1.jp", "https://foundr1.jp")),
            (view, message, origin, mainFrame, reply) -> {
                if (!mainFrame) return;
                String requestId = "";
                try {
                    JSONObject request = new JSONObject(message.getData());
                    requestId = request.optString("id");
                    String action = request.optString("action");
                    if (action.equals("configure")) {
                        JSONObject config = request.getJSONObject("firebase");
                        String saved = prefs(activity).getString("firebase", "");
                        if (!saved.isEmpty() && !saved.equals(config.toString())) throw new IllegalStateException("FIREBASE_CONFIG_CHANGED_RESTART_REQUIRED");
                        prefs(activity).edit().putString("firebase", config.toString()).putString("error", "").apply();
                        initialize(activity);
                        FirebaseMessaging.getInstance().setAutoInitEnabled(true);
                        FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
                            prefs(activity).edit().putString("fcmToken", token).putString("error", "").apply();
                        }).addOnFailureListener(error -> prefs(activity).edit().putString("error", "FCM_REGISTRATION_FAILED").apply());
                    } else if (action.equals("bind")) {
                        JSONObject binding = request.getJSONObject("binding");
                        clearBinding(activity);
                        prefs(activity).edit().putString("deviceId", binding.getString("deviceId"))
                            .putString("sessionId", binding.getString("sessionId"))
                            .putString("presenceToken", binding.getString("presenceToken")).apply();
                        updateRules(activity, binding.getJSONArray("rules"));
                        refresh(activity);
                    } else if (action.equals("disable")) {
                        clearBinding(activity);
                    } else if (action.equals("settings")) {
                        StorePushNotifications.openSettings(activity, false);
                    } else if (action.equals("channelSettings")) {
                        StorePushNotifications.openSettings(activity, true);
                    } else if (action.equals("chooseSound")) {
                        StorePushNotifications.chooseSound(activity);
                    } else if (action.equals("preview")) {
                        StorePushNotifications.preview(activity);
                    } else if (action.equals("alarmConfigure")) {
                        StoreOrderAlarmService.configure(activity, request.getBoolean("enabled"), request.getString("tone"));
                    } else if (action.equals("alarmPreview")) {
                        StoreOrderAlarmService.preview(activity);
                    } else if (action.equals("alarmStopPreview")) {
                        StoreOrderAlarmService.stopPreview(activity);
                    } else if (action.equals("alarmAcknowledge")) {
                        StoreOrderAlarmService.acknowledge(activity, request.getJSONArray("eventIds"));
                    } else if (action.equals("alarmSettings")) {
                        StoreOrderAlarmService.channel(activity);
                        activity.startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID, StoreOrderAlarmService.CHANNEL));
                    } else if (action.equals("soundSettings")) {
                        activity.startActivity(new Intent(Settings.ACTION_SOUND_SETTINGS));
                    } else if (action.equals("locationSettings")) {
                        activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName())));
                    } else if (action.equals("refresh")) {
                        refresh(activity);
                    } else if (!action.equals("status")) throw new IllegalArgumentException("UNKNOWN_ACTION");
                    JSONObject result = status(activity); result.put("id", requestId); result.put("ok", true);
                    reply.postMessage(result.toString());
                } catch (Exception error) {
                    try { reply.postMessage(new JSONObject().put("id", requestId).put("ok", false).put("error", "NATIVE_PUSH_ACTION_FAILED").toString()); } catch (Exception ignored) {}
                }
            });
    }
    static boolean hasLocationPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            && (Build.VERSION.SDK_INT < 29 || context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED);
    }
    static boolean locationEnabled(Context context) {
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        return manager != null && (Build.VERSION.SDK_INT < 28 || manager.isLocationEnabled());
    }
    private static JSONObject status(Context context) throws Exception {
        SharedPreferences saved = prefs(context);
        JSONObject result = new JSONObject().put("googlePlayAvailable", GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) == 0)
            .put("locationAllowed", hasLocationPermission(context)).put("locationEnabled", locationEnabled(context))
            .put("token", saved.getString("fcmToken", "")).put("deviceId", saved.getString("deviceId", ""))
            .put("bound", !saved.getString("presenceToken", "").isEmpty()).put("error", saved.getString("error", ""))
            .put("geoError", saved.getString("geoError", "")).put("syncError", saved.getString("syncError", ""))
            .put("lastSyncAt", saved.getLong("lastSyncAt", 0)).put("lastReceivedAt", saved.getLong("lastReceivedAt", 0))
            .put("presence", presenceArray(context));
        StorePushNotifications.addStatus(context, result);
        StoreOrderAlarmService.addStatus(context, result);
        return result;
    }
    public static void onActivityResult(Context context, int requestCode, int resultCode, Intent data) {
        StorePushNotifications.soundResult(context, requestCode, resultCode, data);
    }
    static synchronized void setPresence(Context context, String ruleKey, String state) {
        JSONArray regions = rules(context);
        for (int i = 0; i < regions.length(); i++) {
            JSONObject rule = regions.optJSONObject(i);
            if (rule != null && ruleKey.equals(rule.optString("key"))) {
                prefs(context).edit().putString("state:" + ruleKey, state).putLong("observed:" + ruleKey, System.currentTimeMillis()).apply();
                StoreOrderAlarmService.signal();
                if (state.equals("inside")) {
                    NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (manager != null) for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications()) {
                        if (notification.getNotification().extras.getString("foundr1_store_id", "").equals(rule.optString("storeId"))) manager.cancel(notification.getTag(), notification.getId());
                    }
                }
            }
        }
    }
    static void markUnknown(Context context) {
        JSONArray regions = rules(context);
        for (int i = 0; i < regions.length(); i++) if (regions.optJSONObject(i) != null) setPresence(context, regions.optJSONObject(i).optString("key"), "unknown");
    }
    static JSONArray presenceArray(Context context) {
        JSONArray result = new JSONArray(), regions = rules(context);
        for (int i = 0; i < regions.length(); i++) {
            JSONObject rule = regions.optJSONObject(i); if (rule == null) continue;
            String key = rule.optString("key");
            try { result.put(new JSONObject().put("storeId", rule.getString("storeId")).put("ruleKey", key)
                .put("state", prefs(context).getString("state:" + key, "unknown"))
                .put("observedAt", prefs(context).getLong("observed:" + key, System.currentTimeMillis()))); } catch (Exception ignored) {}
        }
        return result;
    }
    static void updateRules(Context context, JSONArray next) {
        if (applyRuleSnapshot(context, next)) installGeofences(context);
    }
    static boolean applyRuleSnapshot(Context context, JSONArray next) {
        if (rules(context).toString().equals(next.toString())) return false;
        java.util.Set<String> previousKeys = new java.util.HashSet<>();
        JSONArray previous = rules(context);
        for (int i = 0; i < previous.length(); i++) {
            JSONObject rule = previous.optJSONObject(i);
            if (rule != null) previousKeys.add(rule.optString("key"));
        }
        prefs(context).edit().putString("rules", next.toString()).apply();
        // A switch for one store must not silence unchanged rules for other stores.
        for (int i = 0; i < next.length(); i++) {
            JSONObject rule = next.optJSONObject(i);
            if (rule != null && !previousKeys.contains(rule.optString("key"))) setPresence(context, rule.optString("key"), "unknown");
        }
        StoreOrderAlarmState.pruneLocal(context);
        StoreOrderAlarmService.signal();
        return true;
    }
    private static PendingIntent geofenceIntent(Context context) {
        return PendingIntent.getBroadcast(context, 72, new Intent(context, StoreGeofenceReceiver.class),
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0));
    }
    @SuppressWarnings("MissingPermission")
    static void installGeofences(Context context) {
        if (installing) return;
        JSONArray regions = rules(context);
        if (regions.length() == 0) { LocationServices.getGeofencingClient(context).removeGeofences(geofenceIntent(context)); return; }
        if (!hasLocationPermission(context) || !locationEnabled(context)) { markUnknown(context); return; }
        installing = true;
        ArrayList<Geofence> fences = new ArrayList<>();
        for (int i = 0; i < Math.min(regions.length(), 50); i++) {
            JSONObject rule = regions.optJSONObject(i); if (rule == null) continue;
            fences.add(new Geofence.Builder().setRequestId(rule.optString("key") + ":outer")
                .setCircularRegion(rule.optDouble("latitude"), rule.optDouble("longitude"), (float) rule.optDouble("exitRadius"))
                .setExpirationDuration(Geofence.NEVER_EXPIRE).setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT).setNotificationResponsiveness(30_000).build());
            fences.add(new Geofence.Builder().setRequestId(rule.optString("key") + ":inner")
                .setCircularRegion(rule.optDouble("latitude"), rule.optDouble("longitude"), (float) rule.optDouble("enterRadius"))
                .setExpirationDuration(Geofence.NEVER_EXPIRE).setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER).setNotificationResponsiveness(30_000).build());
        }
        LocationServices.getGeofencingClient(context).removeGeofences(geofenceIntent(context)).addOnCompleteListener(removed -> {
            if (!regions.toString().equals(rules(context).toString())) {
                installing = false; installGeofences(context); return;
            }
            try {
                LocationServices.getGeofencingClient(context).addGeofences(new GeofencingRequest.Builder()
                    .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER | GeofencingRequest.INITIAL_TRIGGER_EXIT).addGeofences(fences).build(), geofenceIntent(context))
                    .addOnSuccessListener(unused -> {
                        installing = false;
                        if (!regions.toString().equals(rules(context).toString())) { installGeofences(context); return; }
                        prefs(context).edit().putString("geoError", "").apply();
                    })
                    .addOnFailureListener(error -> {
                        installing = false;
                        if (!regions.toString().equals(rules(context).toString())) { installGeofences(context); return; }
                        markUnknown(context); prefs(context).edit().putString("geoError", "GEOFENCE_REGISTRATION_FAILED").apply(); enqueueSync(context);
                    });
            } catch (Exception error) { installing = false; markUnknown(context); }
        });
    }
    public static void refresh(Context context) {
        InventoryWidgetProvider.refreshWidgets(context);
        if (prefs(context).getString("presenceToken", "").isEmpty()) return;
        if (!hasLocationPermission(context) || !locationEnabled(context)) { markUnknown(context); enqueueSync(context); return; }
        installGeofences(context);
        try {
            CancellationTokenSource cancellation = new CancellationTokenSource();
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(cancellation::cancel, 15_000);
            LocationServices.getFusedLocationProviderClient(context).getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cancellation.getToken())
                .addOnSuccessListener(location -> { if (location != null) updateLocation(context, location); enqueueSync(context); })
                .addOnFailureListener(error -> enqueueSync(context));
        } catch (SecurityException error) { markUnknown(context); enqueueSync(context); }
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("foundr1-push-presence-refresh", ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(StorePushSyncWorker.class, 15, TimeUnit.MINUTES).setConstraints(networkConstraints()).build());
    }
    public static void refreshWidgets(Context context) {
        InventoryWidgetProvider.refreshWidgets(context);
    }
    static void updateLocation(Context context, Location location) {
        if (!location.hasAccuracy() || location.getAccuracy() > 100 || System.currentTimeMillis() - location.getTime() > 120_000) return;
        JSONArray regions = rules(context);
        for (int i = 0; i < regions.length(); i++) {
            JSONObject rule = regions.optJSONObject(i); if (rule == null) continue;
            float[] distance = new float[1]; Location.distanceBetween(location.getLatitude(), location.getLongitude(), rule.optDouble("latitude"), rule.optDouble("longitude"), distance);
            String key = rule.optString("key");
            String next = StorePresencePolicy.nextState(prefs(context).getString("state:" + key, "unknown"), distance[0], location.getAccuracy(), rule.optDouble("enterRadius"), rule.optDouble("exitRadius"));
            setPresence(context, key, next);
        }
    }
    static Constraints networkConstraints() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }
    static void enqueueSync(Context context) {
        if (prefs(context).getString("presenceToken", "").isEmpty()) return;
        WorkManager.getInstance(context).enqueueUniqueWork("foundr1-push-presence", ExistingWorkPolicy.APPEND_OR_REPLACE,
            new OneTimeWorkRequest.Builder(StorePushSyncWorker.class).setConstraints(networkConstraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build());
    }
    public static void clearBinding(Context context) {
        StoreOrderAlarmService.clear(context);
        WorkManager.getInstance(context).cancelAllWorkByTag("foundr1-order-alarm-ack");
        String config = prefs(context).getString("firebase", ""), token = prefs(context).getString("fcmToken", "");
        prefs(context).edit().clear().putString("firebase", config).putString("fcmToken", token).apply();
        LocationServices.getGeofencingClient(context).removeGeofences(geofenceIntent(context));
        WorkManager.getInstance(context).cancelUniqueWork("foundr1-push-presence");
        WorkManager.getInstance(context).cancelUniqueWork("foundr1-push-presence-refresh");
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications()) {
            if (StorePushNotifications.ownsChannel(notification.getNotification().getChannelId())) manager.cancel(notification.getTag(), notification.getId());
        }
    }
    static synchronized void display(Context context, JSONObject data, boolean highPriority) {
        SharedPreferences saved = prefs(context);
        if (saved.getString("presenceToken", "").isEmpty() || !saved.getString("sessionId", "").equals(data.optString("sessionId"))) return;
        if (data.optLong("expiresAt", 0) < System.currentTimeMillis()) return;
        boolean test = "store_push_test".equals(data.optString("type"));
        String ruleKey = data.optString("ruleKey");
        boolean currentRule = false;
        JSONArray regions = rules(context);
        for (int i = 0; i < regions.length(); i++) {
            JSONObject rule = regions.optJSONObject(i);
            if (rule != null && ruleKey.equals(rule.optString("key")) && data.optString("storeId").equals(rule.optString("storeId"))) currentRule = true;
        }
        if (!test && !currentRule) return;
        if (!test && (!hasLocationPermission(context) || !locationEnabled(context))) { markUnknown(context); enqueueSync(context); return; }
        if (!test && !"outside".equals(saved.getString("state:" + ruleKey, "unknown"))) { enqueueSync(context); return; }
        if (!test && StoreOrderAlarmState.wasAcknowledged(context, data.optString("eventId"))) return;
        String deliveryKey = data.optString("deliveryKey");
        JSONArray seen;
        try { seen = new JSONArray(saved.getString("seen", "[]")); } catch (Exception error) { seen = new JSONArray(); }
        for (int i = 0; i < seen.length(); i++) if (deliveryKey.equals(seen.optString(i))) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || !manager.areNotificationsEnabled()) { markUnknown(context); enqueueSync(context); return; }
        StorePushNotifications.channel(context);
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        String eventId = data.optString("eventId");
        String href = !test && eventId.matches("[0-9a-fA-F-]{36}") ? "/store/notifications?eventId=" + eventId : "/store/notifications";
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("foundr1_href", href);
        PendingIntent pending = PendingIntent.getActivity(context, eventId.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.os.Bundle extras = new android.os.Bundle(); extras.putString("foundr1_store_id", data.optString("storeId"));
        boolean alarmStarted = false;
        if (StoreOrderAlarmService.enabled(context)) {
            if (test && highPriority && StoreOrderAlarmService.allowed(context)) {
                alarmStarted = StoreOrderAlarmService.preview(context);
            } else if (!test) alarmStarted = StoreOrderAlarmService.receive(context, data, highPriority);
        }
        if (!alarmStarted) {
            Notification notification = StorePushNotifications.build(context, data.optString("title", "Foundr1 STORE"), data.optString("body"), pending, extras);
            manager.notify("store-order:" + eventId, 73, notification);
        }
        StorePushNotifications.pruneUnusedChannels(context);
        JSONArray nextSeen = new JSONArray(); for (int i = Math.max(0, seen.length() - 63); i < seen.length(); i++) nextSeen.put(seen.optString(i)); nextSeen.put(deliveryKey);
        saved.edit().putString("seen", nextSeen.toString()).putLong("lastReceivedAt", System.currentTimeMillis()).apply();
    }
}
