package jp.foundr1.store;

import static org.junit.Assert.*;
import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class StoreInventorySyncPushTest {
    Context context;
    NotificationManager manager;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(NotificationManager.class);
        StoreOrderPush.prefs(context).edit().clear().putString("sessionId", "session")
            .putString("presenceToken", "binding").putString("rules", "[]").commit();
        Shadows.shadowOf((Application) context).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    JSONObject event() throws Exception {
        return new JSONObject().put("type", "store_inventory_sync").put("eventId", "command")
            .put("deliveryKey", "inventory-sync:command").put("sessionId", "session")
            .put("storeId", "store").put("expiresAt", System.currentTimeMillis() + 60000)
            .put("priority", "high").put("title", "販売停止の同期を確認してください")
            .put("body", "牛肉：Rocket Now で未確認");
    }

    @Test public void storeAlertNeedsNoOutsideGeofenceAndNeverStartsOrderAlarm() throws Exception {
        StoreOrderAlarmService.configure(context, true, "urgent");
        StoreOrderPush.display(context, event(), true);
        assertEquals(1, manager.getActiveNotifications().length);
        assertEquals("store-inventory-sync:command", manager.getActiveNotifications()[0].getTag());
        assertEquals(0, StoreOrderAlarmState.events(context).length());
        assertNull(Shadows.shadowOf((Application) context).getNextStartedService());
        Notification notification = manager.getActiveNotifications()[0].getNotification();
        assertEquals(StorePushNotifications.channel(context).getId(), notification.getChannelId());
        assertTrue(Shadows.shadowOf(notification.contentIntent).getSavedIntent()
            .getStringExtra("foundr1_href").contains("syncAttention=1&storeId=store"));
    }

    @Test public void sameDeliveryIsDeduplicatedAndWrongOrExpiredSessionIsRejected() throws Exception {
        StoreOrderPush.display(context, event(), true);
        StoreOrderPush.display(context, event(), true);
        assertEquals(1, manager.getActiveNotifications().length);
        manager.cancelAll();
        StoreOrderPush.display(context, event().put("sessionId", "old"), true);
        StoreOrderPush.display(context, event().put("expiresAt", 1), true);
        assertEquals(0, manager.getActiveNotifications().length);
    }

    @Test public void ordinaryOrderStillRequiresItsOutsideRule() throws Exception {
        StoreOrderPush.display(context, event().put("type", "store_order"), true);
        assertEquals(0, manager.getActiveNotifications().length);
        assertEquals(0, StoreOrderAlarmState.events(context).length());
    }

    @Test public void operationalSilenceDoesNotUseOrChangeBlockedOrderAlarmChannel() {
        StoreOrderAlarmService.configure(context, true, "urgent");
        manager.createNotificationChannel(new android.app.NotificationChannel(StoreOrderAlarmService.CHANNEL,
            "blocked", NotificationManager.IMPORTANCE_NONE));
        Notification notification = StorePushNotifications.buildOperational(context, "Sync", "Unconfirmed", null,
            new android.os.Bundle(), true);
        assertEquals(StorePushNotifications.channel(context).getId(), notification.getChannelId());
        assertEquals(Notification.GROUP_ALERT_SUMMARY, notification.getGroupAlertBehavior());
        assertEquals(NotificationManager.IMPORTANCE_NONE, manager.getNotificationChannel(StoreOrderAlarmService.CHANNEL).getImportance());
    }

    void allowOrdinaryOrderRule() {
        Shadows.shadowOf((Application) context).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION);
        Shadows.shadowOf(context.getSystemService(android.location.LocationManager.class)).setLocationEnabled(true);
        StoreOrderPush.prefs(context).edit().putString("rules", "[{\"key\":\"rule\",\"storeId\":\"store\"}]")
            .putString("state:rule", "outside").commit();
        StoreOrderAlarmService.configure(context, false, "urgent");
    }

    @Test public void ordinaryOrderWithValidOutsideRuleKeepsItsOrderNotificationAndDeepLink() throws Exception {
        allowOrdinaryOrderRule();
        String id = "00000000-0000-4000-8000-000000000001";
        StoreOrderPush.display(context, event().put("type", "store_order").put("eventId", id)
            .put("deliveryKey", "order:one").put("ruleKey", "rule"), true);
        assertEquals(1, manager.getActiveNotifications().length);
        android.service.notification.StatusBarNotification shown = manager.getActiveNotifications()[0];
        assertEquals("store-order:" + id, shown.getTag());
        assertEquals("store", shown.getNotification().extras.getString("foundr1_store_id"));
        assertEquals("/store/notifications?eventId=" + id, Shadows.shadowOf(shown.getNotification().contentIntent)
            .getSavedIntent().getStringExtra("foundr1_href"));
    }

    @Test public void enteringStoreClearsOrdinaryOrderButPreservesOperationalFailure() throws Exception {
        allowOrdinaryOrderRule();
        StoreOrderPush.display(context, event().put("type", "store_order").put("eventId", "order")
            .put("deliveryKey", "order:one").put("ruleKey", "rule"), true);
        StoreOrderPush.display(context, event(), true);
        assertEquals(2, manager.getActiveNotifications().length);
        StoreOrderPush.setPresence(context, "rule", "inside");
        assertEquals(1, manager.getActiveNotifications().length);
        assertEquals("store-inventory-sync:command", manager.getActiveNotifications()[0].getTag());
    }

    @Test public void lowPriorityOperationalFailureIsSilentWithoutChangingOrderPresentation() throws Exception {
        StoreOrderPush.display(context, event().put("priority", "normal"), true);
        assertEquals(1, manager.getActiveNotifications().length);
        Notification notification = manager.getActiveNotifications()[0].getNotification();
        assertEquals(Notification.CATEGORY_STATUS, notification.category);
        assertEquals(Notification.GROUP_ALERT_SUMMARY, notification.getGroupAlertBehavior());
        assertNotNull(StorePushNotifications.channel(context).getSound());
        assertNull(Shadows.shadowOf((Application) context).getNextStartedService());
    }
}
