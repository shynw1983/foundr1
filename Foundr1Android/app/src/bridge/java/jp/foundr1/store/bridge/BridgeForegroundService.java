package jp.foundr1.store.bridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;

import org.json.JSONObject;

import jp.foundr1.store.R;

public class BridgeForegroundService extends Service {
    static final String CHANNEL_ID = "foundr1_bridge_status";
    private static final String ALERT_CHANNEL_ID = "foundr1_bridge_alerts";
    private static final int NOTIFICATION_ID = 5201;
    private static final int ACCESSIBILITY_ALERT_ID = 5202;
    private static final int CONNECTION_ALERT_ID = 5203;
    private static final int HEALTHY_COLOR = Color.rgb(24, 112, 74);
    private static final int UNHEALTHY_COLOR = Color.rgb(190, 24, 45);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean heartbeatAttempted = false;
    private boolean backendConnected = false;
    private String lastProblem = "";
    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            BridgeUploader.upload(
                BridgeForegroundService.this,
                "heartbeat",
                "",
                new JSONObject(),
                success -> handler.post(() -> {
                    heartbeatAttempted = true;
                    backendConnected = success;
                    refreshBridgeStatus();
                })
            );
            refreshAccessibilityWarning();
            refreshBridgeStatus();
            handler.postDelayed(this, 60000);
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
        startForeground(NOTIFICATION_ID, buildStatusNotification(false, "接続確認中"));
        refreshAccessibilityWarning();
        refreshBridgeStatus();
        handler.post(heartbeat);
        handler.post(recoveryWatchdog);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        refreshAccessibilityWarning();
        refreshBridgeStatus();
        return START_STICKY;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        handler.removeCallbacks(heartbeat);
        handler.removeCallbacks(recoveryWatchdog);
        stopSelf(startId);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(heartbeat);
        handler.removeCallbacks(recoveryWatchdog);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildStatusNotification(boolean healthy, String detail) {
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
            .setContentTitle(healthy ? "Bridge 接続正常" : "Bridge 接続異常")
            .setContentText(detail)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .setColor(healthy ? HEALTHY_COLOR : UNHEALTHY_COLOR)
            .build();
    }

    private void refreshBridgeStatus() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String problem = currentProblem(manager);
        boolean healthy = problem.isEmpty();
        String detail = healthy
            ? "Uber Eats の読み取りと Foundr1 OS への接続は正常です"
            : problem;
        manager.notify(NOTIFICATION_ID, buildStatusNotification(healthy, detail));

        boolean connectionChecking = "Foundr1 OS への接続を確認中です".equals(problem);
        if (!healthy && !connectionChecking && !problem.equals(lastProblem)) {
            manager.notify(CONNECTION_ALERT_ID, buildConnectionAlert(problem));
        } else if (healthy) {
            manager.cancel(CONNECTION_ALERT_ID);
        }
        lastProblem = healthy ? "" : problem;
    }

    private String currentProblem(NotificationManager manager) {
        if (!manager.areNotificationsEnabled()) return "Bridge の通知が許可されていません";
        if (!isNotificationListenerEnabled()) return "Uber Eats の通知アクセスが無効です";
        if (!isAccessibilityServiceEnabled()) return "Uber Eats の画面読み取りが無効です";
        if (BridgeConfig.endpoint(this).isEmpty() || BridgeConfig.token(this).isEmpty()) {
            return "Foundr1 OS の接続設定が未完了です";
        }
        if (!heartbeatAttempted) return "Foundr1 OS への接続を確認中です";
        if (!backendConnected) return "Foundr1 OS に接続できません";
        return "";
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
}
