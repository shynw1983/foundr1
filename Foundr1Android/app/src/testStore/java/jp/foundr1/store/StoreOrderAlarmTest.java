package jp.foundr1.store;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class StoreOrderAlarmTest {
    Context context;
    @Before public void setUp() throws Exception {
        context = RuntimeEnvironment.getApplication();
        Shadows.shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        Shadows.shadowOf(context.getSystemService(LocationManager.class)).setLocationEnabled(true);
        StoreOrderPush.prefs(context).edit().putString("sessionId", "session")
            .putString("presenceToken", "binding-secret").putString("rules", "[{\"key\":\"rule\",\"storeId\":\"store\"}]")
            .putString("state:rule", "outside").commit();
    }
    JSONObject event(String id) throws Exception {
        return new JSONObject().put("eventId", id).put("storeId", "store").put("ruleKey", "rule").put("sessionId", "session");
    }
    @Test public void duplicatesShareQueueAndAcknowledgedOrderNeverRestarts() throws Exception {
        StoreOrderAlarmState.add(context, event("one")); StoreOrderAlarmState.add(context, event("one"));
        assertEquals(1, StoreOrderAlarmState.events(context).length());
        StoreOrderAlarmState.acknowledge(context, new JSONArray().put("one"));
        StoreOrderAlarmState.add(context, event("one"));
        assertEquals(0, StoreOrderAlarmState.events(context).length());
        StoreOrderAlarmState.add(context, event("two"));
        assertEquals(1, StoreOrderAlarmState.events(context).length());
    }
    @Test public void oldNotificationActionDoesNotAcknowledgeNewOrder() throws Exception {
        StoreOrderAlarmState.add(context, event("one"));
        JSONArray shown = StoreOrderAlarmState.eventIds(context);
        StoreOrderAlarmState.add(context, event("two"));
        StoreOrderAlarmState.acknowledge(context, shown);
        assertTrue(StoreOrderAlarmState.ids(StoreOrderAlarmState.eventIds(context)).contains("two"));
        assertFalse(StoreOrderAlarmState.wasAcknowledged(context, "two"));
    }
    @Test public void statusReplyRemovesOnlyCheckedOrdersAndPreservesArrivalsDuringRequest() throws Exception {
        StoreOrderAlarmState.add(context, event("one"));
        JSONArray checked = StoreOrderAlarmState.eventIds(context);
        StoreOrderAlarmState.add(context, event("two"));
        StoreOrderAlarmState.applyServerState(context, checked, new JSONArray());
        StoreOrderAlarmState.add(context, event("one"));
        assertEquals(1, StoreOrderAlarmState.events(context).length());
        assertEquals("two", StoreOrderAlarmState.events(context).getJSONObject(0).getString("eventId"));
    }
    @Test public void invalidLocalScopeStopsAlarmButElapsedTimeDoesNot() throws Exception {
        StoreOrderAlarmState.add(context, event("one").put("expiresAt", 1));
        StoreOrderAlarmState.pruneLocal(context);
        assertEquals(1, StoreOrderAlarmState.events(context).length());
        StoreOrderPush.prefs(context).edit().putString("state:rule", "inside").commit();
        StoreOrderAlarmState.pruneLocal(context); assertEquals(0, StoreOrderAlarmState.events(context).length());
        StoreOrderPush.prefs(context).edit().putString("state:rule", "outside").commit();
        StoreOrderAlarmState.add(context, event("two").put("sessionId", "old-session"));
        StoreOrderAlarmState.pruneLocal(context); assertEquals(0, StoreOrderAlarmState.events(context).length());
    }
    @Test public void optingOutClearsActiveQueueAndDoesNotUndoPreviousAcknowledgements() throws Exception {
        StoreOrderAlarmState.add(context, event("one"));
        StoreOrderAlarmState.acknowledge(context, new JSONArray().put("one"));
        StoreOrderAlarmState.add(context, event("two"));
        StoreOrderAlarmService.configure(context, false, "pulse");
        assertEquals(0, StoreOrderAlarmState.events(context).length());
        assertTrue(StoreOrderAlarmState.wasAcknowledged(context, "one"));
        StoreOrderAlarmState.clear(context);
        assertFalse(StoreOrderAlarmState.wasAcknowledged(context, "one"));
        assertEquals("pulse", StoreOrderAlarmService.tone(context));
    }
    @Test public void disablingOneStoreStopsItsAlarmAndPreservesOtherStoresAndAcknowledgements() throws Exception {
        JSONObject otherRule = new JSONObject().put("key", "other-rule").put("storeId", "other-store");
        StoreOrderPush.prefs(context).edit().putString("rules", new JSONArray()
            .put(new JSONObject().put("key", "rule").put("storeId", "store")).put(otherRule).toString())
            .putString("state:other-rule", "outside").commit();
        StoreOrderAlarmState.add(context, event("disabled-store"));
        StoreOrderAlarmState.add(context, event("other-store-order").put("storeId", "other-store").put("ruleKey", "other-rule"));
        StoreOrderAlarmState.acknowledge(context, new JSONArray().put("already-acknowledged"));
        assertTrue(StoreOrderPush.applyRuleSnapshot(context, new JSONArray().put(otherRule)));
        assertEquals("outside", StoreOrderPush.prefs(context).getString("state:other-rule", ""));
        assertEquals(1, StoreOrderAlarmState.events(context).length());
        assertEquals("other-store-order", StoreOrderAlarmState.events(context).getJSONObject(0).getString("eventId"));
        assertTrue(StoreOrderAlarmState.wasAcknowledged(context, "already-acknowledged"));
        assertFalse(StoreOrderAlarmState.wasAcknowledged(context, "disabled-store"));
    }
    @Test public void downgradedFcmNeverStartsForegroundServiceAndBlockedChannelIsRespected() throws Exception {
        StoreOrderAlarmService.configure(context, true, "urgent");
        assertFalse(StoreOrderAlarmService.receive(context, event("one"), false));
        assertEquals("PUSH_PRIORITY_DOWNGRADED", StoreOrderAlarmState.error(context));
        assertEquals(0, StoreOrderAlarmState.events(context).length());
        android.app.Notification fallback = StorePushNotifications.build(context, "Order", "Received", null, new android.os.Bundle());
        assertEquals(StorePushNotifications.channel(context).getId(), fallback.getChannelId());
        assertNotNull(StorePushNotifications.channel(context).getSound());
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel blocked = new NotificationChannel(StoreOrderAlarmService.CHANNEL, "blocked", NotificationManager.IMPORTANCE_NONE);
        manager.createNotificationChannel(blocked);
        assertFalse(StoreOrderAlarmService.receive(context, event("two"), true));
        assertEquals(0, StoreOrderAlarmState.events(context).length());
        assertEquals(StoreOrderAlarmService.CHANNEL, StorePushNotifications.build(context, "Order", "Received", null, new android.os.Bundle()).getChannelId());
    }
    @Test public void previewUsesForegroundServiceAndStoppingPreviewKeepsRealOrders() throws Exception {
        assertTrue(StoreOrderAlarmService.preview(context));
        Intent started = Shadows.shadowOf((Application) context).getNextStartedService();
        assertEquals(StoreOrderAlarmService.class.getName(), started.getComponent().getClassName());
        assertTrue(StoreOrderAlarmState.previewUntil(context) > android.os.SystemClock.elapsedRealtime());
        StoreOrderAlarmState.add(context, event("one"));
        StoreOrderAlarmService.stopPreview(context);
        assertEquals(0, StoreOrderAlarmState.previewUntil(context));
        assertEquals(1, StoreOrderAlarmState.events(context).length());
    }
    @Test public void expiredPreviewStopsForegroundServiceInsteadOfRingingIndefinitely() {
        StoreOrderAlarmState.preview(context, android.os.SystemClock.elapsedRealtime() - 1);
        org.robolectric.android.controller.ServiceController<StoreOrderAlarmService> controller = Robolectric.buildService(StoreOrderAlarmService.class).create();
        try {
            StoreOrderAlarmService service = controller.get();
            service.onStartCommand(new Intent(context, StoreOrderAlarmService.class), 0, 1);
            assertTrue(Shadows.shadowOf(service).isStoppedBySelf());
        } finally { controller.destroy(); }
    }
    @Test public void playerLoopsAtAlarmVolumeWithoutStackingAndToneChangeReleasesPreviousPlayer() {
        java.util.ArrayList<android.media.MediaPlayer> players = new java.util.ArrayList<>();
        org.robolectric.shadows.ShadowMediaPlayer.setMediaInfoProvider(source -> new org.robolectric.shadows.ShadowMediaPlayer.MediaInfo(4000, 0));
        org.robolectric.shadows.ShadowMediaPlayer.setCreateListener((real, shadow) -> players.add(real));
        StoreOrderAlarmPlayer player = new StoreOrderAlarmPlayer(context);
        try {
            player.update("urgent", true);
            assertEquals("", StoreOrderAlarmState.error(context));
            assertEquals(1, players.size()); assertTrue(players.get(0).isLooping()); assertTrue(players.get(0).isPlaying());
            assertEquals(android.media.AudioAttributes.USAGE_ALARM, Shadows.shadowOf(players.get(0)).getAudioAttributes().getUsage());
            for (int i = 0; i < 20; i++) player.update("urgent", true);
            assertEquals(1, players.size());
            Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(16));
            assertTrue(players.get(0).isPlaying());
            player.update("pulse", true); assertEquals(2, players.size());
            assertEquals(org.robolectric.shadows.ShadowMediaPlayer.State.END, Shadows.shadowOf(players.get(0)).getState());
            assertTrue(players.get(1).isPlaying());
        } finally { player.stop(); }
        assertEquals(org.robolectric.shadows.ShadowMediaPlayer.State.END, Shadows.shadowOf(players.get(players.size() - 1)).getState());
    }
    @Test public void playingPreviewAutomaticallyStopsAfterTenSeconds() {
        org.robolectric.shadows.ShadowMediaPlayer.setMediaInfoProvider(source -> new org.robolectric.shadows.ShadowMediaPlayer.MediaInfo(4000, 0));
        StoreOrderAlarmState.preview(context, android.os.SystemClock.elapsedRealtime() + 10_000);
        org.robolectric.android.controller.ServiceController<StoreOrderAlarmService> controller = Robolectric.buildService(StoreOrderAlarmService.class).create();
        try {
            StoreOrderAlarmService service = controller.get();
            service.onStartCommand(new Intent(context, StoreOrderAlarmService.class), 0, 1);
            assertFalse(Shadows.shadowOf(service).isStoppedBySelf());
            Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(11));
            assertTrue(Shadows.shadowOf(service).isStoppedBySelf());
            assertEquals(0, StoreOrderAlarmState.previewUntil(context));
        } finally { controller.destroy(); }
    }
}
