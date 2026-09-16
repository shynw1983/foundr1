package jp.foundr1.store;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.provider.Settings;
import java.util.Objects;
import org.json.JSONObject;

/** Device presentation preferences are independent of account/geofence registration. */
final class StorePushNotifications {
    static final String LEGACY_CHANNEL = "foundr1_remote_orders_v1";
    static final String DEFAULT_CHANNEL = "foundr1_remote_orders_v2";
    static final int SOUND_REQUEST = 18674;
    private StorePushNotifications() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("foundr1_push_presentation", Context.MODE_PRIVATE);
    }
    private static NotificationManager manager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }
    static synchronized NotificationChannel channel(Context context) {
        NotificationManager manager = manager(context);
        // Keep existing user settings during upgrades. A new sound is applied only after selection.
        String id = prefs(context).getString("channel", manager.getNotificationChannel(LEGACY_CHANNEL) != null ? LEGACY_CHANNEL : DEFAULT_CHANNEL);
        NotificationChannel current = manager.getNotificationChannel(id);
        if (current != null) return current;
        current = new NotificationChannel(id, context.getString(R.string.push_channel_name), NotificationManager.IMPORTANCE_HIGH);
        current.setDescription(context.getString(R.string.push_channel_description));
        current.enableVibration(true);
        current.setVibrationPattern(new long[] {0, 450, 180, 450, 180, 700});
        current.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, audioAttributes());
        current.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(current);
        return manager.getNotificationChannel(id);
    }
    private static AudioAttributes audioAttributes() {
        return new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
    }
    static void openSettings(Activity activity, boolean category) {
        Intent intent = new Intent(category ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
        if (category) intent.putExtra(Settings.EXTRA_CHANNEL_ID, channel(activity).getId());
        try { activity.startActivity(intent); }
        catch (android.content.ActivityNotFoundException error) {
            if (category) openSettings(activity, false);
            else activity.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName())));
        }
    }
    static void chooseSound(Activity activity) {
        Intent picker = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, activity.getString(R.string.push_choose_sound))
            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, Settings.System.DEFAULT_NOTIFICATION_URI)
            .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, channel(activity).getSound());
        prefs(activity).edit().putString("soundError", "").apply();
        try { activity.startActivityForResult(picker, SOUND_REQUEST); }
        catch (android.content.ActivityNotFoundException error) { openSettings(activity, true); }
    }
    static void soundResult(Context context, int requestCode, int resultCode, Intent data) {
        if (requestCode != SOUND_REQUEST || resultCode != Activity.RESULT_OK || data == null
            || !data.hasExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)) return;
        try {
            Uri sound = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
            if (sound != null && !"content".equals(sound.getScheme()) && !"android.resource".equals(sound.getScheme())) {
                throw new IllegalArgumentException("Unsupported ringtone URI");
            }
            if (sound != null && (data.getFlags() & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
                try { context.getContentResolver().takePersistableUriPermission(sound, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                catch (SecurityException ignored) { /* System tones don't require a document grant. */ }
            }
            selectSound(context, sound);
        } catch (Exception error) { prefs(context).edit().putString("soundError", "SOUND_SELECTION_FAILED").apply(); }
    }
    static synchronized void selectSound(Context context, Uri sound) {
        NotificationChannel previous = channel(context);
        if (Objects.equals(sound, previous.getSound())) return;
        // Android channel sounds are immutable. An explicit choice creates a replacement,
        // copying the existing importance (including blocked), vibration and privacy settings.
        long sequence = prefs(context).getLong("sequence", 0) + 1;
        String id = "foundr1_remote_orders_sound_" + sequence;
        NotificationChannel next = new NotificationChannel(id, context.getString(R.string.push_channel_name), previous.getImportance());
        next.setDescription(context.getString(R.string.push_channel_description));
        next.setSound(sound, audioAttributes());
        next.setVibrationPattern(previous.getVibrationPattern());
        next.enableVibration(previous.shouldVibrate());
        next.enableLights(previous.shouldShowLights());
        next.setLightColor(previous.getLightColor());
        next.setShowBadge(previous.canShowBadge());
        next.setLockscreenVisibility(previous.getLockscreenVisibility());
        next.setBypassDnd(previous.canBypassDnd());
        NotificationManager manager = manager(context);
        manager.createNotificationChannel(next);
        if (manager.getNotificationChannel(id) == null) throw new IllegalStateException("Channel not created");
        // Commit the new ID before removing the old one; do not cancel unread order notifications.
        if (!prefs(context).edit().putString("channel", id).putLong("sequence", sequence).putString("soundError", "").commit()) {
            manager.deleteNotificationChannel(id);
            throw new IllegalStateException("Channel preference not saved");
        }
        pruneUnusedChannels(context);
    }
    static void pruneUnusedChannels(Context context) {
        NotificationManager manager = manager(context);
        String current = channel(context).getId();
        java.util.HashSet<String> active = new java.util.HashSet<>();
        for (android.service.notification.StatusBarNotification notification : manager.getActiveNotifications()) active.add(notification.getNotification().getChannelId());
        for (NotificationChannel channel : manager.getNotificationChannels()) {
            String id = channel.getId();
            if (ownsChannel(id) && !id.equals(current) && !active.contains(id)) manager.deleteNotificationChannel(id);
        }
    }
    static boolean ownsChannel(String id) { return id != null && (id.equals(LEGACY_CHANNEL) || id.equals(DEFAULT_CHANNEL) || id.startsWith("foundr1_remote_orders_sound_")); }
    static void addStatus(Context context, JSONObject result) throws Exception {
        NotificationChannel channel = channel(context);
        NotificationManager manager = manager(context);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        boolean allowed = manager.areNotificationsEnabled() && channel.getImportance() > NotificationManager.IMPORTANCE_NONE;
        boolean sound = channel.getSound() != null && channel.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT;
        String title = context.getString(R.string.push_sound_silent);
        if (channel.getSound() != null) {
            if (channel.getSound().toString().equals("android.resource://" + context.getPackageName() + "/raw/store_order_push")) title = context.getString(R.string.push_sound_original);
            else {
                Ringtone ringtone = RingtoneManager.getRingtone(context, channel.getSound());
                title = ringtone == null ? context.getString(R.string.push_sound_unavailable) : ringtone.getTitle(context);
            }
        }
        result.put("presentationVersion", 2).put("notificationsAllowed", allowed).put("soundEnabled", allowed && sound)
            .put("soundName", title).put("soundError", prefs(context).getString("soundError", ""))
            .put("highImportance", allowed && channel.getImportance() >= NotificationManager.IMPORTANCE_HIGH)
            .put("notificationVolume", audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION))
            .put("notificationVolumeMax", audio == null ? -1 : audio.getStreamMaxVolume(AudioManager.STREAM_NOTIFICATION))
            .put("ringerNormal", audio != null && audio.getRingerMode() == AudioManager.RINGER_MODE_NORMAL)
            .put("doNotDisturb", manager.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL
                && manager.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_UNKNOWN);
    }
    static Notification build(Context context, String title, String body, PendingIntent pending, android.os.Bundle extras) {
        return new Notification.Builder(context, channel(context).getId()).setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(pending).setCategory(Notification.CATEGORY_EVENT).setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(false).setTimeoutAfter(5 * 60_000).addExtras(extras).build();
    }
    static void preview(Context context) {
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("foundr1_href", "/store/notifications");
        PendingIntent pending = PendingIntent.getActivity(context, 18773, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager(context).notify("store-order:preview", 74, build(context, context.getString(R.string.push_test_title),
            context.getString(R.string.push_test_body), pending, new android.os.Bundle()));
    }
}
