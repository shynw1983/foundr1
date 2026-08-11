package jp.foundr1.store.bridge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

final class BridgeHealthState {
    static final String ACTION_CHANGED = "jp.foundr1.bridge.HEALTH_CHANGED";
    static final String ACTION_ACCESSIBILITY_PING = "jp.foundr1.bridge.ACCESSIBILITY_PING";
    private static final String PREFS = "foundr1_bridge_health";
    private static final String KEY_ACCESSIBILITY_CONNECTED = "accessibility_connected";
    private static final String KEY_NOTIFICATION_CONNECTED = "notification_connected";
    private static final String KEY_REALTIME_CONNECTED = "realtime_connected";
    private static final String KEY_PENDING_COUNT = "pending_count";
    private static final String KEY_LAST_ORDER_CODE = "last_order_code";
    private static final String KEY_LAST_ORDER_AT = "last_order_at";
    private static final String KEY_LAST_UPLOAD_AT = "last_upload_at";
    private static final String KEY_LAST_UPLOAD_ERROR = "last_upload_error";

    private BridgeHealthState() {}

    static void resetRuntimeConnections(Context context) {
        prefs(context).edit()
            .putBoolean(KEY_ACCESSIBILITY_CONNECTED, false)
            .putBoolean(KEY_NOTIFICATION_CONNECTED, false)
            .putBoolean(KEY_REALTIME_CONNECTED, false)
            .apply();
    }

    static void setAccessibilityConnected(Context context, boolean connected) {
        setBoolean(context, KEY_ACCESSIBILITY_CONNECTED, connected);
    }

    static void confirmAccessibilityConnected(Context context) {
        prefs(context).edit().putBoolean(KEY_ACCESSIBILITY_CONNECTED, true).commit();
        notifyChanged(context);
    }

    static void setNotificationConnected(Context context, boolean connected) {
        setBoolean(context, KEY_NOTIFICATION_CONNECTED, connected);
    }

    static void setRealtimeConnected(Context context, boolean connected) {
        setBoolean(context, KEY_REALTIME_CONNECTED, connected);
    }

    static void setPendingCount(Context context, int count) {
        SharedPreferences preferences = prefs(context);
        if (preferences.getInt(KEY_PENDING_COUNT, -1) == count) return;
        preferences.edit().putInt(KEY_PENDING_COUNT, Math.max(0, count)).apply();
        notifyChanged(context);
    }

    static void recordOrderUpload(Context context, String orderCode) {
        prefs(context).edit()
            .putString(KEY_LAST_ORDER_CODE, orderCode == null ? "" : orderCode)
            .putLong(KEY_LAST_ORDER_AT, System.currentTimeMillis())
            .putLong(KEY_LAST_UPLOAD_AT, System.currentTimeMillis())
            .putString(KEY_LAST_UPLOAD_ERROR, "")
            .apply();
        notifyChanged(context);
    }

    static void recordUploadSuccess(Context context) {
        prefs(context).edit()
            .putLong(KEY_LAST_UPLOAD_AT, System.currentTimeMillis())
            .putString(KEY_LAST_UPLOAD_ERROR, "")
            .apply();
        notifyChanged(context);
    }

    static void recordUploadError(Context context, String error) {
        prefs(context).edit()
            .putString(KEY_LAST_UPLOAD_ERROR, error == null ? "" : error)
            .apply();
        notifyChanged(context);
    }

    static Snapshot snapshot(Context context) {
        SharedPreferences preferences = prefs(context);
        return new Snapshot(
            preferences.getBoolean(KEY_ACCESSIBILITY_CONNECTED, false),
            preferences.getBoolean(KEY_NOTIFICATION_CONNECTED, false),
            preferences.getBoolean(KEY_REALTIME_CONNECTED, false),
            Math.max(0, preferences.getInt(KEY_PENDING_COUNT, 0)),
            preferences.getString(KEY_LAST_ORDER_CODE, ""),
            preferences.getLong(KEY_LAST_ORDER_AT, 0L),
            preferences.getLong(KEY_LAST_UPLOAD_AT, 0L),
            preferences.getString(KEY_LAST_UPLOAD_ERROR, "")
        );
    }

    private static void setBoolean(Context context, String key, boolean value) {
        SharedPreferences preferences = prefs(context);
        if (preferences.getBoolean(key, false) == value) return;
        preferences.edit().putBoolean(key, value).apply();
        notifyChanged(context);
    }

    private static void notifyChanged(Context context) {
        Intent intent = new Intent(ACTION_CHANGED);
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static final class Snapshot {
        final boolean accessibilityConnected;
        final boolean notificationConnected;
        final boolean realtimeConnected;
        final int pendingCount;
        final String lastOrderCode;
        final long lastOrderAt;
        final long lastUploadAt;
        final String lastUploadError;

        Snapshot(
            boolean accessibilityConnected,
            boolean notificationConnected,
            boolean realtimeConnected,
            int pendingCount,
            String lastOrderCode,
            long lastOrderAt,
            long lastUploadAt,
            String lastUploadError
        ) {
            this.accessibilityConnected = accessibilityConnected;
            this.notificationConnected = notificationConnected;
            this.realtimeConnected = realtimeConnected;
            this.pendingCount = pendingCount;
            this.lastOrderCode = lastOrderCode == null ? "" : lastOrderCode;
            this.lastOrderAt = lastOrderAt;
            this.lastUploadAt = lastUploadAt;
            this.lastUploadError = lastUploadError == null ? "" : lastUploadError;
        }
    }
}
