package jp.foundr1.store.bridge;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONObject;

public class UberNotificationListenerService extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String packageName = sbn == null ? "" : sbn.getPackageName();
        if (!looksLikeUber(packageName)) return;
        Notification notification = sbn.getNotification();
        if (notification == null || notification.extras == null) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("title", stringExtra(notification, Notification.EXTRA_TITLE));
            payload.put("text", stringExtra(notification, Notification.EXTRA_TEXT));
            payload.put("bigText", stringExtra(notification, Notification.EXTRA_BIG_TEXT));
            payload.put("subText", stringExtra(notification, Notification.EXTRA_SUB_TEXT));
            payload.put("postTime", sbn.getPostTime());
            BridgeUploader.upload(this, "notification", packageName, payload);
        } catch (Exception ignored) {
        }
    }

    private String stringExtra(Notification notification, String key) {
        CharSequence value = notification.extras.getCharSequence(key);
        return value == null ? "" : value.toString();
    }

    private boolean looksLikeUber(String packageName) {
        String value = packageName == null ? "" : packageName.toLowerCase();
        return value.contains("uber");
    }
}
