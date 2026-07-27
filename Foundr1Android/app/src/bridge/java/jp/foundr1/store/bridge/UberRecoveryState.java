package jp.foundr1.store.bridge;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class UberRecoveryState {
    private static final String UBER_ORDERS_PACKAGE = "com.uber.restaurants";
    private static final String PREFS = "foundr1_uber_recovery";
    private static final String KEY_PENDING_UNTIL = "pending_until";
    private static final String KEY_REMAINING = "remaining";
    private static final String KEY_LAST_NOTIFICATION = "last_notification";
    private static final String KEY_LAST_NOTIFICATION_COUNT = "last_notification_count";
    private static final String KEY_LAST_NOTIFICATION_AT = "last_notification_at";
    private static final String KEY_LAST_UI_TRIGGER_AT = "last_ui_trigger_at";
    private static final String KEY_OPENED_AUTOMATICALLY = "opened_automatically";
    private static final String KEY_BACK_ATTEMPTS = "back_attempts";
    private static final String KEY_HANDLED_ORDER_CODES = "handled_order_codes";
    private static final long RECOVERY_WINDOW_MS = 3 * 60 * 1000L;
    private static final long UI_TRIGGER_COOLDOWN_MS = 30 * 1000L;
    private static final long NOTIFICATION_BANNER_DEDUP_MS = 15 * 1000L;
    private static final int MAX_PENDING_ORDERS = 50;
    private static final Pattern ORDER_COUNT = Pattern.compile(
        "(\\d+)\\s*(?:件|个|個|(?:new\\s+)?orders?)",
        Pattern.CASE_INSENSITIVE
    );

    private UberRecoveryState() {
    }

    static boolean isNewOrderNotification(String title, String text, String bigText) {
        String combined = (title + "\n" + text + "\n" + bigText)
            .replace('\u00a0', ' ')
            .toLowerCase(Locale.ROOT);
        return combined.contains("新規注文")
            || combined.contains("新しい注文")
            || combined.contains("新订单")
            || combined.contains("新訂單")
            || combined.contains("new order");
    }

    static void requestFromNotification(
        Context context,
        String notificationKey,
        String title,
        String text,
        String bigText,
        Notification notification
    ) {
        if (!isNewOrderNotification(title, text, bigText)) return;
        SharedPreferences preferences = preferences(context);
        String previousKey = preferences.getString(KEY_LAST_NOTIFICATION, "");
        int count = extractOrderCount(title + "\n" + text + "\n" + bigText);
        boolean sameNotification = notificationKey != null && notificationKey.equals(previousKey);
        int previousCount = sameNotification
            ? preferences.getInt(KEY_LAST_NOTIFICATION_COUNT, 0)
            : 0;
        int newlyReportedOrders = sameNotification ? Math.max(0, count - previousCount) : count;
        if (newlyReportedOrders == 0) return;
        boolean alreadyPending = isPending(context);
        int existing = alreadyPending ? preferences.getInt(KEY_REMAINING, 0) : 0;
        SharedPreferences.Editor editor = preferences.edit()
            .putLong(KEY_PENDING_UNTIL, System.currentTimeMillis() + RECOVERY_WINDOW_MS)
            .putLong(KEY_LAST_NOTIFICATION_AT, System.currentTimeMillis())
            .putInt(KEY_REMAINING, Math.min(MAX_PENDING_ORDERS, Math.max(1, existing + newlyReportedOrders)))
            .putString(KEY_LAST_NOTIFICATION, notificationKey == null ? "" : notificationKey)
            .putInt(KEY_LAST_NOTIFICATION_COUNT, count)
            .putInt(KEY_BACK_ATTEMPTS, 0);
        if (!alreadyPending) {
            editor
                .putBoolean(KEY_OPENED_AUTOMATICALLY, false)
                .remove(KEY_HANDLED_ORDER_CODES);
        }
        editor.apply();
        openUber(context, notification);
    }

    static void requestFromAutoAcceptBanner(Context context) {
        SharedPreferences preferences = preferences(context);
        long now = System.currentTimeMillis();
        if (now - preferences.getLong(KEY_LAST_UI_TRIGGER_AT, 0L) < UI_TRIGGER_COOLDOWN_MS) return;
        boolean alreadyPending = isPending(context);
        int existing = alreadyPending ? preferences.getInt(KEY_REMAINING, 0) : 0;
        boolean duplicatesNotification = now - preferences.getLong(KEY_LAST_NOTIFICATION_AT, 0L)
            < NOTIFICATION_BANNER_DEDUP_MS;
        SharedPreferences.Editor editor = preferences.edit()
            .putLong(KEY_PENDING_UNTIL, now + RECOVERY_WINDOW_MS)
            .putLong(KEY_LAST_UI_TRIGGER_AT, now)
            .putInt(
                KEY_REMAINING,
                Math.min(MAX_PENDING_ORDERS, Math.max(1, existing + (duplicatesNotification ? 0 : 1)))
            )
            .putInt(KEY_BACK_ATTEMPTS, 0);
        if (!alreadyPending) {
            editor
                .putBoolean(KEY_OPENED_AUTOMATICALLY, false)
                .remove(KEY_HANDLED_ORDER_CODES);
        }
        editor.apply();
    }

    static boolean isPending(Context context) {
        SharedPreferences preferences = preferences(context);
        if (preferences.getLong(KEY_PENDING_UNTIL, 0L) >= System.currentTimeMillis()) {
            return preferences.getInt(KEY_REMAINING, 0) > 0;
        }
        clear(context);
        return false;
    }

    static void markDetailsOpened(Context context, String orderCode) {
        SharedPreferences preferences = preferences(context);
        Set<String> handled = new HashSet<>(
            preferences.getStringSet(KEY_HANDLED_ORDER_CODES, new HashSet<>())
        );
        if (orderCode != null && !orderCode.trim().isEmpty()) {
            handled.add(orderCode.trim().toUpperCase(Locale.ROOT));
        }
        preferences.edit()
            .putBoolean(KEY_OPENED_AUTOMATICALLY, true)
            .putInt(KEY_BACK_ATTEMPTS, 0)
            .putStringSet(KEY_HANDLED_ORDER_CODES, handled)
            .apply();
    }

    static boolean wasHandled(Context context, String orderCode) {
        if (orderCode == null || orderCode.trim().isEmpty()) return false;
        Set<String> handled = preferences(context)
            .getStringSet(KEY_HANDLED_ORDER_CODES, new HashSet<>());
        return handled.contains(orderCode.trim().toUpperCase(Locale.ROOT));
    }

    static boolean wasOpenedAutomatically(Context context) {
        return isPending(context) && preferences(context).getBoolean(KEY_OPENED_AUTOMATICALLY, false);
    }

    static boolean mayNavigateBack(Context context) {
        if (!isPending(context)) return false;
        SharedPreferences preferences = preferences(context);
        int attempts = preferences.getInt(KEY_BACK_ATTEMPTS, 0);
        if (attempts >= 4) return false;
        preferences.edit().putInt(KEY_BACK_ATTEMPTS, attempts + 1).apply();
        return true;
    }

    static boolean finishCurrentOrder(Context context) {
        SharedPreferences preferences = preferences(context);
        int remaining = Math.max(0, preferences.getInt(KEY_REMAINING, 1) - 1);
        if (remaining == 0) {
            clear(context);
            return false;
        }
        preferences.edit()
            .putLong(KEY_PENDING_UNTIL, System.currentTimeMillis() + RECOVERY_WINDOW_MS)
            .putInt(KEY_REMAINING, remaining)
            .putBoolean(KEY_OPENED_AUTOMATICALLY, false)
            .putInt(KEY_BACK_ATTEMPTS, 0)
            .apply();
        return true;
    }

    private static int extractOrderCount(String value) {
        Matcher matcher = ORDER_COUNT.matcher(value == null ? "" : value);
        if (!matcher.find()) return 1;
        try {
            return Math.max(1, Math.min(MAX_PENDING_ORDERS, Integer.parseInt(matcher.group(1))));
        } catch (Exception ignored) {
            return 1;
        }
    }

    private static void openUber(Context context, Notification notification) {
        PendingIntent pendingIntent = notification == null ? null : notification.contentIntent;
        if (pendingIntent != null) {
            try {
                pendingIntent.send();
                return;
            } catch (PendingIntent.CanceledException ignored) {
            }
        }
        Intent launchIntent = context.getPackageManager().getLaunchIntentForPackage(UBER_ORDERS_PACKAGE);
        if (launchIntent == null) return;
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            context.startActivity(launchIntent);
        } catch (Exception ignored) {
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void clear(Context context) {
        preferences(context).edit()
            .remove(KEY_PENDING_UNTIL)
            .remove(KEY_REMAINING)
            .remove(KEY_OPENED_AUTOMATICALLY)
            .remove(KEY_BACK_ATTEMPTS)
            .apply();
    }
}
