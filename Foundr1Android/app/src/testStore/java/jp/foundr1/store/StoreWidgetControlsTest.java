package jp.foundr1.store;

import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StoreWidgetControlsTest {
    private Context context;
    private String session;
    private JSONObject notification(boolean enabled, String version) throws Exception {
        return new JSONObject().put("ready", true).put("canManage", true).put("preference", new JSONObject()
            .put("enabled", enabled).put("version", version).put("exitRadius", 750).put("enterRadius", 300));
    }
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        StoreWidgetControlsData.prefs(context).edit().clear().commit();
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=test-account-a");
        session = InventoryApiClient.sessionKey();
    }
    @Test public void choicesPersistPerWidgetAndNeverDuplicateOrAcceptUnknownKeys() {
        assertArrayEquals(new String[]{"reception","away"}, InventoryWidgetProvider.shortcuts(context, 3));
        InventoryWidgetProvider.saveShortcuts(context, 3, "orders", "sync");
        InventoryWidgetProvider.saveShortcuts(context, 4, "away", "away");
        assertArrayEquals(new String[]{"orders","sync"}, InventoryWidgetProvider.shortcuts(context, 3));
        assertArrayEquals(new String[]{"away","reception"}, InventoryWidgetProvider.shortcuts(context, 4));
        new InventoryWidgetProvider().onDeleted(context, new int[]{3});
        assertArrayEquals(new String[]{"reception","away"}, InventoryWidgetProvider.shortcuts(context, 3));
        assertArrayEquals(new String[]{"away","reception"}, InventoryWidgetProvider.shortcuts(context, 4));
        assertArrayEquals(new String[]{"reception","away"}, StoreWidgetControlsPolicy.normalize("unknown",null));
    }
    @Test public void expiredFailedAndOtherAccountSnapshotsAreNotActionable() throws Exception {
        StoreWidgetControlsData.save(context, "store", session, "away", notification(true,"v1"));
        StoreWidgetControlsData data = StoreWidgetControlsData.read(context, "store");
        assertTrue(data.canToggle());
        data.notificationAt = System.currentTimeMillis() - InventoryWidgetPolicy.FRESH_MILLIS - 1;
        assertFalse(data.canToggle());
        StoreWidgetControlsData.error(context,"store",session,"away",new java.io.IOException("offline"));
        assertFalse(StoreWidgetControlsData.read(context,"store").canToggle());
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=test-account-b");
        assertNull(StoreWidgetControlsData.read(context,"store").notification);
        StoreWidgetControlsData.save(context,"store",session,"away",notification(false,"old-response"));
        assertNull(StoreWidgetControlsData.read(context,"store").notification);
    }
    @Test public void delayedRefreshCannotUndoAConfirmedToggleOrRestartOldPresence() throws Exception {
        long generation = StoreWidgetControlsData.beginRead("store",session);
        long ruleGeneration = StoreWidgetControlsData.rulesGeneration();
        assertTrue(StoreWidgetControlsData.beginMutation("store",session));
        assertFalse(StoreWidgetControlsData.beginMutation("store",session));
        try {
            StoreWidgetControlsData.acceptRead(context,"store",session,generation,ruleGeneration,"away",notification(true,"old"),null);
            assertNull(StoreWidgetControlsData.read(context,"store").notification);
            StoreWidgetControlsData.save(context,"store",session,"away",notification(false,"new"));
        } finally { StoreWidgetControlsData.endMutation("store",session); }
        StoreWidgetControlsData.acceptRead(context,"store",session,generation,ruleGeneration,"away",notification(true,"old"),null);
        StoreWidgetControlsData data = StoreWidgetControlsData.read(context,"store");
        assertFalse(data.preference().getBoolean("enabled"));
        assertEquals("new", data.preference().getString("version"));
        assertFalse(StoreWidgetControlsData.acceptPresenceRules(context,ruleGeneration,new org.json.JSONArray()));
    }
    @Test public void tapCarriesItsExactWidgetStoreDesiredStateAndRuleVersion() throws Exception {
        InventoryWidgetProvider.saveConfiguration(context,3,"zh","store-a","店 A","","");
        InventoryWidgetProvider.saveConfiguration(context,4,"zh","store-b","店 B","","");
        StoreWidgetControlsData data = new StoreWidgetControlsData();
        data.notification = notification(false,"version-a"); data.notificationAt = System.currentTimeMillis();
        android.app.PendingIntent first = StoreWidgetControlsRenderer.action(context,3,"away",data);
        Intent intent = shadowOf(first).getSavedIntent();
        assertEquals("store-a",intent.getStringExtra(StoreWidgetControlActivity.EXTRA_STORE));
        assertTrue(intent.getBooleanExtra(StoreWidgetControlActivity.EXTRA_ENABLED,false));
        assertEquals("version-a",intent.getStringExtra(StoreWidgetControlActivity.EXTRA_VERSION));
        assertNotEquals(first,StoreWidgetControlsRenderer.action(context,4,"away",data));
        data.notification = notification(true,"version-b");
        android.app.PendingIntent next = StoreWidgetControlsRenderer.action(context,3,"away",data);
        assertNotEquals(first,next);
        assertFalse(shadowOf(next).getSavedIntent().getBooleanExtra(StoreWidgetControlActivity.EXTRA_ENABLED,true));
    }
}
