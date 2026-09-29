package jp.foundr1.store;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.widget.Button;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = android.app.Application.class)
public class StoreWidgetDeviceTest {
    private static final String KEY = "111111111111111111111111", OTHER = "222222222222222222222222";
    private Context context;
    private String session;
    private static JSONObject fixture;
    public static class RecordingActivity extends StoreWidgetDeviceActivity {
        int reads;
        volatile int writes;
        volatile String action, requestId;
        final java.util.concurrent.CountDownLatch sent = new java.util.concurrent.CountDownLatch(1);
        @Override void load() { reads++; showDevice(fixture); }
        @Override JSONObject sendCommand(String action, Integer position, String requestId) throws Exception {
            writes++; this.action = action; this.requestId = requestId; sent.countDown();
            return new JSONObject().put("command", new JSONObject().put("result", "accepted"));
        }
    }
    private JSONObject device(String key) throws Exception {
        return new JSONObject().put("key", key).put("name", "間接照明").put("kind", "plug").put("controlEnabled", true)
            .put("actions", new JSONArray().put("turnOn").put("turnOff"))
            .put("fetchedAt", java.time.Instant.now().toString()).put("sample", new JSONObject().put("power", "on"));
    }
    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        StoreWidgetDevicesData.prefs(context).edit().clear().commit();
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=widget-device-test");
        session = InventoryApiClient.sessionKey();
        AppWidgetProviderInfo info = new AppWidgetProviderInfo(); info.provider = new ComponentName(context, InventoryWidgetProvider.class);
        shadowOf(AppWidgetManager.getInstance(context)).addBoundWidget(7, info);
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "store", "清水店", "", "");
        fixture = device(KEY);
        StoreWidgetDevicesData.saveSlots(context, 7, fixture, device(OTHER));
    }
    private Intent intent() {
        return new Intent(context, RecordingActivity.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 7)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_STORE, "store").putExtra(StoreWidgetDeviceActivity.EXTRA_KEY, KEY)
            .putExtra(StoreWidgetDeviceActivity.EXTRA_SLOT, 0).putExtra(StoreWidgetDeviceActivity.EXTRA_SESSION, session);
    }
    private Button find(View view, String label) {
        if (view instanceof Button && label.contentEquals(((Button)view).getText())) return (Button)view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup)view).getChildCount(); i++) {
            Button result = find(((ViewGroup)view).getChildAt(i), label); if (result != null) return result;
        }
        return null;
    }
    @Test public void launcherAndRestorationReadFreshWithoutSendingAndCancelDoesNothing() {
        for (Bundle saved : new Bundle[]{null, new Bundle()}) {
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent())) {
                if (saved == null) controller.setup(); else controller.setup(saved);
                RecordingActivity activity = controller.get();
                assertEquals(1, activity.reads); assertEquals(0, activity.writes);
                assertNotNull(find(activity.getWindow().getDecorView(), "确认关闭"));
                find(activity.getWindow().getDecorView(), "取消").performClick();
                assertTrue(activity.isFinishing()); assertEquals(0, activity.writes);
            }
        }
    }
    @Test public void explicitConfirmationSendsExactlyOnceAndUsesUniqueId() throws Exception {
        try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
            RecordingActivity activity = controller.get();
            Button button = find(activity.getWindow().getDecorView(), "确认关闭");
            button.performClick(); button.performClick(); activity.execute("turnOn", null);
            assertTrue(activity.sent.await(3, java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1, activity.writes); assertEquals("turnOff", activity.action);
            assertNotNull(java.util.UUID.fromString(activity.requestId));
        }
    }
    @Test public void changedAccountStoreAndSlotCannotUseOldShortcutOrConfirmation() throws Exception {
        for (String change : new String[]{"slot", "store", "account"}) {
            setup();
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                RecordingActivity activity = controller.get();
                Button button = find(activity.getWindow().getDecorView(), "确认关闭");
                if (change.equals("slot")) StoreWidgetDevicesData.saveSlots(context, 7, device(OTHER), null);
                if (change.equals("store")) InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
                if (change.equals("account")) CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=another-account");
                button.performClick(); assertEquals(0, activity.writes);
            }
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                assertEquals(0, controller.get().reads); assertEquals(0, controller.get().writes);
            }
        }
    }
    @Test public void unconfirmedStatesDisabledControlAndCooldownExposeNoPhysicalAction() throws Exception {
        for (String failure : new String[]{"stale", "read", "disabled", "cooldown"}) {
            fixture = device(KEY);
            if (failure.equals("stale")) fixture.put("fetchedAt", "2020-01-01T00:00:00Z");
            if (failure.equals("read")) fixture.put("readError", true);
            if (failure.equals("disabled")) fixture.put("controlEnabled", false);
            if (failure.equals("cooldown")) fixture.put("blockedUntil", java.time.Instant.now().plusSeconds(10).toString());
            try (ActivityController<RecordingActivity> controller = Robolectric.buildActivity(RecordingActivity.class, intent()).setup()) {
                assertNull(failure, find(controller.get().getWindow().getDecorView(), "确认关闭"));
                controller.get().execute("turnOff", null); assertEquals(0, controller.get().writes);
            }
        }
    }
    @Test public void cacheIsAccountScopedAndDelayedReadCannotRestoreInvalidatedState() throws Exception {
        long old = StoreWidgetDevicesData.beginRead(session, "store", KEY);
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        StoreWidgetDevicesData.save(context, session, "store", KEY, old, fixture);
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
        long current = StoreWidgetDevicesData.beginRead(session, "store", KEY);
        StoreWidgetDevicesData.save(context, session, "store", KEY, current, fixture);
        StoreWidgetDevicesData.failedRead(context, session, "store", KEY, old);
        assertEquals("on", StoreWidgetDevicesData.read(context, "store", KEY).getJSONObject("sample").getString("power"));
        CookieManager.getInstance().setCookie(InventoryApiClient.BASE_URL, "foundr1_os_session=another-account");
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
        StoreWidgetDevicesData.save(context, session, "store", KEY, current, fixture);
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
    }
    @Test public void storeChangeAndRemovalClearOnlyTheirWidgetBindings() throws Exception {
        InventoryWidgetProvider.saveConfiguration(context, 8, "ja", "store", "清水店", "", "");
        StoreWidgetDevicesData.saveSlots(context, 8, fixture, null);
        InventoryWidgetProvider.saveConfiguration(context, 7, "zh", "other", "别店", "", "");
        assertEquals("", StoreWidgetDevicesData.slot(context, 7, 0).optString("key"));
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 8, 0).optString("key"));
        new InventoryWidgetProvider().onDeleted(context, new int[]{8});
        assertEquals("", StoreWidgetDevicesData.slot(context, 8, 0).optString("key"));
    }
    @Test public void deviceIdentitySurvivesClearedStatusAndUpgradesExistingBindingsLocally() throws Exception {
        fixture.put("name", "入口").put("kind", "lock");
        StoreWidgetDevicesData.saveSlots(context, 7, fixture, null);
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        assertEquals(R.drawable.inventory_widget_device_lock, StoreWidgetDevicesRenderer.icon(StoreWidgetDevicesData.slot(context, 7, 0), null));

        JSONObject oldBinding = StoreWidgetDevicesData.slot(context, 7, 0);
        oldBinding.remove("kind");
        StoreWidgetDevicesData.prefs(context).edit().putString("slot:7:0", oldBinding.toString()).commit();
        fixture.put("fetchedAt", "2020-01-01T00:00:00Z");
        StoreWidgetDevicesData.save(context, session, "store", KEY, StoreWidgetDevicesData.beginRead(session, "store", KEY), fixture);
        assertFalse(StoreWidgetDevicePolicy.fresh(fixture, System.currentTimeMillis()));
        assertEquals("lock", StoreWidgetDevicesData.slot(context, 7, 0).optString("kind"));
        StoreWidgetDevicesData.invalidate(context, session, "store", KEY);
        assertEquals(R.drawable.inventory_widget_device_lock, StoreWidgetDevicesRenderer.icon(StoreWidgetDevicesData.slot(context, 7, 0), null));
        assertEquals(KEY, StoreWidgetDevicesData.slot(context, 7, 0).optString("key"));
        assertNull(StoreWidgetDevicesData.read(context, "store", KEY));
    }
    @Test public void botsNeverInventPowerAndReadOnlySensorsCannotBeSelected() throws Exception {
        fixture.put("kind", "bot").put("actions", new JSONArray().put("press")).put("sample", new JSONObject().put("botMode", "pressMode"));
        assertEquals("状态不可读", StoreWidgetDevicePolicy.state(fixture, true));
        fixture.put("kind", "indoorLight").getJSONObject("sample").put("lightLevel", 12);
        assertEquals("亮（推测）", StoreWidgetDevicePolicy.state(fixture, true));
        fixture.getJSONObject("sample").put("lightLevel", 6);
        assertEquals("状態不明", StoreWidgetDevicePolicy.state(fixture, false));
        fixture.put("actions", new JSONArray()); assertFalse(StoreWidgetDevicePolicy.selectable(fixture));
    }
}
