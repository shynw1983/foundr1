package jp.foundr1.store.bridge;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class UberNotificationListenerService extends NotificationListenerService {
    private static final String UBER_ORDERS_PACKAGE = "com.uber.restaurants";
    private static long lastRebindRequestAt = 0L;

    static synchronized void requestConnection(android.content.Context context) {
        long now = System.currentTimeMillis();
        if (now - lastRebindRequestAt < 30000L) return;
        lastRebindRequestAt = now;
        requestRebind(new android.content.ComponentName(context, UberNotificationListenerService.class));
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        BridgeHealthState.setNotificationConnected(this, true);
        BridgeServiceStarter.ensureStarted(this, "notification_connected");
    }

    @Override
    public void onListenerDisconnected() {
        BridgeHealthState.setNotificationConnected(this, false);
        requestConnection(this);
        super.onListenerDisconnected();
    }

    @Override
    public void onDestroy() {
        BridgeHealthState.setNotificationConnected(this, false);
        super.onDestroy();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            handleNotificationPosted(sbn);
        } catch (RuntimeException error) {
            BridgeCrashReporter.reportCaught(this, "notification_listener", error);
        }
    }

    private void handleNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn == null ? "" : sbn.getPackageName();
        if (!looksLikeUber(packageName)) return;
        Notification notification = sbn.getNotification();
        if (notification == null || notification.extras == null) return;
        String title = stringExtra(notification, Notification.EXTRA_TITLE);
        String text = stringExtra(notification, Notification.EXTRA_TEXT);
        String bigText = stringExtra(notification, Notification.EXTRA_BIG_TEXT);
        int recoveryRequestedOrders = UberRecoveryState.requestFromNotification(
            this,
            sbn.getKey(),
            sbn.getPostTime(),
            title,
            text,
            bigText,
            notification
        );
        try {
            JSONObject payload = new JSONObject();
            payload.put("title", title);
            payload.put("text", text);
            payload.put("bigText", bigText);
            payload.put("subText", stringExtra(notification, Notification.EXTRA_SUB_TEXT));
            payload.put("postTime", sbn.getPostTime());
            payload.put("recoveryRequestedOrders", recoveryRequestedOrders);
            BridgeUploader.upload(this, "notification", packageName, payload);
        } catch (Exception ignored) {
        }
    }

    private String stringExtra(Notification notification, String key) {
        CharSequence value = notification.extras.getCharSequence(key);
        return value == null ? "" : value.toString();
    }

    private boolean looksLikeUber(String packageName) {
        return UBER_ORDERS_PACKAGE.equals(packageName);
    }
}
