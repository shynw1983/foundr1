package jp.foundr1.store;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.RingtoneManager;
import android.net.Uri;
import android.provider.Settings;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StorePushNotificationsTest {
    Context context;
    NotificationManager manager;
    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(NotificationManager.class);
    }
    @Test public void freshInstallUsesAudibleHighImportanceChannel() {
        NotificationChannel channel = StorePushNotifications.channel(context);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.getImportance());
        assertEquals(Settings.System.DEFAULT_NOTIFICATION_URI, channel.getSound());
        assertTrue(channel.shouldVibrate());
    }
    @Test public void upgradeDoesNotReplaceLegacyMutedChannel() {
        NotificationChannel old = new NotificationChannel(StorePushNotifications.LEGACY_CHANNEL, "Order", NotificationManager.IMPORTANCE_LOW);
        old.setSound(null, null);
        manager.createNotificationChannel(old);
        NotificationChannel current = StorePushNotifications.channel(context);
        assertEquals(old.getId(), current.getId());
        assertEquals(NotificationManager.IMPORTANCE_LOW, current.getImportance());
        assertNull(current.getSound());
    }
    @Test public void explicitSoundSelectionPreservesBlockedAndVibrationPreferences() {
        NotificationChannel old = new NotificationChannel(StorePushNotifications.LEGACY_CHANNEL, "Order", NotificationManager.IMPORTANCE_NONE);
        old.enableVibration(false);
        old.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        manager.createNotificationChannel(old);
        Uri sound = Uri.parse("content://media/internal/audio/media/7");
        StorePushNotifications.selectSound(context, sound);
        NotificationChannel current = StorePushNotifications.channel(context);
        assertEquals(sound, current.getSound());
        assertEquals(NotificationManager.IMPORTANCE_NONE, current.getImportance());
        assertEquals(Notification.VISIBILITY_SECRET, current.getLockscreenVisibility());
        assertFalse(current.shouldVibrate());
        assertNotEquals(old.getId(), current.getId());
        assertNull(manager.getNotificationChannel(old.getId()));
        StorePushNotifications.selectSound(context, sound);
        assertEquals(current.getId(), StorePushNotifications.channel(context).getId());
    }
    @Test public void switchingSoundKeepsUnreadNotificationUntilDismissed() {
        StorePushNotifications.preview(context);
        String previous = StorePushNotifications.channel(context).getId();
        StorePushNotifications.selectSound(context, Uri.parse("content://media/internal/audio/media/8"));
        assertNotNull(manager.getNotificationChannel(previous));
        assertEquals(1, manager.getActiveNotifications().length);
        manager.cancelAll();
        StorePushNotifications.pruneUnusedChannels(context);
        assertNull(manager.getNotificationChannel(previous));
    }
    @Test public void cancellingPickerOrMalformedResultLeavesSoundUntouched() {
        Uri previous = StorePushNotifications.channel(context).getSound();
        StorePushNotifications.soundResult(context, StorePushNotifications.SOUND_REQUEST, Activity.RESULT_CANCELED, new Intent());
        StorePushNotifications.soundResult(context, StorePushNotifications.SOUND_REQUEST, Activity.RESULT_OK, new Intent());
        StorePushNotifications.soundResult(context, StorePushNotifications.SOUND_REQUEST, Activity.RESULT_OK,
            new Intent().putExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri.parse("https://example.com/sound")));
        assertEquals(previous, StorePushNotifications.channel(context).getSound());
    }
    @Test public void choosingSilentIsExplicitAndPersistsAcrossAccountPreferenceClear() {
        StorePushNotifications.soundResult(context, StorePushNotifications.SOUND_REQUEST, Activity.RESULT_OK,
            new Intent().putExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, (Uri) null));
        context.getSharedPreferences("foundr1_order_push", Context.MODE_PRIVATE).edit().clear().commit();
        assertNull(StorePushNotifications.channel(context).getSound());
    }
    @Test public void systemSettingsAndSoundPickerTargetCorrectSystemScreens() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        StorePushNotifications.openSettings(activity, false);
        Intent app = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, app.getAction());
        assertEquals(context.getPackageName(), app.getStringExtra(Settings.EXTRA_APP_PACKAGE));
        StorePushNotifications.openSettings(activity, true);
        Intent category = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, category.getAction());
        assertEquals(StorePushNotifications.channel(context).getId(), category.getStringExtra(Settings.EXTRA_CHANNEL_ID));
        StorePushNotifications.chooseSound(activity);
        Intent picker = Shadows.shadowOf(activity).getNextStartedActivityForResult().intent;
        assertEquals(RingtoneManager.ACTION_RINGTONE_PICKER, picker.getAction());
        assertEquals(RingtoneManager.TYPE_NOTIFICATION, picker.getIntExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, 0));
    }
    @Test public void previewUsesRealOrderChannelWithoutReceivingAnOrder() {
        StorePushNotifications.preview(context);
        Notification notification = manager.getActiveNotifications()[0].getNotification();
        assertEquals(StorePushNotifications.channel(context).getId(), notification.getChannelId());
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility);
        assertEquals(0, context.getSharedPreferences("foundr1_order_push", Context.MODE_PRIVATE).getLong("lastReceivedAt", 0));
    }
}
