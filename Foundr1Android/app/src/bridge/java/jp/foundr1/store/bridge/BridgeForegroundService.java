package jp.foundr1.store.bridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;

import jp.foundr1.store.R;

public class BridgeForegroundService extends Service {
    static final String CHANNEL_ID = "foundr1_bridge_status";
    private static final String ALERT_CHANNEL_ID = "foundr1_bridge_alerts";
    private static final int NOTIFICATION_ID = 5201;
    private static final int ACCESSIBILITY_ALERT_ID = 5202;
    private static final int CONNECTION_ALERT_ID = 5203;
    private static final int HEALTHY_COLOR = Color.rgb(24, 112, 74);
    private static final int ATTENTION_COLOR = Color.rgb(183, 121, 31);
    private static final int UNHEALTHY_COLOR = Color.rgb(190, 24, 45);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final long createdAt = System.currentTimeMillis();
    private String lastProblem = "";
    private boolean healthReceiverRegistered = false;
    private final Runnable healthRefresh = new Runnable() {
        @Override
        public void run() {
            refreshAccessibilityWarning();
            refreshBridgeStatus();
            BridgeStatusReporter.reportIfNeeded(BridgeForegroundService.this, false);
            handler.postDelayed(this, 60000);
        }
    };
    private final BroadcastReceiver healthReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            refreshBridgeStatus();
            BridgeStatusReporter.reportIfNeeded(BridgeForegroundService.this, false);
        }
    };
    private final Runnable recoveryWatchdog = new Runnable() {
        @Override
        public void run() {
            if (UberRecoveryState.isPending(BridgeForegroundService.this)) {
                UberRecoveryState.sendRecoverySignal(BridgeForegroundService.this);
            }
            handler.postDelayed(this, 2000);
        }
    };
    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildStatusNotification("attention", "接続確認中"));
        IntentFilter filter = new IntentFilter(BridgeHealthState.ACTION_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(healthReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(healthReceiver, filter);
        }
        healthReceiverRegistered = true;
        BridgeRealtimeClient.start(this);
        refreshAccessibilityWarning();
        refreshBridgeStatus();
        handler.post(healthRefresh);
        handler.post(recoveryWatchdog);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        refreshAccessibilityWarning();
        BridgeRealtimeClient.start(this);
        refreshBridgeStatus();
        return START_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        handler.removeCallbacks(healthRefresh);
        handler.removeCallbacks(recoveryWatchdog);
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(healthRefresh);
        handler.removeCallbacks(recoveryWatchdog);
        if (healthReceiverRegistered) {
            try { unregisterReceiver(healthReceiver); } catch (Exception ignored) {}
            healthReceiverRegistered = false;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildStatusNotification(String level, String detail) {
        boolean healthy = "healthy".equals(level);
        boolean attention = "attention".equals(level);
        Intent intent = new Intent(this, BridgeActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(healthy ? R.drawable.ic_bridge_status_ok : R.drawable.ic_bridge_status_error)
            .setContentTitle(healthy ? "Bridge 接続正常" : attention ? "Bridge 確認が必要" : "Bridge 接続異常")
            .setContentText(detail)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .setColor(healthy ? HEALTHY_COLOR : attention ? ATTENTION_COLOR : UNHEALTHY_COLOR)
            .build();
    }

    private void refreshBridgeStatus() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        HealthResult health = currentHealth(manager);
        boolean healthy = "healthy".equals(health.level);
        String detail = healthy
            ? "Uber Eats の読み取りと Foundr1 OS への接続は正常です"
            : health.problem;
        manager.notify(NOTIFICATION_ID, buildStatusNotification(health.level, detail));

        if ("error".equals(health.level) && !health.problem.equals(lastProblem)) {
            manager.notify(CONNECTION_ALERT_ID, buildConnectionAlert(health.problem));
        } else if (healthy) {
            manager.cancel(CONNECTION_ALERT_ID);
        }
        lastProblem = healthy ? "" : health.problem;
    }

    private HealthResult currentHealth(NotificationManager manager) {
        if (!manager.areNotificationsEnabled()) return HealthResult.error("Bridge の通知が許可されていません");
        if (!isNotificationListenerEnabled()) return HealthResult.error("Uber Eats の通知アクセスが無効です");
        if (!isAccessibilityServiceEnabled()) return HealthResult.error("Uber Eats の画面読み取りが無効です");
        if (
            BridgeConfig.endpoint(this).isEmpty()
            || BridgeConfig.token(this).isEmpty()
            || BridgeConfig.storeId(this).isEmpty()
        ) return HealthResult.error("店舗の接続設定が未完了です");
        BridgeHealthState.Snapshot state = BridgeHealthState.snapshot(this);
        if (!state.accessibilityConnected) return HealthResult.attention("画面読み取りサービスの接続を確認中です");
        if (!state.notificationConnected) {
            UberNotificationListenerService.requestConnection(this);
            return System.currentTimeMillis() - createdAt > 90000L
                ? HealthResult.error("通知読み取りサービスを再接続できません")
                : HealthResult.attention("通知読み取りサービスの接続を確認中です");
        }
        if (!state.realtimeConnected) {
            return System.currentTimeMillis() - createdAt > 90000L
                ? HealthResult.error("Foundr1 OS のリアルタイム接続が切れています")
                : HealthResult.attention("Foundr1 OS のリアルタイム接続を確認中です");
        }
        if (state.pendingCount > 0) return HealthResult.attention("未送信データが " + state.pendingCount + " 件あります");
        if (!state.lastUploadError.isEmpty()) return HealthResult.attention(state.lastUploadError);
        return HealthResult.healthy();
    }

    private Notification buildConnectionAlert(String problem) {
        Intent intent = new Intent(this, BridgeActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            CONNECTION_ALERT_ID,
            intent,
            Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, ALERT_CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(R.drawable.ic_bridge_status_error)
            .setContentTitle("⚠ Bridge 接続異常")
            .setContentText(problem)
            .setContentIntent(pendingIntent)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setColor(UNHEALTHY_COLOR)
            .setPriority(Notification.PRIORITY_HIGH)
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Foundr1 Bridge for Uber Eats",
            NotificationManager.IMPORTANCE_LOW
        );
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.createNotificationChannel(channel);
            NotificationChannel alertChannel = new NotificationChannel(
                ALERT_CHANNEL_ID,
                "Foundr1 Bridge for Uber Eats 警告",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Uber注文の読み取りが停止した場合に通知します");
            manager.createNotificationChannel(alertChannel);
        }
    }

    private void refreshAccessibilityWarning() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (isAccessibilityServiceEnabled()) {
            manager.cancel(ACCESSIBILITY_ALERT_ID);
            return;
        }
        Intent settingsIntent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            ACCESSIBILITY_ALERT_ID,
            settingsIntent,
            Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, ALERT_CHANNEL_ID)
            : new Notification.Builder(this);
        manager.notify(
            ACCESSIBILITY_ALERT_ID,
            builder
                .setSmallIcon(R.drawable.ic_bridge_status_error)
                .setContentTitle("⚠ Foundr1 Bridge の読み取りが停止")
                .setContentText("タップしてユーザー補助を再度有効にしてください")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setColor(UNHEALTHY_COLOR)
                .setPriority(Notification.PRIORITY_HIGH)
                .build()
        );
    }

    private boolean isAccessibilityServiceEnabled() {
        if (
            Settings.Secure.getInt(
                getContentResolver(),
                Settings.Secure.ACCESSIBILITY_ENABLED,
                0
            ) != 1
        ) return false;
        String enabledServices = Settings.Secure.getString(
            getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        if (TextUtils.isEmpty(enabledServices)) return false;
        String expected = getPackageName() + "/" + UberAccessibilityService.class.getName();
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledServices);
        while (splitter.hasNext()) {
            if (expected.equalsIgnoreCase(splitter.next())) return true;
        }
        return false;
    }

    private boolean isNotificationListenerEnabled() {
        String enabledListeners = Settings.Secure.getString(
            getContentResolver(),
            "enabled_notification_listeners"
        );
        if (TextUtils.isEmpty(enabledListeners)) return false;
        TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
        splitter.setString(enabledListeners);
        while (splitter.hasNext()) {
            ComponentName component = ComponentName.unflattenFromString(splitter.next());
            if (component != null && getPackageName().equals(component.getPackageName())) return true;
        }
        return false;
    }

    private static final class HealthResult {
        final String level;
        final String problem;

        private HealthResult(String level, String problem) {
            this.level = level;
            this.problem = problem;
        }

        static HealthResult healthy() { return new HealthResult("healthy", ""); }
        static HealthResult attention(String problem) { return new HealthResult("attention", problem); }
        static HealthResult error(String problem) { return new HealthResult("error", problem); }
    }
}
