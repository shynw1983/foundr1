package jp.foundr1.store;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

public final class StoreOrderAlarmService extends Service {
    static final String CHANNEL = "foundr1_order_alarm_v1";
    static final String ACKNOWLEDGE = "jp.foundr1.store.ACKNOWLEDGE_ORDER_ALARM";
    private static final int NOTIFICATION_ID = 18774;
    private static volatile StoreOrderAlarmService running;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private StoreOrderAlarmPlayer player;
    private boolean checking;
    private boolean destroyed;
    private long nextCheck;
    private String displayedIds = "";
    private final Runnable tick = this::tick;
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences("foundr1_push_presentation", Context.MODE_PRIVATE); }
    // Opt in on each phone: continuous alarm uses alarm volume, independent of a notification tone.
    static boolean enabled(Context context) { return preferences(context).getBoolean("continuousAlarm", false); }
    static String tone(Context context) { return preferences(context).getString("alarmTone", "urgent"); }
    static void configure(Context context, boolean enabled, String tone) {
        if (!"urgent".equals(tone) && !"pulse".equals(tone)) throw new IllegalArgumentException("Invalid alarm tone");
        preferences(context).edit().putBoolean("continuousAlarm", enabled).putString("alarmTone", tone).apply();
        if (!enabled) StoreOrderAlarmState.clearEvents(context);
        signal();
    }
    static NotificationChannel channel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        if (channel == null) {
            channel = new NotificationChannel(CHANNEL, context.getString(R.string.alarm_channel_name), NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(context.getString(R.string.alarm_channel_description));
            // Playback/vibration are controlled by the visible foreground service, not a one-shot tone.
            channel.setSound(null, null); channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        return manager.getNotificationChannel(CHANNEL);
    }
    static boolean allowed(Context context) {
        return context.getSystemService(NotificationManager.class).areNotificationsEnabled()
            && channel(context).getImportance() >= NotificationManager.IMPORTANCE_DEFAULT;
    }
    static boolean receive(Context context, JSONObject event, boolean highPriority) {
        if (!enabled(context) || !allowed(context)) return false;
        if (!highPriority) { StoreOrderAlarmState.error(context, "PUSH_PRIORITY_DOWNGRADED"); return false; }
        StoreOrderAlarmState.add(context, event);
        if (StoreOrderAlarmState.events(context).length() == 0) return true;
        if (start(context)) return true;
        StoreOrderAlarmState.reconcile(context, new JSONArray().put(event.optString("eventId")), new JSONArray());
        return false;
    }
    static boolean preview(Context context) {
        if (!allowed(context)) throw new IllegalStateException("Alarm notifications disabled");
        StoreOrderAlarmState.preview(context, android.os.SystemClock.elapsedRealtime() + 10_000);
        boolean started = start(context);
        if (!started) StoreOrderAlarmState.preview(context, 0);
        return started;
    }
    static void stopPreview(Context context) { StoreOrderAlarmState.preview(context, 0); signal(); }
    private static boolean start(Context context) {
        try {
            StoreOrderAlarmState.error(context, "");
            context.startForegroundService(new Intent(context, StoreOrderAlarmService.class));
            return true;
        } catch (RuntimeException error) { StoreOrderAlarmState.error(context, "BACKGROUND_ALARM_BLOCKED"); return false; }
    }
    static void signal() {
        StoreOrderAlarmService instance = running;
        if (instance != null) instance.handler.post(instance::tick);
    }
    static void clear(Context context) {
        StoreOrderAlarmState.clear(context);
        context.stopService(new Intent(context, StoreOrderAlarmService.class));
    }
    static void acknowledge(Context context, JSONArray requestedIds) {
        java.util.Set<String> current = StoreOrderAlarmState.ids(StoreOrderAlarmState.events(context));
        current.retainAll(StoreOrderAlarmState.ids(requestedIds));
        JSONArray ids = new JSONArray(current);
        StoreOrderAlarmState.acknowledge(context, ids);
        StoreOrderAlarmAckWorker.enqueue(context, ids);
        signal();
    }
    static void addStatus(Context context, JSONObject result) throws Exception {
        AudioManager audio = context.getSystemService(AudioManager.class);
        result.put("alarmVersion", 1).put("alarmEnabled", enabled(context)).put("alarmTone", tone(context))
            .put("alarmAllowed", allowed(context)).put("alarmActiveIds", StoreOrderAlarmState.eventIds(context))
            .put("alarmPreview", StoreOrderAlarmState.previewUntil(context) > android.os.SystemClock.elapsedRealtime())
            .put("alarmVolume", audio.getStreamVolume(AudioManager.STREAM_ALARM)).put("alarmVolumeMax", audio.getStreamMaxVolume(AudioManager.STREAM_ALARM))
            .put("alarmError", StoreOrderAlarmState.error(context));
        if (enabled(context)) result.put("notificationsAllowed", context.getSystemService(NotificationManager.class).areNotificationsEnabled() && channel(context).getImportance() > 0)
            .put("soundEnabled", allowed(context)).put("highImportance", allowed(context) && channel(context).getImportance() >= NotificationManager.IMPORTANCE_HIGH)
            .put("soundName", context.getString("pulse".equals(tone(context)) ? R.string.alarm_tone_pulse : R.string.alarm_tone_urgent));
    }
    @Override public void onCreate() { super.onCreate(); running = this; player = new StoreOrderAlarmPlayer(this); }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // Foreground immediately, before any network or audio preparation (Android's five-second rule).
        Notification notification = notification();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION_ID, notification);
        } catch (RuntimeException error) {
            StoreOrderAlarmState.error(this, "BACKGROUND_ALARM_BLOCKED");
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
            stopSelf(); return START_NOT_STICKY;
        }
        if (intent != null && ACKNOWLEDGE.equals(intent.getAction())) {
            try { acknowledge(this, new JSONArray(intent.getStringExtra("eventIds"))); } catch (Exception ignored) {}
            if (intent.getBooleanExtra("preview", false)) stopPreview(this);
        }
        tick();
        return START_STICKY;
    }
    private Notification notification() {
        JSONArray events = StoreOrderAlarmState.events(this);
        boolean preview = events.length() == 0;
        String title = getString(preview ? R.string.alarm_preview_title : R.string.alarm_title, events.length());
        JSONObject first = events.optJSONObject(0);
        String text = first == null ? getString(R.string.alarm_preview_body) : first.optString("title") + " · " + first.optString("body");
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra("foundr1_href", "/store/notifications");
        PendingIntent view = PendingIntent.getActivity(this, NOTIFICATION_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String ids = StoreOrderAlarmState.eventIds(this).toString();
        // Each notification button acknowledges exactly the orders visible when it was rendered.
        Intent stop = new Intent(this, StoreOrderAlarmService.class).setAction(ACKNOWLEDGE)
            .setData(Uri.parse("foundr1://order-alarm/" + Uri.encode(ids) + "/" + preview)).putExtra("eventIds", ids).putExtra("preview", preview);
        PendingIntent acknowledge = PendingIntent.getForegroundService(this, NOTIFICATION_ID, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, channel(this).getId()).setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(view).setCategory(Notification.CATEGORY_EVENT).setOngoing(true).setAutoCancel(false)
            .setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, getString(preview ? R.string.alarm_stop_preview : R.string.alarm_acknowledge), acknowledge).build()).build();
    }
    private void tick() {
        if (destroyed) return;
        handler.removeCallbacks(tick);
        StoreOrderAlarmState.pruneLocal(this);
        if (!enabled(this)) StoreOrderAlarmState.reconcile(this, StoreOrderAlarmState.eventIds(this), new JSONArray());
        JSONArray ids = StoreOrderAlarmState.eventIds(this);
        boolean preview = StoreOrderAlarmState.previewUntil(this) > android.os.SystemClock.elapsedRealtime();
        if ((!preview && ids.length() == 0) || !allowed(this)) { finishAlarm(); return; }
        String nextIds = ids.toString();
        if (!displayedIds.equals(nextIds)) { getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification()); displayedIds = nextIds; }
        player.update(tone(this), channel(this).shouldVibrate());
        if (ids.length() > 0 && !checking && android.os.SystemClock.elapsedRealtime() >= nextCheck) checkServer(ids);
        handler.postDelayed(tick, 1000);
    }
    private void checkServer(JSONArray checkedIds) {
        String secret = StoreOrderPush.prefs(this).getString("presenceToken", "");
        if (secret.isEmpty()) { finishAlarm(); return; }
        checking = true; nextCheck = android.os.SystemClock.elapsedRealtime() + 15_000;
        network.execute(() -> {
            StoreOrderAlarmApi.Result result = null;
            try { result = StoreOrderAlarmApi.request(secret, "status", checkedIds); } catch (Exception ignored) {}
            final StoreOrderAlarmApi.Result response = result;
            handler.post(() -> {
                checking = false;
                if (destroyed || !secret.equals(StoreOrderPush.prefs(this).getString("presenceToken", ""))) return;
                if (response != null && response.code == 401) { StoreOrderPush.clearBinding(this); return; }
                if (response != null && response.code == 200 && response.body.optJSONArray("activeIds") != null) {
                    StoreOrderAlarmState.applyServerState(this, checkedIds, response.body.optJSONArray("activeIds"));
                    if ("ALARM_SYNC_OFFLINE".equals(StoreOrderAlarmState.error(this))) StoreOrderAlarmState.error(this, "");
                } else StoreOrderAlarmState.error(this, "ALARM_SYNC_OFFLINE");
                // A connection failure never silently acknowledges an order or stops an already received alarm.
                tick();
            });
        });
    }
    private void finishAlarm() { player.stop(); StoreOrderAlarmState.preview(this, 0); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); }
    @Override public void onDestroy() {
        destroyed = true; handler.removeCallbacksAndMessages(null); player.stop(); network.shutdownNow();
        if (running == this) running = null;
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
